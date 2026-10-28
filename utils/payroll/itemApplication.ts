import {assertPayrollItemFields,payrollItemIdentifier,validatePayrollItemInventory} from './items';
import {validatePayrollItemTreatment,type ItemTreatmentEvidence} from './itemTreatment';
import {add,decimal,evidence,rational,type FractionEvidence} from './rational';

export interface ItemExecutionPolicy {
 sourceRefs:string[];reason:string;
 items:Array<{
  itemCode:string;recipe:'fixed-taxable-earning'|'fixed-posttax-deduction'|'unresolved';
  normalWage:'excluded-by-reviewed-evidence'|'unresolved';
  incomeTax:'included'|'not-applicable'|'unresolved';
  supplementaryPremium:'included'|'not-applicable'|'unresolved';
  insuranceReporting:'confirmed-timeline'|'not-applicable'|'unresolved';
  deductionAuthority:'authorized'|'not-applicable'|'unresolved';
  evidence:ItemTreatmentEvidence[];reason:string;
 }>;
}
export interface ItemExecutionLine {
 code:string;itemCode:string;kind:'earning'|'deduction';amount:string;exact:FractionEvidence;
 from:string;to:string;sourceRefs:string[];recipe:'fixed-taxable-earning'|'fixed-posttax-deduction';
}
export interface ItemExecutionPolicyAssessment {
 status:'ready'|'needs-review';supported:boolean;issues:string[];lines:ItemExecutionLine[];
 earningsExact:FractionEvidence|null;deductionsExact:FractionEvidence|null;
 taxableEarningsExact:FractionEvidence|null;supplementaryEarningsExact:FractionEvidence|null;
 calculationVersion:'item-application-v1';applicationStatus:'calculated-not-posted';paymentStatus:'not-paid';formalEligibility:'BLOCKED';legalValidation:'not-certified';
}
const invalid=():never=>{throw Object.assign(new Error('項目執行政策格式或明示處理無效'),{statusCode:400});};
const choices={recipe:['fixed-taxable-earning','fixed-posttax-deduction','unresolved'],normalWage:['excluded-by-reviewed-evidence','unresolved'],incomeTax:['included','not-applicable','unresolved'],supplementaryPremium:['included','not-applicable','unresolved'],insuranceReporting:['confirmed-timeline','not-applicable','unresolved'],deductionAuthority:['authorized','not-applicable','unresolved']} as const;

/** Typed, bounded recipes only. No formula, amount, source snapshot, or asserted
 * ready flag can be supplied as execution policy. Legacy narratives are not
 * silently promoted to executable treatment. */
export function validateItemExecutionPolicy(value:unknown):ItemExecutionPolicy {
 assertPayrollItemFields(value,['sourceRefs','reason','items']);const v=value as any;
 if(!Array.isArray(v.items)||!v.items.length||v.items.length>100)invalid();
 for(const item of v.items){
  assertPayrollItemFields(item,['itemCode',...Object.keys(choices),'evidence','reason']);
  if(!payrollItemIdentifier(item.itemCode))invalid();
  for(const key of Object.keys(choices) as Array<keyof typeof choices>)if(!(choices[key] as readonly string[]).includes(item[key]))invalid();
 }
 // Reuse the established six-purpose evidence and metadata contract, preserving
 // explicit unresolved entries without inventing defaults for any verdict.
 const checked=validatePayrollItemTreatment({sourceRefs:v.sourceRefs,reason:v.reason,items:v.items.map((item:any)=>({itemCode:item.itemCode,category:'unresolved',reason:item.reason,evidence:item.evidence}))});
 return {sourceRefs:checked.sourceRefs,reason:checked.reason,items:checked.items.map((item,index)=>({itemCode:item.itemCode,
  recipe:v.items[index].recipe,normalWage:v.items[index].normalWage,incomeTax:v.items[index].incomeTax,supplementaryPremium:v.items[index].supplementaryPremium,
  insuranceReporting:v.items[index].insuranceReporting,deductionAuthority:v.items[index].deductionAuthority,evidence:item.evidence,reason:item.reason}))};
}

/** Pure arithmetic over trusted, separately approved inventory and policy.
 * The backend must verify immutable versions, scope/roles and actual evidence
 * occurrence <= proposal/review time; this function has no implicit clock and
 * cannot authenticate documents or legal authority from reference strings.
 * Item amount is already the explicit fixed amount for its period: no proration,
 * wage-rate transformation, tax calculation or rounding is performed here. */
export function assessItemExecutionPolicy(policy:unknown,inventory:unknown,context:{insuranceConfirmed:boolean}):ItemExecutionPolicyAssessment {
 const result:ItemExecutionPolicyAssessment={status:'needs-review',supported:false,issues:[],lines:[],earningsExact:null,deductionsExact:null,taxableEarningsExact:null,supplementaryEarningsExact:null,
  calculationVersion:'item-application-v1',applicationStatus:'calculated-not-posted',paymentStatus:'not-paid',formalEligibility:'BLOCKED',legalValidation:'not-certified'};
 let p:ItemExecutionPolicy,source:ReturnType<typeof validatePayrollItemInventory>;
 try{p=validateItemExecutionPolicy(policy);source=validatePayrollItemInventory(inventory);}catch{result.issues=['item-execution-policy-or-inventory-invalid'];return result;}
 if(source.mode!=='items'){result.issues=['item-execution-requires-nonempty-item-inventory'];return result;}
 const sourceCodes=source.items.map(i=>i.itemCode).sort(),policyCodes=p.items.map(i=>i.itemCode).sort();
 if(JSON.stringify(sourceCodes)!==JSON.stringify(policyCodes)){result.issues=['item-execution-inventory-coverage-mismatch'];return result;}
 const issues=new Set<string>(),lines:ItemExecutionLine[]=[];
 let earnings=rational(0n),deductions=rational(0n);
 for(const item of source.items){
  const decision=p.items.find(i=>i.itemCode===item.itemCode)!;
  const issue=(reason:string)=>issues.add(reason+':'+item.itemCode);
  if(decision.recipe==='unresolved')issue('item-execution-recipe-unresolved');
  if(decision.normalWage!=='excluded-by-reviewed-evidence')issue('item-execution-normal-wage-treatment-unresolved');
  for(const proof of decision.evidence){
   if(proof.status!=='documented'){issue('item-execution-evidence-unresolved:'+proof.purpose);continue;}
   if(!proof.effectiveFrom||!proof.effectiveTo||proof.effectiveFrom>item.from||proof.effectiveTo<item.to)issue('item-execution-evidence-period-mismatch:'+proof.purpose);
  }
  if(decision.recipe==='fixed-taxable-earning'){
   if(item.kind!=='earning')issue('item-execution-recipe-kind-mismatch');
   if(decision.incomeTax!=='included'||decision.supplementaryPremium!=='included')issue('item-execution-earning-tax-treatment-unsupported');
   if(decision.insuranceReporting!=='confirmed-timeline'||context?.insuranceConfirmed!==true)issue('item-execution-insurance-source-unconfirmed');
   if(decision.deductionAuthority!=='not-applicable')issue('item-execution-earning-deduction-treatment-invalid');
  }else if(decision.recipe==='fixed-posttax-deduction'){
   if(item.kind!=='deduction')issue('item-execution-recipe-kind-mismatch');
   if(decision.incomeTax!=='not-applicable'||decision.supplementaryPremium!=='not-applicable'||decision.insuranceReporting!=='not-applicable')issue('item-execution-posttax-base-change-unsupported');
   if(decision.deductionAuthority!=='authorized')issue('item-execution-deduction-authority-unresolved');
  }
  if(decision.recipe==='unresolved')continue;
  const amount=decimal(item.amount);
  if(item.kind==='earning')earnings=add(earnings,amount);else deductions=add(deductions,amount);
  lines.push({code:'item:'+item.itemCode,itemCode:item.itemCode,kind:item.kind,amount:item.amount,exact:evidence(amount),from:item.from,to:item.to,
   sourceRefs:[...new Set([...source.sourceRefs,...item.sourceRefs,...p.sourceRefs,...decision.evidence.flatMap(e=>e.sourceRefs)])].sort(),recipe:decision.recipe});
 }
 if(issues.size){result.issues=[...issues].sort();return result;}
 return {...result,status:'ready',supported:true,lines,earningsExact:evidence(earnings),deductionsExact:evidence(deductions),taxableEarningsExact:evidence(earnings),supplementaryEarningsExact:evidence(earnings)};
}
