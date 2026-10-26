import {validDate} from '../attendance';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason} from './items';
export interface PaymentEventEvidence {
 id:string;evidenceLocator:string;paidOn:string;paidAt?:string;amount:string;sourceRefs:string[];reason:string;
 incomeClassification:'salary-monthly'|'salary-nonmonthly'|'non-salary'|'unresolved';
 insuredCategory:'insured-here'|'category-2-union'|'other'|'unresolved';
 exemption:{kind:'none'|'category-2-union'|'unresolved';from:string;to:string;sourceRefs:string[];issuerRef?:string;proofKind?:'insurance-unit-certificate'|'insurer-query'|'unresolved';providedAt?:string;queriedAt?:string;queryConfirmedOn?:string}|null;
}
export interface PaymentEvidence {empId:string;month:string;mode:'none'|'events';sourceRefs:string[];reason:string;events:PaymentEventEvidence[]}
export interface PaymentReconciliation {empId:unknown;month:unknown;monthlyPayable:unknown;payableSourceRef:unknown}
const invalid=():never=>{throw Object.assign(new Error('給付證據格式、範圍或明細識別無效'),{statusCode:400});};
const timestamp=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v)&&validDate(v.slice(0,10))&&Number.isFinite(Date.parse(v));
const taipeiDate=(at:string)=>new Date(Date.parse(at)+8*60*60*1000).toISOString().slice(0,10);
const refs=(v:any):string[]=>{
 if(!Array.isArray(v)||!v.length||v.length>20||v.some(r=>!payrollItemIdentifier(r))||new Set(v.map(r=>r.toLowerCase())).size!==v.length)return invalid();return [...v];
};
const amount=(v:any):string=>{
 if(typeof v!=='string'||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(v))return invalid();
 const [whole,fraction='']=v.split('.'),tail=fraction.replace(/0+$/,'');return tail?whole+'.'+tail:whole;
};
const cents=(v:string):bigint=>{const [whole,fraction='']=v.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));};
const display=(v:bigint):string=>{const f=(v%100n).toString().padStart(2,'0').replace(/0+$/,'');return (v/100n).toString()+(f?'.'+f:'');};
export function validatePaymentEvidence(value:any):PaymentEvidence {
 assertPayrollItemFields(value,['empId','month','mode','sourceRefs','reason','events']);
 if(!payrollItemIdentity(value.empId)||!payrollItemMonth(value.month)||!['none','events'].includes(value.mode)||!Array.isArray(value.events)||value.events.length>100||value.mode==='none'&&value.events.length||value.mode==='events'&&!value.events.length)return invalid();
 const ids=new Set<string>(),locations=new Set<string>();
 const events=value.events.map((e:any):PaymentEventEvidence=>{
  assertPayrollItemFields(e,['id','evidenceLocator','paidOn','paidAt','amount','sourceRefs','reason','incomeClassification','insuredCategory','exemption']);
  if(!payrollItemIdentifier(e.id)||!payrollItemIdentifier(e.evidenceLocator)||!validDate(e.paidOn)||!['salary-monthly','salary-nonmonthly','non-salary','unresolved'].includes(e.incomeClassification)||!['insured-here','category-2-union','other','unresolved'].includes(e.insuredCategory))return invalid();
  if(e.paidAt!==undefined&&(!timestamp(e.paidAt)||taipeiDate(e.paidAt)!==e.paidOn))return invalid();
  const identity=e.id.toLowerCase();if(ids.has(identity))return invalid();ids.add(identity);
  const sourceRefs=refs(e.sourceRefs);
  // A statement may prove many payments, but the same statement row cannot be
  // counted twice under different event IDs. No aggregate is split here.
  for(const ref of sourceRefs){const locator=ref.toLowerCase()+'|'+e.evidenceLocator.toLowerCase();if(locations.has(locator))return invalid();locations.add(locator);}
  let exemption:PaymentEventEvidence['exemption']=null;
  if(e.exemption!==null){
   const p=e.exemption;assertPayrollItemFields(p,['kind','from','to','sourceRefs','issuerRef','proofKind','providedAt','queriedAt','queryConfirmedOn']);
   if(!['none','category-2-union','unresolved'].includes(p.kind)||!validDate(p.from)||!validDate(p.to)||p.from>p.to)return invalid();
   if(p.issuerRef!==undefined&&!payrollItemIdentifier(p.issuerRef)||p.proofKind!==undefined&&!['insurance-unit-certificate','insurer-query','unresolved'].includes(p.proofKind))return invalid();
   if(p.queryConfirmedOn!==undefined&&(!validDate(p.queryConfirmedOn)||p.proofKind!=='insurer-query'))return invalid();
   for(const key of ['providedAt','queriedAt'])if(p[key]!==undefined&&!timestamp(p[key]))return invalid();
   exemption={kind:p.kind,from:p.from,to:p.to,sourceRefs:refs(p.sourceRefs),...Object.fromEntries(['issuerRef','proofKind','providedAt','queriedAt','queryConfirmedOn'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))};
  }
  return {id:e.id,evidenceLocator:e.evidenceLocator,paidOn:e.paidOn,...(e.paidAt!==undefined?{paidAt:e.paidAt}:{}),amount:amount(e.amount),sourceRefs,reason:payrollItemReason(e.reason),incomeClassification:e.incomeClassification,insuredCategory:e.insuredCategory,exemption};
 });
 return {empId:value.empId,month:value.month,mode:value.mode,sourceRefs:refs(value.sourceRefs),reason:payrollItemReason(value.reason),events};
}
/** Records completeness only. Actual proof validation, independent version review,
 * taxable/exempt income and pension allocation remain separate prerequisites.
 * This function neither initiates payment nor calculates tax or premiums. */
export function assessPaymentEvidence(value:unknown,context:PaymentReconciliation){
 const issues:string[]=[];let totalRecorded:string|null=null;
 try{
  const v=validatePaymentEvidence(value);
  if(v.empId!==context?.empId||v.month!==context?.month)issues.push('payment-scope-mismatch');
  totalRecorded=display(v.events.reduce((n,e)=>n+cents(e.amount),0n));
  if(!payrollItemIdentifier(context?.payableSourceRef))issues.push('monthly-payable-source-missing');
  try{if(cents(amount(context?.monthlyPayable))!==cents(totalRecorded))issues.push('monthly-payable-reconciliation-mismatch');}catch{issues.push('monthly-payable-unresolved');}
  for(const e of v.events){
   if(!['salary-monthly','salary-nonmonthly'].includes(e.incomeClassification))issues.push('income-classification-unresolved:'+e.id);
   const p=e.exemption,scoped=!!p&&p.from<=e.paidOn&&p.to>=e.paidOn;
   if(e.insuredCategory==='unresolved')issues.push('insured-category-unresolved:'+e.id);
   if(e.insuredCategory==='category-2-union'&&(!scoped||p?.kind!=='category-2-union'))issues.push('union-exemption-proof-unresolved:'+e.id);
   if(e.insuredCategory==='category-2-union'&&p?.kind==='category-2-union'){
    if(!p.issuerRef||!p.proofKind||p.proofKind==='unresolved')issues.push('union-proof-issuer-or-kind-unresolved:'+e.id);
    const before=!!p.providedAt&&(e.paidAt?Date.parse(p.providedAt)<Date.parse(e.paidAt):taipeiDate(p.providedAt)<e.paidOn);
    if(!before)issues.push('union-proof-prepayment-timing-unresolved:'+e.id);
    // NHIA FAQ L006 (answer 2015-09-01, collection 2021-01-21), p87:
    // reply 2013-02-28 is valid through 2013-04-27 inclusive.
    // https://www.nhi.gov.tw/ch/dl-66095-bf2b612a3e734f9da4312142066afb05-1.pdf
    // Art5 amended 2024-03-20 and NHIA 115.01 handbook p47 retain two months:
    // https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060027
    // https://www.nhi.gov.tw/ch/dl-64814-5f26c2b955c24ebbbbf1479877ecfb7e-1.pdf
    // Reply DATE, not request queriedAt. Ordinary interval [reply, +2 months).
    // No 60-day substitution, missing-day clamping or holiday extension.
    if(p.proofKind==='insurer-query'){
     if(!p.queryConfirmedOn)issues.push('insurer-query-validity-unresolved:'+e.id); // Preserve legacy assessment/history.
     else{
      const [year,month,day]=p.queryConfirmedOn.split('-').map(Number),targetMonth=month+2,targetYear=year+Math.floor((targetMonth-1)/12),normalizedMonth=(targetMonth-1)%12+1;
      const exclusiveEnd=String(targetYear).padStart(4,'0')+'-'+String(normalizedMonth).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      if(!validDate(exclusiveEnd))issues.push('insurer-query-month-end-boundary-unresolved:'+e.id);
      else if(e.paidOn<p.queryConfirmedOn||e.paidOn>=exclusiveEnd)issues.push('insurer-query-outside-validity:'+e.id);
     }
    }
   }
   if(e.insuredCategory==='other'&&(!scoped||p?.kind!=='none'))issues.push('exemption-applicability-unresolved:'+e.id);
   if(p&&(p.kind==='unresolved'||!scoped||p.kind==='category-2-union'&&e.insuredCategory!=='category-2-union'))issues.push('exemption-proof-scope-unresolved:'+e.id);
  }
 }catch{issues.push('payment-inventory-missing-or-invalid');}
 return {status:issues.length?'needs-review' as const:'ready-evidence' as const,totalRecorded,issues,formalEligibility:'BLOCKED' as const,legalValidation:'unresolved' as const,incomeTaxBase:null,pensionBasis:null,applicationStatus:'not-applied' as const};
}
