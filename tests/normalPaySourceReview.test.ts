import {describe,expect,it} from 'vitest';
import {normalPayPreview} from '../netlify/functions/utils/normalPayPreview';
import {effectiveMasterForMonth} from '../netlify/functions/utils/effectiveMaster';
import {calculateSalaryForEmployee,validLeaveAllocations} from '../netlify/functions/utils/payroll';
import {evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';
import {clockSourceKey} from '../utils/attendance';
import {normalDays,normalPolicy} from './fixtures/normalPay';
import {employee,card,review,leave} from './fixtures/payrollV2';

const month='2026-08';
const monthly=()=>({...employee,payBasis:'monthly',monthlySalary:30000,effectiveMasterVersion:'M',masterAssessment:{issues:[]},normalPayDays:normalDays(),normalPayCompEvidence:{issues:[],intervals:[]},payrollReview:{...review,yearMonth:month,payBasis:'monthly',policy:{...review.policy,regularDates:normalDays().map(d=>d.date)}}});
const preview=(cards:any[]=[],leaves:any[]=[],emp:any=monthly())=>normalPayPreview(emp,month,cards,leaves,validLeaveAllocations);
const nights=()=>[{...card('2026-08-20','20:00','23:30'),id:'SYNTH-FIRST'},{...card('2026-08-21','00:30','06:00'),id:'SYNTH-SECOND'}];
const mapping=(cards:ReturnType<typeof nights>)=>cards.map((c,n)=>{const w=c.workIntervals![0],approval=c.workReview!.reviewedBy+'@'+c.workReview!.reviewedAt,base=Date.parse(c.date+'T00:00:00+08:00')/60000;return {sourceId:c.id,sourceVersion:evidenceHash([clockSourceKey(c),c.workIntervals,approval]),workApprovalId:approval,start:base+w.start,end:base+w.end,workdayId:'SYNTH-DAY-'+n,workdayDate:c.date};});
async function effective(cards:ReturnType<typeof nights>,mappingIn:'expired'|'current'|'none'){
 const first={...normalPolicy(),version:'SYNTH-FIRST-HALF',...(mappingIn==='expired'?{workdayAssignments:mapping(cards)}:{})};
 const second={...normalPolicy(),version:'SYNTH-SECOND-HALF',...(mappingIn==='current'?{workdayAssignments:mapping(cards)}:{})};
 const period={employmentState:'active',employmentType:'part-time',payBasis:'hourly',amount:200,dayTypeCalendarId:'D'};
 const outer={status:'approved',version:review.policy.version,approvedBy:'SYNTH-MANAGER',approvedAt:'2026-07-01T00:00:00Z',employeeIds:['SYNTH']};
 const data=new Map<string,any>([
  ['payrollMasterHeads/SYNTH',{currentVersionId:'M'}],
  ['payrollMasterVersions/M',{empId:'SYNTH',status:'approved',approvedBy:outer.approvedBy,approvedAt:outer.approvedAt,timeline:{accountKind:'employee',from:'2026-08-01',to:'2026-08-31',periods:[{...period,from:'2026-08-01',to:'2026-08-15',policyVersionId:'P1'},{...period,from:'2026-08-16',to:'2026-08-31',policyVersionId:'P2'}]}}],
  ['payrollPolicyVersions/P1',{...outer,from:'2026-08-01',to:'2026-08-15',normalPay:first}],
  ['payrollPolicyVersions/P2',{...outer,from:'2026-08-16',to:'2026-08-31',normalPay:second}],
  ['dayTypeCalendars/D',{...outer,version:'SYNTH-DAYS',days:Object.fromEntries(normalDays().map(d=>[d.date,'normal']))}],
 ]);
 const db={collection:(col:string)=>({doc:(id:string)=>({get:async()=>({exists:data.has(col+'/'+id),data:()=>structuredClone(data.get(col+'/'+id))})})})};
 const e=await effectiveMasterForMonth(db,null,{...employee,payrollReview:{...review,yearMonth:month,policy:{...review.policy,regularDates:normalDays().map(d=>d.date)}}},month,{masterVersionId:'M'});
 return {...e,normalPayCompEvidence:{issues:[],intervals:[]}};
}

describe('independent C2a source review regressions; synthetic only',()=>{
 it('an expired first-half policy cannot authorise second-half workday mappings',async()=>{
  const cards=nights(),emp=await effective(cards,'expired');
  const result=preview(cards,[],emp);
  expect(result.status).toBe('needs-review');expect(result.amount).toBeNull();
  expect(result.issues.join()).toContain('工日分配政策不適用');
 });
 it('the current effective policy can still provide one source-bound identity per work interval',async()=>{
  const cards=nights(),emp=await effective(cards,'current');
  const result=preview(cards,[],emp);
  expect(result.status,result.issues.join()).toBe('ready');expect(result.amount).toBe('1800.00');
  expect(result.segments.map(s=>s.policyVersion)).toEqual(['SYNTH-SECOND-HALF','SYNTH-SECOND-HALF']);
 });
 it('approved-looking nested mappings without server-loaded policy scope do not authorise workdays',()=>{
  const cards=nights(),days=normalDays(month,{payBasis:'hourly',amount:'200'});
  days.forEach(d=>d.policy!.workdayAssignments=mapping(cards));
  const result=preview(cards,[],{...monthly(),normalPayDays:days});
  expect(result.amount).toBeNull();expect(result.issues.join()).toContain('工日分配政策不適用');
 });
 it('a changed work review still invalidates a mapping under the current policy',async()=>{
  const cards=nights(),emp=await effective(cards,'current');cards[1].workIntervals![0].end-=10;
  expect(preview(cards,[],emp).amount).toBeNull();
 });
 it.each([
  {startDate:'invalid',endDate:'invalid'},
  {startDate:undefined,endDate:'2026-08-02T17:00'},
  {startDate:'2026-02-30T09:00',endDate:'2026-03-02T17:00'},
  {startDate:'2026-09-01T09:00',endDate:'2026-07-01T17:00'},
 ])('unlocatable or invalid approved leave remains a source issue (%j)',patch=>{
  const request={...leave('2026-08-02'),approver:'SYNTH-APPROVER',approvalDate:'2026-08-03T00:00:00Z',...patch};
  const result=preview([], [request]);
  expect(result.status).toBe('needs-review');expect(result.amount).toBeNull();expect(result.issues.join()).toContain('假單日期／期間來源無效');
 });
 it.each(['駁回','已取消','已取代'])('terminal %s leave with unusable dates supplies no pay and does not block normal scope',status=>{
  const result=preview([],[{...leave(),status,startDate:undefined,endDate:'invalid'}]);
  expect(result.status,result.issues.join()).toBe('ready');expect(result.amount).toBe('30000.00');
 });
 it('a valid approved leave wholly outside the month remains excluded',()=>{
  const result=preview([],[{...leave('2026-07-01'),approver:'SYNTH-APPROVER',approvalDate:'2026-07-02T00:00:00Z'}]);
  expect(result.status).toBe('ready');expect(result.amount).toBe('30000.00');
 });
 it.each([
  {reviewedAt:'invalid'},{reviewedAt:{}},{reviewedBy:{}},{reviewedBy:' '},
 ])('malformed actual-work approval metadata cannot produce ready hourly pay (%j)',patch=>{
  const c=card('2026-08-01');Object.assign(c.workReview!,patch);
  const e={...monthly(),payBasis:'hourly',hourlyRate:200,normalPayDays:normalDays(month,{payBasis:'hourly',amount:'200'}),payrollReview:{...monthly().payrollReview,payBasis:'hourly'}};
  const result=calculateSalaryForEmployee(e as any,month,[],[c],[]).normalPayPreview!;
  expect(result.status).toBe('needs-review');expect(result.amount).toBeNull();expect(result.issues.join()).toContain('實際工作／休息來源未核定');
 });
 it.each([{date:undefined},{date:null},{date:'invalid'},{date:'2026-02-30'}])('invalid/missing card dates fail closed without a startsWith exception (%j)',patch=>{
  const c={...card(),...patch};
  const result=preview([c]);
  expect(result.status).toBe('needs-review');expect(result.amount).toBeNull();expect(result.issues.join()).toContain('打卡日期來源無效');
 });
 it.each([{approvalDate:'invalid'},{payrollReviewedAt:{}},{approver:' '}])('approved leave metadata is validated before it becomes a string proof (%j)',patch=>{
  const request={...leave('2026-08-02'),approver:'SYNTH-APPROVER',approvalDate:'2026-08-03T00:00:00Z',payrollReviewedBy:'SYNTH-MANAGER',payrollReviewedAt:'2026-08-03T00:00:00Z',...patch};
  const result=preview([],[request]);expect(result.status).toBe('needs-review');expect(result.amount).toBeNull();
 });
});
