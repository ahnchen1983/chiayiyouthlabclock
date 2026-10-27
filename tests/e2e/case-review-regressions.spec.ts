import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { employeeUser, adminUser, seedSession } from './helpers/session';
const base={id:'case_synthetic0001',empId:employeeUser.id,type:'pending-request',anchor:'request:synthetic',status:'open',owner:null,revision:1,expectedEvidenceVersion:'e1',window:{start:Date.parse('2026-08-01T09:00:00+08:00')/60000,end:Date.parse('2026-08-01T17:00:00+08:00')/60000},outcome:'finding',reason:'合成補卡申請待審',history:[{id:'h1',revision:1,actor:'ADMIN',at:'2026-08-02T00:00:00Z',from:null,to:'open',reason:'合成案件建立'}],notifications:{mode:'sandbox-only',counts:{held:1,'dead-letter':1},complete:true,deliveryEnabled:false}};
async function setup(page:Page,admin=false,handler?:(body:any)=>any){
 const user=admin?adminUser:employeeUser;await seedSession(page,user);await mockApi(page,{user});
 const calls:any[]=[];let detail:any=structuredClone(base);
 await page.route('**/.netlify/functions/api',async route=>{
  const body=route.request().postDataJSON();if(!body.action.includes('attendance-case'))return route.fallback();calls.push(body);
  const custom=await handler?.(body);if(custom==='abort')return route.abort();if(custom)return route.fulfill(custom);
  if(body.action==='list-attendance-cases')return route.fulfill({json:{cases:[detail],nextCursor:null,scope:'existing-attendance-role'}});
  if(body.action==='get-attendance-case')return route.fulfill({json:detail});
  if(body.action==='act-attendance-case'){
   if(!admin&&body.mode!=='explain')return route.fulfill({status:403,json:{error:'denied'}});
   detail={...detail,revision:2,expectedEvidenceVersion:'e2',status:body.mode==='request-info'?'needs-info':body.mode==='resolve'?'resolved':body.mode==='assign'?detail.status:'awaiting-review',owner:body.owner||detail.owner,history:[...detail.history,{id:'h2',revision:2,actor:user.id,at:'2026-08-02T01:00:00Z',from:detail.status,to:'awaiting-review',reason:body.reason}]};
   return route.fulfill({json:{id:detail.id,revision:detail.revision,status:detail.status}});
  }
  return route.fulfill({status:400,json:{error:'unsupported'}});
 });
 await page.goto('/');if(admin&&await page.getByRole('button',{name:'開啟選單'}).isVisible())await page.getByRole('button',{name:'開啟選單'}).click();
 await page.getByRole('button',{name:'異常待辦',exact:true}).click();await page.getByLabel('案件月份').fill('2026-08');
 if(admin)await page.getByLabel('員工編號',{exact:true}).fill(employeeUser.id);
 await page.getByRole('button',{name:'查詢案件',exact:true}).click();return calls;
}
// Case suffix shown in UI is the final eight characters, not an invented URL.
const detail=async(page:Page)=>{await page.getByRole('button',{name:/查看案件/}).first().click();await expect(page.getByRole('heading',{name:'處理歷程'})).toBeVisible();};

test('independent: opening makeup from Aug case retains case date',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+08:00'));
 await setup(page);await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(b.action==='get-employee-makeup-requests')return route.fulfill({json:[]});return route.fallback();});await detail(page);
 await page.getByRole('button',{name:'前往補打卡申請'}).click();await expect(page.getByRole('heading',{name:'補打卡申請',exact:true})).toBeVisible();
 await expect(page.locator('input[type="date"]')).toHaveValue('2026-08-01');
});
test('independent: unknown write cannot lose retry identity by reloading detail',async({page})=>{
 let writes=0;const calls=await setup(page,false,b=>{
  if(b.action==='act-attendance-case'){writes++;return writes===1?'abort':{json:{id:base.id,revision:3,status:'awaiting-review'}};}
  if(b.action==='get-attendance-case')return {json:{...base,revision:writes+1,expectedEvidenceVersion:'e'+(writes+1),status:writes?'awaiting-review':'open'}};
 });await detail(page);await page.getByLabel('處理原因／說明').fill('同一個尚未確認結果的說明');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('alert')).toContainText('連線失敗');
 await page.getByRole('button',{name:'重新載入案件'}).click();await expect(page.getByRole('heading',{name:'處理歷程'})).toBeVisible();
 // A read may show a newer revision, but cannot prove which command committed.
 await expect(page.getByRole('button',{name:'重試原操作'})).toBeVisible();
});
test('uncertain operation survives back, view navigation and browser reload with the original payload',async({page})=>{
 let writes=0;const calls=await setup(page,false,b=>b.action==='act-attendance-case'&&++writes===1?'abort':null);await detail(page);
 await page.getByLabel('處理原因／說明').fill('原始未確認操作內容');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('alert')).toContainText('連線失敗');
 const original=calls.find(c=>c.action==='act-attendance-case');await page.getByRole('button',{name:'返回案件列表'}).click();await page.getByRole('button',{name:'返回未確認案件'}).click();await expect(page.getByRole('button',{name:'重試原操作'})).toBeVisible();
 await page.getByRole('button',{name:'打卡紀錄',exact:true}).click();await page.getByRole('button',{name:'異常待辦',exact:true}).click();await expect(page.getByRole('button',{name:'返回未確認案件'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'異常待辦',exact:true}).click();await page.getByRole('button',{name:'返回未確認案件'}).click();await expect(page.getByLabel('處理原因／說明')).toHaveValue('原始未確認操作內容');await expect(page.getByLabel('處理原因／說明')).toBeDisabled();
 await page.getByRole('button',{name:'重試原操作'}).click();await expect.poll(()=>writes).toBe(2);expect(calls.filter(c=>c.action==='act-attendance-case')[1]).toEqual(original);
});
test('case leave dates remain August with no invented work/leave times',async({page})=>{
 await setup(page);await detail(page);await page.getByRole('button',{name:'前往請假／外勤申請'}).click();await expect(page.getByLabel('案件請假開始日')).toHaveValue('2026-08-01');await expect(page.getByLabel('案件請假結束日')).toHaveValue('2026-08-01');await expect(page.getByLabel('案件請假開始時間')).toHaveValue('');await expect(page.getByText(/案件 case_synthetic0001 · 員工 EMP001/)).toBeVisible();
});
test('broad scope case requires explicit incident date instead of today',async({page})=>{
 await setup(page,false,b=>b.action==='get-attendance-case'?{json:{...base,anchor:'scope:2026-08',window:{start:Date.parse('2026-08-01T00:00:00+08:00')/60000,end:Date.parse('2026-09-01T00:00:00+08:00')/60000}}}:null);await detail(page);
 await page.route('**/.netlify/functions/api',async route=>route.request().postDataJSON().action==='get-employee-makeup-requests'?route.fulfill({json:[]}):route.fallback());await page.getByRole('button',{name:'前往補打卡申請'}).click();await expect(page.locator('input[type="date"]')).toHaveValue('');await expect(page.getByText(/日期未能確定/)).toBeVisible();
});
test('manager source queue keeps the case employee and date scope',async({page})=>{
 await setup(page,true);await page.route('**/.netlify/functions/api',async route=>route.request().postDataJSON().action==='get-makeup-requests'?route.fulfill({json:[
 {id:'match',empId:employeeUser.id,name:'案件本人',date:'2026-08-01',status:'待審核',reason:'符合案件範圍'},
 {id:'other',empId:'EMP999',name:'不相關人員',date:'2026-08-01',status:'待審核',reason:'其他人'},
 {id:'wrong-day',empId:employeeUser.id,name:'案件本人',date:'2026-10-24',status:'待審核',reason:'不相關日期'}
 ]}):route.fallback());await detail(page);await page.getByRole('button',{name:'前往補打卡審核'}).click();await expect(page.getByText('符合案件範圍',{exact:true})).toBeVisible();await expect(page.getByText('不相關人員',{exact:true})).toHaveCount(0);await expect(page.getByText('不相關日期',{exact:true})).toHaveCount(0);
});
