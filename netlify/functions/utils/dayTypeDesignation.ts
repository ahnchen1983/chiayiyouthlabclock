import {UserRole} from '../../../types';
import {runPayrollMutation} from './monthGuard';
import {evidenceHash} from './attendanceCaseLifecycle';
import {validMonth,parseMonthDates,designationWarnings,designationDays} from '../../../utils/dayTypeDesignation';
/** Employee submits own monthly 例假／休息日 (or a reviewer records it on their
 * behalf with a reason); a different Admin/SuperAdmin approves. Approval creates an
 * immutable dayTypeCalendars version and moves dayTypeCalendarHeads/{emp}_{month}.
 * Locked months are rejected by runPayrollMutation; snapshots are never rewritten.
 */
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const reviewerRole=(role:any)=>role===UserRole.Admin||role===UserRole.SuperAdmin;
const read=async(tx:any,ref:any,optional=false)=>{const s=await tx.get(ref);if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
const dates=(v:unknown,month:string,label:string)=>{const r=parseMonthDates(v,month,label);if(typeof r==='string')fail(400,r);return r as string[];};
export const DAYTYPE_ACTIONS=['get-daytype-designation','list-daytype-designations','submit-daytype-designation','review-daytype-designation'] as const;
export async function handleDayTypeAction(db:any,uid:string,action:string,data:any){
 const readTx={get:(r:any)=>r.get()},col=(c:string)=>db.collection(c);
 if(!validMonth(data.yearMonth))fail(400,'月份無效');const month:string=data.yearMonth;
 const actor=await read(readTx,col('employees').doc(uid));
 if(action==='list-daytype-designations'){
  if(!reviewerRole(actor.role))fail(403,'僅管理者可查看全員日別指定');
  const q=await col('dayTypeDesignations').where('yearMonth','==',month).limit(201).get();if(q.size>200)fail(409,'日別指定容量超限');
  return {yearMonth:month,designations:q.docs.map((d:any)=>({...d.data(),id:d.id})).sort((a:any,b:any)=>a.empId.localeCompare(b.empId))};
 }
 const empId=data.empId||uid;if(!id(empId))fail(400,'員工識別無效');
 if(empId!==uid&&!reviewerRole(actor.role))fail(403,'不得讀取或代填他人日別');
 const key=empId+'_'+month;
 if(action==='get-daytype-designation'){
  const designation=await read(readTx,col('dayTypeDesignations').doc(key),true),head=await read(readTx,col('dayTypeCalendarHeads').doc(key),true);
  const calendar=head&&id(head.currentCalendarId)?await read(readTx,col('dayTypeCalendars').doc(head.currentCalendarId),true):null;
  return {empId,yearMonth:month,designation,calendar,headRevision:head?.revision||0,canReview:reviewerRole(actor.role)&&uid!==empId&&designation?.submittedBy!==uid};
 }
 if(!id(data.operationId)||!Number.isInteger(data.expectedRevision))fail(400,'日別操作需識別與版本');
 const reason=typeof data.reason==='string'?data.reason.trim():'';if(reason.length>2000)fail(400,'原因過長');
 const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[month],async tx=>{
  // All reads precede writes (Firestore transaction rule).
  const a=await read(tx,col('employees').doc(uid)),employee=await read(tx,col('employees').doc(empId));
  const receipt=col('dayTypeDesignationCommands').doc(evidenceHash([uid,data.operationId])),old=await tx.get(receipt);if(old.exists){if(old.data().hash!==hash)fail(409,'重播內容不同');return old.data().result;}
  const ref=col('dayTypeDesignations').doc(key),current=await read(tx,ref,true),headRef=col('dayTypeCalendarHeads').doc(key),head=await read(tx,headRef,true);
  if((current?.revision||0)!==data.expectedRevision)fail(409,'日別指定已變更，請重新讀取');
  let result:any;
  if(action==='submit-daytype-designation'){
   if(employee.accountKind==='system-account')fail(409,'系統帳號不適用日別指定');
   if(empId!==uid&&(!reviewerRole(a.role)||reason.length<5))fail(403,'代為補錄需管理者並填寫至少5字原因');
   const regular=dates(data.regularHolidays,month,'例假'),rest=dates(data.restDays,month,'休息日');if(regular.some(d=>rest.includes(d)))fail(400,'同一日不可同時為例假與休息日');
   result={id:key,empId,yearMonth:month,status:'submitted',revision:(current?.revision||0)+1,regularHolidays:regular,restDays:rest,warnings:designationWarnings(month,regular,rest),submittedBy:uid,submittedAt:at,onBehalf:empId!==uid,reason:reason||null,calendarId:current?.calendarId||null,history:[...(current?.history||[]),{actor:uid,at,to:'submitted',reason:reason||null}]};
   tx.set(ref,result);
  }else{
   if(!reviewerRole(a.role))fail(403,'僅管理者可核定日別');if(!current||current.status!=='submitted')fail(409,'沒有待核定的日別指定');
   if(uid===empId||uid===current.submittedBy)fail(403,'不可核定本人日別或自己送出的指定');
   if(!['approve','return'].includes(data.mode))fail(400,'核定操作無效');if(reason.length<5)fail(400,'核定／退回需至少5字原因');
   const history=[...current.history,{actor:uid,at,to:data.mode,reason}];
   if(data.mode==='return')result={...current,status:'returned',revision:current.revision+1,returnedBy:uid,returnedAt:at,history};
   else{
    const national=dates(data.nationalHolidays??[],month,'國定假日');if(national.some(d=>current.regularHolidays.includes(d)||current.restDays.includes(d)))fail(409,'國定假日與例假／休息日重疊，需另行核定補假或調移');
    if(data.confirmRemainingNormal!==true)fail(400,'需確認其餘日期為一般工作日');
    if(current.warnings.length&&data.acknowledgeWarnings!==true)fail(400,'指定有法遵提醒，需確認已核對');
    const calendarId='dtc_'+evidenceHash([key,current.revision,uid,data.operationId]);
    const calendar={id:calendarId,status:'approved',version:calendarId,yearMonth:month,employeeIds:[empId],days:designationDays(month,current.regularHolidays,current.restDays,national),nationalHolidays:national,warnings:current.warnings,acknowledgedWarnings:current.warnings.length>0,approvedBy:uid,approvedAt:at,reason,source:{designationId:key,designationRevision:current.revision,submittedBy:current.submittedBy,submittedAt:current.submittedAt,onBehalf:current.onBehalf},previousCalendarId:head?.currentCalendarId||null};
    tx.create(col('dayTypeCalendars').doc(calendarId),calendar);
    tx.set(headRef,{empId,yearMonth:month,currentCalendarId:calendarId,revision:(head?.revision||0)+1,actor:uid,at});
    result={...current,status:'approved',revision:current.revision+1,approvedBy:uid,approvedAt:at,calendarId,history};
   }
   tx.set(ref,result);
  }
  tx.create(receipt,{hash,result,actor:uid,at});return result;
 });
}
