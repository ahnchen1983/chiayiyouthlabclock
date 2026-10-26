import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import {assessPaymentEvidence} from '../../../utils/payroll/paymentEvidence';
import {loadApprovedPayrollPaymentEvidence} from './payrollPaymentEvidence';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';
export const payrollReconciliationActions=['get-payroll-reconciliation','propose-payroll-reconciliation','review-payroll-reconciliation'] as const;
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const read=async(reader:any,ref:any,optional=false)=>{const s=await reader.get(ref);if(!s.exists){if(optional)return null;fail(409,'月對帳不可變證據缺漏');}return s.data();};
const refs=(v:any)=>{if(!Array.isArray(v)||!v.length||v.length>20||v.some(x=>!payrollItemIdentifier(x))||new Set(v.map(x=>x.toLowerCase())).size!==v.length)fail(400,'需不重複來源識別');return [...v];};
const flags={approvalScope:'monthly-reconciliation-only',paymentStatus:'not-executed',policyActivation:'not-activated'} as const;
const key=(month:string)=>'pr_'+month;
/** No read clock, salary display annotation, adjustment ledger or reconciliation
 * approval can enter its own prerequisite hash. */
export function reconciliationPrerequisites(source:any){
 if(source?.kind!=='live'||!source.formalEvidence||!payrollItemMonth(source.formalEvidence.month)||typeof source.sourceHash!=='string'||!source.sourceHash||!Array.isArray(source.evaluation?.salaries))fail(409,'月對帳來源無效');
 const month=source.formalEvidence.month,employeeIds=source.evaluation.salaries.map((s:any)=>s.empId).sort();
 if(!employeeIds.length||employeeIds.some((id:any)=>!payrollItemIdentity(id))||new Set(employeeIds).size!==employeeIds.length||evidenceHash(Object.keys(source.formalEvidence.employees||{}).sort())!==evidenceHash(employeeIds))fail(409,'月對帳完整名冊與正式證據範圍不一致');
 const proofs=employeeIds.map((id:string)=>{const p=source.formalEvidence.employees[id];return {empId:id,month:p.month,sourceHash:p.sourceHash,items:p.items,attendance:p.attendance,difference:p.difference,worktime:p.worktime,payment:p.payment??null};});
 return {month,sourceHash:source.sourceHash,employeeIds,prerequisitesHash:evidenceHash({month,sourceHash:source.sourceHash,employeeIds,proofs,sourceEvidence:source.sourceEvidence})};
}
interface Assessment {month:string;employeeIds:string[];employees:Array<{empId:string;netSalary:number|null;paymentStatus:'verified-recorded'|'needs-review';issues:string[]}>;issues:string[]}
interface Candidate {month:string;sourceHash:string;prerequisitesHash:string;employeeIds:string[];employees:Array<{empId:string;netSalary:number;paymentStatus:'verified-recorded'}>}
interface Version {id:string;month:string;revision:number;status:'proposed'|'approved'|'returned';candidate:Candidate;reason:string;sourceRefs:string[];actor:string;at:string;operationId:string;previousHash:string|null;approvalScope:'monthly-reconciliation-only';paymentStatus:'not-executed';policyActivation:'not-activated'}
async function candidate(db:any,reader:any,month:string,at:string,out:Assessment={month,employeeIds:[],employees:[],issues:[]}):Promise<Candidate>{
 const {loadPayrollMonthWithFormalEvidence}=await import('./payrollFormalEvidence');
 const source:any=await loadPayrollMonthWithFormalEvidence(db,reader,{month,at,skipReconciliation:true});
 let binding:ReturnType<typeof reconciliationPrerequisites>;
 try{binding=reconciliationPrerequisites(source);}catch(error){
  if(Array.isArray(source?.evaluation?.salaries)){out.employeeIds=source.evaluation.salaries.map((s:any)=>s.empId).filter(payrollItemIdentity);out.employees=source.evaluation.salaries.filter((s:any)=>payrollItemIdentity(s.empId)).map((s:any)=>({empId:s.empId,netSalary:Number.isFinite(s.netSalary)?s.netSalary:null,paymentStatus:'needs-review',issues:['完整名冊或正式證據範圍無法核實']}));}
  out.issues.push('完整名冊或正式證據範圍無法核實');throw error;
 }
 out.employeeIds=binding.employeeIds;if(binding.month!==month)fail(409,'月對帳來源月份不一致');
 if(source.evaluation.trialStatus!=='READY')out.issues.push('整月計算尚未完整核實');
 for(const salary of source.evaluation.salaries){
  const row:Assessment['employees'][number]={empId:salary.empId,netSalary:Number.isFinite(salary.netSalary)?salary.netSalary:null,paymentStatus:'needs-review',issues:[]};out.employees.push(row);
  const p=salary.preflight,proof=source.formalEvidence.employees[salary.empId];
  if(salary.calculationStatus!=='ready'||p?.trialStatus!=='READY'||!Array.isArray(p.gaps)||!p.gaps.length||p.gaps.some((g:string)=>g!=='PRODUCTION_RECONCILIATION')||!Array.isArray(p.issues)||p.issues.some((i:any)=>i.code!=='CAPABILITY_MISSING'||i.source!=='PRODUCTION_RECONCILIATION')||!Number.isFinite(salary.netSalary)||salary.netSalary<0)row.issues.push('計算或正式證據仍有缺口',...(p?.issues||[]).filter((i:any)=>i.source!=='PRODUCTION_RECONCILIATION').map((i:any)=>i.message));
  try{
   if(proof?.empId!==salary.empId||proof.month!==month||proof.sourceHash!==source.sourceHash||proof.payment?.satisfied!==true||!proof.payment.identity)fail(409,'實際給付核對尚未完整');
   const payment=await loadApprovedPayrollPaymentEvidence(db,reader,salary.empId,month);if(!payment.approved||!payment.source)fail(409,'缺少獨立核定給付證據');
   const allocation=source.sourceEvidence.paymentAllocations?.[salary.empId]?.evidence,baseHash=allocation?.sourceBinding?.preWithholding?.baseSourceHash||source.sourceHash;
   if(payment.approved.sourceBinding.sourceHash!==baseHash)fail(409,'給付證據來源已變更');
   const assessment=assessPaymentEvidence(payment.approved.inventory,{empId:salary.empId,month,monthlyPayable:String(salary.netSalary),payableSourceRef:baseHash});
   if(assessment.status!=='ready-evidence'||evidenceHash(proof.payment.identity.paymentSource)!==evidenceHash(payment.source))fail(409,'實際給付與月薪或來源身份未對齊');row.paymentStatus='verified-recorded';
  }catch(e:any){row.issues.push(e.message||'給付證據無法核實');}
 }
 out.employees.sort((a,b)=>a.empId.localeCompare(b.empId));if(out.issues.length||out.employees.some(e=>e.issues.length))fail(409,'整月來源、正式證據或實際給付尚未全部核實');
 return {...binding,employees:out.employees.map(e=>({empId:e.empId,netSalary:e.netSalary!,paymentStatus:'verified-recorded'}))};
}
function validate(v:any,month:string,index:number,previous:Version|null,authors:Set<string>){
 if(!v||v.id!==key(month)||v.month!==month||v.revision!==index||!payrollItemIdentity(v.actor)||!payrollItemIdentifier(v.operationId)||!Number.isFinite(Date.parse(v.at))||previous&&Date.parse(v.at)<Date.parse(previous.at)||v.previousHash!==(previous?evidenceHash(previous):null)||Object.entries(flags).some(([k,x])=>v[k]!==x))fail(409,'月對帳歷程無效');
 payrollItemReason(v.reason);refs(v.sourceRefs);const c=v.candidate;
 if(!c||c.month!==month||!/^[a-f0-9]{64}$/.test(c.sourceHash)||!/^[a-f0-9]{64}$/.test(c.prerequisitesHash)||!Array.isArray(c.employeeIds)||!c.employeeIds.length||c.employeeIds.some((x:any)=>!payrollItemIdentity(x))||new Set(c.employeeIds).size!==c.employeeIds.length||c.employeeIds.includes(v.actor)||!Array.isArray(c.employees)||evidenceHash(c.employees.map((e:any)=>e.empId).sort())!==evidenceHash([...c.employeeIds].sort())||c.employees.some((e:any)=>!Number.isFinite(e.netSalary)||e.netSalary<0||e.paymentStatus!=='verified-recorded'))fail(409,'月對帳範圍或給付證據無效');
 if(v.status==='proposed'){if(previous&&!['returned','approved'].includes(previous.status))fail(409,'待核月對帳不可覆寫');authors.add(v.actor);}
 else if(!['approved','returned'].includes(v.status)||previous?.status!=='proposed'||authors.has(v.actor)||evidenceHash(previous.candidate)!==evidenceHash(c)||evidenceHash(previous.sourceRefs)!==evidenceHash(v.sourceRefs))fail(409,'月對帳非獨立覆核或來源變更');
}
async function history(db:any,reader:any,head:any,month:string){
 if(head&&(!Number.isSafeInteger(head.revision)||head.revision<1||head.revision>60))fail(409,'月對帳版本容量無效');const versions:Version[]=[],authors=new Set<string>();let previous:Version|null=null;
 for(let i=1;i<=(head?.revision||0);i++){const v=await read(reader,db.collection('payrollReconciliationVersions').doc(key(month)+'_'+i));validate(v,month,i,previous,authors);versions.push(v);previous=v;}
 if(head&&evidenceHash(head)!==evidenceHash(previous))fail(409,'月對帳目前版本與不可變歷程不一致');return {versions,authors};
}
export async function loadPayrollReconciliationEvidence(db:any,reader:any,args:{month:string;sourceHash:string;prerequisitesHash:string;employeeIds:string[]}){
 try{const {month,sourceHash,prerequisitesHash,employeeIds}=args;if(!payrollItemMonth(month)||!Array.isArray(employeeIds)||!employeeIds.length)fail(409,'月對帳範圍無效');const head=await read(reader,db.collection('payrollReconciliationHeads').doc(key(month)),true);await history(db,reader,head,month);
  if(head?.status!=='approved')return {satisfied:false,identity:null,issues:['本月尚無獨立核定的完整對帳']};
  if(head.candidate.sourceHash!==sourceHash||head.candidate.prerequisitesHash!==prerequisitesHash||evidenceHash([...employeeIds].sort())!==evidenceHash([...head.candidate.employeeIds].sort()))return {satisfied:false,identity:null,issues:['月對帳來源或正式證據已變更']};
  return {satisfied:true,identity:{id:head.id,revision:head.revision,evidenceVersion:evidenceHash(head)},issues:[]};
 }catch{return {satisfied:false,identity:null,issues:['月對帳不可變歷程無法核實']};}
}
export const PAYROLL_RECONCILIATION_ACTIONS=payrollReconciliationActions;
export async function handlePayrollReconciliationAction(db:any,uid:string,action:string,data:any){
 if(!payrollReconciliationActions.includes(action as any))fail(400,'月對帳操作無效');const get=action==='get-payroll-reconciliation',propose=action==='propose-payroll-reconciliation';
 assertPayrollItemFields(data,get?['month']:['month','expectedRevision','operationId','reason',...(propose?['sourceRefs','expectedCandidateHash']:['mode'])]);const {month}=data;
 if(!payrollItemIdentity(uid)||!payrollItemMonth(month))fail(400,'月對帳月份或操作者無效');const at=new Date().toISOString(),col=(n:string)=>db.collection(n);
 const auth=async(tx:any)=>{const actor=await read(tx,col('employees').doc(uid));if(actor.role!==UserRole.SuperAdmin)fail(403,'僅系統管理員可核對整月薪資');};
 if(get)return db.runTransaction(async(tx:any)=>{
  await auth(tx);const current=await read(tx,col('payrollReconciliationHeads').doc(key(month)),true),all=await history(db,tx,current,month);
  let available:Candidate|null=null;const candidateIssues:string[]=[],assessment:Assessment={month,employeeIds:[],employees:[],issues:[]};try{available=await candidate(db,tx,month,at,assessment);}catch(e:any){candidateIssues.push(e.message||'月對帳證據未完整');}
  if(assessment.employeeIds.includes(uid)||current?.candidate.employeeIds.includes(uid))fail(403,'涉及本月本人薪資不得讀取或處理整月對帳');
  const stale=!!current&&(!available||evidenceHash(current.candidate)!==evidenceHash(available)),eligibleActions:string[]=[];
  if(available&&(!current||current.status!=='proposed'))eligibleActions.push('propose-payroll-reconciliation');
  if(current?.status==='proposed'&&!all.authors.has(uid))eligibleActions.push('review-payroll-reconciliation');
  return {month,current,versions:all.versions,candidate:available,candidateIssues,assessment,stale,canManage:true,eligibleActions};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'月對帳操作識別或版本無效');const reason=payrollItemReason(data.reason);
 if(propose){refs(data.sourceRefs);if(typeof data.expectedCandidateHash!=='string'||!/^[a-f0-9]{64}$/.test(data.expectedCandidateHash))fail(400,'需指定預覽的正式證據摘要');}else if(!['approve','return'].includes(data.mode))fail(400,'月對帳審核操作無效');const requestHash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  await auth(tx);const receiptRef=col('payrollReconciliationCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true),head=await read(tx,col('payrollReconciliationHeads').doc(key(month)),true),all=await history(db,tx,head,month);
  if(head?.candidate.employeeIds.includes(uid))fail(403,'不得處理本人月份薪資對帳');
  if(receipt){const saved=all.versions.find(v=>v.revision===receipt.revision);if(receipt.requestHash!==requestHash||receipt.actor!==uid||!saved||saved.actor!==uid||saved.operationId!==data.operationId||receipt.resultHash!==evidenceHash(saved))fail(409,'月對帳操作收據不一致');return saved;}
  await assertTransactionMonths(db,tx,[month]);if((head?.revision||0)!==data.expectedRevision)fail(409,'月對帳版本已變更');const revision=(head?.revision||0)+1;if(revision>60)fail(409,'月對帳版本容量已滿');let v:Version;
  if(propose){const available=await candidate(db,tx,month,at);if(available.employeeIds.includes(uid))fail(403,'不得提出本人月份薪資對帳');if(available.prerequisitesHash!==data.expectedCandidateHash)fail(409,'預覽後正式證據已變更');v={id:key(month),month,revision,status:'proposed',candidate:available,reason,sourceRefs:refs(data.sourceRefs),actor:uid,at,operationId:data.operationId,previousHash:head?evidenceHash(head):null,...flags};}
  else{if(!head||all.authors.has(uid))fail(403,'提出者或歷史編輯者不得覆核');if(data.mode==='approve'){const available=await candidate(db,tx,month,at);if(available.employeeIds.includes(uid))fail(403,'不得覆核本人月份薪資');if(evidenceHash(available)!==evidenceHash(head.candidate))fail(409,'月對帳證據已變更，須重新提出');}v={...head,revision,status:data.mode==='approve'?'approved':'returned',reason,actor:uid,at,operationId:data.operationId,previousHash:evidenceHash(head)};}
  validate(v,month,revision,head,all.authors);if(Buffer.byteLength(JSON.stringify(v),'utf8')>200000)fail(409,'月對帳證據容量過大');tx.create(col('payrollReconciliationVersions').doc(key(month)+'_'+revision),v);tx.set(col('payrollReconciliationHeads').doc(key(month)),v);tx.create(receiptRef,{requestHash,actor:uid,revision,resultHash:evidenceHash(v)});return v;
 });
}
