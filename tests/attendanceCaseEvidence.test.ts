import {describe,it,expect,vi} from 'vitest';
import {assessAttendanceCaseEvidence} from '../netlify/functions/utils/attendanceCaseEvidence';
import {detectAttendanceCases} from '../netlify/functions/utils/attendanceCaseDetector';
import {evidenceHash,reconcileCase} from '../netlify/functions/utils/attendanceCaseLifecycle';
import type {DetectorInput,CaseObservation} from '../netlify/functions/utils/attendanceCaseTypes';
import {card,employee,schedule} from './fixtures/payrollV2';

const minute=(s:string)=>Date.parse(s)/60000;
const fixture=():DetectorInput=>({
 employee:{id:employee.id,hireDate:'2026-01-01'},
 window:{start:minute('2026-04-01T00:00:00+08:00'),end:minute('2026-05-01T00:00:00+08:00')},
 asOf:minute('2026-05-02T00:00:00+08:00'),records:[card()],schedules:[schedule()],
 leaves:[],makeups:[],absences:[],swaps:[],revisions:[],
 coverage:{records:'complete',schedules:'complete',requests:'complete',employment:'complete',revisions:'complete',explanations:'complete'},
 policy:null,
});
const observation=(input=fixture()):CaseObservation=>detectAttendanceCases(input).observations.find(o=>o.type==='missing-in'&&o.anchor==='card:'+input.records[0].id)!;
const closed=(o=observation())=>{
 const finding={...o,outcome:'finding' as const,evidenceVersion:evidenceHash(['synthetic-prior',o.evidenceVersion])};
 const prior=reconcileCase(undefined,finding,'SYNTH-manager','2026-05-01T00:00:00Z')!;
 return {...reconcileCase(prior,o,'SYNTH-manager','2026-05-02T00:00:00Z')!,scanMonth:'2026-04',sourceVersion:'whole-input-hash-is-not-closure-proof'};
};
const events=(c:any)=>c.history.map((e:any)=>({...e,caseId:c.id,empId:c.empId}));
const assess=(cases:any,loadObservations:any,month='2026-04',empId=employee.id,loadEvents?:any)=>assessAttendanceCaseEvidence({empId,month,cases,loadObservations,
 loadEvents:loadEvents|| (async (caseId:string)=>events(cases.find((c:any)=>c.id===caseId)))});

describe('server-only terminal attendance case evidence assessment',()=>{
 it('retains explicit scope and accepts the same stable clear evidence without mutating history',async()=>{
  const c=closed(),before=JSON.stringify(c),load=vi.fn(async()=>[c.observation]);
  const r=await assess([c],load);
  expect(r).toMatchObject({empId:employee.id,month:'2026-04',inventory:'loaded',assessments:[{caseId:c.id,caseRevision:2,storedEvidenceVersion:c.observation.evidenceVersion,currentEvidenceVersion:c.observation.evidenceVersion,status:'current-clear',scope:'relevant'}]});
  expect(load).toHaveBeenCalledExactlyOnceWith('2026-04');expect(JSON.stringify(c)).toBe(before);
 });
 it('changed but still clear evidence needs a new retained closure event',async()=>{
  const c=closed(),input=fixture();input.records=[card(undefined,'09:00','18:00')];const fresh=observation(input);
  expect(fresh.outcome).toBe('clear');expect(fresh.evidenceVersion).not.toBe(c.observation.evidenceVersion);
  expect((await assess([c],async()=>[fresh])).assessments[0].status).toBe('stale');
 });
 it('a newly found anomaly or unknown outcome cannot reuse a terminal status',async()=>{
  for(const outcome of ['finding','unknown'] as const){const c=closed(),fresh={...c.observation,outcome,evidenceVersion:evidenceHash(outcome)};
   expect((await assess([c],async()=>[fresh])).assessments[0].status).not.toBe('current-clear');}
 });
 it('deleted or omitted source observation remains unknown rather than clear',async()=>{
  const c=closed();expect((await assess([c],async()=>[])).assessments[0]).toMatchObject({caseId:c.id,currentEvidenceVersion:null,status:'unknown'});
 });
 it('missing and malformed scan month never invokes a source query',async()=>{
  for(const scanMonth of [undefined,'','2026-13','2026-04/other']){const c={...closed(),scanMonth},load=vi.fn(async()=>[c.observation]);
   expect((await assess([c],load)).assessments[0].status).toBe('unknown');expect(load).not.toHaveBeenCalled();}
 });
 it('retains the historical cross-month window and uses its original scan month',async()=>{
  const input=fixture();input.records=[card('2026-04-30')];input.schedules=[schedule('2026-04-30')];const fresh=observation(input);
  const window={start:fresh.window.start,end:minute('2026-05-02T00:00:00+08:00')};
  const c=closed({...fresh,window,evidenceVersion:evidenceHash([fresh.evidenceVersion,window])}),load=vi.fn(async()=>[fresh]);
  const r=await assess([c],load,'2026-05');expect(r.assessments[0].status).toBe('current-clear');expect(load).toHaveBeenCalledExactlyOnceWith('2026-04');
 });
 it('time-only changes do not invalidate a stable case observation',async()=>{
  const input=fixture(),c=closed(observation(input));input.asOf+=1440;
  const fresh=observation(input);expect(fresh.evidenceVersion).toBe(c.observation.evidenceVersion);
  expect((await assess([c],async()=>[fresh])).assessments[0].status).toBe('current-clear');
 });
 it('ignores another employee and open cases but verifies terminal evidence before declaring an unrelated month',async()=>{
  const c=closed(),other={...c,empId:'OTHER'},open={...c,status:'open'},load=vi.fn(async()=>[c.observation]);
  expect((await assess([other,open],load)).assessments).toEqual([]);
  expect(load).not.toHaveBeenCalled();
  expect((await assess([c],load,'2026-06')).assessments).toMatchObject([{caseId:c.id,status:'current-clear',scope:'unrelated'}]);expect(load).toHaveBeenCalledExactlyOnceWith('2026-04');
 });
 it('distinguishes loaded empty inventory from missing source inventory',async()=>{
  const load=vi.fn(async()=>[]);
  expect(await assess([],load)).toMatchObject({empId:employee.id,month:'2026-04',inventory:'loaded',assessments:[]});
  expect(await assess(undefined,load)).toMatchObject({empId:employee.id,month:'2026-04',inventory:'missing',assessments:[]});expect(load).not.toHaveBeenCalled();
 });
 it('does not choose between duplicate case IDs or duplicate current observations',async()=>{
  const c=closed(),duplicate=await assess([c,{...c,revision:3}],async()=>[c.observation]);
  expect(duplicate.assessments).toHaveLength(1);expect(duplicate.assessments[0].status).toBe('unknown');
  expect((await assess([c],async()=>[c.observation,c.observation])).assessments[0].status).toBe('unknown');
 });
 it('malformed stored identity, window, or closure evidence cannot become clear',async()=>{
  for(const c of [{...closed(),id:'wrong-case-id'}, {...closed(),observation:{...observation(),window:{start:NaN,end:NaN}}}, {...closed(),observation:{...observation(),outcome:'finding'}}]){
   expect((await assess([c],async()=>[observation()])).assessments[0].status).toBe('unknown');}
 });
 it('source-loader failures become unknown and shared scan months load only once',async()=>{
  const c=closed(),load=vi.fn(async()=>{throw new Error('synthetic unavailable source');});
  expect((await assess([c],load)).assessments[0].status).toBe('unknown');
  const input=fixture();input.records=[card('2026-04-02')];const second=closed(observation(input)),shared=vi.fn(async()=>[c.observation,second.observation]);
  const r=await assess([c,second],shared);expect(r.assessments.map(x=>x.status)).toEqual(['current-clear','current-clear']);expect(shared).toHaveBeenCalledTimes(1);
 });
 it.each([
  ['empty history',(c:any)=>{c.history=[];}],
  ['last revision',(c:any)=>{c.history[1].revision=3;}],
  ['last status',(c:any)=>{c.history[1].to='open';}],
  ['last evidence',(c:any)=>{c.history[1].evidenceVersion='different';}],
  ['event identity',(c:any)=>{c.history[1].id='forged-id';}],
  ['chain origin',(c:any)=>{c.history[0].from='open';}],
  ['chain continuity',(c:any)=>{c.history[1].from='needs-info';}],
  ['missing actor',(c:any)=>{c.history[1].actor='';}],
  ['invalid time',(c:any)=>{c.history[1].at='invalid';}],
 ] as const)('rejects unbound closure history: %s',async(_label,mutate)=>{
  const c=closed();mutate(c);const r=await assess([c],async()=>[c.observation]);expect(r.assessments[0]).toMatchObject({status:'unknown',scope:'unknown'});
 });
 it.each(['missing','extra','duplicate','mismatch','wrong-owner'] as const)('requires exact immutable events: %s',async(mode)=>{
  const c=closed(),persisted=events(c);
  if(mode==='missing')persisted.pop();
  if(mode==='extra')persisted.push({...persisted[1],id:'extra'});
  if(mode==='duplicate')persisted[1]={...persisted[0]};
  if(mode==='mismatch')persisted[1].reason='changed reason';
  if(mode==='wrong-owner')persisted[1].empId='OTHER';
  expect((await assess([c],async()=>[c.observation],'2026-04',employee.id,async()=>persisted)).assessments[0]).toMatchObject({status:'unknown',scope:'unknown'});
 });
 it('a forged out-of-month stored window cannot omit an April case',async()=>{
  const c=closed(),original=c.observation;c.observation={...original,window:{start:minute('2026-06-01T00:00:00+08:00'),end:minute('2026-06-02T00:00:00+08:00')}};
  const r=await assess([c],async()=>[original]);expect(r.assessments).toHaveLength(1);expect(r.assessments[0].status).not.toBe('current-clear');expect(r.assessments[0].scope).toBe('unknown');
 });
 it('unidentified inventory rows are missing evidence rather than safely unrelated',async()=>{
  for(const row of [null,{...closed(),empId:undefined},{...closed(),empId:''}]){
   expect((await assess([row],async()=>[])).inventory).toBe('missing');}
 });
 it('unavailable immutable event inventory cannot clear a case',async()=>{
  const c=closed();expect((await assess([c],async()=>[c.observation],'2026-04',employee.id,async()=>{throw new Error('synthetic event failure');})).assessments[0]).toMatchObject({status:'unknown',scope:'unknown'});
 });
});
