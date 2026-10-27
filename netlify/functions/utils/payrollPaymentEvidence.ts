import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentifier,payrollItemIdentity,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import {validatePaymentEvidence,assessPaymentEvidence} from '../../../utils/payroll/paymentEvidence';
import {loadPayrollMonthSource} from './payrollSourceReader';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';

export const PAYROLL_PAYMENT_EVIDENCE_ACTIONS=['get-payroll-payment-evidence','propose-payroll-payment-evidence','review-payroll-payment-evidence'] as const;
const fail=(code:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode:code});};
const read=async(tx:any,ref:any,optional=false)=>{const s=await tx.get(ref);if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
export const payrollPaymentEvidenceId=(empId:string,month:string)=>'pe_'+evidenceHash([empId,month]);
const flags={approvalScope:'recorded-evidence-only' as const,applicationStatus:'not-applied' as const,paymentExecution:'none' as const,legalValidation:'unresolved' as const};

function validVersionHistory(v:any):boolean {
 try{
  if(v?.schemaVersion!=='payroll-payment-evidence-v1'||!payrollItemIdentifier(v.id)||!payrollItemIdentity(v.empId)||!payrollItemMonth(v.month)||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>100||!Array.isArray(v.history)||v.history.length!==v.revision)return false;
  // Shared strict validator retains explicit insurer reply date queryConfirmedOn.
  // Never derive it from legacy queriedAt: old immutable assessments must remain reproducible.
  const inventory=validatePaymentEvidence(v.inventory);if(inventory.empId!==v.empId||inventory.month!==v.month||v.approvalScope!==flags.approvalScope||v.applicationStatus!==flags.applicationStatus||v.paymentExecution!=='none'||v.legalValidation!=='unresolved')return false;
  if(!v.sourceBinding||!/^[a-f0-9]{64}$/.test(v.sourceBinding.sourceHash)||(v.sourceBinding.net!==null&&(typeof v.sourceBinding.net!=='string'||!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(v.sourceBinding.net))))return false;
  if(evidenceHash(v.assessment)!==evidenceHash(assessPaymentEvidence(v.inventory,{empId:v.empId,month:v.month,monthlyPayable:v.sourceBinding.net,payableSourceRef:v.sourceBinding.sourceHash})))return false;
  let state:any=null,previous=-Infinity,proposal:any=null;const authors=new Set();
  for(let i=0;i<v.history.length;i++){
   const h=v.history[i];assertPayrollItemFields(h,['actor','at','to','revision','reason']);payrollItemReason(h.reason);
   if(!payrollItemIdentity(h.actor)||h.actor===v.empId||h.revision!==i+1||typeof h.at!=='string'||!Number.isFinite(Date.parse(h.at))||Date.parse(h.at)<previous)return false;
   if(h.to==='proposed'){if(state!==null&&!['approved','returned'].includes(state))return false;authors.add(h.actor);proposal=h;}
   else if(['approved','returned'].includes(h.to)){if(state!=='proposed'||authors.has(h.actor))return false;}else return false;
   state=h.to;previous=Date.parse(h.at);
  }
  if(v.status!==state||v.proposedBy!==proposal.actor||v.proposedAt!==proposal.at)return false;
  const last=v.history[v.history.length-1];
  if(state==='proposed')return !v.approvedBy&&!v.approvedAt&&!v.reviewedBy&&!v.reviewedAt;
  if(v.reviewedBy!==last.actor||v.reviewedAt!==last.at)return false;
  return state==='approved'?v.approvedBy===last.actor&&v.approvedAt===last.at:!v.approvedBy&&!v.approvedAt;
 }catch{return false;}
}

// A mutable head is a pointer/cache, not authority for who has ever edited.
// Read the complete bounded immutable chain inside the same transaction used for
// approval; changed/missing earlier versions invalidate the head without repair.
async function verifyImmutableHistory(db:any,reader:any,current:any,empId:string,month:string,id:string):Promise<void>{
 if(!current)return;
 if(current.id!==id||current.empId!==empId||current.month!==month||!validVersionHistory(current))fail(409,'給付證據清冊歷程不完整或範圍無效');
 let previous:any=null;
 for(let revision=1;revision<=current.revision;revision++){
  const snapshot=await reader.get(db.collection('payrollPaymentEvidenceVersions').doc(id+'_'+revision));
  if(!snapshot.exists)fail(409,'給付證據不可變歷史版本缺漏');
  const version=snapshot.data();
  if(version.id!==id||version.empId!==empId||version.month!==month||version.revision!==revision||!validVersionHistory(version))fail(409,'給付證據不可變歷史版本無效');
  if(previous){
   if(evidenceHash(version.history.slice(0,-1))!==evidenceHash(previous.history))fail(409,'給付證據不可變歷史來源鏈不一致');
   if(version.status!=='proposed'&&(evidenceHash([version.inventory,version.sourceBinding])!==evidenceHash([previous.inventory,previous.sourceBinding])||version.proposedBy!==previous.proposedBy||version.proposedAt!==previous.proposedAt))fail(409,'核定版本與原提案內容不一致');
  }
  previous=version;
 }
 if(evidenceHash(current)!==evidenceHash(previous))fail(409,'給付證據目前紀錄與不可變歷史不一致');
}

/** Read-only trusted adapter boundary for allocation evidence. This validates
 * the current immutable cash-fact chain; it does not reinterpret the recorded
 * net amounts, certify tax treatment, or fall back behind a pending replacement.
 * Callers must independently bind their current pre-withholding source.
 */
export async function loadApprovedPayrollPaymentEvidence(db:any,reader:{get:(ref:any)=>Promise<any>},empId:string,month:string){
 if(!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工／月份識別無效');
 const id=payrollPaymentEvidenceId(empId,month);
 const current=await read(reader,db.collection('payrollPaymentEvidence').doc(id),true);
 await verifyImmutableHistory(db,reader,current,empId,month,id);
 return {current,approved:current?.status==='approved'?current:null,source:current?{id,revision:current.revision,evidenceHash:evidenceHash(current)}:null};
}

/** Salary-confidential evidence workflow, parallel to C2m authorisation. All state
 * changes share payrollControl/month locks; immutable revisions remain auditable. */
export async function handlePayrollPaymentEvidenceAction(db:any,uid:string,action:string,data:any){
 if(!PAYROLL_PAYMENT_EVIDENCE_ACTIONS.includes(action as any))fail(400,'給付證據操作無效');
 const proposal=action==='propose-payroll-payment-evidence',reading=action==='get-payroll-payment-evidence';
 assertPayrollItemFields(data,reading?['empId','month']:proposal?['inventory','expectedRevision','operationId']:['empId','month','expectedRevision','mode','reason','operationId']);
 const inventory=proposal?validatePaymentEvidence(data.inventory):null;
 const empId=inventory?.empId||data.empId,month=inventory?.month||data.month;
 if(!payrollItemIdentity(empId)||!payrollItemMonth(month)||!payrollItemIdentity(uid))fail(400,'員工／月份識別無效');
 const id=payrollPaymentEvidenceId(empId,month),col=(name:string)=>db.collection(name),readTx={get:(r:any)=>r.get()};
 if(reading){
  const actor=await read(readTx,col('employees').doc(uid));if(uid!==empId&&actor.role!==UserRole.SuperAdmin)fail(403,'不得讀取他人給付證據');
  const employee=await read(readTx,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'純系統帳號不適用給付證據');
  const current=await read(readTx,col('payrollPaymentEvidence').doc(id),true);
  await verifyImmutableHistory(db,readTx,current,empId,month,id);
  const q=await col('payrollPaymentEvidenceVersions').where('empId','==',empId).limit(1001).get();if(q.size>1000)fail(409,'給付證據版本清冊技術容量超限');
  const all=q.docs.map((d:any)=>({...d.data(),versionId:d.id})).filter((v:any)=>v.month===month);
  const manage=actor.role===UserRole.SuperAdmin&&uid!==empId;
  let sourceAvailable=false,reconciliationAvailable=false,stale=true;
  if(manage){
   try{const source=await loadPayrollMonthSource(db,readTx,{month,at:new Date().toISOString()});const net=source.kind==='live'?source.comparisons[empId]?.totals.net??null:null;
    sourceAvailable=source.kind==='live';reconciliationAvailable=sourceAvailable&&typeof net==='string';
    stale=!sourceAvailable||!current||evidenceHash(current.sourceBinding)!==evidenceHash({sourceHash:source.kind==='live'?source.sourceHash:null,net});
   }catch{sourceAvailable=false;stale=true;}
  }
  // Pending replacements are never a fallback to an earlier approval.
  return {empId,month,...(manage?{sourceAvailable,reconciliationAvailable,stale}:{}),current:manage||current?.status==='approved'?current:null,versions:manage?all:all.filter((v:any)=>v.status==='approved'),canManage:manage,assessment:(manage||current?.status==='approved')&&current?assessPaymentEvidence(current.inventory,{empId,month,monthlyPayable:current.sourceBinding.net,payableSourceRef:current.sourceBinding.sourceHash}):null};
 }
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'需操作識別及非負整數版本');
 const reason=proposal?inventory!.reason:payrollItemReason(data.reason);
 if(!proposal&&!['approve','return'].includes(data.mode))fail(400,'核定操作無效');
 const hash=evidenceHash([action,data]),at=new Date().toISOString();
 return runPayrollMutation(db,[],async tx=>{
  // Role is read again on every retry and before a receipt can be replayed.
  const actor=await read(tx,col('employees').doc(uid));if(actor.role!==UserRole.SuperAdmin||uid===empId)fail(403,'僅最高管理者可登錄他人給付證據');
  const employee=await read(tx,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'純系統帳號不適用給付證據');
  const receiptRef=col('payrollPaymentEvidenceCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true);
  if(receipt){if(receipt.hash!==hash)fail(409,'相同操作識別內容不同');return receipt.result;}
  await assertTransactionMonths(db,tx,[month]);
  const current=await read(tx,col('payrollPaymentEvidence').doc(id),true);
  if((current?.revision||0)!==data.expectedRevision)fail(409,'給付證據清冊版本已變更');
  await verifyImmutableHistory(db,tx,current,empId,month,id);
  const revision=(current?.revision||0)+1;
  if(revision>100||current?.history.length>=100)fail(409,'月份給付證據歷程技術容量已滿');
  let result:any;
  const source=proposal||data.mode==='approve'?await loadPayrollMonthSource(db,tx,{month,at}):null;
  const comparison=source?.kind==='live'?source.comparisons[empId]:null;
  const sourceBinding=source?.kind==='live'?{sourceHash:source.sourceHash,net:comparison?.totals.net??null}:null;
  if((proposal||data.mode==='approve')&&!sourceBinding)fail(409,'目前缺少可綁定的計薪來源清冊');
  if(proposal){
   if(current&&!['approved','returned'].includes(current.status))fail(409,'待核定版本不可覆寫，需先核退');
   result={schemaVersion:'payroll-payment-evidence-v1',id,empId,month,revision,status:'proposed',inventory:inventory!,sourceBinding,proposedBy:uid,proposedAt:at,history:[...(current?.history||[]),{actor:uid,at,to:'proposed',revision,reason}],...flags};
  }else{
   if(!current||current.status!=='proposed')fail(409,'只有待核定清冊可核定或退回');
   if(current.proposedBy===uid||current.history.some((h:any)=>h.to==='proposed'&&h.actor===uid))fail(403,'不得核定本人提出或曾編輯的清冊');
   const validated=validatePaymentEvidence(current.inventory);
   if(validated.empId!==empId||validated.month!==month)fail(409,'給付證據內容範圍不符');
   if(data.mode==='approve'){if(evidenceHash(sourceBinding)!==evidenceHash(current.sourceBinding))fail(409,'月計薪來源已變更，需重新提出給付證據');}
   const status=data.mode==='approve'?'approved':'returned';
   result={...current,inventory:validated,revision,status,reviewedBy:uid,reviewedAt:at,...(status==='approved'?{approvedBy:uid,approvedAt:at}:{}),history:[...current.history,{actor:uid,at,to:status,revision,reason}],...flags};
  }
  // Approval attests recorded document facts only. Unknown or mismatched net
  // remains explicit and never becomes tax/payroll eligibility.
  result.assessment=assessPaymentEvidence(result.inventory,{empId,month,monthlyPayable:result.sourceBinding.net,payableSourceRef:result.sourceBinding.sourceHash});
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>700000)fail(409,'給付證據證據容量過大');
  tx.create(col('payrollPaymentEvidenceVersions').doc(id+'_'+revision),result);
  tx.set(col('payrollPaymentEvidence').doc(id),result);
  tx.create(receiptRef,{actor:uid,at,hash,result});
  return result;
 });
}
