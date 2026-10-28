import {describe,it,expect} from 'vitest';
import {evaluatePayrollMonth,type PendingSources} from '../netlify/functions/utils/payrollPreflight';
import type {AttendanceMonthEvidence} from '../netlify/functions/utils/attendanceMonthEvidence';
import {card,employee,month,schedule} from './fixtures/payrollV2';
const empty=():PendingSources=>({terminationSettlementDrafts:[],terminationAdjustmentCases:[],compRequests:[],compSettlementTasks:[],overtimeRequests:[],anomalyExplanations:[],leaveRequests:[],makeupRequests:[],leaveOfAbsenceRequests:[],shiftSwapRequests:[]});
const proof=():AttendanceMonthEvidence=>({empId:employee.id,month,inventory:'complete',scan:'current',observationDigest:'synthetic',missingCaseIds:[],missingDetectorInputs:[],findings:[],unknowns:[]});
const evaluate=(map?:Record<string,AttendanceMonthEvidence>)=>evaluatePayrollMonth({month,employees:[employee],records:[card()],schedules:[schedule()],leaves:[],requests:empty(),cases:[],attendanceMonthEvidence:map});
const withProof=(changes:Partial<AttendanceMonthEvidence>)=>evaluate({[employee.id]:{...proof(),...changes}});
const observation=(outcome:'finding'|'unknown')=>({id:'synthetic',empId:employee.id,outcome,reason:'PRIVATE SOURCE EXPLANATION'} as any);
describe('month evidence trial and formal gates remain distinct',()=>{
 it('absent adapter preserves existing-model trial but reports formal evidence missing',()=>{
  const r=evaluate();expect(r.trialStatus).toBe('READY');expect(r.status).toBe('BLOCKED');expect(r.salaries[0].preflight.issues.some(i=>i.source==='attendanceMonthEvidence')).toBe(true);
 });
 it.each(['absent-employee','scope','inventory','stale','unknown'] as const)('blocks trial for unavailable bound source: %s',mode=>{
  const r=mode==='absent-employee'?evaluate({}):withProof(mode==='scope'?{empId:'OTHER'}:mode==='inventory'?{inventory:'unknown'}:{scan:mode});expect(r.trialStatus).toBe('BLOCKED');expect(r.salaries[0].netSalary).toBeNull();
 });
 it('policy gaps do not hide simultaneous unclassified unknown observations',()=>{
  const r=withProof({scan:'missing',missingDetectorInputs:['policy.lateGraceMinutes'],unknowns:[observation('unknown')]});expect(r.trialStatus).toBe('NEEDS_REVIEW');expect(r.status).toBe('BLOCKED');
  expect(r.salaries[0].preflight.issues.filter(i=>i.source==='attendanceMonthEvidence').length).toBeGreaterThanOrEqual(2);
 });
 it('unrecorded findings block trial even without a certificate',()=>{expect(withProof({scan:'missing',missingCaseIds:['synthetic'],findings:[observation('finding')]}).trialStatus).toBe('BLOCKED');});
 it('current scan with findings is not all clear',()=>{expect(withProof({findings:[observation('finding')]}).trialStatus).toBe('NEEDS_REVIEW');});
 it('unknown observations without an explicit policy gap require review',()=>{expect(withProof({unknowns:[observation('unknown')]}).trialStatus).toBe('NEEDS_REVIEW');});
 it('all-clear evidence does not remove formal capability gates',()=>{const r=withProof({});expect(r.trialStatus).toBe('READY');expect(r.salaries[0].preflight.gaps).toContain('ATTENDANCE_CASE_WORKFLOW');expect(r.status).toBe('BLOCKED');});
 it('does not expose source explanation text',()=>{expect(JSON.stringify(withProof({findings:[observation('finding')]}))).not.toContain('PRIVATE SOURCE EXPLANATION');});
});
