import {clockInterval,shiftIntervals} from '../../../utils/attendance';
import {employmentWindowStates} from '../../../utils/employmentAuthority';
import {attendanceCaseMonthWindow,scanCaseObservations} from './attendanceCaseEvidence';
import {scheduleDayVersion} from './attendanceCaseDetector';
import {evidenceHash} from './attendanceCaseLifecycle';
import type {CaseObservation,CaseStatus,DetectorInput} from './attendanceCaseTypes';

export interface AttendanceScanCertificate {
 schemaVersion:'attendance-scan-v1'; empId:string; month:string; detectorVersion:'detector-v1';
 explanationDigest?:string|null; observationDigest:string;
 caseHeads:{id:string;revision:number;evidenceVersion:string;status:CaseStatus}[];
 actor:string; at:string;
}
export interface AttendanceMonthEvidence {
 empId:string;month:string;inventory:'complete'|'unknown';scan:'missing'|'stale'|'current'|'unknown';
 staleAcceptedIds?:string[];observationDigest:string|null;missingCaseIds:string[];missingDetectorInputs:string[];
 findings:CaseObservation[];unknowns:CaseObservation[];
}
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const id=(v:unknown):v is string=>text(v)&&v.length<=150&&!v.includes('/');
const minutes=(v:unknown):v is number=>Number.isInteger(v)&&(v as number)>=0;
const statuses=new Set(['open','awaiting-employee','awaiting-review','needs-info','resolved','cancelled']);
const coverageNames=['records','schedules','requests','employment','revisions','explanations'] as const;
const overlap=(a:{start:number;end:number},b:{start:number;end:number})=>a.start<b.end&&b.start<a.end;
const headValid=(h:any)=>h&&id(h.id)&&Number.isInteger(h.revision)&&h.revision>0&&text(h.evidenceVersion)&&statuses.has(h.status);
const sortedHeads=(heads:AttendanceScanCertificate['caseHeads'])=>[...heads].sort((a,b)=>a.id.localeCompare(b.id)).map(h=>[h.id,h.revision,h.evidenceVersion,h.status]);

// Stable detector evidence, not the loader's sourceVersion (which includes asOf).
export const attendanceObservationDigest=(empId:string,month:string,observations:CaseObservation[])=>evidenceHash([
 'attendance-scan-v1','detector-v1',empId,month,
 observations.map(o=>[o.id,o.evidenceVersion,o.outcome]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
]);

// Pure, read-only assessment. Certificate provenance must be established by a
// trusted server adapter; this does not replace immutable case/event verification.
export function assessAttendanceMonth(args:{empId:string;month:string;input:DetectorInput|undefined;cases:unknown;certificate:AttendanceScanCertificate|null|undefined;explanationDigest?:string|null}):AttendanceMonthEvidence {
 const result:AttendanceMonthEvidence={empId:args.empId,month:args.month,inventory:'complete',scan:args.certificate==null?'missing':'unknown',staleAcceptedIds:[],observationDigest:null,missingCaseIds:[],missingDetectorInputs:[],findings:[],unknowns:[]};
 const missing=new Set<string>(),missingCases=new Set<string>();
 let sourceValid=true,caseValid=true;
 let observations:CaseObservation[]=[],heads:AttendanceScanCertificate['caseHeads']=[];
 try {
  const window=attendanceCaseMonthWindow(args.month),input=args.input;
  if(!id(args.empId)||!input||input.employee?.id!==args.empId||input.window?.start!==window.start||input.window?.end!==window.end)throw new Error('Explicit month source required');
  for(const key of coverageNames)if(input.coverage?.[key]!=='complete')missing.add('coverage.'+key);
  if(employmentWindowStates(input.employee,window.start,window.end).includes('unknown'))missing.add('coverage.employment');
  for(const key of ['records','schedules','leaves','makeups','absences','swaps','revisions','comps','overtimes'] as const)if(!Array.isArray(input[key]))throw new Error('Missing source inventory');
  // Check attribution before the detector filters rows by employee. A malformed
  // identity is not evidence that a row belongs to somebody else.
  for(const key of ['records','leaves','makeups','absences','comps','overtimes'] as const){
   if(input[key]!.some(row=>!row||!id(row.empId)||!id(row.id)))throw new Error('Ambiguous source identity');
  }
  if(input.swaps.some(row=>!row||!id(row.id)||!id(row.fromEmpId)||!id(row.toEmpId)))throw new Error('Ambiguous swap participants');
  observations=scanCaseObservations(input,args.month).observations;
  if(new Set(observations.map(o=>o.id)).size!==observations.length||observations.some(o=>o.empId!==args.empId))throw new Error('Ambiguous observations');
  const policy=input.policy;
  const approved=!!(policy&&text(policy.version)&&text(policy.reviewedBy)&&Number.isFinite(Date.parse(policy.reviewedAt||'')));
  const requiredPolicy=(key:'closeAfterMinutes'|'lateGraceMinutes'|'earlyGraceMinutes'|'workDifferenceTolerance'|'workDateRule'|'breaks')=>{
   if(!approved)missing.add('policy.approval');
   if(!approved||(key==='workDateRule'?policy?.[key]!=='clock-in-date':key==='breaks'?policy?.[key]!=='explicit':!minutes(policy?.[key])))missing.add('policy.'+key);
  };
  for(const day of input.schedules){
   const shifts=day.shifts.filter(s=>s.empId===args.empId);if(!shifts.length)continue;
   const base=Date.parse(day.date+'T00:00:00+08:00')/60000;
   const ranges=(shiftIntervals(shifts)||[]).map(s=>({start:base+s.start,end:base+s.end}));
   if(ranges.length&&!ranges.some(r=>overlap(r,window)))continue;
   if(ranges.length&&ranges.every(r=>employmentWindowStates(input.employee,r.start,r.end).every(s=>s==='not-employed')))continue;
   for(const key of ['closeAfterMinutes','lateGraceMinutes','earlyGraceMinutes','workDateRule','breaks','workDifferenceTolerance'] as const)requiredPolicy(key);
   const target=policy?.expectedWorkByDate?.[day.date];
   if(!approved||!target||!minutes(target.minutes)||!text(target.reviewedBy)||target.scheduleVersion!==scheduleDayVersion(day,args.empId))missing.add('policy.expectedWorkByDate:'+day.date);
  }
  for(const card of input.records.filter(c=>c.empId===args.empId)){
   const span=clockInterval(card),base=Date.parse(card.date+'T00:00:00+08:00')/60000;
   if(!overlap({start:base+(span?.start??0),end:base+(span?.end??2880)},window))continue;
   if(!card.clockOutAt&&!card.clockOutTime)requiredPolicy('closeAfterMinutes');
   if(span&&span.end>1440)requiredPolicy('workDateRule');
  }
  result.staleAcceptedIds=[...(input.explanationInventory?.staleAcceptedIds||[])];
  result.observationDigest=attendanceObservationDigest(args.empId,args.month,observations);
  result.findings=observations.filter(o=>o.outcome==='finding');result.unknowns=observations.filter(o=>o.outcome==='unknown');
 }catch{sourceValid=false;missing.add('source.inventory');}
 if(!Array.isArray(args.cases)){caseValid=false;missing.add('cases.inventory');}
 else {
  const seen=new Set<string>();
  for(const c of args.cases){
   if(!c||!id(c.empId)){caseValid=false;continue;}if(c.empId!==args.empId)continue;
   const head={id:c.id,revision:c.revision,evidenceVersion:c.observation?.evidenceVersion,status:c.status};
   if(!headValid(head)||seen.has(head.id)){caseValid=false;continue;}
   seen.add(head.id);heads.push(head);
  }
  if(!caseValid)missing.add('cases.inventory');
  for(const o of observations)if(o.outcome!=='clear'&&!seen.has(o.id))missingCases.add(o.id);
 }
 const cert=args.certificate;
 if(cert!=null){
  const valid=cert.schemaVersion==='attendance-scan-v1'&&cert.detectorVersion==='detector-v1'&&cert.empId===args.empId&&cert.month===args.month&&text(cert.observationDigest)&&text(cert.actor)&&Number.isFinite(Date.parse(cert.at))&&Array.isArray(cert.caseHeads)&&cert.caseHeads.every(headValid)&&new Set(cert.caseHeads.map(h=>h.id)).size===cert.caseHeads.length;
  if(valid){
   const currentIds=new Set(heads.map(h=>h.id));
   for(const h of cert.caseHeads)if(!currentIds.has(h.id))missingCases.add(h.id);
   if(sourceValid&&caseValid)result.scan=cert.observationDigest!==result.observationDigest||(args.explanationDigest!==undefined&&cert.explanationDigest!==args.explanationDigest)||missingCases.size>0||JSON.stringify(sortedHeads(cert.caseHeads))!==JSON.stringify(sortedHeads(heads))?'stale':'current';
  }
 }
 // A matching scan can record unresolved findings; it is not payroll readiness.
 // Missing detector policy is separate from inventory coverage and never defaulted.
 result.inventory=!sourceValid||!caseValid||[...missing].some(k=>k.startsWith('coverage.'))?'unknown':'complete';
 result.missingDetectorInputs=[...missing].sort();result.missingCaseIds=[...missingCases].sort();
 return result;
}
