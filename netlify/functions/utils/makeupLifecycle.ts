import {prepareAttachmentSubmission,assertRequestAttachmentEvidence} from './makeupAttachments';
import { requestAffectsMonth } from './payrollPreflight';
import { isMonthLocked } from './monthLock';
import { normalizeScheduleDoc } from './calculations';
import { UserRole } from '../../../types';
import { validDate, hhmmMinutes, taipeiDate, localInstant, clockInterval } from '../../../utils/attendance';
import { runPayrollMutation, assertTransactionMonths, monthsInRange } from './monthGuard';
import { evidenceHash } from './attendanceCaseLifecycle';
import { makeupSourceKey, makeupClockPatch } from './makeupEvidence';
import { editClock } from './clockMutation';
export const MAKEUP_ACTIONS=['submit-makeup-version','act-makeup-request','link-case-request','get-case-request-links','get-makeup-request-detail'] as const;
const fail=(statusCode:number,message:string):never=>{const e:any=new Error(message);e.statusCode=statusCode;throw e;};
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const revision=(r:any)=>r.revision??0;
const read=async(db:any,tx:any,col:string,key:string)=>{if(!id(key))fail(400,'識別無效');const ref=db.collection(col).doc(key),snap=tx?await tx.get(ref):await ref.get();if(!snap.exists)fail(404,'資料不存在');return {ref,value:{...snap.data(),id:snap.id}};};
const actor=async(db:any,uid:string,tx?:any)=>{const {value}=await read(db,tx,'employees',uid);if(![UserRole.Employee,UserRole.Admin,UserRole.SuperAdmin].includes(value.role))fail(403,'無補卡操作權限');return {...value,manager:value.role!==UserRole.Employee};};
const scope=(a:any,empId:string,manager=false)=>{if((manager&&!a.manager)||(!a.manager&&a.id!==empId))fail(403,'無權處理他人補卡');};
const owned=(a:any,empId:string)=>{if(a.id!==empId)fail(403,'只能提交或撤回本人申請');};
const bounded=async(tx:any,query:any)=>{const snap=await tx.get(query.limit(101));if(snap.size>100)fail(409,'關聯過多，未進行部分寫入');return snap.docs.map((d:any)=>({...d.data(),id:d.id}));};
const stamp=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(v)&&validDate(v.slice(0,10))&&hhmmMinutes(v.slice(11,16))!==null&&Number.isFinite(Date.parse(v));
const payload=(d:any,emp:any,at:string)=>{
 if(!validDate(d.date)||!['上班','下班','上下班'].includes(d.type)||typeof d.reason!=='string'||d.reason.trim().length<5||d.reason.length>2000)fail(400,'日期、補卡類型及詳細理由必填');
 const r:any={empId:emp.id,name:emp.name||emp.id,date:d.date,type:d.type,reason:d.reason.trim(),status:'待審核',requestDate:at,recordId:d.recordId||null,schemaVersion:'makeup-request-v1',revision:1,workflowPolicyStatus:'needs-configuration'};
 if(r.recordId&&!id(r.recordId))fail(400,'打卡識別無效');
 for(const side of ['In','Out']){
  const t=d['requestedClock'+side],ts=d['requestedClock'+side+'At'];
  if(t&&hhmmMinutes(t)===null||ts&&!stamp(ts))fail(400,'補卡時間需有效日期時間與時區');
  if(t&&ts&&new Date(ts).toLocaleTimeString('en-GB',{timeZone:'Asia/Taipei',hour12:false}).slice(0,5)!==t)fail(400,'簡寫時間與完整時間不一致');
  r['requestedClock'+side]=t||null;r['requestedClock'+side+'At']=ts||null;
 }
 if(r.type!=='下班'&&!r.requestedClockIn&&!r.requestedClockInAt||r.type!=='上班'&&!r.requestedClockOut&&!r.requestedClockOutAt)fail(400,'請填申請補正的時間');
 if(r.type==='上班'&&(r.requestedClockOut||r.requestedClockOutAt)||r.type==='下班'&&(r.requestedClockIn||r.requestedClockInAt))fail(400,'時間與補卡類型不符');
 const a=r.requestedClockInAt||(r.requestedClockIn?localInstant(r.date,r.requestedClockIn):null),b=r.requestedClockOutAt||(r.requestedClockOut?localInstant(r.date,r.requestedClockOut):null);
 if(a&&taipeiDate(new Date(a))!==r.date||b&&taipeiDate(new Date(b))<r.date||a&&b&&Date.parse(b)<=Date.parse(a))fail(400,'時間順序不符；跨夜請填完整下班日期');
 return r;
};
const requestMonths=(r:any,tolerate=false)=>{if(!validDate(r.date)){if(tolerate)return [];fail(409,'舊申請日期無效，須受控資料修復');}const dates=[r.date,...[r.requestedClockInAt,r.requestedClockOutAt].filter(Boolean).flatMap(t=>{if(!stamp(t)){if(tolerate)return [];fail(409,'舊申請完整時間無效，須受控資料修復');}return [taipeiDate(new Date(t))];})].sort();return monthsInRange(dates[0],dates.at(-1));};
const caseMonths=(c:any)=>{const w=c.observation?.window;if(!Number.isFinite(w?.start)||!Number.isFinite(w?.end)||w.end<=w.start)fail(409,'案件期間無效');return monthsInRange(taipeiDate(new Date(w.start*60000)),taipeiDate(new Date((w.end-1)*60000)));};
const match=(c:any,r:any)=>{
 if(c.empId!==r.empId)fail(403,'案件與申請員工不符');
 const w=c.observation?.window;caseMonths(c);
 const start=Date.parse(localInstant(r.date,'00:00')!)/60000;
 const points=[r.requestedClockInAt|| (r.requestedClockIn?localInstant(r.date,r.requestedClockIn):null),r.requestedClockOutAt||(r.requestedClockOut?localInstant(r.date,r.requestedClockOut):null)].filter(Boolean).map(t=>Date.parse(t)/60000);
 if(!(start<w.end&&w.start<start+1440)&&!points.some(t=>t>=w.start&&t<=w.end))fail(409,'申請日期時間與案件期間不相交');
 if(c.anchor?.startsWith('card:')&&r.recordId!==c.anchor.slice(5))fail(409,'此案件須指定同一筆打卡紀錄');
};
export const assertMakeupRequestLocks=async(db:any,tx:any,requests:any[])=>{
 const locks=await tx.get(db.collection('monthLocks'));const active=locks.docs.filter((d:any)=>isMonthLocked(d.data()));if(!active.length)return;
 const schedules=await tx.get(db.collection('dailySchedule').limit(501));if(schedules.size>500)fail(409,'班表證據超限，不能略過鎖月檢查');
 const days=schedules.docs.map((d:any)=>normalizeScheduleDoc(d.data(),d.id,''));
 for(const empId of [...new Set(requests.map(r=>r.empId))]){
  const cards=await tx.get(db.collection('clockRecords').where('empId','==',empId).limit(501));if(cards.size>500)fail(409,'打卡證據超限，不能略過鎖月檢查');
  const records=cards.docs.map((d:any)=>({...d.data(),id:d.id}));
  for(const lock of active)if(requests.some(r=>r.empId===empId&&requestAffectsMonth('makeupRequests',r,lock.id,empId as string,records,days)))fail(423,'補卡影響已鎖月份，須走差額覆核');
 }
};
const checkCard=async(db:any,tx:any,r:any)=>{
 if(!r.recordId)return [];
 const {value}=await read(db,tx,'clockRecords',r.recordId);if(value.empId!==r.empId||value.date!==r.date)fail(403,'打卡不屬於本人或指定日期');
 return monthsInRange(value.date,value.clockOutAt?taipeiDate(new Date(value.clockOutAt)):value.date);
};
const event=(r:any,uid:string,at:string,op:string,reason:string,from:string|null)=>({id:evidenceHash([r.id,revision(r),op]),operationId:op,revision:revision(r),actor:uid,at,from,to:r.status,reason});
const saveRequest=(db:any,tx:any,r:any,e:any,create=false)=>{const next={...r,schemaVersion:'makeup-request-v1',history:[...(r.history||[]),e]};if(next.history.length>200||Buffer.byteLength(JSON.stringify(next))>500000)fail(409,'歷程達上限，不能截斷保存');tx[create?'create':'set'](db.collection('makeupRequests').doc(r.id),next);tx.create(db.collection('makeupRequestEvents').doc(e.id),{...e,requestId:r.id,empId:r.empId});return next;};
const linkId=(caseId:string,requestId:string)=>evidenceHash(['case-request-v1',caseId,requestId]);
// Technical read/write bound counts retained inactive links too; unlink never frees history capacity.
const assertLinkCapacity=async(db:any,tx:any,pairs:{caseId:string;requestId:string}[])=>{
 for(const field of ['caseId','requestId'] as const){
  for(const key of new Set(pairs.map(p=>p[field]))){
   const existing=await bounded(tx,db.collection('caseRequestLinks').where(field,'==',key));
   const ids=new Set(existing.map(l=>l.id));
   for(const p of pairs.filter(p=>p[field]===key))ids.add(linkId(p.caseId,p.requestId));
   if(ids.size>100)fail(409,'關聯達技術容量上限，未進行部分寫入');
  }
 }
};
const linkValue=(c:any,r:any,uid:string,at:string,reason:string)=>({id:linkId(c.id,r.id),schemaVersion:'case-request-link-v1',caseId:c.id,requestId:r.id,empId:r.empId,kind:'makeupRequests',state:'active',revision:1,caseRevision:c.revision,requestRevision:revision(r),requestSourceKey:makeupSourceKey(r),actor:uid,at,reason});
const saveLink=(db:any,tx:any,l:any,op:string)=>{tx.set(db.collection('caseRequestLinks').doc(l.id),l);tx.create(db.collection('caseRequestLinkEvents').doc(evidenceHash([l.id,l.revision,op])),{...l,operationId:op});};
export async function handleMakeupAction(db:any,uid:string,action:string,data:any){
 if(['actor','at','proof','appliedEvidence','status','empId','approver','history','revision','attachments','attachmentPolicyVersion'].some(k=>k in data))fail(400,'不得提交伺服器擁有的欄位');
 if(action==='get-case-request-links'){
  const a=await actor(db,uid),{value:c}=await read(db,null,'attendanceCases',data.caseId);scope(a,c.empId);
  const snap=await db.collection('caseRequestLinks').where('caseId','==',c.id).limit(101).get();if(snap.size>100)fail(409,'關聯需分頁歸檔');
  const events=await db.collection('caseRequestLinkEvents').where('caseId','==',c.id).limit(201).get();
  return {history:events.docs.slice(0,200).map((d:any)=>{const e=d.data();return {requestId:e.requestId,revision:e.revision,state:e.state,actor:e.actor,at:e.at,reason:e.reason};}),historyComplete:events.size<=200,caseId:c.id,empId:c.empId,window:c.observation.window,caseRevision:c.revision,recordId:c.anchor?.startsWith('card:')?c.anchor.slice(5):null,links:snap.docs.map((d:any)=>({...d.data(),id:d.id})),workflowPolicyStatus:'needs-configuration'};
 }
 if(action==='get-makeup-request-detail'){
  const a=await actor(db,uid),{value:r}=await read(db,null,'makeupRequests',data.requestId);scope(a,r.empId);return r;
 }
 if(!id(data.operationId)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>2000)fail(400,'操作識別及原因必填');
 const at=new Date().toISOString(),commandRef=db.collection('makeupCommands').doc(evidenceHash([uid,data.operationId])),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await actor(db,uid,tx),command=await tx.get(commandRef);if(command.exists){if(command.data().hash!==hash)fail(409,'重送操作內容不符');scope(a,command.data().result.empId,action==='act-makeup-request'&&['return','approve','reject'].includes(data.mode));return command.data().result;}
  let result:any;
  if(action==='submit-makeup-version'){
   const r={...payload(data,a,at),id:'makeup_'+evidenceHash([uid,data.operationId]),supersedesRequestId:null};const months=[...requestMonths(r),...await checkCard(db,tx,r)];let c:any;
   if(data.caseId){c=(await read(db,tx,'attendanceCases',data.caseId)).value;owned(a,c.empId);if(c.revision!==data.expectedCaseRevision)fail(409,'案件已更新');match(c,r);months.push(...caseMonths(c));}
   if(c)await assertLinkCapacity(db,tx,[{caseId:c.id,requestId:r.id}]);
   const attachments=await prepareAttachmentSubmission(db,tx,uid,data,r.id,r.date);Object.assign(r,attachments.fields);
   await assertMakeupRequestLocks(db,tx,[r]);await assertTransactionMonths(db,tx,months);
   result=saveRequest(db,tx,r,event(r,uid,at,data.operationId,data.reason,null),true);
   if(c)saveLink(db,tx,linkValue(c,r,uid,at,data.reason),data.operationId);attachments.commit();
  }else{
   const {value:r}=await read(db,tx,'makeupRequests',data.requestId);scope(a,r.empId);await read(db,tx,'employees',r.empId);if(revision(r)!==data.expectedRevision)fail(409,'申請已更新，請重新載入');
   const nonApplying=action==='act-makeup-request'&&['cancel','return','reject'].includes(data.mode);
   const months=[...requestMonths(r,nonApplying),...(nonApplying?[]:await checkCard(db,tx,r))];
   const links=await bounded(tx,db.collection('caseRequestLinks').where('requestId','==',r.id));const related:any[]=[];
   for(const l of links){const c=(await read(db,tx,'attendanceCases',l.caseId)).value;if(c.empId!==r.empId)fail(409,'既有關聯員工不符');months.push(...caseMonths(c));related.push({l,c});}
   if(action==='link-case-request'){
    if(!['link','unlink'].includes(data.mode))fail(400,'關聯操作無效');const {value:c}=await read(db,tx,'attendanceCases',data.caseId);scope(a,c.empId);match(c,r);months.push(...caseMonths(c));
    if(c.revision!==data.expectedCaseRevision)fail(409,'案件已更新');const old=links.find(l=>l.caseId===c.id);
    if((old?.revision??0)!==data.expectedLinkRevision)fail(409,'關聯已更新');
    if(data.mode==='unlink'&&(!old||r.status==='核准'))fail(409,'已核准來源鏈或不存在的關聯不能解除');
    const l={...linkValue(c,r,uid,at,data.reason),revision:(old?.revision??0)+1,state:data.mode==='link'?'active':'inactive'};
    await assertLinkCapacity(db,tx,[{caseId:c.id,requestId:r.id}]);
    await assertMakeupRequestLocks(db,tx,[r]);await assertTransactionMonths(db,tx,months);saveLink(db,tx,l,data.operationId);result=l;
   }else if(action==='act-makeup-request'){
    const modes=['cancel','return','resubmit','approve','reject'];if(!modes.includes(data.mode))fail(400,'補卡處理方式無效');
    if(['cancel','resubmit'].includes(data.mode))owned(a,r.empId);else {scope(a,r.empId,true);if(a.id===r.empId)fail(403,'不能自行審核本人申請');}
    if(data.mode==='resubmit'){
     if(!['待補件','駁回','已取消'].includes(r.status))fail(409,'僅退回、駁回或取消版本可重送');
     const emp=(await read(db,tx,'employees',r.empId)).value;const next={...payload({...data.patch,reason:data.reason},emp,at),id:'makeup_'+evidenceHash([uid,data.operationId]),supersedesRequestId:r.id};
     months.push(...requestMonths(next),...await checkCard(db,tx,next));for(const {l,c} of related)if(l.state==='active')match(c,next);
     await assertLinkCapacity(db,tx,related.filter(({l})=>l.state==='active').map(({c})=>({caseId:c.id,requestId:next.id})));
     const attachments=await prepareAttachmentSubmission(db,tx,uid,data.patch||{},next.id,next.date);Object.assign(next,attachments.fields);
     await assertMakeupRequestLocks(db,tx,[r,next]);await assertTransactionMonths(db,tx,months);
     const prior={...r,status:'已取代',revision:revision(r)+1,supersededByRequestId:next.id};saveRequest(db,tx,prior,event(prior,uid,at,data.operationId,data.reason,r.status));
     result=saveRequest(db,tx,next,event(next,uid,at,data.operationId,data.reason,null),true);
     for(const {l,c} of related)if(l.state==='active')saveLink(db,tx,linkValue(c,next,uid,at,data.reason),data.operationId);attachments.commit();
    }else{
     if(data.mode==='cancel'?!['待審核','待補件'].includes(r.status):r.status!=='待審核')fail(409,'此狀態不可執行；核准後須另建更正，不能取消');
     const status={cancel:'已取消',return:'待補件',approve:'核准',reject:'駁回'}[data.mode];let applied:any=null,cardWrite:any=null;
     if(data.mode==='approve'){
      await assertRequestAttachmentEvidence(db,tx,r);
      payload(r,{id:r.empId,name:r.name},r.requestDate||at);
      const cards=await tx.get(db.collection('clockRecords').where('empId','==',r.empId).where('date','==',r.date));
      const selected=r.recordId?cards.docs.find((d:any)=>d.id===r.recordId):(cards.docs.length===1?cards.docs[0]:undefined);
      if(r.recordId&&!selected||!r.recordId&&cards.docs.length>1)fail(409,'同日多段打卡，請指定紀錄');
      const ref=selected?.ref||db.collection('clockRecords').doc('makeup_'+r.id),before=selected?{...selected.data(),id:selected.id}:null;
      if(before?.clockOutAt)months.push(...monthsInRange(before.date,taipeiDate(new Date(before.clockOutAt))));
      const empty:any={id:ref.id,empId:r.empId,name:r.name,date:r.date,clockInTime:null,clockOutTime:null,workHours:null,status:'異常',source:'makeup',verificationMethod:'IP',verificationData:'makeup'};
      if(before?.clockOutAt&&taipeiDate(new Date(before.clockOutAt))>r.date&&r.requestedClockOut&&!r.requestedClockOutAt)fail(409,'原打卡跨夜，補下班須填完整日期時間');
      const base=before||empty,patch={...makeupClockPatch(r,base),note:'補打卡：'+r.reason};
      const after=editClock(base,patch,uid,at);if(after.clockInTime&&after.clockOutTime&&!clockInterval(after))fail(409,'補正後上下班順序無效，跨夜須填完整日期時間');if(after.clockOutAt)months.push(...monthsInRange(after.date,taipeiDate(new Date(after.clockOutAt))));
      const revisionRef=db.collection('attendanceRevisions').doc();after.attendanceRevisionId=revisionRef.id;
      applied={version:'makeup-application-v1',revisionId:revisionRef.id,recordId:ref.id,requestSourceKey:makeupSourceKey(r)};
      cardWrite={ref,before,after,revisionRef};
     }
     await assertMakeupRequestLocks(db,tx,[r]);await assertTransactionMonths(db,tx,months);
     if(cardWrite){const w=cardWrite;tx.set(w.ref,w.after);tx.create(w.revisionRef,{makeupNormalizationVersion:'same-day-v1',recordId:w.ref.id,before:w.before,after:w.after,parentRevisionId:w.before?.attendanceRevisionId||null,requestId:r.id,requestSourceKey:applied.requestSourceKey,editedBy:uid,editedAt:at});}
     const next={...r,status,revision:revision(r)+1,...(['approve','reject'].includes(data.mode)?{approver:uid,approvalDate:at}:{}),...(data.mode==='return'?{returnReason:data.reason}:{}),...(data.mode==='reject'?{rejectReason:data.reason}:{}),...(applied?{appliedEvidence:applied}:{}),workflowPolicyStatus:'needs-configuration'};
     result=saveRequest(db,tx,next,event(next,uid,at,data.operationId,data.reason,r.status));
    }
   }else fail(400,'未知補卡操作');
  }
  tx.create(commandRef,{hash,result,actor:uid,at});return result;
 });
}
