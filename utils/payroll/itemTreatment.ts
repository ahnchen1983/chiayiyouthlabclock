import {validDate} from '../attendance';
import {assertPayrollItemFields,payrollItemIdentifier,payrollItemReason} from './items';

/** No actual allowance/bonus/deduction treatment has approved governing evidence
 * in the current handoff. A reviewed narrative is not executable tax policy. */
export const PAYROLL_ITEM_SUPPORTED_TREATMENTS:readonly string[]=Object.freeze([]);
export const ITEM_TREATMENT_PURPOSES=['entitlement','normal-wage','income-tax','supplementary-premium','insurance-reporting','deduction-authority'] as const;
export type ItemTreatmentPurpose=typeof ITEM_TREATMENT_PURPOSES[number];
export interface ItemTreatmentEvidence {
 purpose:ItemTreatmentPurpose;status:'unresolved'|'documented';sourceRefs:string[];reason:string;
 authorityOccurredAt?:string;effectiveFrom?:string;effectiveTo?:string;
}
export interface PayrollItemTreatment {
 sourceRefs:string[];reason:string;
 items:Array<{itemCode:string;category:'allowance'|'bonus'|'other'|'unresolved';reason:string;evidence:ItemTreatmentEvidence[]}>;
}
const invalid=():never=>{throw Object.assign(new Error('薪資項目處理證據格式或來源無效'),{statusCode:400});};
const refs=(v:any,empty=false):string[]=>{if(!Array.isArray(v)||(!empty&&!v.length)||v.length>20||v.some(r=>!payrollItemIdentifier(r))||new Set(v.map(r=>r.toLowerCase())).size!==v.length)return invalid();return [...v];};
const instant=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v)&&validDate(v.slice(0,10))&&Number.isFinite(Date.parse(v));
export function validatePayrollItemTreatment(value:any):PayrollItemTreatment {
 assertPayrollItemFields(value,['sourceRefs','reason','items']);
 if(!Array.isArray(value.items)||!value.items.length||value.items.length>100)return invalid();const seen=new Set<string>();
 const items=value.items.map((item:any)=>{
  assertPayrollItemFields(item,['itemCode','category','reason','evidence']);
  if(!payrollItemIdentifier(item.itemCode)||seen.has(item.itemCode.toLowerCase())||!['allowance','bonus','other','unresolved'].includes(item.category)||!Array.isArray(item.evidence)||item.evidence.length!==ITEM_TREATMENT_PURPOSES.length)return invalid();seen.add(item.itemCode.toLowerCase());
  const purposes=new Set<string>();
  const evidence=item.evidence.map((entry:any):ItemTreatmentEvidence=>{
   assertPayrollItemFields(entry,['purpose','status','sourceRefs','reason','authorityOccurredAt','effectiveFrom','effectiveTo']);
   if(!ITEM_TREATMENT_PURPOSES.includes(entry.purpose)||purposes.has(entry.purpose)||!['unresolved','documented'].includes(entry.status))return invalid();purposes.add(entry.purpose);
   if(entry.status==='unresolved'){
    assertPayrollItemFields(entry,['purpose','status','sourceRefs','reason']);
    return {purpose:entry.purpose,status:'unresolved',sourceRefs:refs(entry.sourceRefs,true),reason:payrollItemReason(entry.reason)};
   }
   if(!instant(entry.authorityOccurredAt)||!validDate(entry.effectiveFrom)||!validDate(entry.effectiveTo)||entry.effectiveFrom>entry.effectiveTo)return invalid();
   return {purpose:entry.purpose,status:'documented',sourceRefs:refs(entry.sourceRefs),reason:payrollItemReason(entry.reason),authorityOccurredAt:entry.authorityOccurredAt,effectiveFrom:entry.effectiveFrom,effectiveTo:entry.effectiveTo};
  });
  return {itemCode:item.itemCode,category:item.category as PayrollItemTreatment['items'][number]['category'],reason:payrollItemReason(item.reason),evidence};
 });
 return {sourceRefs:refs(value.sourceRefs),reason:payrollItemReason(value.reason),items};
}
export function assessPayrollItemTreatment(value:unknown){
 let treatment:PayrollItemTreatment;try{treatment=validatePayrollItemTreatment(value);}catch{return {status:'needs-review' as const,issues:['item-treatment-evidence-invalid'],supported:false as const,formalEligibility:'BLOCKED' as const,applicationStatus:'not-applied' as const};}
 const issues=['supported-item-treatment-not-established'];
 for(const item of treatment.items)for(const entry of item.evidence)if(entry.status==='unresolved')issues.push('item-treatment-unresolved:'+item.itemCode+':'+entry.purpose);
 return {status:'needs-review' as const,issues,supported:false as const,formalEligibility:'BLOCKED' as const,applicationStatus:'not-applied' as const};
}
