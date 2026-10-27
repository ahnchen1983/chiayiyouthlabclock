import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import {validatePaymentEvidence} from '../../../utils/payroll/paymentEvidence';
import {validatePaymentAllocation,assessPaymentAllocation} from '../../../utils/payroll/paymentAllocation';
import {loadApprovedPayrollPaymentEvidence} from './payrollPaymentEvidence';
import {loadPayrollPreWithholdingSource} from './payrollPreWithholdingSource';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';

export const PAYROLL_PAYMENT_ALLOCATION_ACTIONS=['get-payroll-payment-allocation','propose-payroll-payment-allocation','review-payroll-payment-allocation'] as const;
const flags={approvalScope:'recorded-allocation-evidence-only',formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'unresolved'} as const;
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const hashValid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const timestamp=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const read=async(reader:any,ref:any,optional=false)=>{const s=await reader.get(ref);if(!s.exists){if(optional)return null;fail(409,'給付分攤來源或不可變歷程缺漏');}return s.data();};
export const payrollPaymentAllocationId=(empId:string,month:string)=>'pa_'+evidenceHash([empId,month]);
const assess=(v:any)=>assessPaymentAllocation(v.allocation,{source:v.sourceSnapshot,paymentEvidence:v.paymentInventory});
const MAX_REVISIONS=60,MAX_BYTES=700000;

function validateVersion(v:any,id:string,empId:string,month:string){
 try{
  if(!v||v.schemaVersion!=='payroll-payment-allocation-v1'||v.id!==id||v.empId!==empId||v.month!==month||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>MAX_REVISIONS||!Array.isArray(v.history)||v.history.length!==v.revision||Object.entries(flags).some(([k,value])=>v[k]!==value))throw Error();
  const allocation=validatePaymentAllocation(v.allocation),payment=validatePaymentEvidence(v.paymentInventory);
  if(allocation.empId!==empId||allocation.month!==month||payment.empId!==empId||payment.month!==month||evidenceHash(allocation)!==evidenceHash(v.allocation)||evidenceHash(payment)!==evidenceHash(v.paymentInventory))throw Error();
  const binding=v.sourceBinding;
  if(!binding||!payrollItemIdentifier(binding.payment?.id)||!Number.isSafeInteger(binding.payment.revision)||binding.payment.revision<1||!hashValid(binding.payment.evidenceHash)||!hashValid(binding.preWithholding?.sourceHash)||!hashValid(binding.preWithholding.baseSourceHash))throw Error();
  if(v.sourceSnapshot?.empId!==empId||v.sourceSnapshot?.month!==month||v.sourceSnapshot?.sourceHash!==binding.preWithholding.sourceHash||evidenceHash(v.assessment)!==evidenceHash(assess(v)))throw Error();
  let state:string|null=null,last=-Infinity,proposal:any=null;const authors=new Set<string>();
  for(let i=0;i<v.history.length;i++){
   const h=v.history[i];assertPayrollItemFields(h,['actor','at','to','revision','reason','operationId']);payrollItemReason(h.reason);
   if(!payrollItemIdentity(h.actor)||h.actor===empId||!timestamp(h.at)||Date.parse(h.at)<last||h.revision!==i+1||!payrollItemIdentifier(h.operationId))throw Error();
   if(h.to==='proposed'){if(state&&!['approved','returned'].includes(state))throw Error();authors.add(h.actor);proposal=h;}
   else if(['approved','returned'].includes(h.to)){if(state!=='proposed'||authors.has(h.actor))throw Error();}else throw Error();
   state=h.to;last=Date.parse(h.at);
  }
  if(!proposal||v.status!==state||v.proposedBy!==proposal.actor||v.proposedAt!==proposal.at)throw Error();
  const final=v.history.at(-1);
  if(state==='proposed'){if(v.reviewedBy!==undefined||v.reviewedAt!==undefined||v.approvedBy!==undefined||v.approvedAt!==undefined)throw Error();}
  else if(v.reviewedBy!==final.actor||v.reviewedAt!==final.at||state==='approved'&&(v.approvedBy!==final.actor||v.approvedAt!==final.at)||state==='returned'&&(v.approvedBy!==undefined||v.approvedAt!==undefined))throw Error();
  if(Buffer.byteLength(JSON.stringify(v))>MAX_BYTES)throw Error();
 }catch{fail(409,'給付分攤版本、評估或獨立覆核歷程無效');}
}
async function history(db:any,reader:any,current:any,id:string,empId:string,month:string){
 if(!current)return [];
 validateVersion(current,id,empId,month);const versions:any[]=[];
 for(let revision=1;revision<=current.revision;revision++){
  const v=await read(reader,db.collection('payrollPaymentAllocationVersions').doc(id+'_'+revision));validateVersion(v,id,empId,month);
  if(v.revision!==revision)fail(409,'給付分攤不可變版本序號不符');
  const previous=versions.at(-1);
  if(previous&&(evidenceHash(v.history.slice(0,-1))!==evidenceHash(previous.history)||v.status!=='proposed'&&(evidenceHash([v.allocation,v.sourceBinding,v.sourceSnapshot,v.paymentInventory])!==evidenceHash([previous.allocation,previous.sourceBinding,previous.sourceSnapshot,previous.paymentInventory])||v.proposedBy!==previous.proposedBy||v.proposedAt!==previous.proposedAt)))fail(409,'給付分攤不可變來源鏈不一致');
  versions.push(v);
 }
 if(evidenceHash(current)!==evidenceHash(versions.at(-1)))fail(409,'給付分攤目前紀錄與不可變歷程不符');return versions;
}
async function sources(db:any,reader:any,empId:string,month:string,at:string){
 const payment=await loadApprovedPayrollPaymentEvidence(db,reader,empId,month);
 const upstream=await loadPayrollPreWithholdingSource(db,reader,{empId,month,at});
 if(!payment.approved||!payment.source||!upstream.source||!hashValid(upstream.baseSourceHash)||!hashValid(upstream.source.sourceHash))return null;
 // Recorded cash facts retain their original upstream binding even when net
 // was unknown. A changed base requires explicit payment-fact reproposal.
 if(payment.approved.sourceBinding.sourceHash!==upstream.baseSourceHash)return null;
 if(upstream.source.empId!==empId||upstream.source.month!==month)fail(409,'給付分攤計薪來源範圍不符');
 return {sourceBinding:{payment:payment.source,preWithholding:{sourceHash:upstream.source.sourceHash,baseSourceHash:upstream.baseSourceHash}},sourceSnapshot:upstream.source,paymentInventory:validatePaymentEvidence(payment.approved.inventory)};
}
/** Read-only current immutable evidence. Consumers must independently reload
 * current sources and compare bindings; approval is never payment authority. */
export async function loadApprovedPayrollPaymentAllocationEvidence(db:any,reader:{get:(ref:any)=>Promise<any>},empId:string,month:string){
 if(!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工月份無效');
 const id=payrollPaymentAllocationId(empId,month),current=await read(reader,db.collection('payrollPaymentAllocations').doc(id),true);
 await history(db,reader,current,id,empId,month);
 return {current,approved:current?.status==='approved'?current:null,source:current?{id,revision:current.revision,evidenceHash:evidenceHash(current)}:null,...flags};
}

export async function handlePayrollPaymentAllocationAction(db:any,uid:string,action:string,data:any){
 if(!PAYROLL_PAYMENT_ALLOCATION_ACTIONS.includes(action as any))fail(400,'給付分攤操作無效');
 const getting=action==='get-payroll-payment-allocation',proposing=action==='propose-payroll-payment-allocation';
 assertPayrollItemFields(data,getting?['empId','month']:['empId','month','expectedRevision','operationId','reason',...(proposing?['allocation']:['mode'])]);
 const {empId,month}=data;if(!payrollItemIdentity(uid)||!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工月份無效');
 const id=payrollPaymentAllocationId(empId,month),col=(name:string)=>db.collection(name);
 const authorize=async(reader:any,writing:boolean)=>{const actor=await read(reader,col('employees').doc(uid));if(writing?(actor.role!==UserRole.SuperAdmin||uid===empId):(uid!==empId&&actor.role!==UserRole.SuperAdmin))fail(403,'無給付分攤存取權限');const subject=await read(reader,col('employees').doc(empId));if(subject.accountKind==='system-account')fail(409,'純系統帳號不適用給付分攤');return actor.role===UserRole.SuperAdmin&&uid!==empId;};
 if(getting)return db.runTransaction(async(reader:any)=>{
  const canManage=await authorize(reader,false),current=await read(reader,col('payrollPaymentAllocations').doc(id),true),versions=await history(db,reader,current,id,empId,month),visible=canManage||current?.status==='approved'?current:null;
  let loaded:any=null,sourceIssues:string[]=[];
  if(canManage){try{loaded=await sources(db,reader,empId,month,new Date().toISOString());if(!loaded)sourceIssues=['approved-payment-or-pre-withholding-source-unavailable'];}catch{sourceIssues=['current-source-unverifiable'];}}
  return {empId,month,current:visible,versions:canManage?versions:versions.filter(v=>v.status==='approved'),canManage,assessment:visible?.assessment??null,...(canManage?{sourceAvailable:!!loaded,sourceIssues,source:loaded?.sourceSnapshot??null,paymentInventory:loaded?.paymentInventory??null,currentSourceBinding:loaded?.sourceBinding??null,stale:!loaded||!current||evidenceHash(loaded.sourceBinding)!==evidenceHash(current.sourceBinding)}:{}),...flags};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'需操作識別及非負整數版本');
 const reason=payrollItemReason(data.reason),allocation=proposing?validatePaymentAllocation(data.allocation):null;
 if(allocation&&(allocation.empId!==empId||allocation.month!==month))fail(400,'給付分攤內容範圍不符');
 if(!proposing&&!['approve','return'].includes(data.mode))fail(400,'覆核方式無效');
 const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  await authorize(tx,true);
  const receiptRef=col('payrollPaymentAllocationCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true),current=await read(tx,col('payrollPaymentAllocations').doc(id),true);
  if(receipt){
   if(receipt.hash!==hash||receipt.actor!==uid)fail(409,'重送內容或操作者不符');
   const result=receipt.result;await history(db,tx,result,id,empId,month);await history(db,tx,current,id,empId,month);
   const last=result?.history?.at(-1),expected=proposing?'proposed':data.mode==='approve'?'approved':'returned';
   if(!current||!result||current.revision<result.revision||evidenceHash(current.history.slice(0,result.revision))!==evidenceHash(result.history)||result.revision!==data.expectedRevision+1||result.status!==expected||last.actor!==uid||last.operationId!==data.operationId||last.reason!==reason||last.at!==receipt.at||proposing&&evidenceHash(result.allocation)!==evidenceHash(allocation))fail(409,'重送結果不在目前不可變歷程內');return result;
  }
  await assertTransactionMonths(db,tx,[month]);await history(db,tx,current,id,empId,month);
  if((current?.revision||0)!==data.expectedRevision)fail(409,'給付分攤版本已變更');const revision=(current?.revision||0)+1;if(revision>MAX_REVISIONS)fail(409,'給付分攤歷程已達技術容量');
  const loaded=proposing||data.mode==='approve'?await sources(db,tx,empId,month,at):null;
  if((proposing||data.mode==='approve')&&!loaded)fail(409,'需目前獨立核定給付清冊及可綁定的扣繳前計薪來源');
  let next:any;
  if(proposing){if(current?.status==='proposed')fail(409,'待覆核分攤不可覆寫，需先退回');next={schemaVersion:'payroll-payment-allocation-v1',id,empId,month,revision,status:'proposed',allocation,...loaded,proposedBy:uid,proposedAt:at,...flags};}
  else{
   if(!current||current.status!=='proposed')fail(409,'只有待覆核分攤可處理');
   if(current.history.some((h:any)=>h.to==='proposed'&&h.actor===uid))fail(403,'不得覆核本人提出或曾編輯的分攤');
   if(data.mode==='approve'&&evidenceHash(loaded!.sourceBinding)!==evidenceHash(current.sourceBinding))fail(409,'給付清冊或扣繳前計薪來源已變更，需退回重提');
   const approved=data.mode==='approve';next={...current,revision,status:approved?'approved':'returned',reviewedBy:uid,reviewedAt:at,...(approved?{approvedBy:uid,approvedAt:at}:{})};
  }
  next.history=[...(current?.history||[]),{actor:uid,at,to:next.status,revision,reason,operationId:data.operationId}];next.assessment=assess(next);validateVersion(next,id,empId,month);
  tx.create(col('payrollPaymentAllocationVersions').doc(id+'_'+revision),next);tx.set(col('payrollPaymentAllocations').doc(id),next);tx.create(receiptRef,{actor:uid,at,hash,result:next});return next;
 });
}
