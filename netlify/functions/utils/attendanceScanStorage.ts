import {attendanceCaseMonthWindow} from './attendanceWindow';
import {attendanceObservationDigest,type AttendanceScanCertificate} from './attendanceMonthEvidence';
import {evidenceHash} from './attendanceCaseLifecycle';
import type {CaseObservation} from './attendanceCaseTypes';

type Head=AttendanceScanCertificate['caseHeads'][number];
const fail=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:409});};
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const id=(v:unknown):v is string=>nonempty(v)&&v.length<=150&&!v.includes('/');
const statuses=new Set(['open','awaiting-employee','awaiting-review','needs-info','resolved','cancelled']);
const validHead=(h:any):h is Head=>h&&id(h.id)&&Number.isInteger(h.revision)&&h.revision>0&&nonempty(h.evidenceVersion)&&statuses.has(h.status);
const sortHeads=(heads:Head[])=>[...heads].sort((a,b)=>a.id.localeCompare(b.id));
const sameHead=(a:Head,b:Head)=>a.id===b.id&&a.revision===b.revision&&a.evidenceVersion===b.evidenceVersion&&a.status===b.status;
export const attendanceScanCertificateId=(c:AttendanceScanCertificate)=>evidenceHash([
 c.schemaVersion,c.detectorVersion,c.empId,c.month,c.observationDigest,
 sortHeads(c.caseHeads).map(h=>[h.id,h.revision,h.evidenceVersion,h.status]),
 ...(c.explanationDigest===undefined?[]:[c.explanationDigest]),
]);
const validCertificate=(c:any,empId:string,month:string):c is AttendanceScanCertificate=>!!c&&
 c.schemaVersion==='attendance-scan-v1'&&c.detectorVersion==='detector-v1'&&c.empId===empId&&c.month===month&&
 (c.explanationDigest===undefined||c.explanationDigest===null||/^[a-f0-9]{64}$/.test(c.explanationDigest))&&nonempty(c.observationDigest)&&id(c.actor)&&typeof c.at==='string'&&Number.isFinite(Date.parse(c.at))&&
 Array.isArray(c.caseHeads)&&c.caseHeads.length<=500&&c.caseHeads.every(validHead)&&new Set(c.caseHeads.map((h:Head)=>h.id)).size===c.caseHeads.length&&
 Buffer.byteLength(JSON.stringify(c))<=500000;

function headsFor(cases:unknown,empId:string):Head[]{
 if(!Array.isArray(cases)||cases.length>500)fail('案件清冊缺漏或超過安全容量');
 const heads:Head[]=[],seen=new Set<string>();
 for(const c of cases as any[]){
  if(!c||!id(c.empId))fail('案件歸屬缺漏');if(c.empId!==empId)continue;
  const h={id:c.id,revision:c.revision,status:c.status,evidenceVersion:c.observation?.evidenceVersion};
  if(!validHead(h)||seen.has(h.id))fail('案件版本清冊無效或重複');seen.add(h.id);heads.push(h);
 }
 return sortHeads(heads);
}

export interface AttendanceScanPlan {
 certificateId:string;certificate:AttendanceScanCertificate;retainedCaseIds:string[];reused:boolean;
 // Caller must assert these AND all case-affected months before any writes.
 requiredMonths:string[];commit:()=>void;
}
export interface LoadedAttendanceScanCertificate {
 status:'loaded'|'missing'|'unknown';certificateId:string|null;certificate:AttendanceScanCertificate|null;
}
// Caller supplies a transaction or {get: ref => ref.get()}. Never repairs or
// upgrades summaries during payroll reads. Missing and malformed are distinct.
export async function loadAttendanceScanCertificate(db:any,reader:any,args:{empId:string;month:string}):Promise<LoadedAttendanceScanCertificate>{
 const missing:LoadedAttendanceScanCertificate={status:'missing',certificateId:null,certificate:null};
 const unknown:LoadedAttendanceScanCertificate={status:'unknown',certificateId:null,certificate:null};
 try{
  attendanceCaseMonthWindow(args.month);if(!id(args.empId))return unknown;
  const snap=await reader.get(db.collection('attendanceCaseScans').doc(evidenceHash([args.empId,args.month])));
  if(!snap.exists)return missing;const head=snap.data();
  if(!head||head.empId!==args.empId)return unknown;
  if(head.schemaVersion===undefined&&!('certificateId' in head)&&head.yearMonth===args.month&&nonempty(head.sourceVersion)&&head.complete===false&&id(head.actor)&&Number.isFinite(Date.parse(head.at||'')))return missing;
  if(head.schemaVersion!=='attendance-scan-head-v1'||head.month!==args.month||!id(head.certificateId))return unknown;
  const certificateSnap=await reader.get(db.collection('attendanceScanCertificates').doc(head.certificateId));
  const certificate=certificateSnap.exists?certificateSnap.data():null;
  if(!validCertificate(certificate,args.empId,args.month)||attendanceScanCertificateId(certificate)!==head.certificateId)return unknown;
  return {status:'loaded',certificateId:head.certificateId,certificate};
 }catch{return unknown;}
}
// Server-only transaction planner. No source defaults, user proof, lock bypass,
// or writes during preparation. Full immutable case/event assessment is separate.
export async function prepareAttendanceScanCertificate(db:any,tx:any,args:{
 empId:string;month:string;observations:CaseObservation[];cases:unknown;projectedCases?:unknown;
 actor:string;at:string;allowLegacyUpgrade?:boolean;explanationDigest?:string|null;
}):Promise<AttendanceScanPlan>{
 attendanceCaseMonthWindow(args.month);
 if(!id(args.empId)||!id(args.actor)||typeof args.at!=='string'||!Number.isFinite(Date.parse(args.at)))fail('掃描範圍、操作者或時間無效');
 if(!Array.isArray(args.observations)||args.observations.some(o=>!o||o.schemaVersion!=='attendance-case-v1'||o.detectorVersion!=='detector-v1'||o.empId!==args.empId||!id(o.id)||!nonempty(o.evidenceVersion)||!['clear','unknown','finding'].includes(o.outcome))||new Set(args.observations.map(o=>o.id)).size!==args.observations.length)fail('掃描觀察範圍或版本無效');
 const current=headsFor(args.cases,args.empId),currentMap=new Map(current.map(h=>[h.id,h]));
 const pointerRef=db.collection('attendanceCaseScans').doc(evidenceHash([args.empId,args.month]));
 const pointerSnap=await tx.get(pointerRef),pointer=pointerSnap.exists?pointerSnap.data():null;
 let previous:AttendanceScanCertificate|undefined,previousId:string|undefined;
 if(pointerSnap.exists){
  if(!pointer||pointer.empId!==args.empId)fail('掃描指標範圍無效');
  if(pointer.schemaVersion==='attendance-scan-head-v1'){
   if(pointer.month!==args.month||!id(pointer.certificateId))fail('掃描指標無效');
   previousId=pointer.certificateId;
   const snap=await tx.get(db.collection('attendanceScanCertificates').doc(previousId));
   const cert=snap.exists?snap.data():null;
   if(!validCertificate(cert,args.empId,args.month)||attendanceScanCertificateId(cert)!==previousId)fail('不可變掃描證據缺漏或不符');
   previous=cert;
  }else{
   // Only a recognizable old summary can upgrade. A malformed modern head
   // must never be downgraded to legacy by passing the upgrade option.
   if(pointer.schemaVersion!==undefined||'certificateId' in pointer||pointer.yearMonth!==args.month||!nonempty(pointer.sourceVersion)||pointer.complete!==false||!id(pointer.actor)||!Number.isFinite(Date.parse(pointer.at||''))||!args.allowLegacyUpgrade)fail('舊掃描摘要須明示重新掃描；無效指標不得覆寫');
  }
 }
 // Do this against original inventory before considering projected cases: a
 // new revision-1 projection cannot conceal deletion of retained history.
 for(const prior of previous?.caseHeads||[]){
  const now=currentMap.get(prior.id);if(!now)fail('保留案件已遺失，禁止重建或移除歷史');
  if(now.revision<prior.revision||(now.revision===prior.revision&&!sameHead(now,prior)))fail('案件版本倒退或同版內容不符');
 }
 const projected=args.projectedCases===undefined?current:headsFor(args.projectedCases,args.empId),projectedMap=new Map(projected.map(h=>[h.id,h]));
 for(const before of current){
  const after=projectedMap.get(before.id);
  if(!after||after.revision<before.revision||(after.revision===before.revision&&!sameHead(after,before)))fail('規劃不得移除或倒退案件歷史');
 }
 const retainedIds=new Set([...(previous?.caseHeads||[]).map(h=>h.id),...current.map(h=>h.id),...projected.map(h=>h.id)]);
 if(retainedIds.size>500)fail('保留案件超過安全容量');
 const proposed:AttendanceScanCertificate={schemaVersion:'attendance-scan-v1',detectorVersion:'detector-v1',empId:args.empId,month:args.month,
  ...(args.explanationDigest===undefined?{}:{explanationDigest:args.explanationDigest}),observationDigest:attendanceObservationDigest(args.empId,args.month,args.observations),caseHeads:projected,actor:args.actor,at:args.at};
 if(!validCertificate(proposed,args.empId,args.month))fail('掃描證據超過安全容量或無效');
 const certificateId=attendanceScanCertificateId(proposed),ref=db.collection('attendanceScanCertificates').doc(certificateId);
 let certificate=proposed,reused=false;
 if(certificateId===previousId){certificate=previous!;reused=true;}
 else{
  const snap=await tx.get(ref);
  if(snap.exists){const found=snap.data();if(!validCertificate(found,args.empId,args.month)||attendanceScanCertificateId(found)!==certificateId)fail('既有不可變掃描證據衝突');certificate=found;reused=true;}
 }
 const stored=structuredClone(certificate);let committed=false;
 return {certificateId,certificate:structuredClone(certificate),retainedCaseIds:[...retainedIds].sort(),requiredMonths:[args.month],reused,
  commit:()=>{
   if(committed)return;committed=true;
   if(!reused)tx.create(ref,stored);
   if(previousId!==certificateId)tx.set(pointerRef,{schemaVersion:'attendance-scan-head-v1',empId:args.empId,month:args.month,certificateId});
  }};
}
