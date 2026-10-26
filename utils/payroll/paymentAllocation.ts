import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason} from './items';
import {validatePaymentEvidence,assessPaymentEvidence,type PaymentEvidence} from './paymentEvidence';
import type {WithholdingMethod} from './withholding';

/** Trusted pre-withholding projection. Its hash must exclude calculated tax/net,
 * payment allocations and their approvals; backend verifies immutable source facts. */
export interface PaymentAllocationSource {
 empId:string;month:string;sourceHash:string;status:'ready'|'needs-review';issues:string[];method:WithholdingMethod|null;
 earnings:Array<{code:string;amount:string;sourceRef:string}>;
 taxExemptOvertime:{amount:string;sourceRef:string};pensionSelf:{amount:string;sourceRef:string};
 otherDeductions:Array<{code:string;amount:string;sourceRef:string}>;
}
export interface PaymentAllocationEvent {
 paymentEventId:string;earnings:Array<{code:string;amount:string}>;taxExemptOvertime:string;pensionSelf:string;
 otherDeductions:Array<{code:string;amount:string}>;actualIncomeTax:string;actualSupplementaryPremium:string;sourceRefs:string[];reason:string;
}
export interface PaymentAllocation {empId:string;month:string;sourceRefs:string[];reason:string;events:PaymentAllocationEvent[]}
export interface PaymentAllocationEventResult {
 paymentEventId:string;status:'ready-calculation'|'needs-review';issues:string[];reconciliationStatus:'zero'|'nonzero'|'unresolved';reconciliationIssues:string[];allocatedGross:string;cashPaid:string;
 taxableBase:string|null;supplementaryBase:string|null;actualIncomeTax:string;actualSupplementaryPremium:string;
 calculatedIncomeTax:number|null;calculatedSupplementaryPremium:number|null;expectedNet:string|null;
 differences:{incomeTax:string|null;supplementaryPremium:string|null;net:string|null};
}
const invalid=():never=>{throw Object.assign(new Error('給付分配格式、來源識別或金額無效'),{statusCode:400});};
const references=(v:any):string[]=>{if(!Array.isArray(v)||!v.length||v.length>20||v.some(r=>!payrollItemIdentifier(r))||new Set(v.map(r=>r.toLowerCase())).size!==v.length)return invalid();return [...v];};
const amount=(v:any):string=>{if(typeof v!=='string'||!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(v))return invalid();const [whole,tail='']=v.split('.'),fraction=tail.replace(/0+$/,'');return fraction?whole+'.'+fraction:whole;};
const cents=(v:string)=>{const [w,f='']=amount(v).split('.');return BigInt(w)*100n+BigInt(f.padEnd(2,'0'));};
// Only consumes internally formatted totals, which may exceed a single input's size limit.
const signedCents=(v:string)=>{const negative=v.startsWith('-'),[w,f='']=(negative?v.slice(1):v).split('.');const n=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));return negative?-n:n;};
const display=(n:bigint):string=>{const sign=n<0n?'-':'';const x=n<0n?-n:n,f=(x%100n).toString().padStart(2,'0').replace(/0+$/,'');return sign+(x/100n).toString()+(f?'.'+f:'');};
function allocations(v:any):Array<{code:string;amount:string}>{
 if(!Array.isArray(v)||v.length>100)return invalid();const seen=new Set<string>();
 return v.map(r=>{assertPayrollItemFields(r,['code','amount']);if(!payrollItemIdentifier(r.code)||seen.has(r.code.toLowerCase()))return invalid();seen.add(r.code.toLowerCase());return {code:r.code,amount:amount(r.amount)};});
}
export function validatePaymentAllocation(value:any):PaymentAllocation {
 assertPayrollItemFields(value,['empId','month','sourceRefs','reason','events']);
 if(!payrollItemIdentity(value.empId)||!payrollItemMonth(value.month)||!Array.isArray(value.events)||value.events.length>100)return invalid();const seen=new Set<string>();
 return {empId:value.empId,month:value.month,sourceRefs:references(value.sourceRefs),reason:payrollItemReason(value.reason),events:value.events.map((r:any)=>{
  assertPayrollItemFields(r,['paymentEventId','earnings','taxExemptOvertime','pensionSelf','otherDeductions','actualIncomeTax','actualSupplementaryPremium','sourceRefs','reason']);
  if(!payrollItemIdentifier(r.paymentEventId)||seen.has(r.paymentEventId.toLowerCase()))return invalid();seen.add(r.paymentEventId.toLowerCase());
  return {paymentEventId:r.paymentEventId,earnings:allocations(r.earnings),taxExemptOvertime:amount(r.taxExemptOvertime),pensionSelf:amount(r.pensionSelf),otherDeductions:allocations(r.otherDeductions),actualIncomeTax:amount(r.actualIncomeTax),actualSupplementaryPremium:amount(r.actualSupplementaryPremium),sourceRefs:references(r.sourceRefs),reason:payrollItemReason(r.reason)};
 })};
}
const sum=(values:bigint[])=>values.reduce((a,b)=>a+b,0n);
/** Supported rule sources checked 2026-10-26:
 * MOF 115 nonmonthly/part-time 90,501 threshold, 5%, effective 2026 payments:
 * https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/withheld-rule/rule/NM11BZY
 * https://www.mof.gov.tw/singlehtml/384fb3077bb349ea973e7fc6f13b6974?cntId=1d6facbaae674fb7b1e15161df56768e
 * NHIA 115.01 handbook pp21-23: actual non-enrollment-unit salary payment,
 * 29,500 floor, 10m cap, 2.11%, exclude supported exempt overtime:
 * https://www.nhi.gov.tw/ch/dl-64814-5f26c2b955c24ebbbbf1479877ecfb7e-1.pdf
 * Insurance currency half-up: NHI Enforcement Rules52:
 * https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=52&pcode=L0060002
 * No income-tax fractional rounding rule is invented. Monthly and nonresident
 * methods are not converted into independent per-event 5% calculations.
 */
export function assessPaymentAllocation(value:unknown,context:{source:PaymentAllocationSource|null;paymentEvidence:PaymentEvidence|null}){
 const issues:string[]=[],eventResults:PaymentAllocationEventResult[]=[];
 let grossTotal=0n,cashTotal=0n,actualTaxTotal=0n,actualPremiumTotal=0n;
 const finish=()=>{
  const complete=eventResults.length>0&&eventResults.every(r=>r.calculatedIncomeTax!==null&&r.calculatedSupplementaryPremium!==null);
  const emptyOkay=!issues.length&&!eventResults.length;
  return {status:issues.length||eventResults.some(r=>r.status==='needs-review')?'needs-review' as const:'ready-calculation' as const,issues:[...new Set(issues)],eventResults,reconciliationStatus:!complete&&!emptyOkay?'unresolved' as const:eventResults.some(r=>r.reconciliationStatus==='nonzero')?'nonzero' as const:'zero' as const,reconciliationIssues:eventResults.flatMap(r=>r.reconciliationIssues.map(i=>r.paymentEventId+':'+i)),
   totals:{gross:display(grossTotal),cashPaid:display(cashTotal),actualIncomeTax:display(actualTaxTotal),actualSupplementaryPremium:display(actualPremiumTotal),calculatedIncomeTax:complete?eventResults.reduce((n,r)=>n+r.calculatedIncomeTax!,0):emptyOkay?0:null,calculatedSupplementaryPremium:complete?eventResults.reduce((n,r)=>n+r.calculatedSupplementaryPremium!,0):emptyOkay?0:null,expectedNet:complete?display(sum(eventResults.map(r=>r.expectedNet===null?0n:signedCents(r.expectedNet)))):emptyOkay?'0':null},
   formalEligibility:'BLOCKED' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const,ruleVersion:'payment-allocation-2026-v1' as const};
 };
 let a:PaymentAllocation,p:PaymentEvidence;const s=context?.source;
 try{a=validatePaymentAllocation(value);p=validatePaymentEvidence(context?.paymentEvidence);}catch{issues.push('allocation-or-approved-payment-evidence-invalid');return finish();}
 if(!s||s.empId!==a.empId||s.month!==a.month||p.empId!==a.empId||p.month!==a.month||!/^[a-f0-9]{64}$/.test(s.sourceHash||'')){issues.push('source-or-payment-scope-binding-mismatch');return finish();}
 if(s.status!=='ready'||!Array.isArray(s.issues)||s.issues.length){issues.push('pre-withholding-source-not-ready');return finish();}
 let sourceEarnings:Array<{code:string;amount:string}>,sourceOther:Array<{code:string;amount:string}>,exemptTotal:bigint,pensionTotal:bigint;
 try{
  if(!Array.isArray(s.earnings)||!Array.isArray(s.otherDeductions)||!s.earnings.length)return invalid();
  sourceEarnings=allocations(s.earnings.map(({code,amount})=>({code,amount})));sourceOther=allocations(s.otherDeductions.map(({code,amount})=>({code,amount})));
  if([...s.earnings,...s.otherDeductions,s.taxExemptOvertime,s.pensionSelf].some(r=>!r||!payrollItemIdentifier(r.sourceRef)))return invalid();
  if(sourceOther.some(r=>['tax:income','health:supplementary','insurance:pension-self'].includes(r.code)))return invalid();
  exemptTotal=cents(s.taxExemptOvertime.amount);pensionTotal=cents(s.pensionSelf.amount);
  if(exemptTotal>cents(sourceEarnings.find(r=>r.code==='overtime')?.amount||'0'))return invalid();
 }catch{issues.push('pre-withholding-source-components-invalid');return finish();}
 const eventMap=new Map(p.events.map(e=>[e.id,e]));
 if(a.events.length!==p.events.length||a.events.some(e=>!eventMap.has(e.paymentEventId))){issues.push('approved-payment-event-inventory-mismatch');return finish();}
 const conserve=(kind:'earnings'|'otherDeductions',source:Array<{code:string;amount:string}>)=>{
  const codes=new Set(source.map(r=>r.code));
  for(const e of a.events)if(e[kind].length!==codes.size||e[kind].some(r=>!codes.has(r.code)))issues.push('source-code-inventory-mismatch:'+kind+':'+e.paymentEventId);
  for(const row of source)if(sum(a.events.map(e=>sum(e[kind].filter(r=>r.code===row.code).map(r=>cents(r.amount)))))!==cents(row.amount))issues.push('source-amount-not-conserved:'+kind+':'+row.code);
 };
 conserve('earnings',sourceEarnings);conserve('otherDeductions',sourceOther);
 if(sum(a.events.map(e=>cents(e.taxExemptOvertime)))!==exemptTotal)issues.push('exempt-overtime-not-conserved');
 if(sum(a.events.map(e=>cents(e.pensionSelf)))!==pensionTotal)issues.push('pension-allocation-not-conserved');
 if(issues.length)return finish();
 // Reuse proof applicability only; this tautological cash total is NOT monthly net reconciliation.
 // The workflow separately binds the approved cash inventory and pre-withholding source.
 const paymentAssessment=assessPaymentEvidence(p,{empId:a.empId,month:a.month,monthlyPayable:display(sum(p.events.map(e=>cents(e.amount)))),payableSourceRef:s.sourceHash});
 for(const row of a.events){
  const paid=eventMap.get(row.paymentEventId)!,local:string[]=[],reconciliationIssues:string[]=[];
  const gross=sum(row.earnings.map(r=>cents(r.amount))),exempt=cents(row.taxExemptOvertime),pension=cents(row.pensionSelf),other=sum(row.otherDeductions.map(r=>cents(r.amount))),actualTax=cents(row.actualIncomeTax),actualPremium=cents(row.actualSupplementaryPremium),cash=cents(paid.amount);
  grossTotal+=gross;cashTotal+=cash;actualTaxTotal+=actualTax;actualPremiumTotal+=actualPremium;
  if(exempt>cents(row.earnings.find(r=>r.code==='overtime')?.amount||'0')||exempt+pension>gross)local.push('event-exemption-or-pension-exceeds-supported-earnings');
  if(gross-pension-other-actualTax-actualPremium!==cash)local.push('actual-cash-net-does-not-reconcile');
  const taxable=gross-exempt-pension,supplementary=gross-exempt;
  let incomeTax:number|null=null,premium:number|null=null;
  if(!paid.paidOn.startsWith('2026-'))local.push('payment-year-rule-unsupported');
  if(s.method!=='part-time-5'||paid.incomeClassification!=='salary-nonmonthly')local.push('per-event-income-tax-method-or-classification-unsupported');
  // Structural conservation is independent of tax rounding or actual withholding.
  const structural=local.length>0;
  if(!structural){
   if(taxable%100n!==0n)local.push('fractional-taxable-base-treatment-unresolved');
   else if(taxable<9050100n)incomeTax=0;
   else if(taxable%2000n!==0n)local.push('fractional-income-tax-rounding-unresolved');
   else incomeTax=Number(taxable/2000n);
   const eligibilityIssues=paymentAssessment.issues.filter(i=>i.endsWith(':'+paid.id));
   if(paid.insuredCategory==='insured-here')local.push('insured-here-nonmonthly-bonus-treatment-unresolved');
   else if(eligibilityIssues.length)local.push(...eligibilityIssues);
   else if(paid.insuredCategory==='category-2-union')premium=0;
   else if(paid.insuredCategory==='other'){
    if(pension!==0n)local.push('supplementary-pension-basis-unresolved');
    else if(supplementary<2950000n)premium=0;
    else {const capped=supplementary>1000000000n?1000000000n:supplementary;premium=Number((capped*211n+500000n)/1000000n);}
   }else local.push('supplementary-eligibility-unresolved');
  }
  const expected=incomeTax!==null&&premium!==null?gross-pension-other-BigInt(incomeTax+premium)*100n:null;
  const differences={incomeTax:incomeTax===null?null:display(actualTax-BigInt(incomeTax)*100n),supplementaryPremium:premium===null?null:display(actualPremium-BigInt(premium)*100n),net:expected===null?null:display(cash-expected)};
  if(differences.incomeTax!==null&&differences.incomeTax!=='0')reconciliationIssues.push('actual-income-tax-differs-from-calculation');
  if(differences.supplementaryPremium!==null&&differences.supplementaryPremium!=='0')reconciliationIssues.push('actual-supplementary-premium-differs-from-calculation');
  if(expected!==null&&expected<0n)local.push('calculated-deductions-exceed-gross');
  eventResults.push({paymentEventId:paid.id,status:local.length?'needs-review':'ready-calculation',issues:local,reconciliationStatus:expected===null?'unresolved':reconciliationIssues.length?'nonzero':'zero',reconciliationIssues,allocatedGross:display(gross),cashPaid:display(cash),taxableBase:taxable<0n?null:display(taxable),supplementaryBase:supplementary<0n?null:display(supplementary),actualIncomeTax:row.actualIncomeTax,actualSupplementaryPremium:row.actualSupplementaryPremium,calculatedIncomeTax:incomeTax,calculatedSupplementaryPremium:premium,expectedNet:expected===null?null:display(expected),differences});
  issues.push(...local.map(i=>paid.id+':'+i));
 }
 return finish();
}
