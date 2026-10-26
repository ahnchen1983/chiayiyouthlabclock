import {UserRole} from '../../../types';
import {validDate} from '../../../utils/attendance';
import {runPayrollMutation,assertTransactionMonths,monthsInRange} from './monthGuard';
import {evidenceHash} from './attendanceCaseLifecycle';
import {LABOR_SALARY_GRADES_2026,HEALTH_FIRST_GRADE_2026,type InsurancePeriod} from '../../../utils/payroll/insurance';
/** Per-employee insurance enrollment timeline (labor/employment, health, pension
 * self-contribution) with two-person approval: one admin proposes, a different
 * admin who is not the employee approves. Enrollment is a historical fact, so
 * unlocked past months may be recorded; months already locked are refused and
 * never rewritten. Approved versions are immutable; the head points at the current.
 */
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const manager=(r:any)=>r===UserRole.Admin||r===UserRole.SuperAdmin;
const read=async(tx:any,ref:any,optional=false)=>{const s=await tx.get(ref);if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
export function validateInsurancePeriods(value:any):InsurancePeriod[]{
 if(!Array.isArray(value)||!value.length||value.length>100)fail(400,'投保期間需1–100段');
 const out:InsurancePeriod[]=[];
 for(const p of value){
  if(!validDate(p?.from)||!validDate(p?.to)||p.to<p.from)fail(400,'投保期間日期無效');
  for(const k of ['laborInsured','employmentInsured','healthInsuredHere'])if(typeof p[k]!=='boolean')fail(400,'投保項目需明確選擇');
  if(p.laborInsured&&!LABOR_SALARY_GRADES_2026.includes(p.laborSalary))fail(400,'勞保投保薪資需為分級表級距');
  if(p.employmentInsured&&!p.laborInsured)fail(400,'就業保險需與勞保同時投保');
  if(p.healthInsuredHere&&(!Number.isInteger(p.healthAmount)||p.healthAmount<HEALTH_FIRST_GRADE_2026))fail(400,'健保投保金額需為整數且不低於第一級');
  if(p.healthInsuredHere&&(!Number.isInteger(p.healthDependants)||p.healthDependants<0||p.healthDependants>20))fail(400,'健保眷屬人數無效');
  if(typeof p.pensionSelfPercent!=='number'||!(p.pensionSelfPercent>=0&&p.pensionSelfPercent<=6)||Math.round(p.pensionSelfPercent*100)!==p.pensionSelfPercent*100)fail(400,'勞退自提率需介於0–6%（至多兩位小數）');
  if(p.pensionSelfPercent>0&&(!Number.isInteger(p.pensionWage)||p.pensionWage<=0))fail(400,'自提需有月提繳工資');
  out.push({from:p.from,to:p.to,laborInsured:p.laborInsured,laborSalary:p.laborInsured?p.laborSalary:0,employmentInsured:p.employmentInsured,healthInsuredHere:p.healthInsuredHere,healthAmount:p.healthInsuredHere?p.healthAmount:0,healthDependants:p.healthInsuredHere?p.healthDependants:0,pensionWage:p.pensionSelfPercent>0?p.pensionWage:0,pensionSelfPercent:p.pensionSelfPercent});
 }
 out.sort((a,b)=>a.from.localeCompare(b.from));for(let i=1;i<out.length;i++)if(out[i].from<=out[i-1].to)fail(400,'投保期間重疊');
 return out;
}
// Months whose inputs differ between two timelines (by day), for the lock check.
const changedMonths=(a:InsurancePeriod[],b:InsurancePeriod[])=>{const key=(t:InsurancePeriod[],d:string)=>{const p=t.find(p=>p.from<=d&&p.to>=d);if(!p)return 'none';const {from:_f,to:_t,...content}=p;return JSON.stringify(content);};const dates=[...a,...b].flatMap(p=>[p.from,p.to]).sort();if(!dates.length)return [];const months=new Set<string>();
 for(const m of monthsInRange(dates[0],dates[dates.length-1])){const last=new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).getUTCDate();for(let i=1;i<=last;i++){const d=m+'-'+String(i).padStart(2,'0');if(key(a,d)!==key(b,d)){months.add(m);break;}}}
 return [...months];};
export async function loadInsurancePeriods(db:any,tx:any,empId:string):Promise<InsurancePeriod[]|null>{
 const get=(r:any)=>tx?tx.get(r):r.get(),head=await get(db.collection('insuranceTimelineHeads').doc(empId));if(!head.exists)return null;
 const v=await get(db.collection('insuranceTimelineVersions').doc(head.data().currentVersionId));const d=v.exists?v.data():null;
 return d?.status==='approved'&&d.empId===empId&&Array.isArray(d.periods)?d.periods:null;
}
export const INSURANCE_ACTIONS=['get-insurance-timeline','propose-insurance-timeline','review-insurance-timeline'] as const;
export async function handleInsuranceAction(db:any,uid:string,action:string,data:any){
 const col=(c:string)=>db.collection(c),readTx={get:(r:any)=>r.get()};
 if(!id(data.empId))fail(400,'員工識別無效');const empId:string=data.empId;
 const actor=await read(readTx,col('employees').doc(uid));if(uid!==empId&&!manager(actor.role))fail(403,'不得讀取他人投保資料');
 if(action==='get-insurance-timeline'){
  const head=await read(readTx,col('insuranceTimelineHeads').doc(empId),true),q=await col('insuranceTimelineVersions').where('empId','==',empId).limit(101).get();if(q.size>100)fail(409,'投保版本容量超限');
  const versions=q.docs.map((d:any)=>({...d.data(),id:d.id}));
  return {empId,headRevision:head?.revision||0,current:head?versions.find((v:any)=>v.id===head.currentVersionId)||null:null,versions:manager(actor.role)?versions:versions.filter((v:any)=>v.status==='approved'),canPropose:manager(actor.role)};
 }
 if(!id(data.operationId)||!Number.isInteger(data.expectedHeadRevision))fail(400,'需操作識別與版本');const reason=typeof data.reason==='string'?data.reason.trim():'';if(reason.length<5||reason.length>2000)fail(400,'需至少5字原因');
 const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await read(tx,col('employees').doc(uid));if(!manager(a.role))fail(403,'僅管理者可提出／核定投保資料');const employee=await read(tx,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'系統帳號不適用');
  const receipt=col('insuranceTimelineCommands').doc(evidenceHash([uid,data.operationId])),old=await tx.get(receipt);if(old.exists){if(old.data().hash!==hash)fail(409,'重播內容不同');return old.data().result;}
  const head=await read(tx,col('insuranceTimelineHeads').doc(empId),true);if((head?.revision||0)!==data.expectedHeadRevision)fail(409,'投保資料已變更，請重新讀取');
  const current=head?await read(tx,col('insuranceTimelineVersions').doc(head.currentVersionId)):null;let result:any;
  if(action==='propose-insurance-timeline'){
   const periods=validateInsurancePeriods(data.periods),months=changedMonths(current?.periods||[],periods);if(!months.length)fail(409,'投保資料沒有變更');await assertTransactionMonths(db,tx,months);
   result={id:'ins_'+evidenceHash([uid,data.operationId]),empId,status:'proposed',revision:1,baseHeadRevision:head?.revision||0,periods,changedMonths:months,proposedBy:uid,proposedAt:at,reason,history:[{actor:uid,at,to:'proposed',reason}]};tx.create(col('insuranceTimelineVersions').doc(result.id),result);
  }else{
   if(!id(data.versionId)||!Number.isInteger(data.expectedRevision))fail(400,'需提案識別與版本');const v=await read(tx,col('insuranceTimelineVersions').doc(data.versionId));
   if(v.empId!==empId||v.status!=='proposed'||v.revision!==data.expectedRevision||v.baseHeadRevision!==(head?.revision||0))fail(409,'提案已變更或基準過期');
   if(v.proposedBy===uid||uid===empId)fail(403,'不可核定本人投保資料或自己的提案');if(!['approve','return'].includes(data.mode))fail(400,'核定操作無效');
   const months=changedMonths(current?.periods||[],v.periods);await assertTransactionMonths(db,tx,months);
   result={...v,revision:v.revision+1,status:data.mode==='approve'?'approved':'returned',history:[...v.history,{actor:uid,at,to:data.mode,reason}],...(data.mode==='approve'?{approvedBy:uid,approvedAt:at}:{returnedBy:uid,returnedAt:at})};
   tx.set(col('insuranceTimelineVersions').doc(v.id),result);if(data.mode==='approve')tx.set(col('insuranceTimelineHeads').doc(empId),{currentVersionId:v.id,revision:(head?.revision||0)+1,actor:uid,at});
  }
  tx.create(receipt,{hash,result,actor:uid,at});return result;
 });
}
