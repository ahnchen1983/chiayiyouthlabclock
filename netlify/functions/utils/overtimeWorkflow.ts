import {UserRole} from '../../../types';
import {clockInterval,confirmedWork,unionIntervals,intervalMinutes,taipeiDate,validDate,type Interval} from '../../../utils/attendance';
import {evidenceHash,caseKey} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths,monthsInRange} from './monthGuard';
import {planOvertimeCaseRefresh,handleAttendanceCaseAction} from './attendanceCaseService';
import {assertWorkflowCapacity} from './workflowCapacity';
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const validId=(s:any)=>typeof s==='string'&&s.length>0&&s.length<=150&&!s.includes('/')&&!['.','..'].includes(s);
const read=async(db:any,tx:any,col:string,id:string,optional=false)=>{if(!validId(id))fail(400,'來源識別無效');const s=await(tx?tx.get(db.collection(col).doc(id)):db.collection(col).doc(id).get());if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
const rows=async(db:any,tx:any,col:string,empId:string)=>{const s=await tx.get(db.collection(col).where('empId','==',empId).limit(501));if(s.size>500)fail(409,'來源容量超限，未部分寫入');return s.docs.map((d:any)=>({...d.data(),id:d.id}));};
const manager=(a:any)=>[UserRole.Admin,UserRole.SuperAdmin].includes(a.role);
const actor=async(db:any,tx:any,uid:string)=>{const a=await read(db,tx,'employees',uid);if(![UserRole.Employee,UserRole.Admin,UserRole.SuperAdmin].includes(a.role))fail(403,'無加班工作流權限');return a;};
const minute=(v:any)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!validDate(v.slice(0,10))||!Number.isFinite(Date.parse(v)))fail(400,'需完整時區日期與分鐘');return Date.parse(v)/60000;};
const window=(r:any)=>{const start=minute(r.startDate),end=minute(r.endDate);if(end<=start||end-start>31*1440)fail(400,'期間無效或超過31日技術上限');return {start,end};};
const months=(w:Interval)=>monthsInRange(taipeiDate(new Date(w.start*60000)),taipeiDate(new Date((w.end-1)*60000)));
const overlaps=(a:Interval,b:Interval)=>a.start<b.end&&b.start<a.end;
const covers=(ranges:Interval[],w:Interval)=>intervalMinutes(ranges.map(r=>({start:Math.max(r.start,w.start),end:Math.min(r.end,w.end)})))===w.end-w.start;
const policyFor=async(db:any,tx:any,empId:string)=>{const p=await read(db,tx,'overtimeWorkflowPolicies',empId,true);return p?.status==='approved'&&p.version&&p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt))&&Array.isArray(p.reviewerIds)&&p.reviewerIds.length&&p.reviewerIds.every(validId)&&validDate(p.effectiveFrom)&&validDate(p.effectiveTo)?p:null;};
const scope=(a:any,empId:string,p:any,review=false)=>{if(!review&&a.id===empId)return;if(!manager(a)||a.id===empId||!p?.reviewerIds.includes(a.id))fail(403,'未指定此員工加班覆核權限；不可自核或預設全員');};
const policyPeriod=(p:any,w:Interval)=>{if(!p||taipeiDate(new Date(w.start*60000))<p.effectiveFrom||taipeiDate(new Date((w.end-1)*60000))>p.effectiveTo)fail(409,'加班審核政策／有效期尚未核定');};
export async function overtimeActualSource(db:any,tx:any,empId:string,w:Interval,providedCards?:any[]){
 const cards=providedCards||await rows(db,tx,'clockRecords',empId),relevant:any[]=[],ranges:Interval[]=[];let unknown=false;
 for(const c of cards){const day=Date.parse(c.date+'T00:00:00+08:00')/60000,span=clockInterval(c),possible=span?{start:day+span.start,end:day+span.end}:{start:day,end:day+2880};if(!Number.isFinite(day)||overlaps(possible,w)){relevant.push(c);const work=confirmedWork(c);if(!work)unknown=true;else for(const r of work){const full={start:day+r.start,end:day+r.end};if(overlaps(full,w))ranges.push({start:Math.max(full.start,w.start),end:Math.min(full.end,w.end)});}}}
 if(!relevant.length)unknown=true;const refs=relevant.map(c=>({collection:'clockRecords',id:c.id,version:evidenceHash(c)})).sort((a,b)=>a.id.localeCompare(b.id));
 const intervals=unionIntervals(ranges);return {version:evidenceHash([empId,w,refs]),intervals,unknown,refs,minutes:unknown?null:intervalMinutes(intervals)};
}
const event=(r:any,uid:string,at:string,from:string|null,reason:string)=>{const e={id:evidenceHash([r.id,r.revision]),revision:r.revision,actor:uid,at,from,to:r.status,reason};r.history=[...(r.history||[]),e];if(r.history.length>200||Buffer.byteLength(JSON.stringify(r))>500000)fail(409,'申請歷程容量超限');return e;};
const save=(db:any,tx:any,r:any,e:any)=>{tx.set(db.collection('overtimeRequests').doc(r.id),r);tx.create(db.collection('overtimeEvents').doc(e.id),{...e,requestId:r.id,empId:r.empId});};
export const OVERTIME_ACTIONS=['get-overtime-workflow','submit-overtime-request','act-overtime-request','scan-overtime-candidates'] as const;
export async function handleOvertimeAction(db:any,uid:string,action:string,data:any){
 if(['actor','status','actualWorkMinutes','approvedMinutes','statutoryPayableMinutes','actualSource','dayType','policy','appliedEvidence'].some(k=>k in data))fail(400,'不得提交伺服器工作／計薪證據');
 if(action==='get-overtime-workflow'){
  const tx={get:(r:any)=>r.get()},a=await actor(db,null,uid),empId=data.empId||uid,p=await policyFor(db,tx,empId);scope(a,empId,p);const requests=await rows(db,tx,'overtimeRequests',empId);
  const cards=await rows(db,tx,'clockRecords',empId);const result=[];for(const r of requests){if(a.id!==empId){const w=window(r);if(taipeiDate(new Date(w.start*60000))<p.effectiveFrom||taipeiDate(new Date((w.end-1)*60000))>p.effectiveTo)continue;}const actual=await overtimeActualSource(db,tx,empId,window(r),cards);result.push({...r,currentActual:actual,sourceChanged:actual.version!==r.actualSource.version,sourceVersion:evidenceHash(r)});}
  return {empId,requests:result,workflowPolicy:p?{version:p.version,reviewerIds:p.reviewerIds}:null,settlementEligibility:'BLOCKED',deliveryEnabled:false};
 }
 if(action==='scan-overtime-candidates'){
  const a=await actor(db,null,uid),p=await policyFor(db,{get:(r:any)=>r.get()},data.empId);scope(a,data.empId,p,true);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.yearMonth||''))fail(400,'月份無效');const start=Date.parse(data.yearMonth+'-01T00:00:00+08:00')/60000,next=new Date(data.yearMonth+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);policyPeriod(p,{start,end:Date.parse(next.toISOString().slice(0,10)+'T00:00:00+08:00')/60000});
  return handleAttendanceCaseAction(db,uid,'scan-attendance-cases',{empId:data.empId,yearMonth:data.yearMonth});
 }
 if(!validId(data.operationId)||typeof data.reason!=='string'||data.reason.trim().length<5||data.reason.length>2000)fail(400,'操作識別與完整原因必填');const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await actor(db,tx,uid),old=action==='act-overtime-request'?await read(db,tx,'overtimeRequests',data.requestId):null,empId=old?.empId||uid,p=await policyFor(db,tx,empId);
  const reviewing=!!old&&['approve','partial-approve','preauthorize','return','request-info','reject'].includes(data.mode);scope(a,empId,p,reviewing);if(!reviewing&&a.id!==empId)fail(403,'只能本人提交／撤回');
  const receipt=db.collection('overtimeCommands').doc(evidenceHash([uid,data.operationId])),previous=await tx.get(receipt);if(previous.exists){if(previous.data().hash!==hash)fail(409,'相同操作內容不符');return previous.data().result;}
  if(old&&(old.revision!==data.expectedRevision||evidenceHash(old)!==data.sourceVersion))fail(409,'申請版本已變更');if(old)await assertTransactionMonths(db,tx,months(window(old)));
  const creating=!old||data.mode==='resubmit';let r:any,prior:any=null;
  if(creating){
   if(old&&!['submitted','needs-info','preauthorized','rejected','cancelled'].includes(old.status))fail(409,'已核工作不能直接改寫');const w=window(data);await assertTransactionMonths(db,tx,months(w));
   if(!['before','after'].includes(data.phase)||!['on-site','offsite','travel'].includes(data.kind))fail(400,'申請階段與工作類型必填');if(data.phase==='before'?w.start<Date.parse(at)/60000:w.start>Date.parse(at)/60000)fail(409,'事前／事後與期間不一致');
   const employee=await read(db,tx,'employees',empId),first=taipeiDate(new Date(w.start*60000)),last=taipeiDate(new Date((w.end-1)*60000));if(validDate(employee.hireDate)&&(first<employee.hireDate||employee.resignDate&&last>employee.resignDate))fail(409,'超出雇用期間');
   for(const q of await rows(db,tx,'overtimeRequests',empId))if(q.id!==old?.id&&!['rejected','cancelled','superseded'].includes(q.status)&&overlaps(window(q),w))fail(409,'期間已有有效加班申請');
   const source=await overtimeActualSource(db,tx,empId,w);const caseId=data.linkedCaseId||old?.caseId||null;
   if(caseId){const c=await read(db,tx,'attendanceCases',caseId);if(c.empId!==empId||!overlaps(c.observation.window,w))fail(409,'案件員工或期間不符');await assertTransactionMonths(db,tx,months(c.observation.window));}
   r={id:'overtime_'+evidenceHash([uid,data.operationId]),schemaVersion:'overtime-request-v1',empId,revision:1,status:'submitted',phase:data.phase,kind:data.kind,startDate:data.startDate,endDate:data.endDate,reason:data.reason.trim(),requestedMinutes:w.end-w.start,actualWorkMinutes:source.minutes,actualSource:source,approvedMinutes:null,statutoryPayableMinutes:null,approvedIntervals:[],authorizedIntervals:[],dayType:'unverified',complianceStatus:'needs-review',policyStatus:'needs-review',workflowPolicyVersion:p?.version||null,caseId,createdBy:uid,createdAt:at,history:[],...(old?{supersedesId:old.id}:{})};
   if(old)prior={...old,revision:old.revision+1,status:'superseded',supersededBy:r.id};
  }else{
   const w=window(old);r={...old,revision:old.revision+1};
   if(data.mode==='cancel'){if(!['submitted','needs-info'].includes(old.status))fail(409,'僅未核可撤回；不抹去實際工作');r.status='cancelled';}
   else if(['return','request-info','reject'].includes(data.mode)){policyPeriod(p,w);if(old.status!=='submitted')fail(409,'申請狀態不符');r.status=data.mode==='reject'?'rejected':'needs-info';}
   else if(['approve','partial-approve','preauthorize'].includes(data.mode)){
    policyPeriod(p,w);if(old.status!=='submitted')fail(409,'待補件或已處理不能核准');const employee=await read(db,tx,'employees',empId),first=taipeiDate(new Date(w.start*60000)),last=taipeiDate(new Date((w.end-1)*60000));if(!validDate(employee.hireDate)||first<employee.hireDate||employee.resignDate&&last>employee.resignDate||employee.leaveOfAbsenceStart&&last>=employee.leaveOfAbsenceStart&&(!employee.leaveOfAbsenceEnd||first<=employee.leaveOfAbsenceEnd))fail(409,'雇用或留停來源需調查，不能核准但不抹去工作');const source=await overtimeActualSource(db,tx,empId,w);if(source.version!==old.actualSource.version)fail(409,'實際工作來源變更，須新版本重新調查');
    if(!Array.isArray(data.intervals)||!data.intervals.length||data.intervals.length>20)fail(400,'需明確覆核區間');const ranges=data.intervals.map((v:any)=>window(v));if(ranges.some((v:Interval)=>!covers([w],v)))fail(409,'核准不得超過申請');const intervals=unionIntervals(ranges),minutes=intervalMinutes(intervals);
    if(data.mode==='preauthorize'){if(old.phase!=='before'||w.start<Date.parse(at)/60000)fail(409,'僅尚未開始的事前計畫可授權，否則須事後新版本');r.status='preauthorized';r.authorizedIntervals=intervals;r.approvedMinutes=null;}
    else{if(source.unknown||intervals.some(v=>!covers(source.intervals,v)))fail(409,'未確認實際工作或核准超出已核工作，須重新調查');if(data.mode==='approve'&&minutes!==old.requestedMinutes||data.mode==='partial-approve'&&minutes>=old.requestedMinutes)fail(409,'完整／部分核准範圍不符');r.status=data.mode==='approve'?'approved':'partial-approved';r.approvedIntervals=intervals;r.approvedMinutes=minutes;r.approvalSourceVersion=source.version;}
    r.reviewedBy=uid;r.reviewedAt=at;r.workflowPolicyEvidence=evidenceHash(p);
   }else fail(400,'未知操作');
  }
  const w=window(r),links=[...(r.caseId?[{id:evidenceHash([r.caseId,r.id]),caseId:r.caseId,sourceId:r.id}]:[]),...['pending-request'].map(type=>{const c=caseKey(empId,type as any,'overtimeRequests:'+r.id);return {id:evidenceHash([c,r.id]),caseId:c,sourceId:r.id};})];
  if(creating)await assertWorkflowCapacity(db,tx,'caseOvertimeLinks',links);
  const ev=event(r,uid,at,old?.status||null,data.reason.trim()),priorEv=prior?event(prior,uid,at,old.status,data.reason.trim()):null;
  const refresh=await planOvertimeCaseRefresh(db,tx,empId,[...new Set([...months(w),...(old?months(window(old)):[])])],r,uid,at,prior?[prior]:[]);
  if(prior)save(db,tx,prior,priorEv);save(db,tx,r,ev);if(creating)for(const l of links)tx.create(db.collection('caseOvertimeLinks').doc(l.id),{...l,actor:uid,at,revision:1});refresh();tx.create(receipt,{hash,result:r,actor:uid,at});return r;
 });
}
// Explicit event-handler contract only; no exported scheduler or automatic production trigger.
export const overtimeEventHandler=handleOvertimeAction;
