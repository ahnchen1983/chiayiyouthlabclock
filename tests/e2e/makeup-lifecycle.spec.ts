import { test,expect,type Page } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { seedSession,employeeUser,adminUser } from './helpers/session';
const initial:any={id:'M1',empId:employeeUser.id,name:employeeUser.name,date:'2026-08-01',type:'下班',requestedClockOut:'18:00',recordId:'C1',reason:'合成原始補卡理由',status:'待審核',schemaVersion:'makeup-request-v1',revision:1,requestDate:'2026-08-02T00:00:00Z',history:[]};
const c:any={id:'case_makeup1',empId:employeeUser.id,type:'missing-out',anchor:'card:C1',status:'open',owner:null,revision:1,expectedEvidenceVersion:'e1',window:{start:Date.parse('2026-08-01T09:00:00+08:00')/60000,end:Date.parse('2026-08-01T17:00:00+08:00')/60000},outcome:'finding',reason:'合成缺卡',history:[],notifications:{mode:'sandbox-only',counts:{held:1},complete:true,deliveryEnabled:false}};
async function setup(page:Page,{admin=false,empty=false,abortFirst=false}={}){
 await seedSession(page,admin?adminUser:employeeUser);await mockApi(page,{user:admin?adminUser:employeeUser});
 let requests:any[]=empty?[]:[structuredClone(initial)],links:any[]=[];const writes:any[]=[],receipts=new Map<string,any>();let aborted=false;
 await page.route('**/.netlify/functions/api',async route=>{
  const b=route.request().postDataJSON();const reply=(json:any)=>route.fulfill({json});
  if(b.action==='get-employee-makeup-requests'||b.action==='get-makeup-requests')return reply(requests);
  if(b.action==='get-makeup-request-detail')return reply(requests.find(r=>r.id===b.requestId));
  if(b.action==='get-case-request-links')return reply({caseId:c.id,empId:c.empId,window:c.window,caseRevision:c.revision,recordId:'C1',links,history:[],historyComplete:true,workflowPolicyStatus:'needs-configuration'});
  if(b.action==='list-attendance-cases')return reply({cases:[c],nextCursor:null,scope:'existing-attendance-role'});
  if(b.action==='get-attendance-case')return reply(c);
  if(['submit-makeup-version','act-makeup-request','link-case-request'].includes(b.action)){
   writes.push(b);if(receipts.has(b.operationId))return reply(receipts.get(b.operationId));
   let result:any;
   if(b.action==='submit-makeup-version'){result={...initial,...b,id:'M2',revision:1,status:'待審核'};requests.push(result);if(b.caseId)links.push({id:'L1',caseId:c.id,requestId:result.id,state:'active',revision:1,actor:employeeUser.id,at:'2026-08-02T00:00:00Z',reason:b.reason});}
   else if(b.action==='link-case-request'){result={id:'L1',caseId:c.id,requestId:b.requestId,state:b.mode==='unlink'?'inactive':'active',revision:1,actor:employeeUser.id,at:'2026-08-02T00:00:00Z',reason:b.reason};links=[result];}
   else{
    const r=requests.find(r=>r.id===b.requestId);if(!admin&&['approve','reject','return'].includes(b.mode))return route.fulfill({status:403,json:{error:'forbidden'}});
    if(b.mode==='resubmit'){r.status='已取代';r.revision++;result={...initial,...b.patch,reason:b.reason,id:'M2',revision:1,status:'待審核',supersedesRequestId:r.id};requests.push(result);}
    else{r.status=({cancel:'已取消',return:'待補件',approve:'核准',reject:'駁回'} as any)[b.mode];r.revision++;r.history.push({id:b.operationId,actor:admin?adminUser.id:employeeUser.id,at:'2026-08-02T00:00:00Z',from:'待審核',to:r.status,reason:b.reason});if(b.mode==='return')r.returnReason=b.reason;result=r;}
   }
   receipts.set(b.operationId,structuredClone(result));if(abortFirst&&!aborted){aborted=true;return route.abort();}return reply(result);
  }
  return route.fallback();
 });
 await page.goto('/');return {writes,requests};
}
const form=async(page:Page)=>{await page.getByRole('button',{name:'補打卡',exact:true}).click();await expect(page.getByRole('heading',{name:'補打卡申請',exact:true})).toBeVisible();};
const caseView=async(page:Page)=>{await page.getByRole('button',{name:'異常待辦',exact:true}).click();await page.getByLabel('案件月份').fill('2026-08');await page.getByRole('button',{name:'查詢案件',exact:true}).click();await page.getByRole('button',{name:/查看案件/}).click();};
test('case-linked cross-night submission keeps employee/date/card and one operation on double click',async({page})=>{
 const {writes}=await setup(page,{empty:true});await caseView(page);await page.getByRole('button',{name:'前往補打卡申請'}).click();await expect(page.getByLabel('補打卡日期',{exact:true})).toHaveValue('2026-08-01');await expect(page.getByLabel('打卡紀錄 ID（多段時必須指定）')).toHaveValue('C1');
 await page.getByLabel('補打卡類型').selectOption('下班');await page.getByLabel('完整下班日期時間（跨夜必填，台北）').fill('2026-08-02T02:00:30');await page.getByLabel('申請理由',{exact:true}).fill('合成跨夜下班補卡理由');await page.getByRole('button',{name:'送出申請',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});await expect(page.getByRole('status')).toContainText('申請已送出');expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({caseId:c.id,expectedCaseRevision:1,date:'2026-08-01',recordId:'C1',requestedClockOutAt:'2026-08-02T02:00:30+08:00'});expect(writes[0].empId).toBeUndefined();
});
test('owner can cancel pending and resubmit a new version, never approve',async({page})=>{
 const {writes}=await setup(page);await form(page);await expect(page.getByRole('button',{name:'核准',exact:true})).toHaveCount(0);await page.getByLabel('操作原因',{exact:true}).fill('合成取消未核申請');await page.getByRole('button',{name:'撤回',exact:true}).click();await page.getByRole('button',{name:'編輯並重送新版本'}).click();await page.getByLabel('申請理由',{exact:true}).fill('合成改正後的新版本');await page.getByRole('button',{name:'送出新版本'}).click();await expect(page.getByRole('status')).toContainText('申請已送出');expect(writes.map(w=>w.mode)).toEqual(['cancel','resubmit']);expect(writes[1]).toMatchObject({requestId:'M1',expectedRevision:2,patch:{date:'2026-08-01',recordId:'C1',requestedClockOut:'18:00'}});
});
test('manager return requires a reason and cannot approve while awaiting supplement',async({page})=>{
 const {writes}=await setup(page,{admin:true});await page.getByRole('button',{name:'補打卡審核',exact:true}).click();await expect(page.getByRole('button',{name:'退回',exact:true})).toBeDisabled();await page.getByLabel('操作原因',{exact:true}).fill('請補正此筆下班時間');await page.getByRole('button',{name:'退回',exact:true}).click();await expect(page.getByText('退回補件：請補正此筆下班時間')).toBeVisible();await expect(page.getByRole('button',{name:'核准',exact:true})).toHaveCount(0);expect(writes[0]).toMatchObject({mode:'return',expectedRevision:1});
});
test('committed-but-unacknowledged cancellation survives reads and refresh with same payload',async({page})=>{
 const {writes}=await setup(page,{abortFirst:true});await form(page);await page.getByLabel('操作原因',{exact:true}).fill('結果不明仍保留原操作');await page.getByRole('button',{name:'撤回',exact:true}).click();await expect(page.getByRole('button',{name:'重試原操作',exact:true})).toBeVisible();await page.getByRole('button',{name:'重新載入申請紀錄'}).click();await expect(page.getByRole('button',{name:'重試原操作',exact:true})).toBeVisible();await page.reload();await form(page);await page.getByRole('button',{name:'重試原操作',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual(writes[0]);await expect(page.getByRole('button',{name:'重試原操作',exact:true})).toHaveCount(0);
});
test('existing request links persist and open the exact related request; unlink does not close case',async({page})=>{
 const {writes}=await setup(page);await caseView(page);await page.getByLabel('既有補卡申請 ID').fill('M1');await page.getByLabel('關聯處理原因').fill('合成關聯原補卡申請');await page.getByRole('button',{name:'關聯既有補卡申請',exact:true}).click();await expect(page.getByRole('button',{name:'開啟關聯申請 M1'})).toBeVisible();await page.getByRole('button',{name:'開啟關聯申請 M1'}).click();await expect(page.getByText('指定申請：M1（見紀錄）')).toBeVisible();await page.getByRole('button',{name:'返回案件詳情'}).click();await page.getByLabel('關聯處理原因').fill('合成解除錯誤關聯');await page.getByRole('button',{name:'解除此關聯'}).click();await expect(page.getByText(/已解除（保留歷程）/)).toBeVisible();expect(writes.every(w=>w.action==='link-case-request')).toBe(true);await expect(page.getByRole('heading',{name:'缺下班卡 · 待處理'})).toBeVisible();
});
test('mobile makeup form and history remain within viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await form(page);await expect(page.getByText('待簽核')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
