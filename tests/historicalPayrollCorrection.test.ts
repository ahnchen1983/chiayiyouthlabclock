import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({loaded:null as any}));
// The original-snapshot loader is a unit boundary; its hash/Firestore coverage
// belongs to payrollSourceReader tests. All correction calculations are real.
vi.mock('../netlify/functions/utils/payrollSourceReader',()=>({loadPayrollMonthSource:vi.fn(async()=>state.loaded)}));
import {calculateFrozenHistoricalRateCorrection,validateHistoricalRateCorrection,validHistoricalCorrectedSource} from '../netlify/functions/utils/frozenHistoricalPayroll';
import {handleHistoricalPayrollCorrectionAction as handle,loadApprovedHistoricalPayrollCorrection as load} from '../netlify/functions/utils/historicalPayrollCorrection';
import {calculateSalaryForEmployee} from '../netlify/functions/utils/payroll';
import {normalDays} from './fixtures/normalPay';
import {employee,review} from './fixtures/payrollV2';
import {UserRole} from '../types';
import {evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';
const month='2026-08',at='2026-10-01T00:00:00Z';
const proof=()=>({sourceRefs:['SYNTH-CONTRACT'],authorityOccurredAt:'2026-07-01T00:00:00Z',reason:'Synthetic historical contractual evidence'});
const correction=(amount='50000',extra:Record<string,unknown>={})=>({rates:[{...proof(),from:month+'-01',to:month+'-31',payBasis:'monthly',amount,originalPayVersion:'synthetic-master-v1'}],insuranceUnchanged:{...proof(),sourceRefs:['SYNTH-ENROLLMENT'],reason:'Synthetic explicit verification enrollment remains unchanged'},...extra});
const retainCash=()=>({paymentAllocationDisposition:{mode:'retain-original-cash' as const,...proof(),sourceRefs:['SYNTH-ALLOC-RETAIN'],reason:'Synthetic retain original cash allocation; corrected target is comparison only'}});
function original(){
 const days=normalDays(month,{amount:'40000'}),context=[...normalDays('2026-07',{amount:'40000'}).slice(-6),...normalDays('2026-09',{amount:'40000'}).slice(0,6)].map(d=>({...d,covered:true}));
 for(const d of [...days,...context]){(d.policy as any).overtimeRules={schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240};d.policy!.rounding.precision=0;}
 const emp={...employee,payBasis:'monthly',monthlySalary:40000,effectiveMasterVersion:'SYNTH-MASTER',masterAssessment:{issues:[]},normalPayDays:days,normalPayContextDays:context,normalPayCompEvidence:{intervals:[],credits:[],outstanding:[],issues:[]},payrollReview:{...review,yearMonth:month,payBasis:'monthly',policy:{...review.policy,moneyDecimals:0}},insuranceSource:{versionId:'SYNTH-INS',evidenceVersion:'SYNTH-INS-HASH'},insurancePeriods:[{from:month+'-01',to:month+'-31',laborInsured:false,laborSalary:0,employmentInsured:false,healthInsuredHere:true,healthAmount:29500,healthDependants:0,pensionWage:0,pensionSelfPercent:0,withholdingMethod:'flat-5'}]};
 const inventory={schemaVersion:'payroll-item-inventory-v1',id:'SYNTH-ITEM',empId:employee.id,month,revision:2,status:'approved',inventory:{empId:employee.id,month,mode:'none',items:[],sourceRefs:['SYNTH-NONE'],reason:'Synthetic complete inventory none'},proposedBy:'A',proposedAt:'2026-09-01T00:00:00Z',approvedBy:'B',approvedAt:'2026-09-02T00:00:00Z',reviewedBy:'B',reviewedAt:'2026-09-02T00:00:00Z',history:[{actor:'A',at:'2026-09-01T00:00:00Z',to:'proposed',revision:1,reason:'Synthetic proposal'},{actor:'B',at:'2026-09-02T00:00:00Z',to:'approved',revision:2,reason:'Synthetic review'}],approvalScope:'recorded-evidence-only',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'unresolved'};
 const salary={...calculateSalaryForEmployee(emp,month,[],[],[]),calculationStatus:'locked'};
 return {kind:'locked',completeness:'complete',originalInputHash:'SYNTH-INPUT',sourceHash:'SYNTH-SOURCE',lock:{yearMonth:month,payrollRunId:'SYNTH-RUN'},salaries:[salary],run:{id:'SYNTH-RUN',yearMonth:month,calculationVersion:'payroll-v2-review',inputs:{employees:[emp],records:[],leaves:[],schedules:[]},salaries:[salary],sourceEvidence:{itemInventories:{[employee.id]:{version:inventory,source:{id:inventory.id,revision:2}}}}}} as any;
}
describe('frozen original rate correction calculation',()=>{
 it('recalculates gross and withholding from explicit rate facts without changing original',()=>{
  const input=original(),before=JSON.stringify(input),r=calculateFrozenHistoricalRateCorrection(input,employee.id,correction(),at);
  expect(r.status,r.issues.join()).toBe('calculated');expect(r.salary.grossSalary).toBe(50000);expect(r.salary.incomeTax).toBe(2500);expect(r.salary.netSalary).toBe(47042);
  expect(input.salaries[0].grossSalary).toBe(40000);expect(input.salaries[0].incomeTax).toBe(0);expect(JSON.stringify(input)).toBe(before);
  expect(validHistoricalCorrectedSource(r.source,r.bundleHash)).toBe(true);expect(r).toMatchObject({formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});
 });
 it('rejects client target results and unsupported input fields',()=>{for(const field of ['target','employee','incomeTax','approved'])expect(()=>validateHistoricalRateCorrection({...correction(),[field]:50000},month,at)).toThrow();});
 it('rejects overlapping, outside-month and future-event rate claims',()=>{
  const overlap=correction();overlap.rates.push({...overlap.rates[0]});expect(()=>validateHistoricalRateCorrection(overlap,month,at)).toThrow();
  const outside=correction();outside.rates[0].from='2026-07-31';expect(()=>validateHistoricalRateCorrection(outside,month,at)).toThrow();
  const future=correction();future.insuranceUnchanged.authorityOccurredAt='2026-12-01T00:00:00Z';expect(()=>validateHistoricalRateCorrection(future,month,at)).toThrow();
 });
 it.each(['pay-version','basis','payment-allocation','items','comp','insurance'])('holds unsupported affected evidence: %s',kind=>{
  const input=original(),c=correction(),e=input.run.inputs.employees[0];
  if(kind==='pay-version')c.rates[0].originalPayVersion='OTHER';if(kind==='basis')c.rates[0].payBasis='hourly';
  if(kind==='payment-allocation')input.run.sourceEvidence.paymentAllocations={[employee.id]:{result:{status:'ready'}}};
  if(kind==='items')delete input.run.sourceEvidence.itemInventories[employee.id];
  if(kind==='comp')e.normalPayCompEvidence.credits=[{id:'SYNTH'}];if(kind==='insurance')delete e.insuranceSource;
  const r=calculateFrozenHistoricalRateCorrection(input,employee.id,c,at);expect(r.status).toBe('needs-review');expect(r.source.totals.net).toBeNull();
 });
 it('does not reconstruct missing or legacy original source',()=>{const input=original();input.completeness='legacy-inputs-only';expect(()=>calculateFrozenHistoricalRateCorrection(input,employee.id,correction(),at)).toThrow();});
 it('calculates with explicit retain-original-cash when payment allocation exists',()=>{
  const input=original();input.run.sourceEvidence.paymentAllocations={[employee.id]:{result:{status:'ready'}}};
  const r=calculateFrozenHistoricalRateCorrection(input,employee.id,correction('50000',retainCash()),at);
  expect(r.status,r.issues.join()).toBe('calculated');expect(r.adapterVersion).toBe('historical-rate-correction-payment-retain-v1');
  expect(r.salary.grossSalary).toBe(50000);expect(r).toMatchObject({formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});
  expect(input.salaries[0].grossSalary).toBe(40000);
 });
 it('still needs review when allocation exists without disposition',()=>{
  const input=original();input.run.sourceEvidence.paymentAllocations={[employee.id]:{result:{status:'ready'}}};
  const r=calculateFrozenHistoricalRateCorrection(input,employee.id,correction(),at);
  expect(r.status).toBe('needs-review');expect(r.issues).toContain('historical-payment-allocation-rebinding-required');
 });
 it('rejects retain disposition when no allocation exists',()=>{
  const input=original(),r=calculateFrozenHistoricalRateCorrection(input,employee.id,correction('50000',retainCash()),at);
  expect(r.status).toBe('needs-review');expect(r.issues).toContain('historical-payment-allocation-disposition-without-allocation');
 });
 it('rejects unknown paymentAllocationDisposition mode',()=>{
  expect(()=>validateHistoricalRateCorrection(correction('50000',{paymentAllocationDisposition:{mode:'rebinding',...proof(),sourceRefs:['X'],reason:'Synthetic'}}),month,at)).toThrow();
 });
});

const records=new Map<string,any>(),writes:string[]=[];
const copy=(v:any)=>v===undefined?undefined:structuredClone(v);
const reader={get:async(ref:any)=>({exists:records.has(ref.path),data:()=>copy(records.get(ref.path))}),create:(ref:any,v:any)=>{if(records.has(ref.path))throw Error('duplicate create');writes.push(ref.path);records.set(ref.path,copy(v));},set:(ref:any,v:any)=>{writes.push(ref.path);records.set(ref.path,copy(v));}};
const db={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id})}),runTransaction:async(fn:any)=>fn(reader)};
const cmd=(action:string,uid:string,extra:any={})=>handle(db,uid,action,{empId:employee.id,month,...extra});
const propose=()=>cmd('propose-historical-payroll-correction','A',{expectedRevision:0,operationId:'SYNTH-P',reason:'Synthetic correction proposal',correction:correction()});
const approve=(revision=1)=>cmd('review-historical-payroll-correction','B',{expectedRevision:revision,operationId:'SYNTH-R',reason:'Synthetic independent rate review',mode:'approve'});
const adopt=(revision=2)=>cmd('adopt-historical-payroll-correction','C',{expectedRevision:revision,operationId:'SYNTH-A',reason:'Synthetic independent target adoption'});
beforeEach(()=>{state.loaded=original();records.clear();writes.length=0;for(const id of ['A','B','C'])records.set('employees/'+id,{id,role:UserRole.SuperAdmin});records.set('employees/'+employee.id,{id:employee.id,role:UserRole.Employee});});
describe('independent frozen target workflow',()=>{
 it('reviews/adopts a separate target and serves exact receipt without original writes',async()=>{
  const p=await propose();await approve();const a=await adopt(),replayed=await propose();expect(replayed).toEqual(p);
  const get=await cmd('get-historical-payroll-correction','A'),loaded=await load(db,reader,{empId:employee.id,month,at,correctionRef:get.correctionRef});
  expect(a.status).toBe('adopted');expect(loaded.source.totals.gross).toBe('50000');expect(loaded.authors).toEqual(['A']);expect(loaded.original.runId).toBe('SYNTH-RUN');
  expect(writes.every(path=>path.startsWith('historicalPayrollCorrection')||path==='payrollControl/revision')).toBe(true);expect(state.loaded.salaries[0].grossSalary).toBe(40000);
 });
 it('forbids self/historical-author review',async()=>{await propose();await expect(cmd('review-historical-payroll-correction','A',{expectedRevision:1,operationId:'SELF',reason:'Synthetic forbidden self review',mode:'approve'})).rejects.toThrow();});
 it('refuses approval after original source changes while allowing explicit return',async()=>{await propose();state.loaded.run.inputs.employees[0].normalPayDays[0].amount='41000';await expect(approve()).rejects.toThrow();const r=await cmd('review-historical-payroll-correction','B',{expectedRevision:1,operationId:'RETURN',reason:'Synthetic stale source return',mode:'return'});expect(r.status).toBe('returned');});
 it('holds altered references and missing immutable versions on consumption',async()=>{await propose();await approve();await adopt();const get=await cmd('get-historical-payroll-correction','A');await expect(load(db,reader,{empId:employee.id,month,at,correctionRef:{...get.correctionRef,calculatorVersion:'fake'}})).rejects.toThrow();records.delete('historicalPayrollCorrectionVersions/'+get.current.id+'_1');await expect(load(db,reader,{empId:employee.id,month,at,correctionRef:get.correctionRef})).rejects.toThrow();});
 it('does not allow incomplete calculation to advance to review',async()=>{state.loaded.run.sourceEvidence.paymentAllocations={[employee.id]:{result:{status:'ready'}}};const p=await propose();expect(p.assessment.status).toBe('needs-review');await expect(approve()).rejects.toThrow();});
 it('reviews retain-original-cash target when allocation exists with disposition',async()=>{
  state.loaded.run.sourceEvidence.paymentAllocations={[employee.id]:{result:{status:'ready'}}};
  const withRetain=()=>cmd('propose-historical-payroll-correction','A',{expectedRevision:0,operationId:'SYNTH-P-RETAIN',reason:'Synthetic retain cash correction proposal',correction:correction('50000',retainCash())});
  const p=await withRetain();expect(p.assessment.status).toBe('calculated');expect(p.assessment.adapterVersion).toBe('historical-rate-correction-payment-retain-v1');
  await approve();const a=await adopt();expect(a.status).toBe('adopted');
  expect(writes.every(path=>path.startsWith('historicalPayrollCorrection')||path==='payrollControl/revision')).toBe(true);
  expect(state.loaded.salaries[0].grossSalary).toBe(40000);
 });
 it('rejects corrupted receipt result even when command hash is unchanged',async()=>{const p=await propose(),key=[...records.keys()].find(k=>k.startsWith('historicalPayrollCorrectionCommands/'))!;records.get(key).result.assessment.source.totals.gross='1';await expect(propose()).rejects.toThrow();expect(p.assessment.source.totals.gross).toBe('50000');});
});
