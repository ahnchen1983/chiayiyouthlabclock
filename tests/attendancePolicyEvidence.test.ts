import {describe,it,expect} from 'vitest';
import {assessAttendancePolicyEvidence} from '../netlify/functions/utils/attendancePolicyEvidence';
import {scheduleDayVersion} from '../netlify/functions/utils/attendanceCaseDetector';
import {employee,month,schedule} from './fixtures/payrollV2';
const declaration=()=>({schemaVersion:'attendance-policy-declaration-v1',version:'synthetic-v1',status:'approved',empId:employee.id,month,approvedBy:'SYNTH-manager',approvedAt:'2026-03-01T00:00:00Z',workDateRule:'clock-in-date',breaks:'explicit',closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,workDifferenceTolerance:0,expectedWorkByDate:{'2026-04-01':{minutes:480,scheduleVersion:scheduleDayVersion(schedule(),employee.id),reviewedBy:'SYNTH-manager'}}});
const assess=(d:unknown)=>assessAttendancePolicyEvidence({empId:employee.id,month,declaration:d,schedules:[schedule()]});
describe('explicit attendance declaration without defaults',()=>{
 it('accepts reviewed zero values and known explicit-work rules',()=>{const r=assess(declaration());expect(r.status).toBe('verified');expect(r.policy?.lateGraceMinutes).toBe(0);expect(r.missingInputs).toEqual([]);});
 it.each(['closeAfterMinutes','lateGraceMinutes','earlyGraceMinutes','workDifferenceTolerance'] as const)('requires explicit %s',key=>{const d:any=declaration();delete d[key];expect(assess(d).status).toBe('unknown');expect(assess(d).missingInputs).toContain('policy.'+key);});
 it('does not derive net work minutes from schedule duration',()=>{const d:any=declaration();d.expectedWorkByDate={};expect(assess(d).missingInputs).toContain('policy.expectedWorkByDate:2026-04-01');});
 it('invalidates target when schedule changes',()=>{const d=declaration();d.expectedWorkByDate['2026-04-01'].scheduleVersion='stale';expect(assess(d).status).toBe('unknown');});
 it.each(['scope','approval','breaks','date'] as const)('rejects invalid %s',mode=>{const d:any=declaration();if(mode==='scope')d.empId='OTHER';if(mode==='approval')d.status='draft';if(mode==='breaks')d.breaks='auto-one-hour';if(mode==='date')d.workDateRule='schedule-date';expect(assess(d).status).toBe('unknown');});
 it('returns null policy for missing declaration and never mutates it',()=>{expect(assess(undefined).policy).toBeNull();const d=declaration(),before=JSON.stringify(d);assess(d);expect(JSON.stringify(d)).toBe(before);});
});
