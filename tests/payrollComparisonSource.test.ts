import {describe,it,expect} from 'vitest';
import {projectPayrollComparisonSource} from '../netlify/functions/utils/payrollComparisonSource';
import {comparePayrollAmounts} from '../utils/payroll/comparison';
import {insuranceForMonth} from '../utils/payroll/insurance';
const f=(numerator:string,denominator='1')=>({numerator,denominator});
const refs=[{kind:'payroll-inputs',id:'SYNTH',version:'hash-1'},{kind:'insurance-timeline',id:'INS',version:'1'},{kind:'payroll-item-inventory',id:'pi_demo',version:'2'}];
const inventory=():any=>({schemaVersion:'payroll-item-inventory-v1',id:'pi_demo',empId:'E1',month:'2026-08',revision:2,status:'approved',inventory:{empId:'E1',month:'2026-08',mode:'none',sourceRefs:['DEMO'],reason:'Synthetic verified inventory',items:[]},proposedBy:'A1',proposedAt:'2026-09-01T00:00:00Z',approvedBy:'A2',approvedAt:'2026-09-01T01:00:00Z',reviewedBy:'A2',reviewedAt:'2026-09-01T01:00:00Z',history:[{actor:'A1',at:'2026-09-01T00:00:00Z',to:'proposed',revision:1,reason:'Synthetic inventory proposal'},{actor:'A2',at:'2026-09-01T01:00:00Z',to:'approved',revision:2,reason:'Synthetic inventory review'}],approvalScope:'recorded-evidence-only',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'unresolved'});
const salary=():any=>({empId:'E1',yearMonth:'2026-08',calculationVersion:'test-v1',calculationStatus:'ready',reviewReasons:[],baseSalary:30000,overtimePay:333,compSettlementPay:0,grossSalary:30333,laborInsurance:738,healthInsurance:458,laborPensionSelf:0,incomeTax:0,supplementaryPremium:0,leaveDeduction:0,totalDeductions:1196,netSalary:29137,
 normalPayPreview:{employeeId:'E1',month:'2026-08',status:'ready',issues:[],exactTotal:f('30000'),segments:[{employeeId:'E1',date:'2026-08-01',start:null,end:null,minutes:null,kind:'monthly-base',payVersion:'MASTER',policyId:'POLICY',policyVersion:'P1',sourceIds:['MASTER'],exact:f('30000'),rounded:null}],rounding:{version:'R',status:'approved',approvedBy:'A',approvedAt:'2026-01-01T00:00:00Z',stage:'final',precision:0,mode:'half-up'},combined:{status:'ready',issues:[],normalExact:f('30000'),overtimeExact:f('1000','3'),compSettlementExact:null,exactTotal:f('91000','3'),amount:'30333'},overtimePreview:{version:'overtime-c2b1',status:'candidate',formalEligibility:'BLOCKED',blocking:[],issues:[],monthExact:f('1000','3'),lines:[{workdayId:'DAY',date:'2026-08-01',dayType:'normal',start:100,end:160,minutes:60,kind:'weekday-overtime',basisId:'MASTER',basisVersion:'1',hourlyBasis:f('250'),multiplier:f('4','3'),exact:f('1000','3'),sourceIds:['CARD'],sourceVersions:['1']}]},compSettlement:{items:[],exact:f('0'),issues:[]}},
 insuranceDetail:{status:'ready',issues:[],labor:738,health:458,pensionSelf:0,lines:[{item:'labor',amount:679,exact:f('1357','2')},{item:'employment',amount:59,exact:f('59')},{item:'health',amount:458,exact:f('458')}]},
 withholdingDetail:{status:'ready',issues:[],incomeTax:0,supplementaryPremium:0}});
const run=(s=salary(),sources=refs,items:any=inventory())=>projectPayrollComparisonSource({salary:s,sources,inventory:items});
describe('server comparison projection is evidence only',()=>{
 it('preserves exact fractions and existing rounded allocation without rounding again',()=>{const r=run();expect(r.lines.find(l=>l.code==='overtime')).toMatchObject({exact:f('1000','3'),amount:'333'});expect(r.lines.find(l=>l.code==='insurance:labor')).toMatchObject({exact:f('1357','2'),amount:'679'});expect(r.lines.find(l=>l.code==='insurance:employment')?.amount).toBe('59');expect(r.totals.net).toBe('29137');expect(r).toMatchObject({formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});});
 it('does not turn unresolved withholding placeholder zero into a confirmed zero',()=>{const s=salary();s.withholdingDetail.status='needs-review';s.withholdingDetail.issues=['payment evidence missing'];s.calculationStatus='needs-review';s.incomeTax=null;s.supplementaryPremium=null;const r=run(s);expect(r.lines.find(l=>l.code==='tax:income')).toMatchObject({status:'needs-review',amount:null,exact:null});expect(r.totals.net).toBeNull();});
 it('retains converted noncash overtime without including it in cash comparison',()=>{const s=salary();s.normalPayPreview.overtimePreview.lines.push({...s.normalPayPreview.overtimePreview.lines[0],kind:'comp-converted',exact:null});expect(run(s).totals.net).toBe('29137');});
 it('rejects corrupted component evidence shape rather than throwing',()=>{const s=salary();s.normalPayPreview.compSettlement.items=null;expect(()=>run(s)).not.toThrow();expect(run(s).totals.net).toBeNull();});
 it('requires insurance version identity even when numbers are present',()=>{const r=run(salary(),refs.slice(0,1));expect(r.lines.find(l=>l.code==='insurance:health')).toMatchObject({status:'needs-review',amount:null});});
 it('holds malformed fractions and component/aggregate inconsistencies without throwing',()=>{for(const mutate of [(s:any)=>s.normalPayPreview.combined.overtimeExact=f('1','0'),(s:any)=>s.insuranceDetail.labor=999,(s:any)=>s.netSalary=1]){const s=salary();mutate(s);let r:any;expect(()=>r=run(s)).not.toThrow();expect(r.issues.length).toBeGreaterThan(0);expect(r.totals.net).toBeNull();}});
 it('rejects a changed normal/OT allocation even when gross and net are unchanged',()=>{const s=salary();s.baseSalary=29999;s.overtimePay=334;const r=run(s);expect(r.status).toBe('needs-review');expect(r.totals.net).toBeNull();});
 it('rejects a consistently changed displayed gross when approved final rounding disagrees',()=>{const s=salary();s.normalPayPreview.combined.amount='30334';s.grossSalary=30334;s.baseSalary=30001;s.netSalary=29138;const r=run(s);expect(r.status).toBe('needs-review');expect(r.totals.net).toBeNull();});
 it.each([null,undefined])('missing insurance lines cannot become confirmed zero: %s',value=>{const s=salary();s.insuranceDetail.lines=value;s.insuranceDetail.labor=0;s.insuranceDetail.health=0;s.insuranceDetail.pensionSelf=0;s.laborInsurance=0;s.healthInsurance=0;s.laborPensionSelf=0;s.totalDeductions=0;s.netSalary=s.grossSalary;const r=run(s);expect(r.lines.find(l=>l.code==='insurance:labor')?.status).toBe('needs-review');expect(r.totals.net).toBeNull();});
 it('rejects redistributed statutory rounded insurance amounts even if their aggregate matches',()=>{const s=salary();s.insuranceDetail.lines[0].amount=678;s.insuranceDetail.lines[1].amount=60;const r=run(s);expect(r.status).toBe('needs-review');expect(r.totals.net).toBeNull();});
 it('accepts real engine health evidence with per-person rounding before dependant multiplication',()=>{const s=salary();const ins=insuranceForMonth('2026-08',[{from:'2026-08-01',to:'2026-08-31',laborInsured:true,laborSalary:29500,employmentInsured:true,healthInsuredHere:true,healthAmount:29500,healthDependants:2,pensionWage:0,pensionSelfPercent:0,withholdingMethod:'table'}]);s.insuranceDetail=ins;s.laborInsurance=ins.labor;s.healthInsurance=ins.health;s.laborPensionSelf=ins.pensionSelf;s.totalDeductions=ins.labor+ins.health+ins.pensionSelf;s.netSalary=s.grossSalary-s.totalDeductions;expect(ins.health).toBe(1374);expect(run(s).totals.net).toBe(String(s.netSalary));});
 it('changes source identity when source evidence changes and excludes employee names',()=>{const a=run(),s=salary();s.name='Private synthetic name';expect(run(s).sourceHash).toBe(a.sourceHash);expect(run(s,[...refs.slice(0,1),{...refs[1],version:'2'}]).sourceHash).not.toBe(a.sourceHash);expect(JSON.stringify(a)).not.toContain('Private synthetic name');});
 it('does not count leave deductions twice inside master normal pay',()=>{const s=salary();s.leaveDeduction=50;const r=run(s);expect(r.issues.join()).toContain('假別');expect(r.totals.net).toBeNull();});
 it('does not infer empty compensation evidence as confirmed zero',()=>{const s=salary();delete s.normalPayPreview.compSettlement;expect(run(s).lines.find(l=>l.code==='comp-settlement')).toMatchObject({status:'needs-review',exact:null,amount:null});});
 it('keeps missing generic item inventory distinct from confirmed none',()=>{expect(run(salary(),refs,null).inventoryStatus).toBe('missing');expect(run(salary(),refs,null).issues.join()).toContain('清冊');expect(run().inventoryStatus).toBe('confirmed-none');});
 it('records classified-as-unresolved generic items but never adds them to payroll totals',()=>{const inv=inventory();inv.inventory.mode='items';inv.inventory.items=[{itemCode:'bonus',kind:'earning',amount:'50',from:'2026-08-01',to:'2026-08-31',sourceRefs:['DEMO-BONUS'],reason:'Synthetic bonus evidence'}];const r=run(salary(),refs,inv);expect(r.lines.find(l=>l.code==='item:bonus')).toMatchObject({status:'unclassified',amount:null,recordedAmount:'50'});expect(r.totals.net).toBeNull();});
 it('does not silently accept legacy salary without exact component evidence',()=>{const s=salary();delete s.normalPayPreview;const r=run(s);expect(r.lines.find(l=>l.code==='normal')).toMatchObject({status:'needs-review',exact:null,amount:null});});
});
describe('manual comparison arithmetic',()=>{
 it('uses exact decimals for signed differences and preserves explicit zero',()=>{expect(comparePayrollAmounts('0','0')).toEqual({status:'comparable',delta:f('0')});expect(comparePayrollAmounts('1.10','1.20')).toEqual({status:'comparable',delta:f('-1','10')});});
 it('unknown or invalid amounts never become zero difference',()=>{for(const value of [null,undefined,'NaN','1e3','-1'] as any[])expect(comparePayrollAmounts(value,'0')).toEqual({status:'unresolved',delta:null});});
});

describe('approved fixed item comparison application',()=>{
 const applied=()=>{
  const s=salary(),inv=inventory();
  inv.inventory.mode='items';inv.inventory.items=[
   {itemCode:'fixed',kind:'earning',amount:'0.5',from:'2026-08-01',to:'2026-08-31',sourceRefs:['AUTH-E'],reason:'Synthetic explicit fixed earning'},
   {itemCode:'authorized',kind:'deduction',amount:'1.5',from:'2026-08-01',to:'2026-08-31',sourceRefs:['AUTH-D'],reason:'Synthetic authorized deduction'}];
  s.itemApplication={status:'ready',issues:[],source:{id:'EXEC',revision:2,evidenceVersion:'EXEC-HASH'},lines:inv.inventory.items.map((i:any)=>({...i,code:'item:'+i.itemCode,exact:i.kind==='earning'?f('1','2'):f('3','2'),recipe:i.kind==='earning'?'fixed-taxable-earning':'fixed-posttax-deduction',appliedAmount:i.kind==='earning'?'1':'2'})),earningsExact:f('1','2'),deductionsExact:f('3','2'),earningsAmount:'1',deductionsAmount:'2',grossExact:f('182003','6'),applicationStatus:'calculated-not-posted',paymentStatus:'not-paid'};
  s.grossSalary=30334;s.totalDeductions=1198;s.netSalary=29136;
  return {s,inv,sources:[...refs,{kind:'payroll-item-execution',id:'EXEC',version:'EXEC-HASH'}]};
 };
 it('uses cumulative allocated amounts, retaining exact nominal earning and deduction evidence',()=>{
  const {s,inv,sources}=applied(),r=run(s,sources,inv);
  expect(r.status).toBe('comparable');expect(r.totals).toEqual({gross:'30334',deductions:'1198',net:'29136'});
  expect(r.lines.find(l=>l.code==='item:authorized')).toMatchObject({amount:'2',recordedAmount:'1.5',exact:f('3','2')});
  expect(s.normalPayPreview.combined.amount).toBe('30333');
  expect(r).toMatchObject({formalEligibility:'BLOCKED',paymentStatus:'not-paid',applicationStatus:'not-applied'});
 });
 it.each(['missing-source','wrong-source','amount','period','exact','duplicate','gross-exact','earning-total','deduction-total','incorrect-net-rounding','redistribute'])('holds invalid application: %s',kind=>{
  const {s,inv,sources}=applied();
  if(kind==='missing-source')sources.pop();
  if(kind==='wrong-source')s.itemApplication.source.evidenceVersion='OTHER';
  if(kind==='amount')s.itemApplication.lines[0].amount='50';
  if(kind==='period')s.itemApplication.lines[0].from='2026-08-02';
  if(kind==='exact')s.itemApplication.lines[0].exact=f('1');
  if(kind==='duplicate')s.itemApplication.lines[1]=s.itemApplication.lines[0];
  if(kind==='gross-exact')s.itemApplication.grossExact=f('30334');
  if(kind==='earning-total')s.itemApplication.earningsExact=f('1');
  if(kind==='deduction-total')s.itemApplication.deductionsExact=f('1');
  if(kind==='incorrect-net-rounding'){s.itemApplication.lines[1].appliedAmount='1';s.itemApplication.deductionsAmount='1';s.totalDeductions=1197;s.netSalary=29137;}
  if(kind==='redistribute'){s.baseSalary--;s.itemApplication.lines[0].appliedAmount='2';s.itemApplication.earningsAmount='2';}
  const r=run(s,sources,inv);expect(r.status).toBe('needs-review');expect(r.totals.net).toBeNull();
 });
 it('cannot silently drop a recorded item when application evidence is absent',()=>{const {s,inv,sources}=applied();delete s.itemApplication;expect(run(s,sources,inv).totals.net).toBeNull();});
});
