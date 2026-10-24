import {validLeaveAllocations} from './payroll';
import {LeaveStatus,LeaveType,UserRole} from '../../../types';
import {validDate,taipeiDate,clockInterval} from '../../../utils/attendance';
import {runPayrollMutation,assertTransactionMonths,monthsInRange} from './monthGuard';
import {evidenceHash} from './attendanceCaseLifecycle';
import {appendCaseWorkflowEvent,persistCaseWorkflow,assertCurrentCaseSource,planLeaveCaseRefresh} from './attendanceCaseService';
import {assertWorkflowCapacity} from './workflowCapacity';
export const EXPLANATION_ACTIONS=['get-case-explanation-workflow','submit-anomaly-explanation','act-anomaly-explanation','submit-case-leave','link-case-leave','review-case-leave'] as const;
const fail=(code:number,msg:string):never=>{throw Object.assign(new Error(msg),{statusCode:code});};
const validId=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const read=async(db:any,tx:any,col:string,id:string)=>{if(!validId(id))fail(400,'來源識別無效');const ref=db.collection(col).doc(id),s=await(tx?tx.get(ref):ref.get());if(!s.exists)fail(404,'來源不存在');return {...s.data(),id:s.id};};
const actor=async(db:any,tx:any,uid:string)=>{const a=await read(db,tx,'employees',uid);if(![UserRole.Employee,UserRole.Admin,UserRole.SuperAdmin].includes(a.role))fail(403,'無權限');return {...a,manager:a.role!==UserRole.Employee};};
const scope=(a:any,empId:string,manager=false)=>{if(manager?!a.manager||a.id===empId:!a.manager&&a.id!==empId)fail(403,'無本人／非本人主管權限');};
const own=(a:any,id:string)=>{if(a.id!==id)fail(403,'只能送本人說明與假單');};
const reason=(s:any)=>{if(typeof s!=='string'||s.trim().length<5||s.length>2000)fail(400,'請填至少五字完整原因');return s.trim();};
const stamp=(v:any)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!validDate(v.slice(0,10))||!Number.isFinite(Date.parse(v)))fail(400,'期間須完整日期、時區與整數分鐘');return Date.parse(v)/60000;};
const legacyMinute=(s:any)=>typeof s==='string'?Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(s)?s:s+'+08:00')/60000:NaN;
const range=(r:any)=>({start:legacyMinute(r.startDate),end:legacyMinute(r.endDate)});
const overlap=(a:any,b:any)=>a.start<b.end&&b.start<a.end;
const months=(w:any)=>{if(!Number.isFinite(w?.start)||!Number.isFinite(w?.end)||w.end<=w.start)fail(409,'來源期間未知，不能略過鎖月');return monthsInRange(taipeiDate(new Date(w.start*60000)),taipeiDate(new Date((w.end-1)*60000)));};
const caseWindow=(c:any)=>c.observation.window;
const rows=async(db:any,tx:any,col:string,field:string,value:string,limit=500)=>{const snap=await tx.get(db.collection(col).where(field,'==',value).limit(limit+1));if(snap.size>limit)fail(409,'來源超出技術容量，未部分寫入');return snap.docs.map((d:any)=>({...d.data(),id:d.id}));};
export async function assertNoDuplicateLeave(db:any,tx:any,r:any,excludeId?:string){
 if(!Object.values(LeaveType).includes(r.leaveType))fail(400,'假別不存在');const w=range(r);months(w);
 for(const old of await rows(db,tx,'leaveRequests','empId',r.empId)){
  if(old.id===excludeId||old.status===LeaveStatus.Rejected)continue;
  const oldRange=range(old);if(!Number.isFinite(oldRange.start)||!Number.isFinite(oldRange.end))fail(409,'既有假單期間未知，需先覆核');
  if(overlap(w,oldRange))fail(409,'同時段已有待審或核准假單，不能重複建立／核准');
 }
}
const link=(caseId:string,sourceId:string)=>({id:evidenceHash([caseId,sourceId]),caseId,sourceId});
const event=(r:any,uid:string,at:string,from:string|null,why:string)=>({id:evidenceHash([r.id,r.revision]),revision:r.revision,actor:uid,at,from,to:r.status,reason:why});
const saveExplanation=(db:any,tx:any,r:any,e:any)=>{const next={...r,history:[...(r.history||[]),e]};if(next.history.length>200||Buffer.byteLength(JSON.stringify(next))>500000)fail(409,'說明歷程容量不足');tx.set(db.collection('anomalyExplanations').doc(r.id),next);tx.create(db.collection('anomalyExplanationEvents').doc(e.id),{...e,explanationId:r.id,caseId:r.caseId,empId:r.empId});return next;};
const assertCase=(c:any,data:any,allowClosed=false)=>{if(c.revision!==data.expectedCaseRevision||c.observation.evidenceVersion!==data.expectedEvidenceVersion)fail(409,'案件或來源版本已變更');if(!allowClosed&&['resolved','cancelled'].includes(c.status))fail(409,'已結案案件須由來源重核，不接受文字解除');};
const employmentIssues=(e:any,w:any)=>{const first=taipeiDate(new Date(w.start*60000)),last=taipeiDate(new Date((w.end-1)*60000));const issues=[];if(!validDate(e.hireDate))issues.push('employment-unverified');else if(first<e.hireDate||e.resignDate&&last>e.resignDate)fail(409,'申請超出雇用區間');if(e.leaveOfAbsenceStart&&(!e.leaveOfAbsenceEnd||first<=e.leaveOfAbsenceEnd)&&last>=e.leaveOfAbsenceStart)issues.push('leave-of-absence-overlap');return issues;};
async function leaveIssues(db:any,tx:any,e:any,w:any){
 const issues=[...employmentIssues(e,w),'leave-entitlement-policy-unverified','pay-policy-unverified'];
 for(const c of await rows(db,tx,'clockRecords','empId',e.id)){
  const span=clockInterval(c),start=Date.parse(c.date+'T00:00:00+08:00')/60000;
  if(!span){if(c.date>=taipeiDate(new Date((w.start-1440)*60000))&&c.date<=taipeiDate(new Date(w.end*60000)))issues.push('clock-boundary-unverified');continue;}
  if(overlap(w,{start:start+span.start,end:start+span.end}))issues.push('clock-leave-overlap');
 }
 return [...new Set(issues)];
}
export async function handleExplanationAction(db:any,uid:string,action:string,data:any){
 if(['empId','actor','at','status','policy','paidFraction','payrollAllocations','sourceRefs','proof','applicationEvidence'].some(k=>k in data))fail(400,'不得提交伺服器證據或計薪設定');
 if(action==='get-case-explanation-workflow'){
  const a=await actor(db,null,uid),c=await read(db,null,'attendanceCases',data.caseId);scope(a,c.empId);
  const readTx={get:(r:any)=>r.get()},exLinks=await rows(db,readTx,'caseExplanationLinks','caseId',c.id,100),leaveLinks=await rows(db,readTx,'caseLeaveLinks','caseId',c.id,100);
  const explanations=[],leaves=[];for(const l of exLinks){const e=await read(db,null,'anomalyExplanations',l.sourceId);if(e.empId!==c.empId||e.caseId!==c.id)fail(409,'說明來源不一致');explanations.push(e);}for(const l of leaveLinks){const r=await read(db,null,'leaveRequests',l.sourceId);if(r.empId!==c.empId)fail(409,'假單來源不一致');leaves.push(r);}
  return {caseId:c.id,empId:c.empId,caseRevision:c.revision,evidenceVersion:c.observation.evidenceVersion,window:caseWindow(c),explanations,leaves,policyStatus:'needs-review',settlementEligibility:'BLOCKED'};
 }
 if(!validId(data.operationId)||!validId(data.caseId))fail(400,'操作與案件識別必填');const why=reason(data.reason),at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await actor(db,tx,uid),c=await read(db,tx,'attendanceCases',data.caseId);scope(a,c.empId);
  const commandRef=db.collection('anomalyWorkflowCommands').doc(evidenceHash([uid,data.operationId])),receipt=await tx.get(commandRef);
  const manage=action==='review-case-leave'||action==='act-anomaly-explanation'&&['request-info','accept','reject'].includes(data.mode);
  if(manage)scope(a,c.empId,true);else if(action!=='link-case-leave')own(a,c.empId);
  if(receipt.exists){if(receipt.data().hash!==hash)fail(409,'操作識別內容不符');return receipt.data().result;}
  assertCase(c,data,action==='act-anomaly-explanation'&&data.mode==='cancel');await assertTransactionMonths(db,tx,months(caseWindow(c)));let result:any;
  if(action==='submit-anomaly-explanation'||action==='act-anomaly-explanation'){
   let r:any,old:any=null;if(action==='act-anomaly-explanation'){
    old=await read(db,tx,'anomalyExplanations',data.explanationId);if(old.caseId!==c.id||old.empId!==c.empId)fail(403,'說明不屬此案件');if(old.revision!==data.expectedRevision)fail(409,'說明版本已變更');await assertTransactionMonths(db,tx,months(range(old)));
    if(!['request-info','accept','reject','cancel','resubmit'].includes(data.mode))fail(400,'說明操作無效');
    if(data.mode==='resubmit'?!['needs-info','rejected','cancelled'].includes(old.status):data.mode==='cancel'?!['submitted','needs-info'].includes(old.status):old.status!=='submitted')fail(409,'此說明狀態不能操作；採納後不可直接取消');
   }
   const creating=!old||data.mode==='resubmit';
   if(creating){
    const text=reason(data.text),id='explanation_'+evidenceHash([uid,data.operationId]),l=link(c.id,id);
    await assertWorkflowCapacity(db,tx,'caseExplanationLinks',[l]);
    r={id,schemaVersion:'anomaly-explanation-v1',empId:c.empId,caseId:c.id,revision:1,status:'submitted',text,startDate:new Date(caseWindow(c).start*60000).toISOString(),endDate:new Date(caseWindow(c).end*60000).toISOString(),caseEvidenceVersion:c.observation.evidenceVersion,sourceRefs:c.observation.refs||[],supersedesId:old?.id||null,createdBy:uid,createdAt:at,updatedAt:at,history:[]};
    const nextCase=appendCaseWorkflowEvent(c,{operationId:data.operationId,reason:why},uid,at,'awaiting-review');
    if(old){const previous={...old,status:'superseded',revision:old.revision+1,supersededBy:id,updatedAt:at};saveExplanation(db,tx,previous,event(previous,uid,at,old.status,why));}
    result=saveExplanation(db,tx,r,event(r,uid,at,null,why));tx.create(db.collection('caseExplanationLinks').doc(l.id),{...l,revision:1,actor:uid,at});persistCaseWorkflow(db,tx,c,nextCase);
   }else{
    if(data.mode==='accept'){if(old.caseEvidenceVersion!==c.observation.evidenceVersion)fail(409,'說明依據已變更，須補件重送');await assertCurrentCaseSource(db,tx,c,at);}
    const status=({'request-info':'needs-info',accept:'accepted',reject:'rejected',cancel:'cancelled'} as any)[data.mode];r={...old,status,revision:old.revision+1,updatedAt:at};
    if(data.mode==='accept'){const snapshot={caseId:c.id,empId:c.empId,evidenceVersion:c.observation.evidenceVersion,startDate:r.startDate,endDate:r.endDate,refsHash:evidenceHash(r.sourceRefs),explanationRevision:r.revision,acceptedBy:uid,acceptedAt:at};r.acceptedSource={...snapshot,hash:evidenceHash(snapshot)};}
    result=saveExplanation(db,tx,r,event(r,uid,at,old.status,why));persistCaseWorkflow(db,tx,c,appendCaseWorkflowEvent(c,{operationId:data.operationId,reason:why},uid,at,['resolved','cancelled'].includes(c.status)?c.status:data.mode==='request-info'?'needs-info':'awaiting-review'));
   }
  }else if(action==='submit-case-leave'){
   const e=await read(db,tx,'employees',c.empId),w={start:stamp(data.startDate),end:stamp(data.endDate)};if(w.end<=w.start||w.end-w.start>31*1440)fail(400,'期間無效或超過本批31日技術上限');if(!overlap(w,caseWindow(c)))fail(409,'假單與案件期間不相交');
   const explanationSource=data.explanationId?await assertAcceptedExplanation(db,tx,c,data.explanationId,w,at):null;
   const r:any={id:'caseleave_'+evidenceHash([uid,data.operationId]),schemaVersion:'case-leave-v1',empId:c.empId,name:e.name||c.empId,caseId:c.id,explanationId:data.explanationId||null,explanationSource,revision:1,leaveType:data.leaveType,startDate:data.startDate,endDate:data.endDate,hours:(w.end-w.start)/60,requestedSpanMinutes:w.end-w.start,reason:why,requestDate:at,status:LeaveStatus.Pending,policyStatus:'needs-review',history:[]};
   r.reviewIssues=await leaveIssues(db,tx,e,w);await assertNoDuplicateLeave(db,tx,r);await assertTransactionMonths(db,tx,months(w));const l=link(c.id,r.id);await assertWorkflowCapacity(db,tx,'caseLeaveLinks',[l]);
   const ev=event(r,uid,at,null,why);r.history=[ev];const refresh=await planLeaveCaseRefresh(db,tx,c.empId,months(w),r,uid,at);tx.create(db.collection('leaveRequests').doc(r.id),r);tx.create(db.collection('caseLeaveLinks').doc(l.id),{...l,revision:1,actor:uid,at});tx.create(db.collection('caseLeaveEvents').doc(ev.id),{...ev,requestId:r.id,caseId:c.id,empId:c.empId});refresh();result=r;
  }else if(action==='link-case-leave'){
   const r=await read(db,tx,'leaveRequests',data.leaveRequestId);if(r.empId!==c.empId)fail(403,'假單與案件員工不符');if((r.revision||0)!==data.expectedRevision)fail(409,'假單版本已變更');const w=range(r);await assertTransactionMonths(db,tx,months(w));if(!overlap(w,caseWindow(c)))fail(409,'假單與案件期間不相交');const l=link(c.id,r.id);await assertWorkflowCapacity(db,tx,'caseLeaveLinks',[l]);const old=await tx.get(db.collection('caseLeaveLinks').doc(l.id));if(old.exists)result=old.data();else{result={...l,revision:1,actor:uid,at};tx.create(db.collection('caseLeaveLinks').doc(l.id),result);tx.create(db.collection('caseLeaveLinkEvents').doc(l.id),{...result,reason:why});}
  }else if(action==='review-case-leave'){
   const r=await read(db,tx,'leaveRequests',data.leaveRequestId);if(r.schemaVersion!=='case-leave-v1'||r.empId!==c.empId||r.caseId!==c.id)fail(409,'請使用假單原審核入口');if(r.revision!==data.expectedRevision||r.status!==LeaveStatus.Pending)fail(409,'假單已更新或審核，不能取消／覆寫');if(!['approve','reject'].includes(data.mode))fail(400,'審核方式無效');
   const w=range(r),e=await read(db,tx,'employees',r.empId);await assertTransactionMonths(db,tx,months(w));const issues=await leaveIssues(db,tx,e,w);
   if(data.mode==='approve'){if(r.explanationId){const source=await assertAcceptedExplanation(db,tx,c,r.explanationId,w,at);if(evidenceHash(source)!==evidenceHash(r.explanationSource))fail(409,'假單採納來源鏈缺失或已變更');}await assertCurrentCaseSource(db,tx,c,at);if(issues.includes('employment-unverified')||issues.includes('leave-of-absence-overlap'))fail(409,'雇用或留停期間待核實');await assertNoDuplicateLeave(db,tx,r,r.id);}
   const next={...r,status:data.mode==='approve'?LeaveStatus.Approved:LeaveStatus.Rejected,revision:r.revision+1,approver:uid,approvalDate:at,...(data.mode==='reject'?{rejectReason:why}:{}),reviewIssues:issues,policyStatus:'needs-review'};
   const revisionId=evidenceHash([r.id,next.revision,data.operationId]);next.applicationEvidence={version:'case-leave-v1',revisionId,sourceKey:evidenceHash([r.empId,r.leaveType,r.startDate,r.endDate,r.hours]),requiresPayrollAllocation:true};
   const ev=event(next,uid,at,r.status,why);next.history=[...(r.history||[]),ev];const refresh=await planLeaveCaseRefresh(db,tx,r.empId,months(w),next,uid,at);if(next.history.length>200)fail(409,'假單歷程容量不足');
   tx.update(db.collection('leaveRequests').doc(r.id),next);tx.create(db.collection('leaveRevisions').doc(revisionId),{requestId:r.id,before:r,after:next,actor:uid,at});tx.create(db.collection('caseLeaveEvents').doc(ev.id),{...ev,requestId:r.id,caseId:c.id,empId:r.empId});refresh();result=next;
  }else fail(400,'操作無效');
  tx.create(commandRef,{hash,result,actor:uid,at});return result;
 });
}

export async function prepareCaseLeaveAllocation(db:any,tx:any,uid:string,current:any,data:any){
 const a=await actor(db,tx,uid);scope(a,current.empId,true);
 if(!Number.isInteger(data.expectedRevision))fail(400,'追補假分配需明確版本');
 const key=evidenceHash([uid,current.id,data.expectedRevision,data.allocations]),receiptRef=db.collection('caseLeaveAllocationCommands').doc(key),receipt=await tx.get(receiptRef);
 if(receipt.exists)return ()=>{};
 if(current.revision!==data.expectedRevision)fail(409,'追補假單版本已變更');
 if(!validLeaveAllocations(current,data.allocations))fail(409,'分配超出核准時段或時數');
 const at=new Date().toISOString(),next={...current,revision:current.revision+1,payrollAllocations:data.allocations.map((v:any)=>({date:v.date,from:v.from,to:v.to,minutes:v.minutes})),payrollReviewedBy:uid,payrollReviewedAt:at};
 const ev=event(next,uid,at,current.status,'經既有請假分配入口覆核時段，仍須政策及卡假重疊檢查');next.history=[...(current.history||[]),ev];if(next.history.length>200)fail(409,'假單歷程容量不足');
 const refresh=await planLeaveCaseRefresh(db,tx,current.empId,months(range(current)),next,uid,at);
 return ()=>{tx.update(db.collection('leaveRequests').doc(current.id),next);tx.create(db.collection('leaveRevisions').doc(key),{requestId:current.id,before:current,after:next,actor:uid,at});tx.create(db.collection('caseLeaveEvents').doc(ev.id),{...ev,requestId:current.id,caseId:current.caseId,empId:current.empId});refresh();tx.create(receiptRef,{actor:uid,at,requestId:current.id,revision:next.revision});};
}

/** An adopted explanation endorses only its retained, current source and covered interval. */
export async function assertAcceptedExplanation(db:any,tx:any,c:any,explanationId:string,w:{start:number;end:number},at:string){
 const ex=await read(db,tx,'anomalyExplanations',explanationId),s=ex.acceptedSource;
 if(ex.empId!==c.empId||ex.caseId!==c.id||ex.status!=='accepted'||!s)fail(409,'說明未採納或缺少採納來源，須明確重新覆核');
 const {hash,...snapshot}=s;
 if(hash!==evidenceHash(snapshot)||s.caseId!==c.id||s.empId!==c.empId||s.explanationRevision!==ex.revision||s.evidenceVersion!==ex.caseEvidenceVersion||s.evidenceVersion!==c.observation.evidenceVersion||s.refsHash!==evidenceHash(ex.sourceRefs)||s.startDate!==ex.startDate||s.endDate!==ex.endDate)fail(409,'已採納說明來源過期，須新版本覆核');
 const covered=range(ex);if(!Number.isFinite(covered.start)||!Number.isFinite(covered.end)||w.start<covered.start||w.end>covered.end||w.end<=w.start)fail(409,'假單超出已採納說明涵蓋期間');
 await assertCurrentCaseSource(db,tx,c,at);
 return {explanationId:ex.id,revision:ex.revision,acceptedSourceHash:hash};
}
