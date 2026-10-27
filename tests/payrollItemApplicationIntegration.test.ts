import {describe,it,expect} from 'vitest';
import {calculateSalaryForEmployee} from '../netlify/functions/utils/payroll';
import {assessItemExecutionPolicy} from '../utils/payroll/itemApplication';
import {ITEM_TREATMENT_PURPOSES} from '../utils/payroll/itemTreatment';
import {normalDays} from './fixtures/normalPay';
import {employee,review,card} from './fixtures/payrollV2';
import type {WithholdingResult} from '../utils/payroll/withholding';

// Synthetic unit boundary: real normal/OT/comp/insurance/item calculators run.
// Payment-event verification is intentionally supplied at the calculator's
// internal resolved-withholding boundary; API/Firestore tests own that binding.
const month='2026-08';
const withholding:WithholdingResult={status:'ready',issues:[],method:'part-time-5',incomeTax:0,supplementaryPremium:0,exemptOvertime:{numerator:'0',denominator:'1'},taxableBase:{numerator:'0',denominator:'1'},supplementaryBase:{numerator:'0',denominator:'1'}};
const f=(numerator:string,denominator='1')=>({numerator,denominator});
const rules={schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240};
function person(amount='1000',basis:'monthly'|'hourly'='monthly'):any {
 const days=normalDays(month,{amount,payBasis:basis}),context=[...normalDays('2026-07',{amount,payBasis:basis}).slice(-6),...normalDays('2026-09',{amount,payBasis:basis}).slice(0,6)].map(d=>({...d,covered:true}));
 for(const day of [...days,...context]){(day.policy as any).overtimeRules={...rules};day.policy!.rounding!.precision=0;}
 return {...employee,payBasis:basis,monthlySalary:Number(amount),hourlyRate:Number(amount),effectiveMasterVersion:'SYNTH-MASTER',masterAssessment:{issues:[]},normalPayDays:days,normalPayContextDays:context,normalPayCompEvidence:{intervals:[],issues:[],credits:[],outstanding:[]},
  payrollReview:{...review,yearMonth:month,payBasis:basis,policy:{...review.policy,moneyDecimals:0,regularDates:days.map(d=>d.date)}},
  insurancePeriods:[{from:month+'-01',to:month+'-31',laborInsured:false,laborSalary:0,employmentInsured:false,healthInsuredHere:false,healthAmount:0,healthDependants:0,pensionWage:0,pensionSelfPercent:0,withholdingMethod:'part-time-5'}]};
}
function attach(emp:any,earning:string|null,deduction:string|null){
 const items=[...(earning===null?[]:[{itemCode:'EXTRA',kind:'earning',amount:earning}]),...(deduction===null?[]:[{itemCode:'AUTHORIZED',kind:'deduction',amount:deduction}])].map(i=>({...i,from:month+'-01',to:month+'-31',sourceRefs:['SYNTH-AUTHORITY-'+i.itemCode],reason:'Synthetic explicitly fixed entitlement or deduction'}));
 const inventory={empId:employee.id,month,mode:'items',items,sourceRefs:['SYNTH-INVENTORY'],reason:'Synthetic approved inventory'};
 const policy={sourceRefs:['SYNTH-POLICY'],reason:'Synthetic reviewed bounded execution',items:items.map(i=>({itemCode:i.itemCode,recipe:i.kind==='earning'?'fixed-taxable-earning':'fixed-posttax-deduction',normalWage:'excluded-by-reviewed-evidence',incomeTax:i.kind==='earning'?'included':'not-applicable',supplementaryPremium:i.kind==='earning'?'included':'not-applicable',insuranceReporting:i.kind==='earning'?'confirmed-timeline':'not-applicable',deductionAuthority:i.kind==='earning'?'not-applicable':'authorized',reason:'Synthetic independent treatment decision',evidence:ITEM_TREATMENT_PURPOSES.map(purpose=>({purpose,status:'documented',sourceRefs:['SYNTH-PROOF-'+purpose],reason:'Synthetic authority applicable to complete item period',authorityOccurredAt:'2026-07-01T00:00:00Z',effectiveFrom:month+'-01',effectiveTo:month+'-31'}))}))};
 const assessment=assessItemExecutionPolicy(policy,inventory,{insuranceConfirmed:true});
 expect(assessment.status,assessment.issues.join()).toBe('ready');
 emp.payrollItemExecution={approved:true,stale:false,issues:[],assessment,source:{id:'SYNTH-EXECUTION',revision:2,evidenceVersion:'SYNTH-EXECUTION-HASH'}};
 return emp;
}
const pay=(emp:any,cards:any[]=[])=>calculateSalaryForEmployee(emp,month,[],cards,[],undefined,withholding);
const ready=(s:ReturnType<typeof pay>)=>expect(s.calculationStatus,s.reviewReasons.join()).toBe('ready');

describe('fixed items through actual salary calculation',()=>{
 it('adds approved earnings and authorized posttax deductions to real totals',()=>{
  const s=pay(attach(person(),'100','20'));ready(s);
  expect(s).toMatchObject({baseSalary:1000,overtimePay:0,compSettlementPay:0,grossSalary:1100,totalDeductions:20,netSalary:1080});
  expect(s.itemApplication).toMatchObject({status:'ready',earningsExact:f('100'),deductionsExact:f('20'),grossExact:f('1100'),earningsAmount:'100',deductionsAmount:'20',applicationStatus:'calculated-not-posted',paymentStatus:'not-paid'});
  expect(s.normalPayPreview!.combined!.amount).toBe('1000');
 });
 it('rounds exact net 1000 minus 1.5 to 999, never rounds the deduction to 2 first',()=>{
  const s=pay(attach(person(),null,'1.5'));ready(s);
  expect(s).toMatchObject({grossSalary:1000,totalDeductions:1,netSalary:999});
  expect(s.itemApplication!.lines[0]).toMatchObject({amount:'1.5',exact:f('3','2'),appliedAmount:'1'});
 });
 it('keeps approved taxable additions separate from unchanged normal wage and cumulative fractions',()=>{
  const s=pay(attach(person(),'0.5','1.5'));ready(s);
  expect(s).toMatchObject({baseSalary:1000,grossSalary:1001,totalDeductions:2,netSalary:999});
  expect(s.itemApplication!.grossExact).toEqual(f('2001','2'));
 });
 it('adds items once without counting overtime or expiring comp settlement twice',()=>{
  const emp=person('200','hourly'),start=Date.parse('2026-07-01T16:00:00+08:00')/60000;
  emp.normalPayCompEvidence.outstanding=[{id:'SYNTH-LOT',start,end:start+60,deadline:'2026-08-31',untakenMinutes:60,originalWageBasis:{status:'confirmed',tiers:[{start,end:start+60,minutes:60,kind:'weekday-overtime',hourlyBasis:f('200'),multiplier:f('4','3')}]}}];
  const cards=[card('2026-08-03','08:00','17:00')],base=pay(emp,cards);ready(base);
  const s=pay(attach(emp,'100','20'),cards);ready(s);
  expect(base).toMatchObject({baseSalary:1600,overtimePay:267,compSettlementPay:266,grossSalary:2133,netSalary:2133});
  expect(s).toMatchObject({baseSalary:1600,overtimePay:267,compSettlementPay:266,grossSalary:2233,totalDeductions:20,netSalary:2213});
  expect(s.normalPayPreview!.combined).toEqual(base.normalPayPreview!.combined);
 });
 it('holds negative exact net instead of publishing a negative wage or automatic recovery',()=>{
  const s=pay(attach(person(),null,'1000.01'));
  expect(s.calculationStatus).toBe('needs-review');expect(s.netSalary).toBeNull();expect(s.grossSalary).toBeNull();expect(s.itemApplication!.status).toBe('needs-review');
  expect(s.reviewReasons.join()).toContain('不能產生負數薪資或自動追扣');
 });
 it.each(['pending','stale','unresolved'])('holds item money when execution is %s',state=>{
  const emp=attach(person(),'100','20');
  if(state==='pending')emp.payrollItemExecution.approved=false;
  if(state==='stale')emp.payrollItemExecution.stale=true;
  if(state==='unresolved')emp.payrollItemExecution.assessment={...emp.payrollItemExecution.assessment,status:'needs-review',issues:['Synthetic missing authority']};
  const s=pay(emp);expect(s.calculationStatus).toBe('needs-review');expect(s.grossSalary).toBeNull();expect(s.netSalary).toBeNull();expect(s.itemApplication!.status).toBe('needs-review');expect(s.itemApplication!.lines).toEqual([]);
 });
 it('does not permit item execution to hide an unapproved work source',()=>{
  const emp=attach(person('200','hourly'),'100',null),s=pay(emp,[card('2026-08-03','08:00','17:00',false)]);
  expect(s.calculationStatus).toBe('needs-review');expect(s.netSalary).toBeNull();expect(s.itemApplication!.status).toBe('needs-review');
 });
});
