import { describe, expect, it } from 'vitest';
import { card, employee, leave, schedule } from './fixtures/payrollV2';
import { LeaveStatus, LeaveType } from '../types';
import { detectAttendanceCases, scheduleDayVersion } from '../netlify/functions/utils/attendanceCaseDetector';
import { caseKey, evidenceHash, outboxIntent, reconcileCase, transitionCase } from '../netlify/functions/utils/attendanceCaseLifecycle';
import { CASE_TYPES, type CaseObservation, type CaseType, type DetectorInput } from '../netlify/functions/utils/attendanceCaseTypes';
const min=(s:string)=>Date.parse(s)/60000;
const fixture=():DetectorInput=>({
 employee:{id:employee.id,hireDate:'2026-01-01'}, window:{start:min('2026-04-01T00:00+08:00'),end:min('2026-04-02T00:00+08:00')}, asOf:min('2026-04-03T00:00+08:00'),
 records:[card()],schedules:[schedule()],leaves:[],makeups:[],absences:[],swaps:[],revisions:[],
 coverage:{records:'complete',schedules:'complete',requests:'complete',employment:'complete',revisions:'complete',explanations:'complete'},
 policy:{version:'synthetic-explicit-policy',reviewedBy:'SYNTH',reviewedAt:'2026-03-01T00:00:00Z',closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,breaks:'explicit',workDateRule:'clock-in-date',workDifferenceTolerance:0,
 expectedWorkByDate:{'2026-04-01':{minutes:480,scheduleVersion:scheduleDayVersion(schedule(),employee.id),reviewedBy:'SYNTH'}}},
});
const observations=(i:DetectorInput,t:CaseType)=>detectAttendanceCases(i).observations.filter(o=>o.type===t);
const approvedLeave=()=>({...leave(),status:LeaveStatus.Approved,approver:'SYNTH',approvalDate:'2026-04-02T00:00:00Z'});
const makeup=()=>({id:'P1',empId:employee.id,name:'synthetic',date:'2026-04-01',type:'下班' as const,requestedClockOut:'18:00',recordId:card().id,reason:'synthetic',requestDate:'2026-04-02',status:'核准' as const,approver:'SYNTH',approvalDate:'2026-04-02T00:00:00Z'});
const positive: Record<CaseType,(i:DetectorInput)=>void>={
 'missing-in':i=>{i.records=[card(undefined,null,'17:00',false)];},
 'missing-out':i=>{i.records=[card(undefined,'09:00',null,false)];},
 'unexplained-absence':i=>{i.records=[];},
 late:i=>{i.records=[card(undefined,'10:00','17:00')];},
 early:i=>{i.records=[card(undefined,'09:00','16:00')];},
 'hours-difference':i=>{i.records=[card(undefined,'09:00','16:00')];},
 'unscheduled-card':i=>{i.schedules=[];},
 'sequence-overlap':i=>{i.records.push({...card(),id:'C2'});},
 'overnight-date':i=>{const r=card('2026-04-01','09:00','17:00',false);r.clockInAt='2026-04-02T09:00:00+08:00';r.clockOutAt='2026-04-02T17:00:00+08:00';i.records=[r];i.window.end=min('2026-04-03T00:00+08:00');},
 'work-leave-overlap':i=>{i.leaves=[approvedLeave()];},
 'pending-request':i=>{i.makeups=[{...makeup(),status:'待審核'}];},
 'approved-unapplied':i=>{i.makeups=[makeup()];},
};
describe('12 detector groups: explicit synthetic manual expected findings and controls',()=>{
 it.each(CASE_TYPES)('%s positive: human expected finding; no wage/absence decision',t=>{const i=fixture();positive[t](i);const r=observations(i,t);expect(r.some(o=>o.outcome==='finding')).toBe(true);expect(r.every(o=>o.payrollDecision==='none')).toBe(true);});
 it.each(CASE_TYPES)('%s negative: complete normal day has no finding',t=>{expect(observations(fixture(),t).every(o=>o.outcome==='clear')).toBe(true);});
 it.each(CASE_TYPES)('%s unknown source is retained, never treated as an empty complete dataset',t=>{const i=fixture();i.coverage.requests='unknown';expect(observations(i,t).some(o=>o.outcome==='unknown')).toBe(true);});
 it('unknown policy cannot decide lateness, early departure, missing-out closure or work target',()=>{const i=fixture();i.policy=null;i.records=[card(undefined,'10:00',null,false)];for(const t of ['late','early','missing-out','hours-difference'] as const)expect(observations(i,t).some(o=>o.outcome==='unknown')).toBe(true);});
 it('in-progress shift does not become missing-out finding',()=>{const i=fixture();positive['missing-out'](i);i.asOf=min('2026-04-01T12:00+08:00');expect(observations(i,'missing-out')[0].outcome).toBe('unknown');});
 it('approved complete leave with valid allocations explains absence without inventing work/pay',()=>{const i=fixture();i.records=[];const l=approvedLeave();l.startDate='2026-04-01T09:00';l.hours=8;l.payrollAllocations=[{date:'2026-04-01',from:'09:00',to:'17:00',minutes:480}];i.leaves=[l];expect(observations(i,'unexplained-absence')[0].outcome).toBe('clear');expect(observations(i,'hours-difference')[0].outcome).toBe('clear');expect(detectAttendanceCases(i).settlementEligibility).toBe('BLOCKED');});
 it('approved status without valid allocation cannot explain absent work',()=>{const i=fixture();i.records=[];i.leaves=[{...approvedLeave(),payrollAllocations:undefined}];expect(observations(i,'approved-unapplied').some(o=>o.outcome==='finding')).toBe(true);expect(observations(i,'unexplained-absence')[0].outcome).toBe('unknown');});
 it('approved outing explains attendance but never becomes work-leave conflict',()=>{const i=fixture();i.leaves=[{...approvedLeave(),leaveType:LeaveType.BusinessTrip}];expect(observations(i,'work-leave-overlap')[0].outcome).toBe('clear');});
 it('schedule before hire or after resignation does not imply absence duty',()=>{for(const e of [{hireDate:'2026-04-02'}, {resignDate:'2026-03-31'}]){const i=fixture();i.employee={...i.employee,...e};i.records=[];expect(observations(i,'unexplained-absence')[0].outcome).toBe('clear');}});
 it('hours target must bind current schedule version and explicit reviewed rest policy',()=>{const i=fixture();i.policy!.expectedWorkByDate!['2026-04-01'].scheduleVersion='stale';expect(observations(i,'hours-difference')[0].outcome).toBe('unknown');});
 it('legacy backward HH:mm is unknown overnight, never silently next-day',()=>{const i=fixture();i.records=[card(undefined,'22:00','06:00',false)];expect(observations(i,'overnight-date')[0].outcome).toBe('unknown');});
 it('cross-month overnight uses full intersections, including following-day leave',()=>{const i=fixture();const r=card('2026-03-31','22:00','06:00',false);r.clockInAt='2026-03-31T22:00:00+08:00';r.clockOutAt='2026-04-01T06:00:00+08:00';i.records=[r];i.schedules=[{...schedule('2026-03-31','22:00','06:00'),shifts:[{...schedule().shifts[0],from:'22:00',to:'06:00',endDateOffset:1}]}];i.makeups=[{...makeup(),date:'2026-03-31',requestedClockOutAt:'2026-04-01T06:00:00+08:00',status:'待審核'}];expect(observations(i,'overnight-date')[0].outcome).toBe('clear');expect(observations(i,'pending-request').some(o=>o.outcome==='finding')).toBe(true);expect(observations(i,'unexplained-absence')[0].outcome).toBe('clear');});
 it('same month but unrelated request day is excluded from a bounded daily scan',()=>{const i=fixture();i.makeups=[{...makeup(),date:'2026-04-20',status:'待審核'}];expect(observations(i,'pending-request').every(o=>o.outcome==='clear')).toBe(true);});
 it('legacy approved swap lacking application lineage remains unknown',()=>{const i=fixture();i.swaps=[{id:'S',fromEmpId:employee.id,toEmpId:'OTHER',fromName:'synthetic',toName:'synthetic',fromDate:'2026-04-01',toDate:'2026-04-02',fromShiftIndex:0,toShiftIndex:0,reason:'synthetic',status:'approved',createdAt:'2026-03-30'}];expect(observations(i,'approved-unapplied').some(o=>o.outcome==='unknown')).toBe(true);});
 it('source reorder and scan time do not churn stable identities or evidence',()=>{const i=fixture();i.records.push({...card(undefined,'18:00','19:00'),id:'C2'});const a=detectAttendanceCases(i);i.records.reverse();i.asOf+=60;expect(detectAttendanceCases(i)).toEqual(a);});
 it('schedule-time correction keeps the day key, but changes evidence version',()=>{const i=fixture();const a=observations(i,'late')[0];i.schedules=[schedule(undefined,'08:00','17:00')];const b=observations(i,'late')[0];expect(b.id).toBe(a.id);expect(b.evidenceVersion).not.toBe(a.evidenceVersion);});
 it('B1 cannot clear missing workflow capability or claim settlement readiness',()=>{const r=detectAttendanceCases(fixture());expect(r.settlementEligibility).toBe('BLOCKED');expect(r.missingCapabilities).toContain('PERSISTED_CASE_WORKFLOW');});
});
const at='2026-04-03T00:00:00Z';
const finding=()=>{const i=fixture();positive.late(i);return observations(i,'late')[0];};
describe('versioned case lifecycle and sandbox outbox contract only',()=>{
 it('same scan is idempotent; changed evidence resolves/reopens same identity with retained history',()=>{const o=finding();const c=reconcileCase(undefined,o,'detector',at)!;expect(reconcileCase(c,o,'detector',at)).toBe(c);const clear={...o,outcome:'clear' as const,evidenceVersion:evidenceHash('cleared'),reason:'verified corrected input'};const resolved=reconcileCase(c,clear,'detector',at)!;expect(resolved.status).toBe('resolved');const reopened=reconcileCase(resolved,o,'detector',at)!;expect(reopened.status).toBe('open');expect(reopened.id).toBe(c.id);expect(reopened.history).toHaveLength(3);expect(c.history).toHaveLength(1);});
 it('unknown evidence reopens rather than clearing a prior case',()=>{const o=finding(),c=reconcileCase(undefined,o,'detector',at)!;const next=reconcileCase(c,{...o,outcome:'unknown',evidenceVersion:'missing',reason:'source unavailable'},'detector',at)!;expect(next.status).toBe('needs-info');});
 it('new clear observation does not create a spurious case',()=>{expect(reconcileCase(undefined,{...finding(),outcome:'clear'},'detector',at)).toBeUndefined();});
 it('pure transitions enforce optimistic revision and operation idempotency',()=>{const c=reconcileCase(undefined,finding(),'detector',at)!;const cmd={expectedRevision:1,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:'OP',actor:'SYNTH',at,reason:'request clarification',to:'awaiting-employee' as const};const next=transitionCase(c,cmd);expect(next.revision).toBe(2);expect(transitionCase(next,cmd)).toBe(next);expect(()=>transitionCase(next,{...cmd,operationId:'OTHER'})).toThrow('Stale');expect(()=>transitionCase(next,{...cmd,reason:'different intent'})).toThrow('conflict');});
 it('manual close/cancel cannot silence unresolved evidence',()=>{const c=reconcileCase(undefined,finding(),'detector',at)!;for(const to of ['resolved','cancelled'] as const)expect(()=>transitionCase(c,{expectedRevision:1,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:to,actor:'SYNTH',at,reason:'hide',to})).toThrow('Cannot close');});
 it('invalid identity is rejected and outbox intent never delivers or queues automatically',()=>{const o=finding();expect(()=>reconcileCase(undefined,{...o,id:'wrong'},'detector',at)).toThrow('identity');expect(o.id).toBe(caseKey(o.empId,o.type,o.anchor));const c=reconcileCase(undefined,o,'detector',at)!;const a=outboxIntent(c,null,'v1');expect(a).toEqual(outboxIntent(c,null,'v1'));expect(a.state).toBe('held');expect(a.channel).toBe('sandbox');expect(a.attempts).toBe(0);});
});

it('duplicate source IDs produce one case identity and unknown competing projections',()=>{const i=fixture();i.records.push({...card(undefined,'10:00','16:00'),id:i.records[0].id});const r=detectAttendanceCases(i);expect(new Set(r.observations.map(o=>o.id)).size).toBe(r.observations.length);expect(observations(i,'missing-in')[0].outcome).toBe('unknown');expect(observations(i,'sequence-overlap')[0].outcome).toBe('finding');});
it('empty source identity aborts scan rather than returning false all-clear',()=>{const i=fixture();i.records[0].id='';expect(()=>detectAttendanceCases(i)).toThrow('identity');});

it('malformed clock fields are unknown, not clear just because a string exists',()=>{const i=fixture();i.records[0].clockInAt='invalid';i.records[0].clockOutAt='invalid';for(const t of ['missing-in','missing-out'] as const)expect(observations(i,t)[0].outcome).toBe('unknown');});
it('unknown request status cannot clear a prior unapplied-approval case',()=>{const i=fixture();i.makeups=[{...makeup(),status:'future-state' as any}];expect(observations(i,'approved-unapplied')[0].outcome).toBe('unknown');});

it('policy values without review evidence cannot decide lateness',()=>{const i=fixture();i.records=[card(undefined,'10:00','17:00')];delete i.policy!.reviewedBy;expect(observations(i,'late')[0].outcome).toBe('unknown');});
it('invalid employment ordering leaves uncertainty rather than outside-employment clearance',()=>{const i=fixture();i.employee.hireDate='2026-04-02';i.employee.resignDate='2026-03-31';i.records=[];expect(observations(i,'unexplained-absence').some(o=>o.outcome==='unknown')).toBe(true);});

it('incorrect stored date cannot hide a full timestamp intersecting the selected window',()=>{const i=fixture();const r=card('2026-03-01','09:00','17:00',false);r.clockInAt='2026-04-01T09:00:00+08:00';r.clockOutAt='2026-04-01T17:00:00+08:00';i.records=[r];expect(observations(i,'overnight-date').some(o=>o.outcome==='finding')).toBe(true);expect(observations(i,'unexplained-absence')[0].outcome).toBe('unknown');});
it('partial raw attendance is not falsely labelled whole-shift unexplained absence',()=>{const i=fixture();i.records=[card(undefined,'09:00',null,false)];expect(observations(i,'unexplained-absence')[0].outcome).toBe('unknown');});
