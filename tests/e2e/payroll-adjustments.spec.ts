import {test,expect,type Page} from '@playwright/test';
import {seedSession,adminUser,employeeUser} from './helpers/session';
import {mockApi} from './helpers/apiMock';
const month='2026-08',at='2026-09-01T00:00:00Z';
const actions=['propose-payroll-adjustment','review-payroll-adjustment','adopt-payroll-adjustment','apply-payroll-adjustment'];
const comparisonRef={id:'DIFF_SYNTH',revision:2,evidenceVersion:'synthetic-evidence-2'};
const amount=(normal:string)=>({lines:[{code:'normal',kind:'earning',amount:normal},{code:'insurance:health',kind:'deduction',amount:'0'}],net:normal});
const projection=(target='1100',posted='0')=>({baseline:amount('1000'),target:amount(target),cumulativeAdjustments:amount(posted),accountedTarget:amount(String(1000+Number(posted))),outstanding:amount(String(Number(target)-1000-Number(posted))),recordedActualNet:'1000',paymentStatus:'not-paid',automaticWageDeduction:false});
const candidate=(target='1100',posted='0')=>({comparisonRef,baseline:amount('1000'),target:amount(target),projection:projection(target,posted)});
function version(revision:number,status:string,extra:any={}){return {id:'PA_SYNTH',scope:'current',empId:employeeUser.id,month,revision,status,postingMonth:'2026-09',comparisonRef,baseline:amount('1000'),target:amount('1100'),projection:projection(),reason:'合成核對調整證據',sourceRefs:['SYNTH-ADJUSTMENT'],actor:revision===1?'OTHER_ADMIN':adminUser.id,at,...extra};}
const versions=(state='proposed',extra:any={})=>{const all=['proposed','reviewed','adopted','applied'];return all.slice(0,all.indexOf(state)+1).map((s,i)=>version(i+1,s,extra));};
function response(query:any,history:any[]=[],extra:any={}){
 const scoped=history.map(v=>({...v,scope:query.scope,empId:query.empId,month:query.month})),current=scoped.at(-1)||null;
 const runs=current?.status==='applied'?[{id:'RUN_SYNTH',...query,sequence:1,postingMonth:'2026-09',amounts:amount('100'),actor:adminUser.id,at}]:[];
 const eligible=!current||['returned','applied'].includes(current.status)?[actions[0]]:current.status==='proposed'?[actions[1]]:current.status==='reviewed'?[actions[2]]:[actions[3]];
 return {...query,current,versions:scoped,runs,projection:runs.length?projection('1100','100'):null,canManage:true,candidate:candidate('1100',runs.length?'100':'0'),candidateIssues:[],stale:false,eligibleActions:eligible,targetFreshness:'current-reviewed-source',...extra};
}
async function open(page:Page){if(await page.getByRole('button',{name:'開啟選單'}).isVisible())await page.getByRole('button',{name:'開啟選單'}).click();await page.getByRole('button',{name:'薪資調整',exact:true}).click();}
async function query(page:Page,empId=employeeUser.id,scope='current'){await page.getByLabel('調整來源範圍').selectOption(scope);await page.getByLabel('調整員工編號').fill(empId);await page.getByLabel('調整歸屬月份').fill(month);await page.getByRole('button',{name:'查詢薪資調整'}).click();}
async function fill(page:Page){await page.getByLabel('調整入帳月份',{exact:true}).fill('2026-09');await page.getByLabel('調整來源識別（每行一筆）').fill('SYNTH-ADJUSTMENT');await page.getByLabel('調整提案原因').fill('合成核對調整證據');}
async function setup(page:Page,options:{history?:any[];extra?:any;unknown?:boolean;conflict?:boolean}={}){
 await seedSession(page,adminUser);await mockApi(page,{user:adminUser});let history=options.history||[];const writes:any[]=[];
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(b.action==='get-payroll-adjustment')return route.fulfill({json:response({scope:b.scope,empId:b.empId,month:b.month},history,options.extra)});
  if(actions.includes(b.action)){writes.push(b);if(options.unknown&&writes.length===1)return route.abort();if(options.conflict)return route.fulfill({status:409,json:{error:'合成來源已改變'}});
   const status=b.action===actions[0]?'proposed':b.action===actions[1]?(b.mode==='return'?'returned':'reviewed'):b.action===actions[2]?'adopted':'applied';
   history=[...history,version(history.length+1,status,{actor:adminUser.id,scope:b.scope,empId:b.empId,month:b.month})];return route.fulfill({json:history.at(-1)});
  }return route.fallback();});await page.goto('/');await open(page);await query(page);return {writes};
}
test('proposal uses server comparison and blank posting month without editable amounts',async({page})=>{
 const {writes}=await setup(page);await expect(page.getByLabel('調整入帳月份',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'提出調整提案'})).toBeDisabled();
 const preview=page.getByRole('region',{name:'目前已覆核比較'});await expect(preview.locator('input,textarea,select,button')).toHaveCount(0);await expect(preview.getByText('正常工資 · 應發：+100')).toBeVisible();await fill(page);await page.getByRole('button',{name:'提出調整提案'}).click();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({action:actions[0],scope:'current',empId:employeeUser.id,month,postingMonth:'2026-09',comparisonRef,expectedRevision:0,reason:'合成核對調整證據',sourceRefs:['SYNTH-ADJUSTMENT']});for(const key of ['amount','amounts','target','baseline','projection','caseId'])expect(writes[0][key]).toBeUndefined();
});
test('review adoption and accounting application are separate deliberate commands',async({page})=>{
 const {writes}=await setup(page,{history:versions()});await expect(page.getByRole('button',{name:'採納已覆核調整'})).toHaveCount(0);await page.getByLabel('調整覆核／退回原因').fill('合成獨立覆核證據');await page.getByRole('button',{name:'核定調整證據'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:actions[1],expectedRevision:1,mode:'approve'});
 await expect(page.getByRole('button',{name:'採納已覆核調整'})).toBeDisabled();await page.getByLabel('調整採納原因').fill('合成另外採納紀錄');await page.getByRole('button',{name:'採納已覆核調整'}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toMatchObject({action:actions[2],expectedRevision:2});
 await expect(page.getByRole('button',{name:'記錄調整分錄'})).toBeDisabled();await page.getByLabel('調整入帳原因').fill('合成獨立入帳紀錄');await page.getByRole('button',{name:'記錄調整分錄'}).click();await expect.poll(()=>writes.length).toBe(3);expect(writes[2]).toMatchObject({action:actions[3],expectedRevision:3});expect(writes[2].amounts).toBeUndefined();await expect(page.getByText('已記錄獨立調整分錄，尚未新增實際付款。')).toBeVisible();
});
test('negative balance remains signed and never promises a wage deduction or payment',async({page})=>{
 await setup(page,{extra:{candidate:candidate('900')}});await expect(page.getByText('正常工資 · 應發：-100')).toBeVisible();await expect(page.getByText('調整分錄與實際付款分開。負數差額不會自動從以後工資扣除；原始鎖月快照保留，正式計薪門檻仍適用。')).toBeVisible();await expect(page.getByText('原記錄實發淨額：1000。已入帳金額是核算紀錄，未代表新增實際轉帳。')).toBeVisible();
});
test('historical scope is explicit and sends the reviewed historical comparison',async({page})=>{
 const {writes}=await setup(page);await query(page,employeeUser.id,'historical');await expect(page.getByText('目前查詢：歷史鎖月 · '+employeeUser.id+' · '+month)).toBeVisible();await fill(page);await page.getByRole('button',{name:'提出調整提案'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({scope:'historical',comparisonRef});
});
test('server historical-author exclusion suppresses review adoption and application',async({page})=>{
 await setup(page,{history:versions(),extra:{eligibleActions:[]}});await expect(page.getByRole('button',{name:'核定調整證據'})).toHaveCount(0);await expect(page.getByRole('button',{name:'退回調整提案'})).toHaveCount(0);
});
test('an adjustment historical proposer is excluded even if a malformed permission list allows review',async({page})=>{
 await setup(page,{history:versions('proposed',{actor:adminUser.id}),extra:{eligibleActions:[actions[1]]}});await expect(page.getByText('本人資料或歷史提案者不能覆核、採納或入帳。')).toBeVisible();await expect(page.getByRole('button',{name:'核定調整證據'})).toHaveCount(0);
});
test('salary subject sees correctly scoped applied history and ledger without mutation controls',async({page})=>{
 await setup(page);await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(b.action==='get-payroll-adjustment'&&b.empId===adminUser.id){const value=response({scope:b.scope,empId:b.empId,month:b.month},versions('applied'));return route.fulfill({json:{...value,versions:[value.current],candidate:null,canManage:false,eligibleActions:[]}});}return route.fallback();});await query(page,adminUser.id);await expect(page.getByText('調整版本 4 · 已記錄調整分錄')).toBeVisible();await expect(page.getByRole('button',{name:'提出調整提案'})).toHaveCount(0);await expect(page.getByRole('button',{name:'記錄調整分錄'})).toHaveCount(0);
});
test('stale proposed source allows return but prevents approval',async({page})=>{
 const {writes}=await setup(page,{history:versions(),extra:{stale:true,candidate:null,candidateIssues:['合成來源需重讀']}});await page.getByLabel('調整覆核／退回原因').fill('合成來源變更退回');await expect(page.getByRole('button',{name:'核定調整證據'})).toBeDisabled();await page.getByRole('button',{name:'退回調整提案'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:actions[1],mode:'return'});
});
test('a fresh target after an applied version permits a new proposal without resetting actual baseline',async({page})=>{
 const {writes}=await setup(page,{history:versions('applied'),extra:{stale:true,candidate:candidate('1200','100'),eligibleActions:[actions[0]]}});await fill(page);await page.getByRole('button',{name:'提出調整提案'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].expectedRevision).toBe(4);expect(writes[0].baseline).toBeUndefined();
});
test('unknown intent survives fresh GET reload and changed scope then retries exactly',async({page})=>{
 const {writes}=await setup(page,{unknown:true});await fill(page);await page.getByRole('button',{name:'提出調整提案'}).click();await expect(page.getByRole('button',{name:'重試原異常／追補操作'})).toBeVisible();await page.getByRole('button',{name:'查詢薪資調整'}).click();await expect(page.getByRole('button',{name:'提出調整提案'})).toBeDisabled();await page.reload();await open(page);await query(page,'EMP002','historical');await page.getByRole('button',{name:'重試原異常／追補操作'}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual(writes[0]);
});
test('conflict requires a new query and does not retain a known rejected intent',async({page})=>{
 const {writes}=await setup(page,{history:versions(),conflict:true});await page.getByLabel('調整覆核／退回原因').fill('合成獨立覆核證據');await page.getByRole('button',{name:'核定調整證據'}).click();await expect.poll(()=>writes.length).toBe(1);await expect(page.getByText('來源、版本或月份鎖定狀態已變更，請重新查詢後處理。')).toBeVisible();await expect(page.getByRole('button',{name:'核定調整證據'})).toBeDisabled();expect(await page.evaluate(()=>sessionStorage.getItem('anomaly-workflow-pending-v1:ADMIN'))).toBeNull();
});
test('late GET cannot overwrite a newer scope or its proposal target',async({page})=>{
 const {writes}=await setup(page);let release!:()=>void,started=false;const wait=new Promise<void>(resolve=>{release=resolve;});await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();if(b.action!=='get-payroll-adjustment')return route.fallback();if(b.empId==='SLOW_EMP'){started=true;await wait;}return route.fulfill({json:response({scope:b.scope,empId:b.empId,month:b.month})});});await query(page,'SLOW_EMP');await expect.poll(()=>started).toBe(true);await query(page,'FAST_EMP','historical');await expect(page.getByText('目前查詢：歷史鎖月 · FAST_EMP · '+month)).toBeVisible();const done=page.waitForResponse(r=>r.url().includes('/.netlify/functions/api')&&r.request().postDataJSON().empId==='SLOW_EMP');release();await done;await fill(page);await page.getByRole('button',{name:'提出調整提案'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({empId:'FAST_EMP',scope:'historical'});
});
test('history and posting ledger expand read-only on mobile without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{history:versions('applied')});const history=page.getByRole('region',{name:'薪資調整歷史版本'});await history.locator('summary').first().click();await expect(history.getByText(/SYNTH-ADJUSTMENT/).first()).toBeVisible();await expect(history.locator('input,textarea,select,button')).toHaveCount(0);const ledger=page.getByRole('region',{name:'薪資調整帳本'});await ledger.locator('summary').click();await expect(ledger.getByRole('region',{name:'本筆調整'}).getByText('正常工資 · 應發：+100')).toBeVisible();await expect(ledger.locator('input,textarea,select,button')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('malformed monetary or cross-scope source fails closed without coercing null to zero',async({page})=>{
 await setup(page,{extra:{candidate:{...candidate(),projection:{...projection(),target:{...amount('1100'),net:null}}}}});await expect(page.getByText('調整資料讀取失敗或來源範圍不一致，請重新查詢。')).toBeVisible();await expect(page.getByRole('button',{name:'提出調整提案'})).toHaveCount(0);
});
test('unavailable current source labels the retained ledger as an unvalidated historical snapshot',async({page})=>{
 await setup(page,{history:versions('applied'),extra:{candidate:null,candidateIssues:['合成目前來源無法核實'],stale:true,eligibleActions:[],targetFreshness:'last-applied-snapshot-not-revalidated'}});const ledger=page.getByRole('region',{name:'薪資調整帳本'});await expect(ledger.getByText('以下目標與餘額僅為上次入帳來源快照，尚未重新核對目前應付金額。')).toBeVisible();await expect(ledger.getByRole('region',{name:'上次入帳來源快照餘額'})).toBeVisible();await expect(page.getByRole('button',{name:'提出調整提案'})).toHaveCount(0);
});
