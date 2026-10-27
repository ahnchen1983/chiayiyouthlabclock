import {evidenceHash} from './attendanceCaseLifecycle';
import type {SourceRef} from './attendanceCaseTypes';
const id=(v:any):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=150&&!v.includes('/');
const time=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const states=new Set(['submitted','needs-info','accepted','rejected','cancelled','superseded']);
const transitions:Record<string,string[]>={submitted:['needs-info','accepted','rejected','cancelled'], 'needs-info':['cancelled','superseded'],rejected:['superseded'],cancelled:['superseded'],accepted:['superseded'],superseded:[]};
export interface AttendanceExplanationInventory {
 empId:string;status:'complete'|'unknown';sourceDigest:string|null;pendingIds:string[];unresolvedIds:string[];staleAcceptedIds:string[];refs:SourceRef[];
}
// Inventory proof only. An accepted narrative is never a work interval, leave
// allocation, payroll exemption, or permission to close an attendance case.
export function assessAttendanceExplanationInventory(input:{empId:string;explanations:unknown;links:unknown;events:unknown;cases:unknown}):AttendanceExplanationInventory{
 const result:AttendanceExplanationInventory={empId:input.empId,status:'unknown',sourceDigest:null,pendingIds:[],unresolvedIds:[],staleAcceptedIds:[],refs:[]};
 if(!id(input.empId)||![input.explanations,input.links,input.events,input.cases].every(Array.isArray))return result;
 const explanations=input.explanations as any[],links=input.links as any[],events=input.events as any[],cases=input.cases as any[];
 if([explanations,links,events,cases].some(rows=>rows.length>500))return result;
 const malformed=(rows:any[])=>rows.some(r=>!r||!id(r.id))||new Set(rows.map(r=>r.id)).size!==rows.length;
 if([explanations,links,events,cases].some(malformed)||[...explanations,...events,...cases].some(r=>!id(r.empId)))return result;
 const caseMap=new Map(cases.map(c=>[c.id,c])),exMap=new Map(explanations.map(e=>[e.id,e]));
 const own=explanations.filter(e=>e.empId===input.empId),bad=new Set<string>();let valid=true;
 const mark=(key:string)=>{valid=false;bad.add(key);};
 for(const l of links){
  const c=caseMap.get(l.caseId),ex=exMap.get(l.sourceId);
  if(!c||!ex||l.id!==evidenceHash([l.caseId,l.sourceId])||ex.caseId!==c.id||ex.empId!==c.empId){mark(id(l.sourceId)?l.sourceId:l.id);continue;}
  if(c.empId===input.empId)result.refs.push({collection:'caseExplanationLinks',id:l.id,version:evidenceHash(l)});
 }
 for(const ev of events){
  const ex=exMap.get(ev.explanationId);
  if(!ex||ex.empId!==ev.empId||ex.caseId!==ev.caseId)mark(id(ev.explanationId)?ev.explanationId:ev.id);
 }
 for(const ex of own){
  if(ex.supersedesId!=null){
   const predecessor=exMap.get(ex.supersedesId);
   if(!id(ex.supersedesId)||!predecessor||predecessor.empId!==ex.empId||predecessor.caseId!==ex.caseId||predecessor.status!=='superseded'||predecessor.supersededBy!==ex.id)mark(ex.id);
  }
  if(ex.status==='superseded'||ex.supersededBy!=null){
   const successor=exMap.get(ex.supersededBy);
   if(ex.status!=='superseded'||!id(ex.supersededBy)||!successor||successor.empId!==ex.empId||successor.caseId!==ex.caseId||successor.supersedesId!==ex.id)mark(ex.id);
  }
  const visited=new Set<string>([ex.id]);let ancestor=ex;
  while(ancestor?.supersedesId!=null){
   if(visited.has(ancestor.supersedesId)){mark(ex.id);break;}
   visited.add(ancestor.supersedesId);ancestor=exMap.get(ancestor.supersedesId);
  }
  const c=caseMap.get(ex.caseId),history=ex.history,persisted=events.filter(e=>e.explanationId===ex.id);
  if(['submitted','needs-info'].includes(ex.status))result.pendingIds.push(ex.id);
  if(ex.schemaVersion!=='anomaly-explanation-v1'||!c||c.empId!==input.empId||!states.has(ex.status)||!Number.isInteger(ex.revision)||ex.revision<1||
   !Array.isArray(history)||history.length!==ex.revision||history.length>200||persisted.length!==history.length||links.filter(l=>l.caseId===ex.caseId&&l.sourceId===ex.id).length!==1){mark(ex.id);continue;}
  let previous:string|null=null,lastTime=-Infinity;
  for(let n=0;n<history.length;n++){
   const ev=history[n],rows=persisted.filter(e=>e.id===ev?.id),stamp=Date.parse(ev?.at||'');
   if(!ev||ev.revision!==n+1||ev.id!==evidenceHash([ex.id,n+1])||ev.from!==previous||!states.has(ev.to)||
    (previous===null?ev.to!=='submitted':!transitions[previous]?.includes(ev.to))||
    (['submitted','cancelled','superseded'].includes(ev.to)?ev.actor!==ex.empId:ev.actor===ex.empId)||
    !id(ev.actor)||!time(ev.at)||stamp<lastTime||typeof ev.reason!=='string'||!ev.reason.trim()||rows.length!==1){mark(ex.id);break;}
   const {explanationId,caseId,empId,...stored}=rows[0];
   if(explanationId!==ex.id||caseId!==ex.caseId||empId!==ex.empId||evidenceHash(stored)!==evidenceHash(ev)){mark(ex.id);break;}
   previous=ev.to;lastTime=stamp;
  }
  if(previous!==ex.status)mark(ex.id);
  const acceptedEvents=history.filter((ev:any)=>ev.to==='accepted');
  if(ex.status==='accepted'||ex.acceptedSource||acceptedEvents.length){
   const s=ex.acceptedSource;
   const accepted=acceptedEvents.length===1?acceptedEvents[0]:null;
   if(!s||!accepted||!Array.isArray(ex.sourceRefs)||ex.sourceRefs.some((ref:any)=>!ref||!id(ref.id)||!id(ref.collection)||typeof ref.version!=='string'||!ref.version)){mark(ex.id);continue;}
   const {hash,...snapshot}=s;
   if(hash!==evidenceHash(snapshot)||s.caseId!==ex.caseId||s.empId!==ex.empId||s.explanationRevision!==accepted.revision||
    s.evidenceVersion!==ex.caseEvidenceVersion||s.refsHash!==evidenceHash(ex.sourceRefs)||
    s.startDate!==ex.startDate||s.endDate!==ex.endDate||!time(ex.startDate)||!time(ex.endDate)||Date.parse(ex.endDate)<=Date.parse(ex.startDate)||
    !id(s.acceptedBy)||s.acceptedBy===ex.empId||s.acceptedBy!==accepted.actor||s.acceptedAt!==accepted.at)mark(ex.id);
   // Historical acceptance remains structurally auditable after the underlying
   // case changes. Its eligibility is stale, not evidence of unread inventory.
   // Never feed this comparison into detector coverage: coverage itself is part
   // of the case evidence hash, which would make recovery self-invalidating.
   else if(typeof c.observation?.evidenceVersion!=='string'||!c.observation.evidenceVersion)mark(ex.id);
   else if(ex.status==='accepted'&&s.evidenceVersion!==c.observation.evidenceVersion)result.staleAcceptedIds.push(ex.id);
  }
  result.refs.push({collection:'anomalyExplanations',id:ex.id,version:evidenceHash(ex)});
  for(const ev of persisted)result.refs.push({collection:'anomalyExplanationEvents',id:ev.id,version:evidenceHash(ev)});
 }
 result.refs.sort((a,b)=>a.collection.localeCompare(b.collection)||a.id.localeCompare(b.id));
 result.pendingIds.sort();result.staleAcceptedIds.sort();result.unresolvedIds=[...bad].sort();result.status=valid?'complete':'unknown';
 result.sourceDigest=evidenceHash(['attendance-explanation-inventory-v1',input.empId,result.refs,result.pendingIds,result.unresolvedIds,result.staleAcceptedIds,result.status]);
 return result;
}
