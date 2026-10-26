import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason,assessPayrollItemInventory} from '../../../utils/payroll/items';
import {validateItemExecutionPolicy,assessItemExecutionPolicy} from '../../../utils/payroll/itemApplication';
import {loadInsuranceEvidence} from './insuranceTimeline';
import {insuranceForMonth} from '../../../utils/payroll/insurance';
import {loadPayrollItemInventoryEvidence} from './payrollItems';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';
export const PAYROLL_ITEM_EXECUTION_ACTIONS=['get-payroll-item-execution','propose-payroll-item-execution','review-payroll-item-execution'] as const;
const flags={approvalScope:'supported-item-calculation-only',legalValidation:'unresolved',applicationStatus:'not-applied',paymentStatus:'not-paid',formalEligibility:'BLOCKED'} as const;
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const key=(empId:string,month:string)=>'pie_'+evidenceHash([empId,month]);
const read=async(reader:any,ref:any,optional=false)=>{const s=await reader.get(ref);if(!s.exists){if(optional)return null;fail(409,'項目處理證據或不可變歷程缺漏');}return s.data();};
const binding=(v:any)=>{assertPayrollItemFields(v,['id','revision','evidenceVersion']);if(!payrollItemIdentifier(v.id)||!Number.isSafeInteger(v.revision)||v.revision<1||!/^([a-f0-9]{64})$/.test(v.evidenceVersion))fail(400,'項目清冊版本識別無效');return {id:v.id,revision:v.revision,evidenceVersion:v.evidenceVersion};};
function insuranceAssessment(month:string,periods:any,source:any){
 if(!source||!periods)return false;
 return insuranceForMonth(month,periods).status==='ready';
}
const assessed=(v:any)=>assessItemExecutionPolicy(v.policy,v.inventory.inventory,{insuranceConfirmed:v.insuranceConfirmed});
const insuranceBindingValid=(v:any)=>v===null||!!(v&&payrollItemIdentifier(v.versionId)&&Number.isSafeInteger(v.headRevision)&&v.headRevision>0&&/^[a-f0-9]{64}$/.test(v.evidenceVersion));
function validateSnapshot(v:any,id:string,empId:string,month:string){
 try{
  if(!v||v.schemaVersion!=='payroll-item-execution-v1'||v.id!==id||v.empId!==empId||v.month!==month||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>40||!Array.isArray(v.history)||v.history.length!==v.revision||Object.entries(flags).some(([k,value])=>v[k]!==value))throw Error();
  const b=binding(v.inventoryBinding),inventory=v.inventory;
  if(!inventory||inventory.id!==b.id||inventory.revision!==b.revision||inventory.empId!==empId||inventory.month!==month||evidenceHash(inventory)!==b.evidenceVersion||inventory.inventory?.mode!=='items'||assessPayrollItemInventory(inventory).status!=='recorded-items-needs-classification')throw Error();
  if(!insuranceBindingValid(v.insuranceBinding)||typeof v.insuranceConfirmed!=='boolean'||v.insuranceConfirmed!==insuranceAssessment(month,v.insurancePeriods,v.insuranceBinding))throw Error();
  const policy=validateItemExecutionPolicy(v.policy);
  if(evidenceHash(policy)!==evidenceHash(v.policy)||evidenceHash(policy.items.map(i=>i.itemCode).sort())!==evidenceHash(inventory.inventory.items.map((i:any)=>i.itemCode).sort()))throw Error();
  if(evidenceHash(v.assessment)!==evidenceHash(assessed(v))||v.status==='approved'&&v.assessment.status!=='ready')throw Error();
  let state:string|null=null,p:any=null,last=-Infinity;const authors=new Set<string>();
  for(let i=0;i<v.history.length;i++){
   const h=v.history[i];assertPayrollItemFields(h,['actor','at','to','revision','reason','operationId']);payrollItemReason(h.reason);
   if(!payrollItemIdentity(h.actor)||h.actor===empId||!payrollItemIdentifier(h.operationId)||h.revision!==i+1||typeof h.at!=='string'||!Number.isFinite(Date.parse(h.at))||Date.parse(h.at)<last)throw Error();
   if(h.to==='proposed'){if(state&&!['approved','returned'].includes(state))throw Error();authors.add(h.actor);p=h;}else if(['approved','returned'].includes(h.to)){if(state!=='proposed'||authors.has(h.actor))throw Error();}else throw Error();
   state=h.to;last=Date.parse(h.at);
  }
  if(state!==v.status||!p||v.proposedBy!==p.actor||v.proposedAt!==p.at)throw Error();const final=v.history.at(-1);
  if(state==='proposed'?(v.reviewedBy!==undefined||v.reviewedAt!==undefined):(v.reviewedBy!==final.actor||v.reviewedAt!==final.at))throw Error();
  if(policy.items.some(item=>item.evidence.some(e=>e.authorityOccurredAt&&Date.parse(e.authorityOccurredAt)>Date.parse(v.proposedAt))))throw Error();
 }catch{fail(409,'項目處理證據版本、清冊綁定或歷程無效');}
}
async function chain(db:any,reader:any,current:any,id:string,empId:string,month:string){
 if(!current)return [];validateSnapshot(current,id,empId,month);const versions:any[]=[];
 for(let revision=1;revision<=current.revision;revision++){
  const v=await read(reader,db.collection('payrollItemExecutionVersions').doc(id+'_'+revision));validateSnapshot(v,id,empId,month);
  if(v.revision!==revision||Buffer.byteLength(JSON.stringify(v))>200000)fail(409,'項目處理證據容量或序號無效');const prior=versions.at(-1);
  if(prior&&(evidenceHash(v.history.slice(0,-1))!==evidenceHash(prior.history)||v.status!=='proposed'&&evidenceHash([v.inventoryBinding,v.inventory,v.policy,v.insuranceBinding,v.insurancePeriods,v.insuranceConfirmed,v.proposedBy,v.proposedAt])!==evidenceHash([prior.inventoryBinding,prior.inventory,prior.policy,prior.insuranceBinding,prior.insurancePeriods,prior.insuranceConfirmed,prior.proposedBy,prior.proposedAt])))fail(409,'項目處理不可變歷程鏈不符');versions.push(v);
 }
 if(evidenceHash(current)!==evidenceHash(versions.at(-1)))fail(409,'項目處理目前紀錄與不可變歷程不符');return versions;
}
async function freshInventory(db:any,reader:any,empId:string,month:string){
 const result=await loadPayrollItemInventoryEvidence(db,reader,empId,month);
 const insurance=await loadInsuranceEvidence(db,reader,empId);
 return {source:result.source,inventory:result.version?.status==='approved'&&result.version.inventory.mode==='items'?result.version:null,insuranceBinding:insurance.source,insurancePeriods:insurance.periods,insuranceConfirmed:insuranceAssessment(month,insurance.periods,insurance.source)};
}
/** Trusted current execution boundary. Revalidate inventory and insurance on
 * every consumption; an old approval never rescues a pending replacement.
 * Exact supported amounts remain calculation inputs, never payment authority. */
export async function loadPayrollItemExecutionEvidence(db:any,reader:any,empId:string,month:string){
 if(!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工月份無效');const id=key(empId,month),current=await read(reader,db.collection('payrollItemExecutions').doc(id),true);
 await chain(db,reader,current,id,empId,month);const fresh=await freshInventory(db,reader,empId,month);
 const stale=!!current&&(!fresh.inventory||evidenceHash([current.inventoryBinding,current.insuranceBinding,current.insuranceConfirmed])!==evidenceHash([fresh.source,fresh.insuranceBinding,fresh.insuranceConfirmed]));
 return {current,approved:current?.status==='approved'&&!stale?current:null,source:current?{id,revision:current.revision,evidenceVersion:evidenceHash(current)}:null,binding:current?{inventory:current.inventoryBinding,insurance:current.insuranceBinding}:null,stale,assessment:current&&!stale&&current.status==='approved'?current.assessment:null,issues:stale?['item-execution-source-stale']:current?.status!=='approved'?['item-execution-not-approved']:current.assessment.issues,...flags};
}
export async function handlePayrollItemExecutionAction(db:any,uid:string,action:string,data:any){
 if(!PAYROLL_ITEM_EXECUTION_ACTIONS.includes(action as any))fail(400,'項目處理操作無效');const getting=action==='get-payroll-item-execution',proposing=action==='propose-payroll-item-execution';
 assertPayrollItemFields(data,getting?['empId','month']:['empId','month','expectedRevision','operationId','reason',...(proposing?['inventoryBinding','policy']:['mode'])]);
 const {empId,month}=data;if(!payrollItemIdentity(uid)||!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工月份無效');const id=key(empId,month),col=(name:string)=>db.collection(name);
 const authorize=async(reader:any,writing:boolean)=>{const actor=await read(reader,col('employees').doc(uid));if(writing?(actor.role!==UserRole.SuperAdmin||uid===empId):(uid!==empId&&actor.role!==UserRole.SuperAdmin))fail(403,'無薪資項目處理權限');const person=await read(reader,col('employees').doc(empId));if(person.accountKind==='system-account')fail(409,'純系統帳號不適用');return actor.role===UserRole.SuperAdmin&&uid!==empId;};
 if(getting)return db.runTransaction(async(reader:any)=>{
  const canManage=await authorize(reader,false),current=await read(reader,col('payrollItemExecutions').doc(id),true),versions=await chain(db,reader,current,id,empId,month),fresh=canManage?await freshInventory(db,reader,empId,month):null,visible=canManage||current?.status==='approved'?current:null;
  const stale=!!current&&!!fresh&&(!fresh.inventory||evidenceHash([current.inventoryBinding,current.insuranceBinding,current.insuranceConfirmed])!==evidenceHash([fresh.source,fresh.insuranceBinding,fresh.insuranceConfirmed]));
  return {empId,month,current:visible,versions:canManage?versions:versions.filter(v=>v.status==='approved'),canManage,inventory:fresh?.inventory||null,inventoryBinding:fresh?.source||null,insuranceBinding:fresh?.insuranceBinding||null,insuranceConfirmed:fresh?.insuranceConfirmed||false,stale,assessment:visible?visible.assessment:null,supportedRecipes:['fixed-taxable-earning','fixed-posttax-deduction'],...flags};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'操作識別或版本無效');
 const reason=payrollItemReason(data.reason),provided=proposing?validateItemExecutionPolicy(data.policy):null,expectedInventory=proposing?binding(data.inventoryBinding):null;
 if(!proposing&&!['approve','return'].includes(data.mode))fail(400,'覆核方式無效');const hash=evidenceHash([action,data]),at=new Date().toISOString();
 if(provided?.items.some(item=>item.evidence.some(e=>e.authorityOccurredAt&&Date.parse(e.authorityOccurredAt)>Date.parse(at))))fail(400,'原始依據事件不能記為未來已發生');
 return runPayrollMutation(db,[],async tx=>{
  await authorize(tx,true);const receiptRef=col('payrollItemExecutionCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true),current=await read(tx,col('payrollItemExecutions').doc(id),true);
  if(receipt){
   if(receipt.hash!==hash||receipt.actor!==uid)fail(409,'重送操作內容或操作者不同');const r=receipt.result;await chain(db,tx,r,id,empId,month);await chain(db,tx,current,id,empId,month);const h=r?.history?.at(-1);
   if(!r||!current||current.revision<r.revision||evidenceHash(current.history.slice(0,r.revision))!==evidenceHash(r.history)||r.revision!==data.expectedRevision+1||r.status!==(proposing?'proposed':data.mode==='approve'?'approved':'returned')||h.actor!==uid||h.operationId!==data.operationId||h.reason!==reason||h.at!==receipt.at||proposing&&evidenceHash([r.policy,r.inventoryBinding])!==evidenceHash([provided,expectedInventory]))fail(409,'重送結果與不可變證據不符');return r;
  }
  await assertTransactionMonths(db,tx,[month]);await chain(db,tx,current,id,empId,month);
  if((current?.revision||0)!==data.expectedRevision)fail(409,'項目處理版本已變更');const revision=(current?.revision||0)+1;if(revision>40)fail(409,'項目處理歷程已達技術容量');
  const fresh=proposing||data.mode==='approve'?await freshInventory(db,tx,empId,month):null;let next:any;
  if(proposing){
   if(current?.status==='proposed')fail(409,'待覆核提案不可覆寫，需先退回');if(!fresh?.inventory||evidenceHash(fresh.source)!==evidenceHash(expectedInventory))fail(409,'核定項目清冊已變更或尚未核定');
   const codes=fresh.inventory.inventory.items.map(i=>i.itemCode).sort();if(evidenceHash(codes)!==evidenceHash(provided!.items.map(i=>i.itemCode).sort()))fail(400,'必須逐項對應完整核定清冊，不得新增或省略項目');
   next={schemaVersion:'payroll-item-execution-v1',id,empId,month,revision,status:'proposed',inventoryBinding:fresh.source,inventory:fresh.inventory,insuranceBinding:fresh.insuranceBinding,insurancePeriods:fresh.insurancePeriods,insuranceConfirmed:fresh.insuranceConfirmed,policy:provided,proposedBy:uid,proposedAt:at,...flags};
  }else{
   if(!current||current.status!=='proposed')fail(409,'只有待覆核版本可處理');if(current.history.some((h:any)=>h.to==='proposed'&&h.actor===uid))fail(403,'不得覆核本人提出或曾編輯的項目處理');
   if(data.mode==='approve'&&(!fresh?.inventory||evidenceHash([fresh.source,fresh.insuranceBinding,fresh.insuranceConfirmed])!==evidenceHash([current.inventoryBinding,current.insuranceBinding,current.insuranceConfirmed])))fail(409,'項目清冊已變更，需退回後重新提出');
   if(data.mode==='approve'&&assessed(current).status!=='ready')fail(409,'項目執行依據或保險來源尚未完整，不得核定計算');
   next={...current,revision,status:data.mode==='approve'?'approved':'returned',reviewedBy:uid,reviewedAt:at};
  }
  next.history=[...(current?.history||[]),{actor:uid,at,to:next.status,revision,reason,operationId:data.operationId}];next.assessment=assessed(next);validateSnapshot(next,id,empId,month);
  if(Buffer.byteLength(JSON.stringify(next))>200000)fail(409,'項目處理證據容量過大');tx.create(col('payrollItemExecutionVersions').doc(id+'_'+revision),next);tx.set(col('payrollItemExecutions').doc(id),next);tx.create(receiptRef,{actor:uid,at,hash,result:next});return next;
 });
}
