import {LeaveStatus,LeaveType,UserRole} from '../../../types';
import {taipeiDate,validDate} from '../../../utils/attendance';
import {runPayrollMutation,assertTransactionMonths,monthsInRange} from './monthGuard';
import {evidenceHash} from './attendanceCaseLifecycle';
import {assertNoDuplicateLeave,assertAcceptedExplanation} from './anomalyExplanations';
import {planLeaveCaseRefresh,assertCurrentCaseSource} from './attendanceCaseService';
import {assertWorkflowCapacity} from './workflowCapacity';
import {prepareAttachmentSubmission,assertRequestAttachmentEvidence} from './makeupAttachments';
import {assessLeavePolicy,leaveTimestamp} from './leavePolicy';
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const id=(x:any)=>typeof x==='string'&&x.length>0&&x.length<=150&&!x.includes('/')&&!['.','..'].includes(x);
const read=async(db:any,tx:any,col:string,key:string)=>{if(!id(key))fail(400,'來源識別無效');const ref=db.collection(col).doc(key),s=await(tx?tx.get(ref):ref.get());if(!s.exists)fail(404,'來源不存在');return {...s.data(),id:s.id};};
const manager=(a:any)=>[UserRole.Admin,UserRole.SuperAdmin].includes(a.role);
const scope=(a:any,r:any)=>{if(![UserRole.Employee,UserRole.Admin,UserRole.SuperAdmin].includes(a.role))fail(403,'無假單權限');if(a.id!==r.empId&&!manager(a))fail(403,'無權讀取此假單');};
const period=(r:any)=>{const a=leaveTimestamp(r.startDate),b=leaveTimestamp(r.endDate);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)fail(409,'期間來源無效');return {start:taipeiDate(new Date(a)),end:taipeiDate(new Date(b-1)),minutes:(b-a)/60000};};
const history=(r:any,uid:string,at:string,reason:string,from:string)=>{const ev={id:evidenceHash([r.id,r.revision]),revision:r.revision,actor:uid,at,from,to:r.status,reason};r.history=[...(r.history||[]),ev];if(r.history.length>200||Buffer.byteLength(JSON.stringify(r))>500000)fail(409,'假單歷程達技術上限');return ev;};
export const LEAVE_LIFECYCLE_ACTIONS=['get-leave-workflow','act-leave-version'] as const;
export async function handleLeaveLifecycle(db:any,uid:string,action:string,data:any){
 if(['empId','actor','status','policy','quota','attachments','applicationEvidence','payrollAllocations','paidFraction'].some(k=>k in data))fail(400,'不可提交伺服器證據');
 if(action==='get-leave-workflow'){
  const a=await read(db,null,'employees',uid),r=await read(db,null,'leaveRequests',data.requestId);scope(a,r);
  const c=r.caseId?await read(db,null,'attendanceCases',r.caseId):null;
  return {request:r,sourceVersion:evidenceHash(r),caseRevision:c?.revision,caseEvidenceVersion:c?.observation.evidenceVersion,policyStatus:r.leavePolicyAssessment?.status||'needs-review',settlementEligibility:'BLOCKED'};
 }
 if(!id(data.operationId)||!id(data.requestId)||typeof data.reason!=='string'||data.reason.trim().length<5||data.reason.length>2000)fail(400,'操作識別與完整原因必填');
 const at=new Date().toISOString(),hash=evidenceHash(data);
 return runPayrollMutation(db,[],async tx=>{
  const a=await read(db,tx,'employees',uid),r=await read(db,tx,'leaveRequests',data.requestId);scope(a,r);
  const manage=['request-info','return','approve','reject'].includes(data.mode);
  if(manage?!manager(a)||a.id===r.empId:a.id!==r.empId)fail(403,'只能本人送件或非本人主管審核');
  const receipt=db.collection('leaveWorkflowCommands').doc(evidenceHash([uid,data.operationId])),old=await tx.get(receipt);
  if(old.exists){if(old.data().hash!==hash)fail(409,'操作識別內容不同');return old.data().result;}
  if((r.revision||0)!==data.expectedRevision||evidenceHash(r)!==data.sourceVersion)fail(409,'假單版本／來源已變更');
  const w=period(r);await assertTransactionMonths(db,tx,monthsInRange(w.start,w.end));
  const c=r.caseId?await read(db,tx,'attendanceCases',r.caseId):null;
  if(c){if(c.empId!==r.empId||c.revision!==data.expectedCaseRevision||c.observation.evidenceVersion!==data.expectedEvidenceVersion)fail(409,'案件來源已變更');await assertTransactionMonths(db,tx,monthsInRange(taipeiDate(new Date(c.observation.window.start*60000)),taipeiDate(new Date((c.observation.window.end-1)*60000))));}
  const pending=[LeaveStatus.Pending,LeaveStatus.NeedsInfo];let next:any={...r,revision:(r.revision||0)+1},previous:any=null,attachment:any=null;
  if(data.mode==='cancel'){
   if(!pending.includes(r.status))fail(409,'僅未核准待審／待補件可取消；已核須另走更正');next.status=LeaveStatus.Cancelled;
  }else if(['request-info','return'].includes(data.mode)){
   if(r.status!==LeaveStatus.Pending)fail(409,'僅待審可退回補件');next.status=LeaveStatus.NeedsInfo;
  }else if(data.mode==='resubmit'){
   if(![LeaveStatus.NeedsInfo,LeaveStatus.Rejected,LeaveStatus.Cancelled].includes(r.status))fail(409,'此狀態不可重送；核准不能覆寫');
   const startDate=data.startDate,endDate=data.endDate;for(const v of [startDate,endDate])if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!validDate(v.slice(0,10)))fail(400,'請填完整時區分鐘');
   if(!Object.values(LeaveType).includes(data.leaveType))fail(400,'假別不存在');
   next={id:'leaveversion_'+evidenceHash([uid,data.operationId]),schemaVersion:r.caseId?'case-leave-v1':'leave-version-v1',empId:r.empId,name:r.name,caseId:r.caseId||null,explanationId:('explanationId' in data?data.explanationId:r.explanationId)||null,revision:1,status:LeaveStatus.Pending,startDate,endDate,leaveType:data.leaveType,reason:data.reason.trim(),requestDate:at,supersedesId:r.id,history:[],policyStatus:'needs-review'};
   const nw=period(next);if(nw.minutes>31*1440||!Number.isInteger(nw.minutes))fail(400,'超過31日技術上限或非完整分鐘');next.hours=nw.minutes/60;next.requestedSpanMinutes=nw.minutes;
   if(c&&(Date.parse(endDate)/60000<=c.observation.window.start||Date.parse(startDate)/60000>=c.observation.window.end))fail(409,'新版本不在原案件期間');
   if(next.explanationId){if(!c)fail(409,'說明缺案件來源');next.explanationSource=await assertAcceptedExplanation(db,tx,c,next.explanationId,{start:Date.parse(next.startDate)/60000,end:Date.parse(next.endDate)/60000},at);}
   const e=await read(db,tx,'employees',r.empId);if(validDate(e.hireDate)&&(nw.start<e.hireDate||e.resignDate&&nw.end>e.resignDate))fail(409,'超出雇用期間');
   next.reviewIssues=['pay-policy-unverified',...(!validDate(e.hireDate)?['employment-unverified']:[]),...(e.leaveOfAbsenceStart&&nw.end>=e.leaveOfAbsenceStart&&(!e.leaveOfAbsenceEnd||nw.start<=e.leaveOfAbsenceEnd)?['leave-of-absence-overlap']:[])];
   await assertTransactionMonths(db,tx,monthsInRange(nw.start,nw.end));await assertNoDuplicateLeave(db,tx,next,r.id);
   next.leavePolicyAssessment=await assessLeavePolicy(db,tx,next,[r.id]);attachment=await prepareAttachmentSubmission(db,tx,uid,data,next.id,nw.start,'leave');Object.assign(next,attachment.fields);
   if(c){const link={id:evidenceHash([c.id,next.id]),caseId:c.id,sourceId:next.id};await assertWorkflowCapacity(db,tx,'caseLeaveLinks',[link]);}
   previous={...r,status:LeaveStatus.Superseded,revision:(r.revision||0)+1,supersededBy:next.id};
  }else if(['approve','reject'].includes(data.mode)){
   if(r.status!==LeaveStatus.Pending)fail(409,'待補件／已處理假單不可直接核准');
   if(data.mode==='approve'){
    if(c)await assertCurrentCaseSource(db,tx,c,at);if(r.explanationId){if(!c)fail(409,'說明缺案件來源');const source=await assertAcceptedExplanation(db,tx,c,r.explanationId,{start:leaveTimestamp(r.startDate)/60000,end:leaveTimestamp(r.endDate)/60000},at);if(evidenceHash(source)!==evidenceHash(r.explanationSource))fail(409,'假單採納來源鏈缺失或已變更');}
    const e=await read(db,tx,'employees',r.empId);if(!validDate(e.hireDate)||w.start<e.hireDate||e.resignDate&&w.end>e.resignDate||e.leaveOfAbsenceStart&&w.end>=e.leaveOfAbsenceStart&&(!e.leaveOfAbsenceEnd||w.start<=e.leaveOfAbsenceEnd))fail(409,'雇用／留停期間待核');
    await assertNoDuplicateLeave(db,tx,r,r.id);await assertRequestAttachmentEvidence(db,tx,r,'leave');next.leavePolicyAssessment=await assessLeavePolicy(db,tx,r,[r.id]);
   }
   next.status=data.mode==='approve'?LeaveStatus.Approved:LeaveStatus.Rejected;next.approver=uid;next.approvalDate=at;next.policyStatus='needs-review';
   if(data.mode==='reject')next.rejectReason=data.reason.trim();
  }else fail(400,'未知假單操作');
  if([LeaveStatus.Cancelled,LeaveStatus.Rejected].includes(next.status)&&next.leavePolicyAssessment?.reservedMinutes!==undefined)next.leavePolicyAssessment={...next.leavePolicyAssessment,reservationState:'released',releasedAt:at};
  if(previous?.leavePolicyAssessment?.reservedMinutes!==undefined)previous.leavePolicyAssessment={...previous.leavePolicyAssessment,reservationState:'superseded-release',releasedAt:at};
  const ev=history(next,uid,at,data.reason.trim(),previous?'建立新版本':r.status),oldEv=previous?history(previous,uid,at,data.reason.trim(),r.status):null;
  const refresh=await planLeaveCaseRefresh(db,tx,r.empId,[...new Set([...monthsInRange(w.start,w.end),...monthsInRange(period(next).start,period(next).end)])],next,uid,at,previous?[previous]:[]);
  const revisionKey=evidenceHash([r.id,next.id,next.revision,data.operationId]);
  if(previous){tx.update(db.collection('leaveRequests').doc(r.id),previous);tx.create(db.collection('caseLeaveEvents').doc(oldEv!.id),{...oldEv,requestId:r.id,empId:r.empId,caseId:r.caseId||null});tx.create(db.collection('leaveRequests').doc(next.id),next);if(c){const key=evidenceHash([c.id,next.id]);tx.create(db.collection('caseLeaveLinks').doc(key),{id:key,caseId:c.id,sourceId:next.id,revision:1,actor:uid,at});}}
  else tx.update(db.collection('leaveRequests').doc(r.id),next);
  tx.create(db.collection('leaveRevisions').doc(revisionKey),{requestId:r.id,before:r,after:next,actor:uid,at});tx.create(db.collection('caseLeaveEvents').doc(ev.id),{...ev,requestId:next.id,empId:r.empId,caseId:r.caseId||null});attachment?.commit();refresh();tx.create(receipt,{hash,result:next,actor:uid,at});return next;
 });
}
