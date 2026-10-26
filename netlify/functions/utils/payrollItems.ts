import {UserRole} from '../../../types';
import {assessPayrollItemInventory,validPayrollItemVersionHistory,assertPayrollItemFields,payrollItemIdentifier,payrollItemIdentity,payrollItemMonth,payrollItemReason,validatePayrollItemInventory,type PayrollItemInventoryVersion} from '../../../utils/payroll/items';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';

export const PAYROLL_ITEM_ACTIONS=['get-payroll-item-inventory','propose-payroll-item-inventory','review-payroll-item-inventory'] as const;
const fail=(code:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode:code});};
const read=async(tx:any,ref:any,optional=false)=>{const s=await tx.get(ref);if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
export const payrollItemInventoryId=(empId:string,month:string)=>'pi_'+evidenceHash([empId,month]);
const flags={approvalScope:'recorded-evidence-only' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const,legalValidation:'unresolved' as const};

// A mutable head is a pointer/cache, not authority for who has ever edited.
// Read the complete bounded immutable chain inside the same transaction used for
// approval; changed/missing earlier versions invalidate the head without repair.
async function verifyImmutableHistory(db:any,reader:any,current:any,empId:string,month:string,id:string):Promise<void>{
 if(!current)return;
 if(current.id!==id||current.empId!==empId||current.month!==month||!validPayrollItemVersionHistory(current))fail(409,'薪資項目清冊歷程不完整或範圍無效');
 let previous:any=null;
 for(let revision=1;revision<=current.revision;revision++){
  const snapshot=await reader.get(db.collection('payrollItemInventoryVersions').doc(id+'_'+revision));
  if(!snapshot.exists)fail(409,'薪資項目不可變歷史版本缺漏');
  const version=snapshot.data();
  if(version.id!==id||version.empId!==empId||version.month!==month||version.revision!==revision||!validPayrollItemVersionHistory(version))fail(409,'薪資項目不可變歷史版本無效');
  if(previous){
   if(evidenceHash(version.history.slice(0,-1))!==evidenceHash(previous.history))fail(409,'薪資項目不可變歷史來源鏈不一致');
   if(version.status!=='proposed'&&(evidenceHash(version.inventory)!==evidenceHash(previous.inventory)||version.proposedBy!==previous.proposedBy||version.proposedAt!==previous.proposedAt))fail(409,'核定版本與原提案內容不一致');
  }
  previous=version;
 }
 if(evidenceHash(current)!==evidenceHash(previous))fail(409,'薪資項目目前紀錄與不可變歷史不一致');
}

/** Salary-confidential evidence workflow, parallel to C2m authorisation. All state
 * changes share payrollControl/month locks; immutable revisions remain auditable. */
export async function handlePayrollItemsAction(db:any,uid:string,action:string,data:any){
 if(!PAYROLL_ITEM_ACTIONS.includes(action as any))fail(400,'薪資項目操作無效');
 const proposal=action==='propose-payroll-item-inventory',reading=action==='get-payroll-item-inventory';
 assertPayrollItemFields(data,reading?['empId','month']:proposal?['inventory','expectedRevision','operationId']:['empId','month','expectedRevision','mode','reason','operationId']);
 const inventory=proposal?validatePayrollItemInventory(data.inventory):null;
 const empId=inventory?.empId||data.empId,month=inventory?.month||data.month;
 if(!payrollItemIdentity(empId)||!payrollItemMonth(month)||!payrollItemIdentity(uid))fail(400,'員工／月份識別無效');
 const id=payrollItemInventoryId(empId,month),col=(name:string)=>db.collection(name),readTx={get:(r:any)=>r.get()};
 if(reading){
  const actor=await read(readTx,col('employees').doc(uid));if(uid!==empId&&actor.role!==UserRole.SuperAdmin)fail(403,'不得讀取他人薪資項目');
  const employee=await read(readTx,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'純系統帳號不適用薪資項目');
  const current=await read(readTx,col('payrollItemInventories').doc(id),true);
  await verifyImmutableHistory(db,readTx,current,empId,month,id);
  const q=await col('payrollItemInventoryVersions').where('empId','==',empId).limit(1001).get();if(q.size>1000)fail(409,'薪資項目版本清冊技術容量超限');
  const all=q.docs.map((d:any)=>({...d.data(),versionId:d.id})).filter((v:any)=>v.month===month);
  const manage=actor.role===UserRole.SuperAdmin&&uid!==empId;
  // Pending replacements are never a fallback to an earlier approval.
  return {empId,month,current:manage||current?.status==='approved'?current:null,versions:manage?all:all.filter((v:any)=>v.status==='approved'),canManage:manage,assessment:assessPayrollItemInventory(manage||current?.status==='approved'?current:null)};
 }
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'需操作識別及非負整數版本');
 const reason=proposal?inventory!.reason:payrollItemReason(data.reason);
 if(!proposal&&!['approve','return'].includes(data.mode))fail(400,'核定操作無效');
 const hash=evidenceHash([action,data]),at=new Date().toISOString();
 return runPayrollMutation(db,[],async tx=>{
  // Role is read again on every retry and before a receipt can be replayed.
  const actor=await read(tx,col('employees').doc(uid));if(actor.role!==UserRole.SuperAdmin||uid===empId)fail(403,'僅最高管理者可登錄他人薪資項目');
  const employee=await read(tx,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'純系統帳號不適用薪資項目');
  const receiptRef=col('payrollItemCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true);
  if(receipt){if(receipt.hash!==hash)fail(409,'相同操作識別內容不同');return receipt.result;}
  await assertTransactionMonths(db,tx,[month]);
  const current=await read(tx,col('payrollItemInventories').doc(id),true);
  if((current?.revision||0)!==data.expectedRevision)fail(409,'薪資項目清冊版本已變更');
  await verifyImmutableHistory(db,tx,current,empId,month,id);
  const revision=(current?.revision||0)+1;
  if(revision>100||current?.history.length>=100)fail(409,'月份薪資項目歷程技術容量已滿');
  let result:PayrollItemInventoryVersion;
  if(proposal){
   if(current&&!['approved','returned'].includes(current.status))fail(409,'待核定版本不可覆寫，需先核退');
   result={schemaVersion:'payroll-item-inventory-v1',id,empId,month,revision,status:'proposed',inventory:inventory!,proposedBy:uid,proposedAt:at,history:[...(current?.history||[]),{actor:uid,at,to:'proposed',revision,reason}],...flags};
  }else{
   if(!current||current.status!=='proposed')fail(409,'只有待核定清冊可核定或退回');
   if(current.proposedBy===uid||current.history.some((h:any)=>h.to==='proposed'&&h.actor===uid))fail(403,'不得核定本人提出或曾編輯的清冊');
   const validated=validatePayrollItemInventory(current.inventory);
   if(validated.empId!==empId||validated.month!==month)fail(409,'薪資項目內容範圍不符');
   const status=data.mode==='approve'?'approved':'returned';
   result={...current,inventory:validated,revision,status,reviewedBy:uid,reviewedAt:at,...(status==='approved'?{approvedBy:uid,approvedAt:at}:{}),history:[...current.history,{actor:uid,at,to:status,revision,reason}],...flags};
  }
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>700000)fail(409,'薪資項目證據容量過大');
  tx.create(col('payrollItemInventoryVersions').doc(id+'_'+revision),result);
  tx.set(col('payrollItemInventories').doc(id),result);
  tx.create(receiptRef,{actor:uid,at,hash,result});
  return result;
 });
}
