import {UserRole} from '../../../types';
import {validDate} from '../../../utils/attendance';
import {runPayrollMutation} from './monthGuard';
import {evidenceHash} from './attendanceCaseLifecycle';
/** Per-employee overtime review + comp-time arrangement (LSA Art.32-1).
 * An admin proposes, the employee agrees, and a different admin approves (two
 * people besides the employee). Approval writes the current
 * overtimeWorkflowPolicies/{emp} and compPolicies/{emp}, plus an immutable
 * version record. Comp deadline follows Enforcement Rules Art.22-2: the end of the
 * agreed annual-leave year; this system computes annual leave by calendar year.
 * https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=22-2 (checked 2026-10-25)
 */
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const manager=(r:any)=>r===UserRole.Admin||r===UserRole.SuperAdmin;
const read=async(tx:any,ref:any,optional=false)=>{const s=await tx.get(ref);if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
export const COMP_DEADLINE_RULE='annual-leave-year-end';
export const OVERTIME_COMP_POLICY_ACTIONS=['get-overtime-comp-policy','propose-overtime-comp-policy','agree-overtime-comp-policy','review-overtime-comp-policy'] as const;
export async function handleOvertimeCompPolicyAction(db:any,uid:string,action:string,data:any){
 const col=(c:string)=>db.collection(c),readTx={get:(r:any)=>r.get()};
 if(!id(data.empId))fail(400,'員工識別無效');const empId:string=data.empId;
 const actor=await read(readTx,col('employees').doc(uid));
 if(uid!==empId&&!manager(actor.role))fail(403,'不得讀取或處理他人加班／補休政策');
 if(action==='get-overtime-comp-policy'){
  const [proposal,comp,ot]=await Promise.all([read(readTx,col('overtimeCompPolicyProposals').doc(empId),true),read(readTx,col('compPolicies').doc(empId),true),read(readTx,col('overtimeWorkflowPolicies').doc(empId),true)]);
  return {empId,proposal,current:comp?.status==='approved'?{version:comp.version,reviewerIds:comp.reviewerIds,effectiveFrom:comp.effectiveFrom,effectiveTo:comp.effectiveTo,deadlineRule:comp.deadlineRule,approvedBy:comp.approvedBy,approvedAt:comp.approvedAt,employeeAgreedAt:comp.employeeAgreedAt}:null,overtimeReviewActive:ot?.status==='approved',canReview:manager(actor.role)&&uid!==empId&&proposal?.proposedBy!==uid};
 }
 if(!id(data.operationId)||!Number.isInteger(data.expectedRevision))fail(400,'政策操作需識別與版本');
 const reason=typeof data.reason==='string'?data.reason.trim():'';if(reason.length>2000)fail(400,'原因過長');
 const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await read(tx,col('employees').doc(uid)),employee=await read(tx,col('employees').doc(empId));
  const receipt=col('overtimeCompPolicyCommands').doc(evidenceHash([uid,data.operationId])),old=await tx.get(receipt);if(old.exists){if(old.data().hash!==hash)fail(409,'重播內容不同');return old.data().result;}
  const ref=col('overtimeCompPolicyProposals').doc(empId),current=await read(tx,ref,true);
  if((current?.revision||0)!==data.expectedRevision)fail(409,'政策提案已變更，請重新讀取');
  let result:any;const history=(to:string)=>[...(current?.history||[]),{actor:uid,at,to,reason:reason||null}];
  if(action==='propose-overtime-comp-policy'){
   if(!manager(a.role)||uid===empId)fail(403,'僅管理者可為他人提出政策');if(employee.accountKind==='system-account')fail(409,'系統帳號不適用');if(reason.length<5)fail(400,'需至少5字原因');
   const reviewers=data.reviewerIds;if(!Array.isArray(reviewers)||!reviewers.length||reviewers.length>10||new Set(reviewers).size!==reviewers.length||reviewers.some((r:any)=>!id(r)||r===empId))fail(400,'覆核人需為1–10位不含本人的管理者');
   for(const r of reviewers){const e=await read(tx,col('employees').doc(r),true);if(!e||!manager(e.role))fail(400,'覆核人必須是管理者帳號');}
   if(!validDate(data.effectiveFrom)||!validDate(data.effectiveTo)||data.effectiveTo<data.effectiveFrom)fail(400,'有效期間無效');
   result={id:empId,empId,status:'awaiting-employee',revision:(current?.revision||0)+1,reviewerIds:[...reviewers].sort(),effectiveFrom:data.effectiveFrom,effectiveTo:data.effectiveTo,deadlineRule:COMP_DEADLINE_RULE,annualLeaveYear:'calendar',conversion:'one-to-one',eligibleWork:['weekday-overtime','rest-day'],proposedBy:uid,proposedAt:at,employeeAgreedAt:null,history:history('awaiting-employee')};
  }else if(action==='agree-overtime-comp-policy'){
   if(uid!==empId)fail(403,'只能由員工本人同意');if(current?.status!=='awaiting-employee')fail(409,'沒有待本人同意的提案');
   result={...current,status:'awaiting-approval',revision:current.revision+1,employeeAgreedAt:at,history:history('employee-agreed')};
  }else{
   if(!manager(a.role))fail(403,'僅管理者可核定');if(!current||!['awaiting-employee','awaiting-approval'].includes(current.status))fail(409,'沒有待核定的提案');
   if(uid===empId||uid===current.proposedBy)fail(403,'不可核定本人或自己提出的政策');if(!['approve','return'].includes(data.mode))fail(400,'核定操作無效');if(reason.length<5)fail(400,'需至少5字原因');
   if(data.mode==='return')result={...current,status:'returned',revision:current.revision+1,history:history('returned')};
   else{
    if(current.status!=='awaiting-approval'||!current.employeeAgreedAt)fail(409,'員工尚未同意，不能核定');
    const version='ocp_'+evidenceHash([empId,current.revision,uid,data.operationId]);
    const base={empId,status:'approved',version,approvedBy:uid,approvedAt:at,reviewerIds:current.reviewerIds,effectiveFrom:current.effectiveFrom,effectiveTo:current.effectiveTo};
    tx.set(col('overtimeWorkflowPolicies').doc(empId),{...base,proposedBy:current.proposedBy});
    tx.set(col('compPolicies').doc(empId),{...base,employeeAgreedBy:empId,employeeAgreedAt:current.employeeAgreedAt,deadlineRule:COMP_DEADLINE_RULE,annualLeaveYear:'calendar',reservePending:true,minuteBasis:'explicit-request-interval',conversion:'one-to-one',proposedBy:current.proposedBy});
    tx.create(col('overtimeCompPolicyVersions').doc(version),{...base,proposal:current,reason});
    result={...current,status:'approved',revision:current.revision+1,approvedBy:uid,approvedAt:at,version,history:history('approved')};
   }
  }
  tx.set(ref,result);tx.create(receipt,{hash,result,actor:uid,at});return result;
 });
}
