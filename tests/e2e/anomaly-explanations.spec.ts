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

async function workflow(page:Page,status='submitted',abortFirst=false){
 const calls:any[]=[];let rows:any[]=[{id:'ex1',revision:1,status,text:'合成原始說明內容',history:[]}];
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();
 if(b.action==='get-case-explanation-workflow')return route.fulfill({json:{caseId:base.id,empId:employeeUser.id,caseRevision:1,evidenceVersion:'e1',window:base.window,explanations:rows,leaves:[],policyStatus:'needs-review',settlementEligibility:'BLOCKED'}});
 if(['submit-anomaly-explanation','act-anomaly-explanation'].includes(b.action)){calls.push(b);if(abortFirst&&calls.length===1)return route.abort();rows=b.mode==='resubmit'?[{...rows[0],status:'superseded'},{...rows[0],id:'ex2',status:'submitted',text:b.text}]:[{...rows[0],status:b.mode==='accept'?'accepted':b.mode==='request-info'?'needs-info':'submitted',text:b.text||rows[0].text}];return route.fulfill({json:{id:'ex2'}});}return route.fallback();});return calls;
}
test('B4c owner supplements with a new version and cannot adopt their own explanation',async({page})=>{
 await setup(page);const calls=await workflow(page,'needs-info');await detail(page);
 await expect(page.getByRole('button',{name:'採納說明（不核准假單）'})).toHaveCount(0);
 await page.getByRole('button',{name:'補件重送說明'}).click();await page.getByLabel('異常說明內容').fill('合成補充證據新版本');
 await page.getByRole('button',{name:'重送獨立說明新版本'}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
 await expect(page.getByText('合成補充證據新版本',{exact:true})).toBeVisible();expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({mode:'resubmit',explanationId:'ex1',expectedRevision:1});
});
test('B4c manager adopts explanation only with reason, without approving leave',async({page})=>{
 await setup(page,true);const calls=await workflow(page);await detail(page);const button=page.getByRole('button',{name:'採納說明（不核准假單）'});await expect(button).toBeDisabled();
 await page.getByLabel('異常說明與假單操作理由').fill('合成已核實說明來源');await button.click();await expect(page.getByText('ex1 · v1 · accepted')).toBeVisible();expect(calls).toHaveLength(1);expect(calls[0].action).toBe('act-anomaly-explanation');
});
test('B4c ambiguous mutation survives GET and page reload with exact operation and payload',async({page})=>{
 await setup(page);const calls=await workflow(page,'submitted',true);await detail(page);await page.getByLabel('異常說明內容').fill('合成結果未知的操作');await page.getByRole('button',{name:'送出獨立異常說明'}).click();
 await expect(page.getByRole('button',{name:'重試原異常／追補操作'})).toBeVisible();await page.getByRole('button',{name:'重新讀取獨立說明與假單'}).click();await expect(page.getByLabel('異常說明內容')).toBeDisabled();
 await page.reload();await page.getByRole('button',{name:'異常待辦',exact:true}).click();await page.getByRole('button',{name:'查詢案件',exact:true}).click();await detail(page);
 await page.getByRole('button',{name:'重試原異常／追補操作'}).click();await expect(page.getByRole('button',{name:'重試原異常／追補操作'})).toHaveCount(0);expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);
});
test('B4c adopted explanation opens contextual existing leave form without approving or sending',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);const calls=await workflow(page,'accepted');await detail(page);await page.getByRole('button',{name:'依採納說明補送假單'}).click();
 await expect(page.getByText(/來源說明 ex1/)).toBeVisible();await expect(page.getByLabel('案件請假開始日')).toHaveValue('2026-08-01');expect(calls).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('B4c existing approval queue uses versioned review with reason and no legacy approval',async({page})=>{
 await setup(page,true);await workflow(page);const writes:any[]=[];let approved=false;
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(b.action==='get-all-leave-requests')return route.fulfill({json:approved?[]:[{id:'LCASE',schemaVersion:'case-leave-v1',empId:employeeUser.id,name:'合成員工',caseId:base.id,revision:1,leaveType:'事假',startDate:'2026-08-01T09:00:00+08:00',endDate:'2026-08-01T10:00:00+08:00',hours:1,reason:'合成追補來源',requestDate:'2026-08-02',status:'待審核',history:[],reviewIssues:['pay-policy-unverified']} ]});if(b.action==='review-case-leave'){writes.push(b);approved=true;return route.fulfill({json:{id:'LCASE'}});}if(b.action==='approve-leave-request'){writes.push(b);return route.fulfill({status:409,json:{error:'legacy forbidden'}});}return route.fallback();});
 await detail(page);await page.getByRole('button',{name:'前往請假／外勤審核'}).click();const button=page.getByRole('button',{name:'核准追補假（仍須計薪覆核）'});await expect(button).toBeDisabled();await page.getByLabel('追補假審核原因').fill('合成主管核實假單事實');await button.click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'review-case-leave',expectedRevision:1,mode:'approve',leaveRequestId:'LCASE'});
});
