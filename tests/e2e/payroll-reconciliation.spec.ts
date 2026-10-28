import {test,expect,type Page} from '@playwright/test';
import {seedSession,adminUser,employeeUser,peerUser} from './helpers/session';
import {mockApi} from './helpers/apiMock';
const month='2026-08',at='2026-09-01T00:00:00Z';
const propose='propose-payroll-reconciliation',review='review-payroll-reconciliation';
const candidate=(target=month)=>({month:target,sourceHash:'synthetic-source-'+target,prerequisitesHash:'synthetic-prerequisites-'+target,employeeIds:[employeeUser.id,peerUser.id],employees:[{empId:employeeUser.id,netSalary:30000,paymentStatus:'verified-recorded'},{empId:peerUser.id,netSalary:0,paymentStatus:'verified-recorded'}]});
const assessment=(target=month)=>({...candidate(target),issues:[],employees:candidate(target).employees.map(row=>({...row,issues:[]}))});
const version=(revision:number,status:string,extra:any={})=>({id:'REC_SYNTH',month,revision,status,candidate:candidate(),reason:'合成全月逐人對帳證據',sourceRefs:['SYNTH-RECONCILIATION'],actor:revision===1?'OTHER_ADMIN':adminUser.id,at,operationId:'synthetic-op-'+revision,previousHash:revision===1?null:'synthetic-prior',...extra});
function response(target=month,versions:any[]=[],extra:any={}){
 const scoped=versions.map(v=>({...v,month:target,candidate:{...v.candidate,month:target}})),current=scoped.at(-1)||null;
 return {month:target,current,versions:scoped,candidate:candidate(target),assessment:assessment(target),candidateIssues:[],stale:false,canManage:true,eligibleActions:current?.status==='proposed'?[review]:[propose],...extra};
}
async function open(page:Page){if(await page.getByRole('button',{name:'開啟選單'}).isVisible())await page.getByRole('button',{name:'開啟選單'}).click();await page.getByRole('button',{name:'月薪資對帳',exact:true}).click();}
async function query(page:Page,target=month){await page.getByLabel('對帳月份',{exact:true}).fill(target);await page.getByRole('button',{name:'查詢月薪資對帳'}).click();}
async function fill(page:Page){await page.getByLabel('月對帳來源識別（每行一筆）').fill('SYNTH-RECONCILIATION');await page.getByLabel('月對帳提案原因').fill('合成全月逐人對帳證據');}
async function setup(page:Page,options:{versions?:any[];extra?:any;unknown?:boolean;conflict?:boolean}={}){
 await seedSession(page,adminUser);await mockApi(page,{user:adminUser});let versions=options.versions||[];const writes:any[]=[];
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(b.action==='get-payroll-reconciliation')return route.fulfill({json:response(b.month,versions,options.extra)});
  if([propose,review].includes(b.action)){writes.push(b);if(options.unknown&&writes.length===1)return route.abort();if(options.conflict)return route.fulfill({status:409,json:{error:'合成來源版本不符'}});versions=[...versions,version(versions.length+1,b.action===propose?'proposed':b.mode==='return'?'returned':'approved',{month:b.month,candidate:candidate(b.month),actor:adminUser.id})];return route.fulfill({json:versions.at(-1)});}return route.fallback();});
 await page.goto('/');await open(page);await query(page);return {writes};
}
test('complete roster preserves explicit zero and proposal binds the displayed source digest',async({page})=>{
 const {writes}=await setup(page);const roster=page.getByRole('region',{name:'本月完整名冊與待辦'});await expect(roster.getByText('完整名冊：2 人')).toBeVisible();await expect(roster.getByRole('article',{name:'對帳員工 EMP002'}).getByText('計算淨額：0')).toBeVisible();await expect(roster.getByText('前提證據摘要：synthetic-prerequisites-2026-08')).toBeVisible();await expect(roster.locator('input,textarea,select,button')).toHaveCount(0);await expect(page.getByRole('button',{name:'提出月對帳證據'})).toBeDisabled();await fill(page);await page.getByRole('button',{name:'提出月對帳證據'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:propose,month,expectedRevision:0,expectedCandidateHash:'synthetic-prerequisites-2026-08',sourceRefs:['SYNTH-RECONCILIATION'],reason:'合成全月逐人對帳證據'});for(const key of ['candidate','employees','netSalary','sourceHash','caseId'])expect(writes[0][key]).toBeUndefined();
});
test('incomplete roster shows all rows and individual blockers without treating unknown money as zero',async({page})=>{
 const incomplete={...assessment(),issues:['合成全月名冊尚未核實'],employees:[{empId:employeeUser.id,netSalary:30000,paymentStatus:'verified-recorded',issues:[]},{empId:peerUser.id,netSalary:null,paymentStatus:'needs-review',issues:['合成付款證據缺漏','合成工時核定未完成']}]};await setup(page,{extra:{candidate:null,assessment:incomplete,candidateIssues:['合成目前全月前提未完成'],eligibleActions:[]}});const roster=page.getByRole('region',{name:'本月完整名冊與待辦'});await expect(roster.getByRole('article')).toHaveCount(2);const pending=roster.getByRole('article',{name:'對帳員工 EMP002'});await expect(pending.getByText('計算淨額：待核實')).toBeVisible();await expect(pending.getByText('合成付款證據缺漏')).toBeVisible();await expect(pending.getByText('合成工時核定未完成')).toBeVisible();await expect(page.getByRole('button',{name:'提出月對帳證據'})).toHaveCount(0);
});
test('independent approval records reconciliation only and requires its own reason',async({page})=>{
 const {writes}=await setup(page,{versions:[version(1,'proposed')]});await expect(page.getByRole('button',{name:'核定月對帳證據'})).toBeDisabled();await page.getByLabel('月對帳覆核／退回原因').fill('合成第二人獨立核對');await page.getByRole('button',{name:'核定月對帳證據'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:review,month,expectedRevision:1,mode:'approve'});expect(writes[0].candidate).toBeUndefined();await expect(page.getByText('已核定此版本對帳證據；來源變更後須重新核對。')).toBeVisible();await expect(page.getByText('本頁只記錄對帳證據。核定不會付款或自動鎖月；正常鎖月仍須重新確認所有來源及核定版本有效。')).toBeVisible();
});
test('a historical proposer cannot review a later proposal even if current author is different',async({page})=>{
 await setup(page,{versions:[version(1,'proposed',{actor:adminUser.id}),version(2,'returned'),version(3,'proposed',{actor:'ANOTHER_ADMIN'})]});await expect(page.getByRole('button',{name:'核定月對帳證據'})).toHaveCount(0);await expect(page.getByText('本月薪資名冊內人員或任何歷史提案者不能獨立覆核本月對帳。')).toBeVisible();
});
test('a roster subject cannot approve even if server action list is inconsistent',async({page})=>{
 const own={...candidate(),employeeIds:[adminUser.id],employees:[{empId:adminUser.id,netSalary:30000,paymentStatus:'verified-recorded'}]};await setup(page,{versions:[version(1,'proposed',{candidate:own})],extra:{candidate:own,eligibleActions:[review]}});await expect(page.getByRole('button',{name:'核定月對帳證據'})).toHaveCount(0);
});
test('stale proposed evidence permits return but prevents approval',async({page})=>{
 const {writes}=await setup(page,{versions:[version(1,'proposed')],extra:{stale:true,candidate:null,candidateIssues:['合成來源已變更']}});await page.getByLabel('月對帳覆核／退回原因').fill('合成來源變更需退回');await expect(page.getByRole('button',{name:'核定月對帳證據'})).toBeDisabled();await page.getByRole('button',{name:'退回月對帳提案'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:review,mode:'return',expectedRevision:1});
});
test('fresh candidate after stale approved evidence can be proposed as a new immutable version',async({page})=>{
 const {writes}=await setup(page,{versions:[version(1,'proposed'),version(2,'approved')],extra:{stale:true}});await fill(page);await page.getByRole('button',{name:'提出月對帳證據'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({expectedRevision:2,expectedCandidateHash:'synthetic-prerequisites-2026-08'});
});
test('unknown proposal survives GET reload and a different month before exact retry',async({page})=>{
 const {writes}=await setup(page,{unknown:true});await fill(page);await page.getByRole('button',{name:'提出月對帳證據'}).click();await expect(page.getByRole('button',{name:'重試原異常／追補操作'})).toBeVisible();await page.getByRole('button',{name:'查詢月薪資對帳'}).click();await expect(page.getByRole('button',{name:'提出月對帳證據'})).toBeDisabled();await page.reload();await open(page);await query(page,'2026-09');await page.getByRole('button',{name:'重試原異常／追補操作'}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual(writes[0]);expect(writes[1].month).toBe(month);
});
test('source digest conflict requires refreshing and clears only the known rejected intent',async({page})=>{
 const {writes}=await setup(page,{conflict:true});await fill(page);await page.getByRole('button',{name:'提出月對帳證據'}).click();await expect.poll(()=>writes.length).toBe(1);await expect(page.getByText('名冊、付款證據或來源版本已變更，請重新查詢後處理。')).toBeVisible();await expect(page.getByRole('button',{name:'提出月對帳證據'})).toBeDisabled();expect(await page.evaluate(()=>sessionStorage.getItem('anomaly-workflow-pending-v1:ADMIN'))).toBeNull();
});
test('late roster GET cannot replace the newer month or its bound digest',async({page})=>{
 const {writes}=await setup(page);let release!:()=>void,started=false;const wait=new Promise<void>(resolve=>{release=resolve;});await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(b.action!=='get-payroll-reconciliation')return route.fallback();if(b.month==='2026-07'){started=true;await wait;}return route.fulfill({json:response(b.month)});});await query(page,'2026-07');await expect.poll(()=>started).toBe(true);await query(page,'2026-09');await expect(page.getByText('目前對帳月份：2026-09')).toBeVisible();const done=page.waitForResponse(r=>r.url().includes('/.netlify/functions/api')&&r.request().postDataJSON().month==='2026-07');release();await done;await fill(page);await page.getByRole('button',{name:'提出月對帳證據'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({month:'2026-09',expectedCandidateHash:'synthetic-prerequisites-2026-09'});
});
test('immutable reconciliation history expands read-only on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{versions:[version(1,'proposed'),version(2,'approved')]});const history=page.getByRole('region',{name:'月薪資對帳歷史版本'});await history.locator('summary').first().click();await expect(history.getByText('前提證據摘要：synthetic-prerequisites-2026-08').first()).toBeVisible();await expect(history.locator('input,textarea,select,button')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('duplicate roster identities fail closed rather than appearing as complete',async({page})=>{
 const broken={...candidate(),employeeIds:[employeeUser.id,employeeUser.id]};await setup(page,{extra:{candidate:broken}});await expect(page.getByText('對帳資料讀取失敗或名冊／歷程不一致，請重新查詢。')).toBeVisible();await expect(page.getByRole('button',{name:'提出月對帳證據'})).toHaveCount(0);
});
test('missing candidate does not become ready merely because returned issue arrays are empty',async({page})=>{
 await setup(page,{extra:{candidate:null,assessment:null,candidateIssues:[],eligibleActions:[propose]}});await expect(page.getByText('完整名冊評估尚未取得，不能視為無待辦。')).toBeVisible();await fill(page);await expect(page.getByRole('button',{name:'提出月對帳證據'})).toBeDisabled();
});
