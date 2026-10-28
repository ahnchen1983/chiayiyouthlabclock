import {describe,it,expect} from 'vitest';
import {assessAttendanceExplanationInventory} from '../netlify/functions/utils/attendanceExplanationInventory';
import {evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';
import {detectAttendanceCases} from '../netlify/functions/utils/attendanceCaseDetector';
import {card} from './fixtures/payrollV2';
import type {DetectorInput} from '../netlify/functions/utils/attendanceCaseTypes';
const empId='SYNTH',caseId='case-synthetic';
function fixture(status='accepted'){
 const c={id:caseId,empId,observation:{evidenceVersion:'current'}};
 const events=[{id:evidenceHash(['ex',1]),revision:1,actor:empId,at:'2026-04-01T00:00:00Z',from:null,to:'submitted',reason:'private explanation'},
  {id:evidenceHash(['ex',2]),revision:2,actor:'SYNTH-manager',at:'2026-04-02T00:00:00Z',from:'submitted',to:status,reason:'private review'}];
 const ex:any={id:'ex',schemaVersion:'anomaly-explanation-v1',empId,caseId,revision:2,status,history:events,sourceRefs:[],caseEvidenceVersion:'current',startDate:'2026-04-01T01:00:00Z',endDate:'2026-04-01T09:00:00Z'};
 const snapshot={caseId,empId,evidenceVersion:'current',startDate:ex.startDate,endDate:ex.endDate,refsHash:evidenceHash([]),explanationRevision:2,acceptedBy:'SYNTH-manager',acceptedAt:events[1].at};
 if(status==='accepted')ex.acceptedSource={...snapshot,hash:evidenceHash(snapshot)};
 return {empId,cases:[c],explanations:[ex],links:[{id:evidenceHash([caseId,'ex']),caseId,sourceId:'ex'}],events:events.map(e=>({...e,explanationId:'ex',caseId,empId}))};
}
describe('trusted explanation inventory never clears attendance',()=>{
 it('requires explicit complete inventories, including loaded empty',()=>{
  expect(assessAttendanceExplanationInventory({empId,cases:[],explanations:[],links:[],events:[]}).status).toBe('complete');
  expect(assessAttendanceExplanationInventory({empId,cases:[],explanations:undefined,links:[],events:[]}).status).toBe('unknown');
 });
 it('verifies adopted source and returns hashes only, never text or clearance intervals',()=>{
  const r=assessAttendanceExplanationInventory(fixture());expect(r.status).toBe('complete');expect(r.unresolvedIds).toEqual([]);expect(JSON.stringify(r)).not.toContain('private');expect(r).not.toHaveProperty('clearanceIntervals');
 });
 it.each(['event','link','history','scope','acceptedHash','participant'] as const)('fails closed for %s',mode=>{
  const f=fixture();if(mode==='event')f.events.pop();if(mode==='link')f.links=[];if(mode==='history')f.explanations[0].history=[];
  if(mode==='scope')f.events[0].empId='OTHER';if(mode==='acceptedHash')f.explanations[0].acceptedSource.hash='bad';
  if(mode==='participant')f.explanations[0].empId=null;
  expect(assessAttendanceExplanationInventory(f).status).toBe('unknown');
 });
 it('retains stale historical acceptance without poisoning source-change rescan and a fresh narrative',()=>{
  const f=fixture();expect(assessAttendanceExplanationInventory(f).staleAcceptedIds).toEqual([]);
  f.cases[0].observation.evidenceVersion='changed-by-source-rescan';
  const stale=assessAttendanceExplanationInventory(f);expect(stale.status).toBe('complete');expect(stale.staleAcceptedIds).toEqual(['ex']);
  const first={id:evidenceHash(['fresh',1]),revision:1,actor:empId,at:'2026-04-03T00:00:00Z',from:null,to:'submitted',reason:'fresh source narrative'};
  const fresh:any={...f.explanations[0],id:'fresh',revision:1,status:'submitted',caseEvidenceVersion:'changed-by-source-rescan',acceptedSource:undefined,history:[first],supersedesId:null};
  f.explanations.push(fresh);f.links.push({id:evidenceHash([caseId,'fresh']),caseId,sourceId:'fresh'});f.events.push({...first,explanationId:'fresh',caseId,empId});
  const current=assessAttendanceExplanationInventory(f);expect(current.status).toBe('complete');expect(current.staleAcceptedIds).toEqual(['ex']);expect(current.pendingIds).toEqual(['fresh']);expect(current.unresolvedIds).toEqual([]);expect(current).not.toHaveProperty('clearanceIntervals');
 });
 it('keeps fresh detector evidence stable when a source edit makes old acceptance stale',()=>{
  const input:DetectorInput={employee:{id:empId,hireDate:'2026-01-01'},window:{start:Date.parse('2026-04-01T00:00:00+08:00')/60000,end:Date.parse('2026-05-01T00:00:00+08:00')/60000},asOf:Date.parse('2026-05-02T00:00:00Z')/60000,records:[card()],schedules:[],leaves:[],makeups:[],absences:[],swaps:[],revisions:[],comps:[],overtimes:[],coverage:{records:'complete',schedules:'complete',requests:'complete',employment:'complete',revisions:'complete',explanations:'complete'},policy:null};
  const observed=()=>detectAttendanceCases(input).observations.find(o=>o.type==='missing-in'&&o.anchor.startsWith('card:'))!;
  const f=fixture(),old=observed();f.cases[0].observation.evidenceVersion=old.evidenceVersion;f.explanations[0].caseEvidenceVersion=old.evidenceVersion;f.explanations[0].acceptedSource.evidenceVersion=old.evidenceVersion;
  const {hash,...snapshot}=f.explanations[0].acceptedSource;f.explanations[0].acceptedSource.hash=evidenceHash(snapshot);
  input.records=[card(undefined,'10:00','17:00')];const fresh=observed();expect(fresh.evidenceVersion).not.toBe(old.evidenceVersion);f.cases[0].observation.evidenceVersion=fresh.evidenceVersion;
  const inventory=assessAttendanceExplanationInventory(f);expect(inventory.status).toBe('complete');expect(inventory.staleAcceptedIds).toEqual(['ex']);
  input.coverage.explanations=inventory.status==='complete'?'complete':'unknown';expect(observed().evidenceVersion).toBe(fresh.evidenceVersion);
 });
 it('retains pending IDs even with complete inventory',()=>{const r=assessAttendanceExplanationInventory(fixture('needs-info'));expect(r.status).toBe('complete');expect(r.pendingIds).toEqual(['ex']);});
 it('does not mutate inputs and digest changes when explanation evidence changes',()=>{
  const f=fixture(),before=JSON.stringify(f),a=assessAttendanceExplanationInventory(f);expect(JSON.stringify(f)).toBe(before);
  const b=assessAttendanceExplanationInventory(fixture('rejected'));expect(a.sourceDigest).not.toBe(b.sourceDigest);
 });
 it('requires a reciprocal retained successor when an explanation is superseded',()=>{
  const f=fixture('rejected'),old=f.explanations[0];
  const ev={id:evidenceHash(['ex',3]),revision:3,actor:empId,at:'2026-04-03T00:00:00Z',from:'rejected',to:'superseded',reason:'synthetic resubmit'};
  old.status='superseded';old.revision=3;old.supersededBy='ex2';old.history.push(ev);f.events.push({...ev,explanationId:'ex',caseId,empId});
  const first={id:evidenceHash(['ex2',1]),revision:1,actor:empId,at:ev.at,from:null,to:'submitted',reason:'synthetic replacement'};
  const successor={...old,id:'ex2',status:'submitted',revision:1,supersedesId:'ex',supersededBy:null,history:[first]};
  f.explanations.push(successor);f.links.push({id:evidenceHash([caseId,'ex2']),caseId,sourceId:'ex2'});f.events.push({...first,explanationId:'ex2',caseId,empId});
  expect(assessAttendanceExplanationInventory(f).status).toBe('complete');
  successor.supersedesId='other';expect(assessAttendanceExplanationInventory(f).status).toBe('unknown');successor.supersedesId='ex';
  f.explanations=f.explanations.filter(e=>e.id!=='ex2');f.links=f.links.filter(l=>l.sourceId!=='ex2');f.events=f.events.filter(e=>e.explanationId!=='ex2');
  expect(assessAttendanceExplanationInventory(f).status).toBe('unknown');
 });
});
