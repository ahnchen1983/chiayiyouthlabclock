import {describe,it,expect} from 'vitest';
import {buildAttendanceOvertimeClassification,attendanceDayHasClassification} from '../netlify/functions/utils/attendanceOvertimeClassification';
import {detectAttendanceCases,scheduleDayVersion} from '../netlify/functions/utils/attendanceCaseDetector';
import {attendanceCaseMonthWindow} from '../netlify/functions/utils/attendanceWindow';
import {normalDays} from './fixtures/normalPay';
import {card,schedule} from './fixtures/payrollV2';
import {clockSourceKey} from '../utils/attendance';
import type {DetectorInput} from '../netlify/functions/utils/attendanceCaseTypes';

const month='2026-08',date=month+'-03',empId='SYNTH',minute=(v:string)=>Date.parse(v)/60000;
const rules={schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240};
const days=(m:string)=>normalDays(m).map(d=>({...d,covered:true,policy:{...d.policy,overtimeRules:rules}}));
const employee=()=>({id:empId,normalPayDays:days(month),normalPayContextDays:[...days('2026-07').slice(-6),...days('2026-09').slice(0,6)],normalPayCompEvidence:{intervals:[],credits:[],outstanding:[],issues:[]}});
const input=(cards:any[]=[card(date,'09:00','18:00')]):DetectorInput=>{
 const day=schedule(date,'09:00','18:00');
 return {employee:{id:empId,hireDate:'2026-01-01'},window:attendanceCaseMonthWindow(month),asOf:minute('2026-09-02T00:00:00Z'),records:cards,schedules:[day],leaves:[],makeups:[],absences:[],swaps:[],revisions:[],comps:[],overtimes:[],
  coverage:{records:'complete',schedules:'complete',requests:'complete',employment:'complete',revisions:'complete',explanations:'complete'},
  policy:{version:'SYNTHETIC-attendance-policy',reviewedBy:'MANAGER',reviewedAt:'2026-08-01T00:00:00Z',closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,breaks:'explicit',workDateRule:'clock-in-date',workDifferenceTolerance:0,expectedWorkByDate:{[date]:{minutes:540,scheduleVersion:scheduleDayVersion(day,empId),reviewedBy:'MANAGER'}}}};
};
const candidate=(i:DetectorInput,d=date)=>detectAttendanceCases(i).observations.find(o=>o.anchor==='overtime-candidate:'+d)!;
const attach=(i:DetectorInput,e:any=employee())=>{i.overtimeClassification=buildAttendanceOvertimeClassification(e,month,i.records,i.leaves);return i;};
describe('source-bound existing-model overtime classification',()=>{
 it('clears the verified 540-minute candidate only and never grants legal or payment authority',()=>{
  const i=input();expect(candidate(i).outcome).toBe('unknown');attach(i);
  expect(i.overtimeClassification?.status).toBe('classified');const o=candidate(i);expect(o.outcome).toBe('clear');expect(o.payrollDecision).toBe('none');expect(o.reason).toContain('不代表法定加班授權');expect(i.overtimeClassification?.formalEligibility).toBe('BLOCKED');
 });
 it('does not infer breaks, accept unknown work or reuse a proof after card/review edits',()=>{
  const i=attach(input()),old=i.overtimeClassification!;
  i.records[0].clockOutTime='19:00';expect(candidate(i).outcome).toBe('unknown');
  i.records[0]=card(date,'09:00','18:00');i.records[0].workReview!.reviewedBy='CHANGED';expect(candidate(i).outcome).toBe('unknown');
  const unreviewed=input([card(date,'09:00','18:00',false)]);attach(unreviewed);expect(candidate(unreviewed).outcome).toBe('unknown');expect(unreviewed.overtimeClassification?.status).toBe('unknown');expect(old.ranges.reduce((n,r)=>n+r.end-r.start,0)).toBe(540);
 });
 it('retains unknown when complete cross-month authority or policy is missing',()=>{
  for(const mutate of [(e:any)=>e.normalPayContextDays.shift(),(e:any)=>delete e.normalPayDays[0].policy.overtimeRules]){
   const e=employee();mutate(e);const i=attach(input(),e);expect(i.overtimeClassification?.status).toBe('unknown');expect(candidate(i).outcome).toBe('unknown');
  }
 });
 it('retains compliance findings even if the overtime adapter reports candidate',()=>{
  const e=employee();e.normalPayDays.find(d=>d.date===date)!.dayType='rest';const i=attach(input(),e);
  expect(i.overtimeClassification?.status).toBe('unknown');expect(candidate(i).outcome).toBe('unknown');
 });
 it('pending comp choice stays unknown; verified converted intervals remain part of work coverage',()=>{
  const e:any=employee(),start=minute(date+'T17:00:00+08:00'),end=start+60;
  e.normalPayCompEvidence.credits=[{id:'SYNTH-CREDIT',start,end,status:'pending'}];expect(attach(input(),e).overtimeClassification?.status).toBe('unknown');
  e.normalPayCompEvidence.credits[0].status='approved';const i=attach(input(),e);expect(i.overtimeClassification?.status).toBe('classified');expect(candidate(i).outcome).toBe('clear');
 });
 it('never clears unrelated pending requests or other detector findings',()=>{
  const i=attach(input());i.makeups=[{id:'SYNTH-PENDING',empId,name:'synthetic',date,type:'下班',reason:'Synthetic pending evidence',status:'待審核',requestDate:date}];
  const observations=detectAttendanceCases(i).observations;expect(candidate(i).outcome).toBe('clear');expect(observations.some(o=>o.type==='pending-request'&&o.outcome==='finding')).toBe(true);
 });
 it('requires exact covered union, correct scope and untampered proof',()=>{
  const i=attach(input()),proof=i.overtimeClassification!,actual=[{start:minute(date+'T09:00:00+08:00'),end:minute(date+'T18:00:00+08:00')}];
  expect(attendanceDayHasClassification(proof,empId,month,date,i.records,actual)).toBe(true);
  expect(attendanceDayHasClassification(proof,empId,month,date,i.records,[{...actual[0],end:actual[0].end+1}])).toBe(false);
  expect(attendanceDayHasClassification(proof,'OTHER',month,date,i.records,actual)).toBe(false);
  expect(attendanceDayHasClassification({...proof,ranges:[]},empId,month,date,i.records,actual)).toBe(false);
 });
 it('does not clear an uncovered prior-month workday tail or reset overtime at midnight',()=>{
  const c:any=card('2026-07-31','18:00','03:00',false);c.clockInAt='2026-07-31T18:00:00+08:00';c.clockOutAt='2026-08-01T03:00:00+08:00';c.workIntervals=[{start:1080,end:1620}];c.workReview={sourceKey:clockSourceKey(c),reviewedBy:'MANAGER',reviewedAt:'2026-08-02T00:00:00Z'};
  const e=employee(),proof=buildAttendanceOvertimeClassification(e,month,[c],[]),actual=[{start:minute('2026-08-01T00:00:00+08:00'),end:minute('2026-08-01T03:00:00+08:00')}];
  expect(attendanceDayHasClassification(proof,empId,month,'2026-08-01',[c],actual)).toBe(false);
 });
 it('policy/source changes produce different immutable observation identity',()=>{
  const i=attach(input()),before=candidate(i).evidenceVersion,e=employee();e.normalPayDays.forEach(d=>d.policy.version='new-synthetic-policy');
  attach(i,e);expect(candidate(i).evidenceVersion).not.toBe(before);
 });
});
