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
test('employee sees own pending cases and history but no manager/payroll controls',async({page})=>{
 const calls=await setup(page);await detail(page);await expect(page.getByText('合成補卡申請待審',{exact:true})).toBeVisible();await expect(page.getByText('Sandbox，非真實送達',{exact:false})).toBeVisible();
 await expect(page.getByLabel('處理方式')).toHaveCount(0);await expect(page.getByLabel('員工編號',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重送推播'})).toHaveCount(0);
 expect(calls.filter(c=>c.action==='list-attendance-cases').every(c=>c.empId===employeeUser.id)).toBe(true);expect(calls.some(c=>/salary|payroll|send|retry/.test(c.action))).toBe(false);
 await page.getByLabel('處理原因／說明').fill('合成：已提交補卡，請核實');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('heading',{name:/申請待審.*待管理者覆核/})).toBeVisible();
});
test('double click sends one command; cancelled editing sends nothing',async({page})=>{
 const calls=await setup(page,false,async b=>{if(b.action==='act-attendance-case')await new Promise(r=>setTimeout(r,300));});await detail(page);
 await page.getByLabel('處理原因／說明').fill('取消這段草稿');await page.getByRole('button',{name:'取消編輯'}).click();expect(calls.filter(c=>c.action==='act-attendance-case')).toHaveLength(0);await expect(page.getByLabel('處理原因／說明')).toHaveValue('');
 await page.getByLabel('處理原因／說明').fill('唯一說明');await page.getByRole('button',{name:'送出處理',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});await expect(page.getByRole('heading',{name:/待管理者覆核/})).toBeVisible();expect(calls.filter(c=>c.action==='act-attendance-case')).toHaveLength(1);
});
test('unknown network outcome retries the exact operation ID and immutable content',async({page})=>{
 let attempt=0;const calls=await setup(page,false,b=>b.action==='act-attendance-case'&&++attempt===1?'abort':null);await detail(page);
 await page.getByLabel('處理原因／說明').fill('重送相同說明');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('alert')).toContainText('連線失敗');await expect(page.getByLabel('處理原因／說明')).toBeDisabled();
 await page.getByRole('button',{name:'重試原操作'}).click();await expect(page.getByRole('heading',{name:/待管理者覆核/})).toBeVisible();const writes=calls.filter(c=>c.action==='act-attendance-case');expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);
});
test('stale version requires explicit refresh and a new deliberate submission',async({page})=>{
 let write=0,get=0;const calls=await setup(page,true,b=>{
  if(b.action==='get-attendance-case'&&++get>1)return{json:{...base,revision:7,expectedEvidenceVersion:'e7'}};
  if(b.action==='act-attendance-case'&&++write===1)return{status:409,json:{error:'stale'}};
 });await detail(page);await page.getByLabel('處理方式').selectOption('request-info');await page.getByLabel('處理原因／說明').fill('請補充');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('alert')).toContainText('已變動');await expect(page.getByRole('button',{name:'送出處理',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'重新載入案件'}).click();await expect(page.getByText(/版本 7/).first()).toBeVisible();expect(write).toBe(1);
 await page.getByLabel('處理方式').selectOption('request-info');await page.getByLabel('處理原因／說明').fill('已讀取最新版本，請補充');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect.poll(()=>write).toBe(2);const writes=calls.filter(c=>c.action==='act-attendance-case');expect(writes[1].expectedRevision).toBe(7);expect(writes[1].operationId).not.toBe(writes[0].operationId);
});
test('manager assignment and return-for-information use existing contract and required reason',async({page})=>{
 const calls=await setup(page,true);await detail(page);await page.getByLabel('處理方式').selectOption('assign');await page.getByLabel('負責人管理員編號').fill('ADMIN');await expect(page.getByRole('button',{name:'送出處理',exact:true})).toBeDisabled();
 await page.getByLabel('處理原因／說明').fill('指定既有管理員');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByText('員工 EMP001 · 負責人 ADMIN')).toBeVisible();
 await page.getByLabel('處理方式').selectOption('request-info');await page.getByLabel('處理原因／說明').fill('退回案件補件，不駁回假單');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('heading',{name:/待補件／資料/})).toBeVisible();expect(calls.filter(c=>c.action==='act-attendance-case').map(c=>c.mode)).toEqual(['assign','request-info']);
});
test('unknown evidence cannot close when server refuses; locked month remains unchanged',async({page})=>{
 let locked=false;const calls=await setup(page,true,b=>b.action==='act-attendance-case'?{status:locked?423:409,json:{error:'blocked'}}:null);await detail(page);await page.getByLabel('處理方式').selectOption('resolve');await page.getByLabel('處理原因／說明').fill('請伺服器重核');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('alert')).toContainText('仍待核實');
 locked=true;await page.getByRole('button',{name:'重新載入案件'}).click();await page.getByLabel('處理原因／說明').fill('補充');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('alert')).toContainText('已鎖定');expect(calls.some(c=>/lock-month|approve/.test(c.action))).toBe(false);
});
test('filters reset pagination; next/back preserve applied filter; read error can retry',async({page})=>{
 let fail=true;const calls=await setup(page,false,b=>{
  if(b.action==='list-attendance-cases'&&fail){fail=false;return{status:503,json:{error:'temporary'}};}
  if(b.action==='list-attendance-cases')return{json:{cases:[{...base,id:b.afterId?'case_page2':base.id}],nextCursor:b.afterId?null:'cursor-1',scope:'existing-attendance-role'}};
 });await page.getByRole('button',{name:'重試查詢'}).click();await page.getByLabel('案件狀態').selectOption('needs-info');await page.getByLabel('異常類別').selectOption('approved-unapplied');await page.getByRole('button',{name:'查詢案件',exact:true}).click();await page.getByRole('button',{name:'下一頁'}).click();await expect(page.getByText(/第 2 頁/)).toBeVisible();await page.getByRole('button',{name:'上一頁'}).click();await expect(page.getByText(/第 1 頁/)).toBeVisible();
 const queries=calls.filter(c=>c.action==='list-attendance-cases');expect(queries.at(-2)).toMatchObject({status:'needs-info',type:'approved-unapplied',afterId:'cursor-1'});expect(queries.at(-1).afterId).toBeUndefined();
});
for(const admin of [false,true])test(`existing ${admin?'review':'application'} navigation/back loads real components without submitting`,async({page})=>{
 const calls=await setup(page,admin);const sourceReads:string[]=[];
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(['get-employee-makeup-requests','get-makeup-requests','get-all-leave-requests'].includes(b.action)){sourceReads.push(b.action);return route.fulfill({json:[]});}return route.fallback();});await detail(page);
 await page.getByRole('button',{name:admin?'前往補打卡審核':'前往補打卡申請'}).click();await expect(page.getByRole('heading',{name:admin?'補打卡審核':'補打卡申請',exact:true})).toBeVisible();await expect.poll(()=>sourceReads.includes(admin?'get-makeup-requests':'get-employee-makeup-requests')).toBe(true);
 await page.getByRole('button',{name:'返回案件詳情'}).click();await expect(page.getByRole('heading',{name:'處理歷程'})).toBeVisible();
 await page.getByRole('button',{name:admin?'前往請假／外勤審核':'前往請假／外勤申請'}).click();await expect(page.getByRole('heading',{name:admin?'請假／外勤審核':'請假／外勤申請',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回案件詳情'}).click();
 expect(calls.filter(c=>c.action==='act-attendance-case')).toHaveLength(0);
});
test('confirmed write followed by failed refresh is never retried as a write',async({page})=>{
 let reads=0;const calls=await setup(page,false,b=>b.action==='get-attendance-case'&&++reads===2?'abort':null);await detail(page);
 await page.getByLabel('處理原因／說明').fill('已成功處理的說明');await page.getByRole('button',{name:'送出處理',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'操作已受理'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('連線失敗');await expect(page.getByRole('button',{name:'重試原操作'})).toHaveCount(0);await expect(page.getByRole('button',{name:'送出處理',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'重新載入案件'}).click();await expect(page.getByRole('heading',{name:/待管理者覆核/})).toBeVisible();expect(calls.filter(c=>c.action==='act-attendance-case')).toHaveLength(1);
});
test('403 detail never renders previous or other employee case',async({page})=>{
 await setup(page,false,b=>b.action==='get-attendance-case'?{status:403,json:{error:'private'}}:null);await page.getByRole('button',{name:/查看案件/}).click();await expect(page.getByRole('alert')).toContainText('無權');await expect(page.getByRole('heading',{name:'處理歷程'})).toHaveCount(0);await expect(page.getByText('private',{exact:true})).toHaveCount(0);
});
test('mobile case center has no horizontal overflow and displays approved-unapplied',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,false,b=>b.action==='get-attendance-case'?{json:{...base,type:'approved-unapplied',outcome:'unknown'}}:null);await detail(page);await expect(page.getByRole('heading',{name:/已核准未反映/})).toBeVisible();await expect(page.getByText('來源判定：資料或政策未完整')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
