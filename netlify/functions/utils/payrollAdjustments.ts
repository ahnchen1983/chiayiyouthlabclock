import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import {projectPayrollAdjustments,validateAdjustmentAmounts,type AdjustmentAmounts} from '../../../utils/payroll/adjustment';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';
import {loadReviewedPayrollDifferenceForAdjustment} from './payrollDifference';
import {loadReviewedHistoricalPayrollDifferenceForAdjustment} from './historicalPayrollDifference';
export const PAYROLL_ADJUSTMENT_ACTIONS=['get-payroll-adjustment','propose-payroll-adjustment','review-payroll-adjustment','adopt-payroll-adjustment','apply-payroll-adjustment'] as const;
type Scope='current'|'historical';type State='proposed'|'reviewed'|'returned'|'adopted'|'applied';
const fail=(code:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode:code});};
const flags={applicationScope:'reconciliation-accounting-only',paymentStatus:'not-paid',automaticWageDeduction:false,formalEligibility:'BLOCKED'} as const;
const idFor=(empId:string,month:string,scope:Scope)=>'pa_'+evidenceHash([empId,month,scope]);
const read=async(reader:any,ref:any,optional=false)=>{const s=await reader.get(ref);if(!s.exists){if(optional)return null;fail(409,'調整不可變來源缺漏');}return s.data();};
const refs=(v:any)=>{if(!Array.isArray(v)||!v.length||v.length>20||v.some(x=>!payrollItemIdentifier(x))||new Set(v).size!==v.length)fail(400,'需不重複來源識別');return [...v];};
export interface PayrollAdjustmentVersion {
 id:string;empId:string;month:string;scope:Scope;revision:number;status:State;postingMonth:string;
 comparisonRef:{id:string;revision:number;evidenceVersion:string};binding:any;sourceAuthors:string[];
 baseline:AdjustmentAmounts;target:AdjustmentAmounts;projection:ReturnType<typeof projectPayrollAdjustments>;
 baselineEvidenceHash:string;priorLedgerHash:string|null;priorRunCount:number;
 reason:string;sourceRefs:string[];actor:string;at:string;operationId:string;previousHash:string|null;
 applicationScope:'reconciliation-accounting-only';paymentStatus:'not-paid';automaticWageDeduction:false;formalEligibility:'BLOCKED';
}
const runFor=(v:PayrollAdjustmentVersion)=>({id:v.id+'_'+v.revision,adjustmentId:v.id,revision:v.revision,empId:v.empId,month:v.month,scope:v.scope,postingMonth:v.postingMonth,sequence:v.priorRunCount+1,previousHash:v.priorLedgerHash,baselineEvidenceHash:v.baselineEvidenceHash,binding:v.binding,amounts:v.projection.outstanding,actor:v.actor,at:v.at,...flags});
async function chain(db:any,reader:any,head:any,id:string,empId:string,month:string,scope:Scope){
 const versions:PayrollAdjustmentVersion[]=[],runs:any[]=[];let previous:PayrollAdjustmentVersion|null=null,ledgerHash:string|null=null;const authors=new Set<string>();
 if(head&&(!Number.isSafeInteger(head.revision)||head.revision<1||head.revision>80))fail(409,'調整歷程容量或版本無效');
 for(let i=1;i<=(head?.revision||0);i++){
  const v:PayrollAdjustmentVersion=await read(reader,db.collection('payrollAdjustmentVersions').doc(id+'_'+i));
  if(v.id!==id||v.empId!==empId||v.month!==month||v.scope!==scope||v.revision!==i||!payrollItemMonth(v.postingMonth)||!payrollItemIdentity(v.actor)||v.actor===empId||!payrollItemIdentifier(v.operationId)||!Number.isFinite(Date.parse(v.at))||previous&&Date.parse(v.at)<Date.parse(previous.at)||v.previousHash!==(previous?evidenceHash(previous):null)||Object.entries(flags).some(([k,x])=>(v as any)[k]!==x))fail(409,'調整歷程不一致');
  payrollItemReason(v.reason);refs(v.sourceRefs);
  if(!Array.isArray(v.sourceAuthors)||v.sourceAuthors.some(a=>!payrollItemIdentity(a))||!v.binding||!v.comparisonRef?.id||!Number.isSafeInteger(v.comparisonRef.revision)||v.comparisonRef.revision<1||!v.comparisonRef.evidenceVersion)fail(409,'調整比較來源無效');
  validateAdjustmentAmounts(v.baseline);validateAdjustmentAmounts(v.target);
  if(previous&&(evidenceHash(v.baseline)!==evidenceHash(previous.baseline)||v.baselineEvidenceHash!==previous.baselineEvidenceHash))fail(409,'已凍結的實際基準不可變更');
  if(v.status==='proposed'){
   if(previous&&!['returned','applied'].includes(previous.status))fail(409,'調整尚未結束');authors.add(v.actor);
  }else{
   for(const a of v.sourceAuthors)authors.add(a);
   if(authors.has(v.actor))fail(409,'調整非獨立覆核');
   const expected=v.status==='reviewed'||v.status==='returned'?'proposed':v.status==='adopted'?'reviewed':v.status==='applied'?'adopted':null;
   if(!previous||previous.status!==expected)fail(409,'調整狀態歷程無效');
   const content=(x:PayrollAdjustmentVersion)=>[x.postingMonth,x.comparisonRef,x.binding,x.sourceAuthors,x.baseline,x.target,x.baselineEvidenceHash,x.projection,x.priorRunCount,x.priorLedgerHash];
   if(evidenceHash(content(previous))!==evidenceHash(content(v)))fail(409,'調整審核不可變更金額或來源');
  }
  for(const a of v.sourceAuthors)authors.add(a);
  if(v.priorRunCount!==runs.length||v.priorLedgerHash!==ledgerHash||evidenceHash(v.projection)!==evidenceHash(projectPayrollAdjustments(v.baseline,v.target,runs.map(r=>r.amounts))))fail(409,'調整累計或差額無效');
  if(v.status==='applied'){
   const run=await read(reader,db.collection('payrollAdjustmentRuns').doc(id+'_'+i));if(evidenceHash(run)!==evidenceHash(runFor(v)))fail(409,'調整分錄與核定版本不一致');runs.push(run);ledgerHash=evidenceHash(run);
  }
  versions.push(v);previous=v;
 }
 if(head&&evidenceHash(head)!==evidenceHash(previous))fail(409,'調整目前版本與不可變歷程不一致');
 const ledger=await read(reader,db.collection('payrollAdjustmentLedgers').doc(id),true);
 if(runs.length?evidenceHash(ledger)!==evidenceHash({id,empId,month,scope,sequence:runs.length,headHash:ledgerHash,baselineEvidenceHash:previous!.baselineEvidenceHash}):!!ledger)fail(409,'調整帳本序列不一致');
 return {versions,runs,authors,ledgerHash};
}
async function fresh(db:any,reader:any,args:any){
 const loader=args.scope==='current'?loadReviewedPayrollDifferenceForAdjustment:loadReviewedHistoricalPayrollDifferenceForAdjustment;
 const value=await loader(db,reader,{empId:args.empId,month:args.month,at:args.at,comparisonRef:args.comparisonRef});
 const source=value.source;if(source?.status!=='comparable'||source.issues?.length||!Array.isArray(source.lines)||source.lines.some((l:any)=>l.status!=='confirmed'||typeof l.amount!=='string'))fail(409,'調整目標仍有未核定來源');
 const baseline=validateAdjustmentAmounts({lines:value.actual.items.map((i:any)=>({code:i.sourceCode,kind:i.kind,amount:i.amount})),net:value.actual.netAmount});
 const target=validateAdjustmentAmounts({lines:source.lines.map((i:any)=>({code:i.code,kind:i.kind,amount:i.amount})),net:source.totals.net!});
 projectPayrollAdjustments(baseline,target);
 return {baseline,target,baselineEvidenceHash:evidenceHash(value.actual),binding:value.binding,sourceAuthors:value.authors};
}
/** Internal accounting read. Ledger is deliberately excluded from D calculation source hashes. */
export async function loadPayrollAdjustmentEvidence(db:any,reader:any,args:{empId:string;month:string;scope:Scope}){
 const {empId,month,scope}=args;if(!payrollItemIdentity(empId)||!payrollItemMonth(month)||!['current','historical'].includes(scope))fail(400,'調整範圍無效');
 const id=idFor(empId,month,scope),head=await read(reader,db.collection('payrollAdjustmentHeads').doc(id),true),verified=await chain(db,reader,head,id,empId,month,scope);
 const last=verified.versions.filter(v=>v.status==='applied').at(-1);
 return {empId,month,scope,current:head,versions:verified.versions,runs:verified.runs,projection:last?projectPayrollAdjustments(last.baseline,last.target,verified.runs.map(r=>r.amounts)):null,targetFreshness:'last-applied-snapshot-not-revalidated' as const,...flags};
}
export async function handlePayrollAdjustmentAction(db:any,uid:string,action:string,data:any){
 if(!PAYROLL_ADJUSTMENT_ACTIONS.includes(action as any))fail(400,'調整操作無效');
 const get=action==='get-payroll-adjustment',propose=action==='propose-payroll-adjustment',review=action==='review-payroll-adjustment';
 assertPayrollItemFields(data,get?['empId','month','scope']:['empId','month','scope','expectedRevision','operationId','reason',...(propose?['postingMonth','comparisonRef','sourceRefs']:review?['mode']:[])]);
 const {empId,month,scope}=data;if(!payrollItemIdentity(uid)||!payrollItemIdentity(empId)||!payrollItemMonth(month)||!['current','historical'].includes(scope))fail(400,'調整範圍無效');
 const id=idFor(empId,month,scope),col=(n:string)=>db.collection(n),at=new Date().toISOString();
 const auth=async(tx:any,write:boolean)=>{const a=await read(tx,col('employees').doc(uid)),e=await read(tx,col('employees').doc(empId));const manager=a.role===UserRole.SuperAdmin&&uid!==empId;if(write?!manager:!manager&&uid!==empId)fail(403,'無權處理薪資調整');if(e.accountKind==='system-account')fail(409,'純系統帳號不適用');return manager;};
 if(get)return db.runTransaction(async(tx:any)=>{
  const canManage=await auth(tx,false),result=await loadPayrollAdjustmentEvidence(db,tx,{empId,month,scope});
  if(!canManage)return {...result,current:result.versions.filter(v=>v.status==='applied').at(-1)||null,versions:result.versions.filter(v=>v.status==='applied'),canManage,candidate:null,candidateIssues:[],stale:false,eligibleActions:[]};
  let candidate:any=null,candidateIssues:string[]=[],candidateAuthors:string[]=[];
  try{
   if(await read(tx,col('payrollAdjustmentLedgers').doc(idFor(empId,month,scope==='current'?'historical':'current')),true))fail(409,'另一來源範圍已有入帳調整');
   const loader=scope==='current'?loadReviewedPayrollDifferenceForAdjustment:loadReviewedHistoricalPayrollDifferenceForAdjustment;
   const selected=await loader(db,tx,{empId,month,at});
   const comparisonRef=selected.binding.comparisonRef;
   const available=await fresh(db,tx,{empId,month,scope,at,comparisonRef});candidateAuthors=available.sourceAuthors;
   if(result.current&&result.current.baselineEvidenceHash!==available.baselineEvidenceHash)fail(409,'實際基準已改變，不能重設累計調整');
   candidate={comparisonRef,baseline:available.baseline,target:available.target,projection:projectPayrollAdjustments(available.baseline,available.target,result.runs.map(r=>r.amounts))};
  }catch{candidateIssues=['目前沒有可套用且來源完整一致的獨立覆核差額；請檢查比較來源、實際基準及歷史完整性'];}
  const current=result.current,stale=!!current&&(!candidate||evidenceHash(current.comparisonRef)!==evidenceHash(candidate.comparisonRef)||evidenceHash(current.target)!==evidenceHash(candidate.target));
  const authors=new Set([...candidateAuthors,...result.versions.flatMap(v=>[...v.sourceAuthors,...(v.status==='proposed'?[v.actor]:[])])]);
  const eligibleActions:string[]=[];
  if(candidate&&(!current||['returned','applied'].includes(current.status)))eligibleActions.push('propose-payroll-adjustment');
  if(current&&!authors.has(uid)){
   if(current.status==='proposed')eligibleActions.push('review-payroll-adjustment');
   if(!stale&&current.status==='reviewed')eligibleActions.push('adopt-payroll-adjustment');
   if(!stale&&current.status==='adopted')eligibleActions.push('apply-payroll-adjustment');
  }
  return {...result,projection:result.runs.length&&candidate?candidate.projection:result.projection,targetFreshness:candidate?'current-reviewed-source':'last-applied-snapshot-not-revalidated',canManage,candidate,candidateIssues,stale,eligibleActions};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'調整操作識別或版本無效');
 const reason=payrollItemReason(data.reason);if(review&&!['approve','return'].includes(data.mode))fail(400,'審核操作無效');
 if(propose){if(!payrollItemMonth(data.postingMonth))fail(400,'入帳月份無效');assertPayrollItemFields(data.comparisonRef,['id','revision','evidenceVersion']);if(!payrollItemIdentifier(data.comparisonRef.id)||!Number.isSafeInteger(data.comparisonRef.revision)||data.comparisonRef.revision<1||!payrollItemIdentifier(data.comparisonRef.evidenceVersion))fail(400,'比較版本無效');refs(data.sourceRefs);}
 const requestHash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  await auth(tx,true);const receiptRef=col('payrollAdjustmentCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true);
  const head=await read(tx,col('payrollAdjustmentHeads').doc(id),true),verified=await chain(db,tx,head,id,empId,month,scope);
  if(receipt){if(receipt.requestHash!==requestHash||receipt.actor!==uid)fail(409,'調整操作識別已使用');const saved=verified.versions.find(v=>v.revision===receipt.revision);if(!saved||saved.operationId!==data.operationId||saved.actor!==uid||evidenceHash(saved)!==receipt.resultHash)fail(409,'調整收據無效');return saved;}
  const otherId=idFor(empId,month,scope==='current'?'historical':'current');
  if(await read(tx,col('payrollAdjustmentLedgers').doc(otherId),true)&&!(review&&data.mode==='return'))fail(409,'同一員工月份已有另一來源範圍的入帳調整，需明確移交，不能重複建立基準');
  if((head?.revision||0)!==data.expectedRevision)fail(409,'調整版本已變更');const revision=(head?.revision||0)+1;if(revision>80)fail(409,'調整歷程容量已滿');
  const postingMonth=propose?data.postingMonth:head?.postingMonth;if(!postingMonth)fail(409,'調整不存在');await assertTransactionMonths(db,tx,scope==='current'?[month,postingMonth]:[postingMonth]);
  let v:PayrollAdjustmentVersion;
  if(propose){
   if(head&&!['returned','applied'].includes(head.status))fail(409,'調整尚未結束');
   const source=await fresh(db,tx,{empId,month,scope,at,comparisonRef:data.comparisonRef});
   if(head&&(head.baselineEvidenceHash!==source.baselineEvidenceHash||evidenceHash(head.baseline)!==evidenceHash(source.baseline)))fail(409,'實際基準已改變，不能重設累計調整');
   v={id,empId,month,scope,revision,status:'proposed',postingMonth,comparisonRef:data.comparisonRef,...source,projection:projectPayrollAdjustments(source.baseline,source.target,verified.runs.map(r=>r.amounts)),priorRunCount:verified.runs.length,priorLedgerHash:verified.ledgerHash,reason,sourceRefs:refs(data.sourceRefs),actor:uid,at,operationId:data.operationId,previousHash:head?evidenceHash(head):null,...flags};
  }else{
   if(!head||verified.authors.has(uid))fail(403,'提出者／歷史編輯者不得覆核採用套用');
   const desired:State=review?(data.mode==='return'?'returned':'reviewed'):action==='adopt-payroll-adjustment'?'adopted':'applied';
   if(head.status!==(review?'proposed':desired==='adopted'?'reviewed':'adopted'))fail(409,'調整狀態無法執行');
   if(desired!=='returned'){const source=await fresh(db,tx,{empId,month,scope,at,comparisonRef:head.comparisonRef});if(evidenceHash([source.binding,source.target,source.baseline,source.baselineEvidenceHash,source.sourceAuthors])!==evidenceHash([head.binding,head.target,head.baseline,head.baselineEvidenceHash,head.sourceAuthors]))fail(409,'調整來源已變更');}
   v={...head,revision,status:desired,reason,actor:uid,at,operationId:data.operationId,previousHash:evidenceHash(head)};
  }
  if(Buffer.byteLength(JSON.stringify(v),'utf8')>200000)fail(409,'調整來源容量過大');
  tx.create(col('payrollAdjustmentVersions').doc(id+'_'+revision),v);
  if(v.status==='applied'){const run=runFor(v);tx.create(col('payrollAdjustmentRuns').doc(run.id),run);tx.set(col('payrollAdjustmentLedgers').doc(id),{id,empId,month,scope,sequence:run.sequence,headHash:evidenceHash(run),baselineEvidenceHash:v.baselineEvidenceHash});}
  tx.set(col('payrollAdjustmentHeads').doc(id),v);tx.create(receiptRef,{actor:uid,requestHash,revision,resultHash:evidenceHash(v)});return v;
 });
}
