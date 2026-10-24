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

describe('independent B1 boundary regression',()=>{
 it('approved 08-16 work remains 480 minutes against reviewed 480 target',()=>{const i=fixture();i.records=[card(undefined,'08:00','16:00')];expect(observations(i,'hours-difference')[0].outcome).toBe('clear');});
 it('approved 08-17 work is 540 minutes and must differ from 480 target',()=>{const i=fixture();i.records=[card(undefined,'08:00','17:00')];expect(observations(i,'hours-difference')[0].outcome).toBe('finding');});
 it('full approved split leave explains previous-day overnight shift in April scan',()=>{
 const i=fixture();i.records=[];i.schedules=[schedule('2026-03-31','22:00','06:00')];i.schedules[0].shifts[0].endDateOffset=1;
 i.leaves=[{...approvedLeave(),id:'LM',startDate:'2026-03-31T22:00',endDate:'2026-04-01T00:00',hours:2,payrollAllocations:[{date:'2026-03-31',from:'22:00',to:'24:00',minutes:120}]},{...approvedLeave(),id:'LA',startDate:'2026-04-01T00:00',endDate:'2026-04-01T06:00',hours:6,payrollAllocations:[{date:'2026-04-01',from:'00:00',to:'06:00',minutes:360}]}];
 const full={...i,window:{...i.window,start:min('2026-03-31T00:00+08:00')}};
 for(const t of ['unexplained-absence','early','late'] as const) expect(observations(full,t)[0].outcome).toBe('clear');
 expect(observations(i,'unexplained-absence')[0].outcome).toBe('clear');expect(observations(i,'early')[0].outcome).toBe('clear');expect(observations(i,'late')[0].outcome).toBe('clear');
 });
});

it('separate confirmed work entirely before schedule is included in the work-date total',()=>{const i=fixture();i.records=[card(undefined,'09:00','17:00'),{...card(undefined,'07:00','08:00'),id:'EXTRA'}];expect(observations(i,'hours-difference')[0].outcome).toBe('finding');});
it('missing work-date attribution policy cannot silently assume calendar allocation',()=>{const i=fixture();i.records=[card(undefined,'08:00','17:00')];delete i.policy!.workDateRule;expect(observations(i,'hours-difference')[0].outcome).toBe('unknown');});
