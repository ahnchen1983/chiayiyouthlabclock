import {describe,it,expect} from 'vitest';
import {assessAttendanceMonth,attendanceObservationDigest,type AttendanceScanCertificate} from '../netlify/functions/utils/attendanceMonthEvidence';
import {scanCaseObservations} from '../netlify/functions/utils/attendanceCaseEvidence';
import {scheduleDayVersion} from '../netlify/functions/utils/attendanceCaseDetector';
import {evidenceHash,reconcileCase} from '../netlify/functions/utils/attendanceCaseLifecycle';
import type {DetectorInput} from '../netlify/functions/utils/attendanceCaseTypes';
import {card,employee,schedule} from './fixtures/payrollV2';

const minute=(s:string)=>Date.parse(s)/60000;
const month='2026-04',empId=employee.id;
const input=():DetectorInput=>({employee:{id:empId,hireDate:'2026-01-01'},
 window:{start:minute('2026-04-01T00:00:00+08:00'),end:minute('2026-05-01T00:00:00+08:00')},asOf:minute('2026-05-02T00:00:00+08:00'),
 records:[card()],schedules:[schedule()],leaves:[],makeups:[],absences:[],swaps:[],revisions:[],comps:[],overtimes:[],
 coverage:{records:'complete',schedules:'complete',requests:'complete',employment:'complete',revisions:'complete',explanations:'complete'},
 policy:{version:'synthetic-reviewed-attendance',reviewedBy:'SYNTH-manager',reviewedAt:'2026-03-01T00:00:00Z',
  closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,breaks:'explicit',workDateRule:'clock-in-date',workDifferenceTolerance:0,
  expectedWorkByDate:{'2026-04-01':{minutes:480,scheduleVersion:scheduleDayVersion(schedule(),empId),reviewedBy:'SYNTH-manager'}}},
});
const observations=(i:DetectorInput)=>scanCaseObservations(i,month).observations;
const certificate=(i:DetectorInput,cases:any[]=[]):AttendanceScanCertificate=>({schemaVersion:'attendance-scan-v1',empId,month,detectorVersion:'detector-v1',
 observationDigest:attendanceObservationDigest(empId,month,observations(i)),
 caseHeads:cases.map(c=>({id:c.id,revision:c.revision,evidenceVersion:c.observation.evidenceVersion,status:c.status})),actor:'SYNTH-manager',at:'2026-05-02T00:00:00Z'});
const closed=(i=input())=>{const o=observations(i).find(o=>o.type==='missing-in'&&o.anchor.startsWith('card:'))!;
 const first=reconcileCase(undefined,{...o,outcome:'finding',evidenceVersion:evidenceHash('synthetic-prior')},'SYNTH-manager','2026-05-01T00:00:00Z')!;
 return {...reconcileCase(first,o,'SYNTH-manager','2026-05-02T00:00:00Z')!,scanMonth:month};};
const assess=(i:DetectorInput|undefined,cases:unknown=[],cert:AttendanceScanCertificate|null|undefined=undefined)=>assessAttendanceMonth({empId,month,input:i,cases,certificate:cert});
const swap=():DetectorInput['swaps'][number]=>({id:'synthetic-swap',fromEmpId:empId,fromName:'Synthetic',fromDate:'2026-04-01',fromShiftIndex:0,toEmpId:'SYNTH-other',toName:'Synthetic other',toDate:'2026-04-02',toShiftIndex:0,reason:'synthetic',status:'cancelled',createdAt:'2026-03-20T00:00:00Z'});

describe('whole-month attendance evidence without writes or assumed policy',()=>{
 it('accepts explicit shift-swap participants without a nonexistent empId field',()=>{
  const i=input();i.swaps=[swap()];const r=assess(i,[],certificate(i));expect(r.inventory).toBe('complete');expect(r.scan).toBe('current');
 });
 it.each(['fromEmpId','toEmpId'] as const)('requires shift-swap participant %s before filtering',key=>{
  const i=input();i.swaps=[{...swap(),[key]:null} as any];const r=assess(i,[],certificate(i));expect(r.inventory).toBe('unknown');expect(r.scan).not.toBe('current');
 });
 it.each(['comps','overtimes'] as const)('requires explicit %s inventory even when no schedule exists',key=>{
  const i=input();i.schedules=[];i.records=[];delete i[key];
  const r=assess(i,[],certificate(i));expect(r.inventory).toBe('unknown');expect(r.scan).not.toBe('current');
 });
 it.each(['records','leaves','makeups','absences','swaps','comps','overtimes'] as const)('does not discard malformed employee identity in %s before inventory assessment',key=>{
  const i=input();i.schedules=[];i.records=[];(i as any)[key]=[{...card(),empId:null}];
  const r=assess(i,[],certificate(i));expect(r.inventory).toBe('unknown');expect(r.scan).not.toBe('current');
 });
 it('distinguishes full source inventory and a current certificate from anomaly outcomes',()=>{
  const i=input(),r=assess(i,[],certificate(i));expect(r).toMatchObject({empId,month,inventory:'complete',scan:'current',missingCaseIds:[],missingDetectorInputs:[],findings:[],unknowns:[]});
 });
 it('does not treat empty cases as proof that a month was scanned',()=>{
  const r=assess(input());expect(r.inventory).toBe('complete');expect(r.scan).toBe('missing');
 });
 it('detects a newly missing clock event even if no persisted case exists',()=>{
  const i=input();i.records=[card(undefined,null,'17:00',false)];const o=observations(i).find(o=>o.type==='missing-in'&&o.outcome==='finding')!;
  const r=assess(i);expect(r.findings.some(f=>f.id===o.id)).toBe(true);expect(r.missingCaseIds).toContain(o.id);expect(r.scan).toBe('missing');
 });
 it('a current certificate with retained findings is not an all-clear result',()=>{
  const i=input();i.records=[card(undefined,null,'17:00',false)];
  const cases=observations(i).filter(o=>o.outcome!=='clear').map(o=>reconcileCase(undefined,o,'SYNTH-manager','2026-05-02T00:00:00Z')!);
  const r=assess(i,cases,certificate(i,cases));expect(r.scan).toBe('current');expect(r.missingCaseIds).toEqual([]);expect(r.findings.length).toBeGreaterThan(0);
 });
 it('retained certificate heads reveal deletion of a whole case even when current raw evidence is clear',()=>{
  const i=input(),c=closed(i),r=assess(i,[],certificate(i,[c]));expect(r.missingCaseIds).toContain(c.id);expect(r.scan).toBe('stale');
 });
 it('source changes or case-head changes make a formerly current certificate stale',()=>{
  const i=input(),c=closed(i),cert=certificate(i,[c]);
  expect(assess(i,[{...c,revision:c.revision+1}],cert).scan).toBe('stale');
  i.records=[card(undefined,'10:00','17:00')];expect(assess(i,[c],cert).scan).toBe('stale');
 });
 it('source-time-only changes keep a settled observation certificate stable',()=>{
  const i=input(),cert=certificate(i);i.asOf+=60;expect(assess(i,[],cert).scan).toBe('current');
 });
 it('a closing threshold changing the detector outcome changes the digest',()=>{
  const i=input();i.records=[card(undefined,'09:00',null,false)];i.asOf=minute('2026-04-01T12:00:00+08:00');const cert=certificate(i);
  i.asOf=minute('2026-05-02T00:00:00+08:00');expect(assess(i,[],cert).scan).toBe('stale');
 });
 it('missing source inventory and unknown coverage never become a complete assessment',()=>{
  expect(assess(undefined).inventory).toBe('unknown');const i=input();i.coverage.explanations='unknown';const r=assess(i,[],certificate(i));
  expect(r.inventory).toBe('unknown');expect(r.missingDetectorInputs).toContain('coverage.explanations');expect(r.unknowns.length).toBeGreaterThan(0);
 });
 it('unknown attendance policy does not inherit settings defaults',()=>{
  const i=input();i.policy=null;const r=assess(i,[],certificate(i));
  expect(r.missingDetectorInputs).toEqual(expect.arrayContaining(['policy.approval','policy.closeAfterMinutes','policy.lateGraceMinutes','policy.earlyGraceMinutes','policy.workDateRule','policy.breaks','policy.workDifferenceTolerance','policy.expectedWorkByDate:2026-04-01']));
  expect(r.unknowns.length).toBeGreaterThan(0);
 });
 it('reviewed zero tolerances remain explicit while stale work-target schedule binding remains missing',()=>{
  const i=input();expect(assess(i,[],certificate(i)).missingDetectorInputs).toEqual([]);
  i.policy!.expectedWorkByDate!['2026-04-01'].scheduleVersion='stale';expect(assess(i,[],certificate(i)).missingDetectorInputs).toContain('policy.expectedWorkByDate:2026-04-01');
 });
 it('does not require grace or work-target values when no relevant schedule or overnight work uses them',()=>{
  const i=input();i.schedules=[];i.records=[];i.policy=null;
  expect(assess(i,[],certificate(i)).missingDetectorInputs).toEqual([]);
 });
 it.each(['employee','month','detector','duplicate-heads','missing-actor','invalid-time'] as const)('rejects malformed or wrong-scope certificate: %s',mode=>{
  const i=input(),c=closed(i),cert=certificate(i,[c]);
  if(mode==='employee')cert.empId='OTHER';if(mode==='month')cert.month='2026-05';if(mode==='detector')(cert as any).detectorVersion='unknown';
  if(mode==='duplicate-heads')cert.caseHeads.push(cert.caseHeads[0]);if(mode==='missing-actor')cert.actor='';if(mode==='invalid-time')cert.at='invalid';
  expect(assess(i,[c],cert).scan).toBe('unknown');
 });
 it('requires valid cases inventory, while unrelated employees do not enter its retained heads',()=>{
  const i=input();expect(assessAttendanceMonth({empId,month,input:i,cases:undefined,certificate:certificate(i)}).inventory).toBe('unknown');
  expect(assess(i,[{empId:null}],certificate(i)).inventory).toBe('unknown');
  expect(assess(i,[{...closed(i),empId:'OTHER'}],certificate(i)).scan).toBe('current');
 });
 it('malformed raw sources return unknown rather than throwing or pretending an empty month',()=>{
  const i=input();i.records=[{...card(),date:'invalid'}];expect(()=>assess(i)).not.toThrow();expect(assess(i).inventory).toBe('unknown');
 });
 it('does not mutate supplied sources, case history, or certificate',()=>{
  const i=input(),c=closed(i),cert=certificate(i,[c]),before=JSON.stringify([i,c,cert]);assess(i,[c],cert);expect(JSON.stringify([i,c,cert])).toBe(before);
 });
});
