import {clockInterval,validDate,taipeiDate} from '../../../utils/attendance';
import {loadAttendancePolicyDeclarationEvidence} from './attendancePolicyDeclaration';
import {buildAttendanceOvertimeClassification} from './attendanceOvertimeClassification';
import {assessAttendanceExplanationInventory} from './attendanceExplanationInventory';
import {foldCompLedger} from './compLedger';
import {normalizeScheduleDoc} from './calculations';
import {CASE_TYPES,type AttendanceCase,type CaseObservation,type DetectorInput} from './attendanceCaseTypes';
import {detectAttendanceCases} from './attendanceCaseDetector';
import {caseKey,evidenceHash} from './attendanceCaseLifecycle';
import {loadMonthlyPayrollEmployees} from './payrollReviewStorage';
const error=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const validId=(v:any):v is string=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
import {attendanceCaseMonthWindow} from './attendanceWindow';
export {attendanceCaseMonthWindow} from './attendanceWindow';
const rows=async(db:any,tx:any,name:string,empId?:string)=>{
 const query=empId?db.collection(name).where('empId','==',empId):db.collection(name);
 const snap=await tx.get(query.limit(501));if(snap.size>500)error(409,'來源超出本批安全掃描上限；未產生部分案件');
 return snap.docs.map((d:any)=>({...d.data(),id:d.id}));
};
/** Bounded complete employee inventory, then a conservative relevance filter.
 * The extra prior day preserves overnight tails into the six-day week context.
 * Malformed/ambiguous rows consume capacity rather than disappearing. */
export async function loadAttendanceClockRecords(db:any,tx:any,empId:string,month:string):Promise<any[]> {
 const window=attendanceCaseMonthWindow(month),start=window.start-6*1440,end=window.end+6*1440;
 const snap=await tx.get(db.collection('clockRecords').where('empId','==',empId).limit(10001));
 if(snap.size>10000)error(409,'打卡完整來源清冊超出安全讀取容量；未產生部分案件');
 const records=snap.docs.map((d:any)=>({...d.data(),id:d.id})).filter((r:any)=>{
  if(!validDate(r.date))return true;
  const span=clockInterval(r);if(!span)return true;
  const base=Date.parse(r.date+'T00:00:00+08:00')/60000;
  for(const key of ['clockInAt','clockOutAt'])if(r[key]!==undefined&&r[key]!==null){
   const value=r[key];
   if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!validDate(value.slice(0,10))||!Number.isFinite(Date.parse(value)))return true;
   if(key==='clockInAt'&&taipeiDate(new Date(value))!==r.date)return true;
   if(Date.parse(value)/60000!==base+(key==='clockInAt'?span.start:span.end))return true;
  }
  if(r.workIntervals!==undefined&&(!Array.isArray(r.workIntervals)||r.workIntervals.some((w:any)=>!w||!Number.isSafeInteger(w.start)||!Number.isSafeInteger(w.end)||w.end<=w.start||w.start<span.start||w.end>span.end)))return true;
  return base+span.start<end&&base+span.end>start;
 });
 if(records.length>500)error(409,'相關或待釐清打卡來源超出本批安全掃描上限；未產生部分案件');
 return records;
}
// Trusted server loader only. No client observation/policy/coverage is accepted.
export const loadAttendanceCaseInput=async(db:any,tx:any,empId:string,month:string,at:string):Promise<DetectorInput>=>{
 const employeeSnap=await tx.get(db.collection('employees').doc(empId));if(!employeeSnap.exists)error(404,'員工不存在');
 const [e]=await loadMonthlyPayrollEmployees([{...employeeSnap.data(),id:empId}],month,db,tx);
 const records=await loadAttendanceClockRecords(db,tx,empId,month);
 const schedules=(await rows(db,tx,'dailySchedule')).map((d:any)=>normalizeScheduleDoc(d,d.id,''));
 // Read complete employee sources, including full cross-month evidence.
 const comps=[...await rows(db,tx,'compRequests',empId),...await rows(db,tx,'compSettlementTasks',empId)];
 try{foldCompLedger(await rows(db,tx,'compLedger',empId));}catch{comps.push({id:'ledger-unverified:'+empId,empId,status:'unverified'});}
 const overtimes=await rows(db,tx,'overtimeRequests',empId);
 const leaves=await rows(db,tx,'leaveRequests',empId),makeups=await rows(db,tx,'makeupRequests',empId),absences=await rows(db,tx,'leaveOfAbsenceRequests',empId);
 const swaps=(await rows(db,tx,'shiftSwapRequests')).filter((r:any)=>r.fromEmpId===empId||r.toEmpId===empId);
 const revisions=(await rows(db,tx,'attendanceRevisions')).filter((r:any)=>r.before?.empId===empId||r.after?.empId===empId);
 const review=e.payrollReview, p=review?.policy;
 const declaration=await loadAttendancePolicyDeclarationEvidence(db,tx,empId,month);
 const explanationInventory=assessAttendanceExplanationInventory({empId,
  explanations:await rows(db,tx,'anomalyExplanations'),links:await rows(db,tx,'caseExplanationLinks'),
  events:await rows(db,tx,'anomalyExplanationEvents'),cases:await rows(db,tx,'attendanceCases')});
 return { employee:{...(e.employmentAuthority?{employmentAuthority:e.employmentAuthority}:{}),id:empId,hireDate:e.hireDate||'',...(e.resignDate?{resignDate:e.resignDate}:{}),...(e.leaveOfAbsenceStart?{leaveOfAbsenceStart:e.leaveOfAbsenceStart}:{}),...(e.leaveOfAbsenceEnd?{leaveOfAbsenceEnd:e.leaveOfAbsenceEnd}:{})},
 explanationInventory,overtimeClassification:buildAttendanceOvertimeClassification(e,month,records,leaves),window:attendanceCaseMonthWindow(month),asOf:Date.parse(at)/60000,records,schedules,leaves,makeups,comps,overtimes,absences,swaps,revisions,
 coverage:{records:'complete',schedules:schedules.some((d:any)=>d.shifts.some((s:any)=>!s.empId))?'unknown':'complete',requests:'complete',employment:'complete',revisions:'complete',explanations:explanationInventory.status==='complete'?'complete':'unknown'},
 // Only the independently approved declaration supplies detector thresholds.
 // Legacy payroll policy still supplies no invented grace/close/break targets.
 policy:declaration.assessment.status==='verified'?declaration.assessment.policy:p?{version:p.version,reviewedBy:review.reviewedBy,reviewedAt:review.reviewedAt,workDateRule:p.workDateRule}:null };
};
// Source-scope observations have no entity anchor in B1. Namespace those
// by scan month at the persistence boundary so April cannot overwrite May.
export const scanCaseObservations=(input:DetectorInput,month:string)=>{
 const result=detectAttendanceCases(input);
 return {...result,observations:result.observations.map(o=>o.anchor==='scope'?{...o,anchor:'scope:'+month,id:caseKey(o.empId,o.type,'scope:'+month),evidenceVersion:evidenceHash([o.evidenceVersion,month])}:o)};
};
export const retainAffectedWindow=(previous:AttendanceCase|undefined,o:CaseObservation):CaseObservation=>{
 if(!previous)return o;
 const window={start:Math.min(previous.observation.window.start,o.window.start),end:Math.max(previous.observation.window.end,o.window.end)};
 if(window.start===o.window.start&&window.end===o.window.end)return o;
 return {...o,window,evidenceVersion:evidenceHash([o.evidenceVersion,window])};
};

export interface AttendanceCaseAssessment {
 caseId:string;
 caseRevision:number|null;
 storedEvidenceVersion:string|null;
 currentEvidenceVersion:string|null;
 status:'current-clear'|'stale'|'unknown';
 scope:'relevant'|'unrelated'|'unknown';
}
export interface AttendanceCaseEvidence {
 empId:string;
 month:string;
 inventory:'loaded'|'missing';
 assessments:AttendanceCaseAssessment[];
}
const validWindow=(w:any)=>!!w&&Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start;
const terminal=(c:any)=>['resolved','cancelled'].includes(c?.status);
const validObservation=(o:any,c:any)=>!!o&&o.schemaVersion==='attendance-case-v1'&&o.detectorVersion==='detector-v1'&&
 CASE_TYPES.includes(o.type)&&typeof o.anchor==='string'&&!!o.anchor&&o.id===c.id&&o.empId===c.empId&&o.type===c.type&&o.anchor===c.anchor&&
 o.id===caseKey(o.empId,o.type,o.anchor)&&typeof o.evidenceVersion==='string'&&!!o.evidenceVersion&&validWindow(o.window)&&
 ['clear','finding','unknown'].includes(o.outcome);
const statuses=['open','awaiting-employee','awaiting-review','needs-info','resolved','cancelled'];
const nonempty=(s:any):s is string=>typeof s==='string'&&!!s.trim();
const validHistory=(c:any)=>{
 if(!Array.isArray(c.history)||!c.history.length||c.history.length>200||c.history.length!==c.revision)return false;
 let previous:any=null;
 for(let i=0;i<c.history.length;i++){
  const e=c.history[i];
  if(!e||e.revision!==i+1||!nonempty(e.operationId)||e.id!==evidenceHash([c.id,e.revision,e.operationId])||
   !nonempty(e.actor)||!nonempty(e.reason)||!nonempty(e.evidenceVersion)||typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at))||
   !statuses.includes(e.to)||e.from!==(previous?previous.to:null)||previous&&Date.parse(e.at)<Date.parse(previous.at))return false;
  previous=e;
 }
 return previous.to===c.status&&previous.revision===c.revision&&previous.evidenceVersion===c.observation.evidenceVersion;
};
const matchingEvents=(c:any,rows:unknown)=>{
 if(!Array.isArray(rows)||rows.length!==c.history.length)return false;
 const byId=new Map<string,any>();
 for(const row of rows){
  if(!row||typeof row.id!=='string'||byId.has(row.id)||row.caseId!==c.id||row.empId!==c.empId)return false;
  byId.set(row.id,row);
 }
 return c.history.every((e:any)=>byId.has(e.id)&&evidenceHash(byId.get(e.id))===evidenceHash({...e,caseId:c.id,empId:c.empId}));
};

/** Assess supplied server inventory against freshly loaded detector observations.
 * The callback is an internal adapter, never a client-provided API argument.
 * No case, event, history, or outbox is written by a salary read. A new clear
 * source hash still needs a scan to retain its closure event before it can pass.
 */
export async function assessAttendanceCaseEvidence(input:{
 empId:string;month:string;cases:unknown;
 loadObservations:(scanMonth:string)=>Promise<CaseObservation[]>;
 loadEvents:(caseId:string)=>Promise<unknown>;
}):Promise<AttendanceCaseEvidence>{
 const result:AttendanceCaseEvidence={empId:input.empId,month:input.month,inventory:'loaded',assessments:[]};
 if(!validId(input.empId)||typeof input.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)||!Array.isArray(input.cases))return {...result,inventory:'missing'};
 const window=attendanceCaseMonthWindow(input.month),groups=new Map<string,any[]>();
 for(const c of input.cases){
  // An unidentified row cannot safely be excluded from this employee's scope.
  if(!c||typeof c!=='object'||!validId(c.empId)){result.inventory='missing';continue;}
  if(c.empId!==input.empId)continue;
  const key=typeof c.id==='string'?c.id:'';
  groups.set(key,[...(groups.get(key)||[]),c]);
 }
 const cache=new Map<string,Promise<CaseObservation[]|null>>();
 for(const [id,rows] of groups){
  // Never trust the stored window to hide a terminal case. Scope is established
  // only after its retained history, immutable events and current source agree.
  const closed=rows.filter(terminal);
  if(!closed.length)continue;
  const c=closed[0],assessment:AttendanceCaseAssessment={caseId:id,caseRevision:Number.isSafeInteger(c.revision)?c.revision:null,
   storedEvidenceVersion:typeof c.observation?.evidenceVersion==='string'?c.observation.evidenceVersion:null,currentEvidenceVersion:null,status:'unknown',scope:'unknown'};
  result.assessments.push(assessment);
  if(rows.length!==1||!validId(c.id)||c.schemaVersion!=='attendance-case-v1'||!Number.isSafeInteger(c.revision)||c.revision<1||
   !validObservation(c.observation,c)||c.observation.outcome!=='clear'||typeof c.scanMonth!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(c.scanMonth)||!validHistory(c))continue;
  try{if(!matchingEvents(c,await input.loadEvents(c.id)))continue;}catch{continue;}
  if(!cache.has(c.scanMonth))cache.set(c.scanMonth,Promise.resolve().then(()=>input.loadObservations(c.scanMonth)).then(o=>Array.isArray(o)?o:null).catch(()=>null));
  const observations=await cache.get(c.scanMonth)!;
  const matches=observations?.filter(o=>o?.id===c.id);
  if(!matches||matches.length!==1||!validObservation(matches[0],c))continue;
  const fresh=retainAffectedWindow(c,matches[0]);
  assessment.currentEvidenceVersion=fresh.evidenceVersion;
  assessment.status=fresh.outcome==='unknown'?'unknown':fresh.outcome==='clear'&&fresh.evidenceVersion===c.observation.evidenceVersion?'current-clear':'stale';
  if(assessment.status==='current-clear')assessment.scope=fresh.window.start<window.end&&fresh.window.end>window.start?'relevant':'unrelated';
 }
 return result;
}

/** Shared read-only adapter for ordinary salary reads and their locking transaction. */
export async function loadAttendanceCaseEvidence(db:any,tx:any,input:{empId:string;month:string;cases:unknown;at:string}):Promise<AttendanceCaseEvidence>{
 const readTx=tx||{get:(ref:any)=>ref.get()};
 return assessAttendanceCaseEvidence({...input,
  loadEvents:async caseId=>{
   const snap=await readTx.get(db.collection('attendanceCaseEvents').where('caseId','==',caseId).limit(201));
   if(snap.size>200)error(409,'案件不可變事件超出完整核對上限');
   return snap.docs.map((d:any)=>({...d.data(),id:d.id}));
  },
  loadObservations:async scanMonth=>scanCaseObservations(await loadAttendanceCaseInput(db,readTx,input.empId,scanMonth,input.at),scanMonth).observations});
}
