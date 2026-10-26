import {attendanceCaseMonthWindow as monthWindow,loadAttendanceCaseInput as loadInput,scanCaseObservations as scanObservations,retainAffectedWindow} from './attendanceCaseEvidence';
import {prepareAttendanceScanCertificate} from './attendanceScanStorage';
import { UserRole } from '../../../types';
import { CASE_TYPES } from './attendanceCaseTypes';
import type { AttendanceCase, CaseObservation } from './attendanceCaseTypes';
import { evidenceHash, outboxIntent, reconcileCase } from './attendanceCaseLifecycle';
import { assertTransactionMonths, monthsInRange, runPayrollMutation } from './monthGuard';
import { taipeiDate } from '../../../utils/attendance';
export const CASE_ACTIONS = ['list-attendance-cases','get-attendance-case','scan-attendance-cases','act-attendance-case'] as const;
const error = (code:number,message:string):never => { const e:any=new Error(message);e.statusCode=code;throw e; };
const validId=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const intersect=(a:any,b:any)=>a.start<b.end&&b.start<a.end;
const affectedMonths=(o:CaseObservation)=>monthsInRange(taipeiDate(new Date(o.window.start*60000)),taipeiDate(new Date((o.window.end-1)*60000)));
const actorFor=async(db:any,uid:string,tx?:any)=>{
 const ref=db.collection('employees').doc(uid),snap=tx?await tx.get(ref):await ref.get();
 const role=snap.data()?.role;
 if(!snap.exists||![UserRole.Employee,UserRole.Admin,UserRole.SuperAdmin].includes(role))error(403,'無案件存取權限');
 return {uid,manager:role===UserRole.Admin||role===UserRole.SuperAdmin};
};
const assertScope=(actor:any,empId:string,manage=false)=>{
 if(!validId(empId))error(400,'員工識別無效');
 if((manage&&!actor.manager)||(!actor.manager&&actor.uid!==empId))error(403,'無權處理其他員工或管理案件');
};
const rows=async(db:any,tx:any,name:string,empId?:string)=>{
 const query=empId?db.collection(name).where('empId','==',empId):db.collection(name);
 const snap=await tx.get(query.limit(501));if(snap.size>500)error(409,'來源超出本批安全掃描上限；未產生部分案件');
 return snap.docs.map((d:any)=>({...d.data(),id:d.id}));
};
type StoredCase=AttendanceCase & {scanMonth:string;sourceVersion:string};
const publicCase=(c:StoredCase)=>({id:c.id,empId:c.empId,type:c.type,anchor:c.anchor,status:c.status,owner:c.owner,revision:c.revision,
 expectedEvidenceVersion:c.observation.evidenceVersion,window:c.observation.window,outcome:c.observation.outcome,reason:c.observation.reason,
 history:c.history.map(e=>({id:e.id,revision:e.revision,actor:e.actor,at:e.at,from:e.from,to:e.to,reason:e.reason}))});
export const persistCaseWorkflow=(db:any,tx:any,previous:StoredCase|undefined,next:StoredCase)=>{
 if(Buffer.byteLength(JSON.stringify(next))>500000||next.history.length>200)error(409,'案件歷程達安全上限，須保留原資料另行歸檔');
 tx.set(db.collection('attendanceCases').doc(next.id),next);
 for(const e of next.history.slice(previous?.history.length||0)){
  tx.create(db.collection('attendanceCaseEvents').doc(e.id),{...e,caseId:next.id,empId:next.empId});
  const snapshot={...next,history:next.history.filter(h=>h.revision<=e.revision)};
  const intent=outboxIntent(snapshot,next.owner||next.empId,'case-event-v1|sandbox-retry-v1');
  tx.create(db.collection('attendanceCaseOutbox').doc(intent.id),{...intent,policyVersion:'sandbox-retry-v1',maxAttempts:3});
 }
};
export const appendCaseWorkflowEvent=(c:StoredCase,data:any,actor:string,at:string,status=c.status,owner=c.owner):StoredCase=>{
 const revision=c.revision+1;
 const ev={id:evidenceHash([c.id,revision,data.operationId]),operationId:data.operationId,revision,actor,at,from:c.status,to:status,reason:data.reason,evidenceVersion:c.observation.evidenceVersion,commandOwner:owner};
 return {...c,revision,status,owner,history:[...c.history,ev]};
};
export const handleAttendanceCaseAction=async(db:any,uid:string,action:string,data:any,clock:()=>Date=()=>new Date())=>{
 if(!CASE_ACTIONS.includes(action as any))error(400,'案件操作無效');
 // Server-owned evidence fields are never accepted, even for administrators.
 if(['proof','observation','coverage','policy','actor','at','sourceVersion','clearedObservation','certificate','certificateId','caseHeads'].some(k=>k in data))error(400,'不得提交伺服器證據或時間');
 if(action==='list-attendance-cases'){
  const actor=await actorFor(db,uid);assertScope(actor,data.empId);const window=monthWindow(data.yearMonth);
  const snap=await db.collection('attendanceCases').where('empId','==',data.empId).limit(501).get();if(snap.size>500)error(409,'案件查詢需縮小範圍');
  if(data.status&&!['open','awaiting-employee','awaiting-review','needs-info','resolved','cancelled'].includes(data.status))error(400,'案件狀態無效');
  if(data.type&&!CASE_TYPES.includes(data.type))error(400,'案件類別無效');
  const selected=snap.docs.map((d:any)=>({...d.data(),id:d.id})).filter((c:StoredCase)=>intersect(c.observation.window,window)&&(!data.status||c.status===data.status)&&(!data.type||c.type===data.type)).sort((a:any,b:any)=>a.id.localeCompare(b.id));
  const page=selected.filter((c:any)=>!data.afterId||c.id>data.afterId).slice(0,50);
  return {cases:page.map(publicCase),nextCursor:page.length===50?page.at(-1).id:null,scope:'existing-attendance-role'};
 }
 if(action==='get-attendance-case'){
  if(!validId(data.caseId))error(400,'案件識別無效');const actor=await actorFor(db,uid),snap=await db.collection('attendanceCases').doc(data.caseId).get();
  if(!snap.exists)error(404,'案件不存在');assertScope(actor,snap.data().empId);const jobs=await db.collection('attendanceCaseOutbox').where('caseId','==',snap.id).limit(501).get();
  const states=['held','queued','leased','retry','delivered','unknown-delivery','dead-letter'];
  const counts:Record<string,number>={};
  for(const job of jobs.docs){const d=job.data();const state=d.channel==='sandbox'&&states.includes(d.state)?d.state:'unknown';counts[state]=(counts[state]||0)+1;}
  return {...publicCase({...snap.data(),id:snap.id}),notifications:{mode:'sandbox-only',counts,complete:jobs.size<=500,deliveryEnabled:false}};
 }
 const at=clock().toISOString();
 if(action==='scan-attendance-cases'){
  monthWindow(data.yearMonth);if(!validId(data.empId))error(400,'員工識別無效');
  return runPayrollMutation(db,[data.yearMonth],async tx=>{
   const actor=await actorFor(db,uid,tx);assertScope(actor,data.empId,true);
   const input=await loadInput(db,tx,data.empId,data.yearMonth,at),sourceVersion=evidenceHash(input);
   const result=scanObservations(input,data.yearMonth),existing=await rows(db,tx,'attendanceCases',data.empId);
   const updates: {previous:StoredCase|undefined,next:StoredCase}[]=[];
   for(const o of result.observations){const previous=existing.find((c:any)=>c.id===o.id);const next=reconcileCase(previous,retainAffectedWindow(previous,o),uid,at);if(next&&next!==previous)updates.push({previous,next:{...next,scanMonth:data.yearMonth,sourceVersion}});}
   if(updates.reduce((n,u)=>n+u.next.history.length-(u.previous?.history.length||0),0)>100)error(409,'單次案件變更過多，須拆分來源；未部分寫入');
   const projected=new Map(existing.map((c:any)=>[c.id,c]));for(const u of updates)projected.set(u.next.id,u.next);
   // Validate retained IDs against the ORIGINAL inventory, before any projected
   // recreation can hide deleted history. Planning only reads; commit is deferred.
   const certificate=await prepareAttendanceScanCertificate(db,tx,{empId:data.empId,month:data.yearMonth,
    explanationDigest:input.explanationInventory?.sourceDigest,observations:result.observations,cases:existing,projectedCases:[...projected.values()],actor:uid,at,allowLegacyUpgrade:true});
   const months=[...new Set(updates.flatMap(u=>[...affectedMonths(u.next.observation),...(u.previous?affectedMonths(u.previous.observation):[])]))];
   await assertTransactionMonths(db,tx,[...new Set([...certificate.requiredMonths,...months])]);
   for(const u of updates)persistCaseWorkflow(db,tx,u.previous,u.next);
   certificate.commit();
   return {changed:updates.length,complete:false,settlementEligibility:'BLOCKED'};
  });
 }
 if(!validId(data.caseId)||!validId(data.operationId)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>2000)error(400,'案件、操作識別及原因必填');
 const modes=['assign','explain','resolve','reopen','request-info'];if(!modes.includes(data.mode))error(400,'案件處理方式無效');
 const outerActor=await actorFor(db,uid);
 const initial=await db.collection('attendanceCases').doc(data.caseId).get();if(!initial.exists)error(404,'案件不存在');
 assertScope(outerActor,initial.data().empId,data.mode!=='explain');
 return runPayrollMutation(db,affectedMonths(initial.data().observation),async tx=>{
  const actor=await actorFor(db,uid,tx),snap=await tx.get(initial.ref);if(!snap.exists)error(404,'案件不存在');const previous:StoredCase={...snap.data(),id:snap.id};assertScope(actor,previous.empId,data.mode!=='explain');
  const commandRef=db.collection('attendanceCaseCommands').doc(evidenceHash([uid,data.operationId]));const command=await tx.get(commandRef);
  const commandHash=evidenceHash([uid,data.caseId,data.mode,data.reason,data.owner??null,data.expectedRevision,data.expectedEvidenceVersion]);
  if(command.exists){if(command.data().hash!==commandHash)error(409,'重送操作內容不符');return command.data().result;}
  if(previous.revision!==data.expectedRevision||previous.observation.evidenceVersion!==data.expectedEvidenceVersion)error(409,'案件已更新，請重新載入');
  await assertTransactionMonths(db,tx,affectedMonths(previous.observation));
  let next=previous;
  if(data.mode==='assign'){
   if(!validId(data.owner))error(400,'請指定有效管理者');const owner=await actorFor(db,data.owner,tx);if(!owner.manager)error(403,'負責人需具有既有出勤管理權限');
   next=appendCaseWorkflowEvent(previous,data,uid,at,previous.status,data.owner);
  }else if(data.mode==='explain'){
   if(['resolved','cancelled'].includes(previous.status))error(409,'已結案案件不能由說明重新開啟');
   next=appendCaseWorkflowEvent(previous,data,uid,at,'awaiting-review');
  }else if(data.mode==='request-info'){
   if(['resolved','cancelled'].includes(previous.status))error(409,'已結案案件須以來源重核後再重開');
   next=appendCaseWorkflowEvent(previous,data,uid,at,'needs-info');
  }
  else {
   const input=await loadInput(db,tx,previous.empId,previous.scanMonth,at);
   const observed=scanObservations(input,previous.scanMonth).observations.find(o=>o.id===previous.id);
   const fresh=observed?retainAffectedWindow(previous,observed):undefined;
   if(!fresh)error(409,'缺少來源清除證明，不能自行結案');
   await assertTransactionMonths(db,tx,affectedMonths(fresh));
   if(data.mode==='resolve'&&fresh.outcome!=='clear')error(409,'仍有異常或未知來源，不能結案');
   if(data.mode==='reopen'&&fresh.outcome==='clear')error(409,'目前來源無重開依據');
   const reconciled=reconcileCase(previous,fresh,uid,at)!;
   next=appendCaseWorkflowEvent({...reconciled,scanMonth:previous.scanMonth,sourceVersion:evidenceHash(input)},data,uid,at,data.mode==='resolve'?'resolved':fresh.outcome==='unknown'?'needs-info':'open');
  }
  persistCaseWorkflow(db,tx,previous,next);
  const response={id:next.id,revision:next.revision,status:next.status};tx.create(commandRef,{hash:commandHash,result:response,actor:uid,at});return response;
 });
};
// No deployed schedule: disabled by default; a future controlled trigger may
// call this same backend entrypoint with a verified principal, never raw proof.
export const runAttendanceScanTrigger=async(db:any,uid:string,request:any,enabled=false)=>enabled
 ?handleAttendanceCaseAction(db,uid,'scan-attendance-cases',request):{disabled:true};

// Shared server-only planning for versioned leave transitions. No client evidence accepted.
export async function assertCurrentCaseSource(db:any,tx:any,c:any,at:string){
 const month=c.scanMonth;if(!month)error(409,'案件缺少來源掃描月份，須先重核');
 const input=await loadInput(db,tx,c.empId,month,at);
 const observed=scanObservations(input,month).observations.find(o=>o.id===c.id);
 const fresh=observed?retainAffectedWindow(c,observed):null;
 if(!fresh||fresh.evidenceVersion!==c.observation.evidenceVersion)error(409,'原始來源已變更，須重新掃描後覆核');
}
export async function planLeaveCaseRefresh(db:any,tx:any,empId:string,months:string[],leave:any,actor:string,at:string,otherLeaves:any[]=[],collection:'leaves'|'overtimes'|'comps'='leaves'){
 const existing=await rows(db,tx,'attendanceCases',empId),original=new Map(existing.map((c:any)=>[c.id,c]));
 const planned=new Map<string,any>();
 for(const month of months){
  const input=await loadInput(db,tx,empId,month,at);
  const replacements=[...otherLeaves,leave];input[collection]=[...(input[collection]||[]).filter(r=>!replacements.some(n=>n.id===r.id)),...replacements];
  const sourceVersion=evidenceHash(input);
  for(const o of scanObservations(input,month).observations){
   const previous=planned.get(o.id)||original.get(o.id) as any;
   const next=reconcileCase(previous,retainAffectedWindow(previous,o),actor,at);
   if(next&&next!==previous)planned.set(o.id,{...next,scanMonth:month,sourceVersion});
  }
 }
 if(new Set([...original.keys(),...planned.keys()]).size>500||[...planned.values()].reduce((n,c)=>n+c.history.length-((original.get(c.id) as any)?.history.length||0),0)>100)error(409,'案件變更超過技術容量，未部分寫入');
 await assertTransactionMonths(db,tx,[...months,...[...planned.values()].flatMap(c=>affectedMonths(c.observation))]);
 return ()=>{for(const [id,next] of planned)persistCaseWorkflow(db,tx,original.get(id) as any,next);};
}

export const planOvertimeCaseRefresh=(db:any,tx:any,empId:string,months:string[],request:any,actor:string,at:string,previous:any[]=[])=>planLeaveCaseRefresh(db,tx,empId,months,request,actor,at,previous,'overtimes');

export const planCompCaseRefresh=(db:any,tx:any,empId:string,months:string[],request:any,actor:string,at:string,previous:any[]=[])=>planLeaveCaseRefresh(db,tx,empId,months,request,actor,at,previous,'comps');
