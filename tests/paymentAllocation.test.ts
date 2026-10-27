import {describe,it,expect} from 'vitest';
import {assessPaymentAllocation,validatePaymentAllocation,type PaymentAllocationSource} from '../utils/payroll/paymentAllocation';
const source=(gross='100000'):PaymentAllocationSource=>({empId:'synthetic@example.test',month:'2026-08',sourceHash:'a'.repeat(64),status:'ready',issues:[],method:'part-time-5',earnings:[{code:'normal',amount:gross,sourceRef:'NORMAL-1'}],taxExemptOvertime:{amount:'0',sourceRef:'OT-1'},pensionSelf:{amount:'0',sourceRef:'PENSION-1'},otherDeductions:[]});
const payment=(id='PAY-1',amount='92890',extra:any={})=>({id,evidenceLocator:'ROW-'+id,paidOn:'2026-09-05',amount,sourceRefs:['SOURCE-'+id],reason:'Synthetic actual payment evidence',incomeClassification:'salary-nonmonthly',insuredCategory:'other',exemption:{kind:'none',from:'2026-01-01',to:'2026-12-31',sourceRefs:['ELIGIBILITY-1']},...extra});
const row=(paymentEventId='PAY-1',gross='100000',actualIncomeTax='5000',actualSupplementaryPremium='2110')=>({paymentEventId,earnings:[{code:'normal',amount:gross}],taxExemptOvertime:'0',pensionSelf:'0',otherDeductions:[],actualIncomeTax,actualSupplementaryPremium,sourceRefs:['ALLOCATION-'+paymentEventId],reason:'Synthetic documented gross allocation'});
function fixture(gross='100000',rows:any[]=[row()],payments:any[]=[payment()]){
 return {allocation:{empId:'synthetic@example.test',month:'2026-08',sourceRefs:['ALLOCATION-1'],reason:'Synthetic complete event allocation',events:rows},context:{source:source(gross),paymentEvidence:{empId:'synthetic@example.test',month:'2026-08',mode:payments.length?'events':'none',sourceRefs:['PAYMENTS-1'],reason:'Synthetic complete payment inventory',events:payments} as any}};
}
const assess=(f:ReturnType<typeof fixture>)=>assessPaymentAllocation(f.allocation,f.context);
describe('source-bound actual-payment allocation',()=>{
 it('calculates from supported gross rather than recorded cash net',()=>{
  const f=fixture(),before=JSON.stringify(f),r=assess(f);
  expect(r).toMatchObject({status:'ready-calculation',reconciliationStatus:'zero',formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid',totals:{gross:'100000',cashPaid:'92890',calculatedIncomeTax:5000,calculatedSupplementaryPremium:2110,expectedNet:'92890'}});
  expect(r.eventResults[0]).toMatchObject({taxableBase:'100000',supplementaryBase:'100000'});expect(JSON.stringify(f)).toBe(before);
 });
 it('uses two evidenced payments separately, never inventing a split or monthly tax aggregation',()=>{
  const r=assess(fixture('120000',[row('PAY-1','60000','0','1266'),row('PAY-2','60000','0','1266')],[payment('PAY-1','58734'),payment('PAY-2','58734')]));
  expect(r).toMatchObject({status:'ready-calculation',totals:{calculatedIncomeTax:0,calculatedSupplementaryPremium:2532}});
  expect(assess(fixture('30000',[row('PAY-1','15000','0','0'),row('PAY-2','15000','0','0')],[payment('PAY-1','15000'),payment('PAY-2','15000')])).totals.calculatedSupplementaryPremium).toBe(0);
 });
 it.each([['29500','622','28878'],['35000','739','34261']])('rounds supplementary premium per statutory item at %s', (gross,premium,cash)=>{
  expect(assess(fixture(gross,[row('PAY-1',gross,'0',premium)],[payment('PAY-1',cash)]))).toMatchObject({status:'ready-calculation',totals:{calculatedSupplementaryPremium:Number(premium)}});
 });
 it('caps each supplementary salary payment at ten million',()=>{
  expect(assess(fixture('10000020',[row('PAY-1','10000020','500001','211000')],[payment('PAY-1','9289019')]))).toMatchObject({status:'ready-calculation',totals:{calculatedIncomeTax:500001,calculatedSupplementaryPremium:211000}});
 });
 it('keeps a known obligation available when actual deductions differ',()=>{
  const r=assess(fixture('100000',[row('PAY-1','100000','0','2110')],[payment('PAY-1','97890')]));
  expect(r).toMatchObject({status:'ready-calculation',reconciliationStatus:'nonzero',totals:{calculatedIncomeTax:5000,actualIncomeTax:'0'}});
  expect(r.eventResults[0].differences).toEqual({incomeTax:'-5000',supplementaryPremium:'0',net:'5000'});
 });
 it('requires cash conservation before calculating',()=>{const f=fixture();f.context.paymentEvidence.events[0].amount='100000';expect(assess(f).eventResults[0].calculatedIncomeTax).toBeNull();});
 it('requires exact approved event inventory and source component conservation',()=>{
  const f=fixture();f.allocation.events[0].paymentEventId='INVENTED';expect(assess(f).issues).toContain('approved-payment-event-inventory-mismatch');
  const g=fixture();g.allocation.events[0].earnings[0].amount='99999';expect(assess(g).issues).toContain('source-amount-not-conserved:earnings:normal');
  const h=fixture();h.context.source.otherDeductions=[{code:'insurance:health',amount:'0',sourceRef:'HEALTH-1'}];expect(assess(h).issues).toContain('source-code-inventory-mismatch:otherDeductions:PAY-1');
 });
 it('rejects stale/missing upstream readiness or scope',()=>{for(const change of [{sourceHash:'bad'},{empId:'OTHER'},{status:'needs-review'},{issues:['missing']}]){const f=fixture();Object.assign(f.context.source,change);expect(assess(f).status).toBe('needs-review');}});
 it('does not borrow exempt overtime from another earning classification',()=>{const f=fixture();f.context.source.taxExemptOvertime.amount='1';f.allocation.events[0].taxExemptOvertime='1';expect(assess(f).issues).toContain('pre-withholding-source-components-invalid');});
 it('preserves explicit zeros and complete zero inventory',()=>{const f=fixture('0',[],[]);expect(assess(f)).toMatchObject({status:'ready-calculation',totals:{gross:'0',calculatedIncomeTax:0,calculatedSupplementaryPremium:0}});expect(validatePaymentAllocation(fixture().allocation).events[0].pensionSelf).toBe('0');});
 it('rejects unknown fields, duplicate identities and noncanonical amounts',()=>{
  const f=fixture();expect(()=>validatePaymentAllocation({...f.allocation,ready:true})).toThrow();
  expect(()=>validatePaymentAllocation({...f.allocation,events:[row(),row('pay-1')]})).toThrow();
  for(const value of ['-1','01','1e3','0.001']){const g=fixture();g.allocation.events[0].actualIncomeTax=value;expect(()=>validatePaymentAllocation(g.allocation)).toThrow();}
 });
 it('holds fractional income-tax treatment without suppressing supported premium rounding',()=>{
  const r=assess(fixture('90501',[row('PAY-1','90501','0','1910')],[payment('PAY-1','88591')]));
  expect(r.eventResults[0]).toMatchObject({status:'needs-review',calculatedIncomeTax:null,calculatedSupplementaryPremium:1910});
  const f=fixture('100000.01',[row('PAY-1','100000.01','5000','2110')],[payment('PAY-1','92890.01')]);expect(assess(f).eventResults[0].issues).toContain('fractional-taxable-base-treatment-unresolved');
 });
 it.each(['table','flat-5','non-resident'])('does not replace monthly method %s with per-event calculations',method=>{const f=fixture();f.context.source.method=method as any;expect(assess(f).eventResults[0].calculatedIncomeTax).toBeNull();});
 it('does not apply 2026 thresholds to unsupported payment years',()=>{const f=fixture();f.context.paymentEvidence.events[0].paidOn='2027-01-05';expect(assess(f).eventResults[0].issues).toContain('payment-year-rule-unsupported');});
 it('requires source-bound union exemption proof before applying zero',()=>{
  const f=fixture('100000',[row('PAY-1','100000','5000','0')],[payment('PAY-1','95000',{insuredCategory:'category-2-union',exemption:{kind:'category-2-union',from:'2026-01-01',to:'2026-12-31',sourceRefs:['PROOF-1'],issuerRef:'UNION-1',proofKind:'insurance-unit-certificate',providedAt:'2026-09-04T10:00:00+08:00'}})]);
  expect(assess(f)).toMatchObject({status:'ready-calculation',totals:{calculatedSupplementaryPremium:0}});
  f.context.paymentEvidence.events[0].exemption=null;expect(assess(f).eventResults[0].calculatedSupplementaryPremium).toBeNull();
 });
 it('holds enrollment-unit bonus treatment and unresolved pension basis independently',()=>{
  const f=fixture();f.context.paymentEvidence.events[0].insuredCategory='insured-here';f.context.paymentEvidence.events[0].exemption=null;expect(assess(f).eventResults[0]).toMatchObject({calculatedIncomeTax:5000,calculatedSupplementaryPremium:null});
  const g=fixture('100020');g.allocation.events[0].earnings[0].amount='100020';g.allocation.events[0].pensionSelf='20';g.context.source.pensionSelf.amount='20';expect(assess(g).eventResults[0]).toMatchObject({calculatedIncomeTax:5000,calculatedSupplementaryPremium:null});
 });
});
