import type {PayrollComparisonSource} from '../../../utils/payroll/comparison';
import {validDate} from '../../../utils/attendance';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemMonth,payrollItemIdentifier,payrollItemReason,assessPayrollItemInventory} from '../../../utils/payroll/items';
import {calculateSalaryForEmployee,PAYROLL_VERSION} from './payroll';
import {projectPayrollComparisonSource} from './payrollComparisonSource';
import {sanitizePayrollSnapshot} from './payrollSnapshot';
import {evidenceHash} from './attendanceCaseLifecycle';
import type {PayrollMonthSource} from './payrollSourceReader';

export interface HistoricalRateProof {sourceRefs:string[];authorityOccurredAt:string;reason:string}
export interface HistoricalPaymentAllocationDisposition extends HistoricalRateProof {mode:'retain-original-cash'}
export interface HistoricalCompOriginalWageDisposition extends HistoricalRateProof {mode:'retain-recorded-comp-wage'}
export interface HistoricalRateCorrection {
 rates:Array<HistoricalRateProof & {from:string;to:string;payBasis:'monthly'|'hourly';amount:string;originalPayVersion:string}>;
 insuranceUnchanged:HistoricalRateProof;
 /** When original envelope has payment allocation: retain cash on frozen run; corrected target is comparison/D only. Rebinding is a separate adapter. */
 paymentAllocationDisposition?:HistoricalPaymentAllocationDisposition;
 /** When frozen comp evidence exists: keep recorded original wage / credits; do not recompute comp from the corrected rate. */
 compOriginalWageDisposition?:HistoricalCompOriginalWageDisposition;
}
const bad=():never=>{throw Object.assign(new Error('歷史費率更正事實、期間或依據無效'),{statusCode:400});};
function proof(v:any):HistoricalRateProof {
 if(!Array.isArray(v.sourceRefs)||!v.sourceRefs.length||v.sourceRefs.length>20||v.sourceRefs.some((x:any)=>!payrollItemIdentifier(x))||new Set(v.sourceRefs).size!==v.sourceRefs.length||typeof v.authorityOccurredAt!=='string'||!/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v.authorityOccurredAt)||!validDate(v.authorityOccurredAt.slice(0,10))||!Number.isFinite(Date.parse(v.authorityOccurredAt)))bad();
 return {sourceRefs:[...v.sourceRefs],authorityOccurredAt:v.authorityOccurredAt,reason:payrollItemReason(v.reason)};
}
export function validateHistoricalRateCorrection(value:any,month:string,at:string):HistoricalRateCorrection {
 const allowed=['rates','insuranceUnchanged'];
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  if('paymentAllocationDisposition' in value)allowed.push('paymentAllocationDisposition');
  if('compOriginalWageDisposition' in value)allowed.push('compOriginalWageDisposition');
 }
 assertPayrollItemFields(value,allowed);if(!payrollItemMonth(month)||!Number.isFinite(Date.parse(at))||!Array.isArray(value.rates)||!value.rates.length||value.rates.length>31)bad();
 assertPayrollItemFields(value.insuranceUnchanged,['sourceRefs','authorityOccurredAt','reason']);
 const rates=value.rates.map((r:any)=>{assertPayrollItemFields(r,['from','to','payBasis','amount','originalPayVersion','sourceRefs','authorityOccurredAt','reason']);
  if(!validDate(r.from)||!validDate(r.to)||!r.from.startsWith(month+'-')||!r.to.startsWith(month+'-')||r.from>r.to||!['monthly','hourly'].includes(r.payBasis)||typeof r.amount!=='string'||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(r.amount)||Number(r.amount)<=0||!payrollItemIdentifier(r.originalPayVersion))bad();
  return {...proof(r),from:r.from,to:r.to,payBasis:r.payBasis,amount:r.amount,originalPayVersion:r.originalPayVersion};
 }).sort((a:any,b:any)=>a.from.localeCompare(b.from));
 if(rates.some((r:any,i:number)=>i&&r.from<=rates[i-1].to))bad();const insuranceUnchanged=proof(value.insuranceUnchanged);
 let paymentAllocationDisposition:HistoricalPaymentAllocationDisposition|undefined;
 if('paymentAllocationDisposition' in value){
  assertPayrollItemFields(value.paymentAllocationDisposition,['mode','sourceRefs','authorityOccurredAt','reason']);
  if(value.paymentAllocationDisposition.mode!=='retain-original-cash')bad();
  paymentAllocationDisposition={mode:'retain-original-cash',...proof(value.paymentAllocationDisposition)};
 }
 let compOriginalWageDisposition:HistoricalCompOriginalWageDisposition|undefined;
 if('compOriginalWageDisposition' in value){
  assertPayrollItemFields(value.compOriginalWageDisposition,['mode','sourceRefs','authorityOccurredAt','reason']);
  if(value.compOriginalWageDisposition.mode!=='retain-recorded-comp-wage')bad();
  compOriginalWageDisposition={mode:'retain-recorded-comp-wage',...proof(value.compOriginalWageDisposition)};
 }
 const proofs:HistoricalRateProof[]=[...rates,insuranceUnchanged,...(paymentAllocationDisposition?[paymentAllocationDisposition]:[]),...(compOriginalWageDisposition?[compOriginalWageDisposition]:[])];
 if(proofs.some(r=>Date.parse(r.authorityOccurredAt)>Date.parse(at)))bad();
 return {rates,insuranceUnchanged,...(paymentAllocationDisposition?{paymentAllocationDisposition}:{}),...(compOriginalWageDisposition?{compOriginalWageDisposition}:{})};
}
/** Only a server-verified complete ORIGINAL snapshot is accepted. No hydrated
 * employee, ready flag, tax result or target amount comes from the proposal.
 * This is a correction candidate, never an original-run rewrite or legal release. */
export function calculateFrozenHistoricalRateCorrection(loaded:PayrollMonthSource,empId:string,raw:unknown,at:string){
 if(loaded.kind!=='locked'||loaded.completeness!=='complete'||!payrollItemIdentity(empId))throw Object.assign(new Error('需完整且可驗證的原始鎖月快照；缺失歷史主檔不能重建'),{statusCode:409});
 const month=loaded.run.yearMonth,correction=validateHistoricalRateCorrection(raw,month,at),originalEmployee=loaded.run.inputs.employees.find((e:any)=>e.id===empId) as any;
 const originalSalary=loaded.salaries.find(s=>s.empId===empId);if(!originalEmployee||!originalSalary)bad();
 const original={runId:loaded.run.id,inputHash:loaded.originalInputHash,sourceHash:loaded.sourceHash,runHash:evidenceHash(loaded.run),lockHash:evidenceHash(loaded.lock),salaryHash:evidenceHash(originalSalary)};
 const tags:string[]=[];
 if(correction.paymentAllocationDisposition?.mode==='retain-original-cash')tags.push('payment-retain');
 if(correction.compOriginalWageDisposition?.mode==='retain-recorded-comp-wage')tags.push('comp-retain');
 const adapterVersion=tags.length?`historical-rate-correction-${tags.join('-')}-v1`:'historical-rate-correction-v1';
 const bundleHash=evidenceHash({original,correction,calculatorVersion:PAYROLL_VERSION,adapterVersion});
 const emp=sanitizePayrollSnapshot(originalEmployee),envelope=(loaded.run as any).sourceEvidence,issues:string[]=[];
 if(!Array.isArray(emp.normalPayDays)||!Array.isArray(emp.normalPayContextDays)||!emp.effectiveMasterVersion)issues.push('original-effective-master-and-context-missing');
 const item=envelope?.itemInventories?.[empId];
 if(assessPayrollItemInventory(item?.version).status!=='confirmed-none'||emp.payrollItemExecution||envelope?.itemExecutions?.[empId])issues.push('historical-item-reclassification-unsupported');
 const hasAllocation=!!envelope?.paymentAllocations?.[empId];
 if(hasAllocation){
  if(correction.paymentAllocationDisposition?.mode==='retain-original-cash'){
   // Explicit retain: corrected target is comparison/D only; original cash allocation stays bound to the frozen run. Cash rebinding is a separate adapter.
  }else{
   issues.push('historical-payment-allocation-rebinding-required');
  }
 }else if(correction.paymentAllocationDisposition){
  issues.push('historical-payment-allocation-disposition-without-allocation');
 }
 const hasComp=!!(emp.normalPayCompEvidence?.outstanding?.length||emp.normalPayCompEvidence?.credits?.length||emp.normalPayCompEvidence?.intervals?.length);
 if(hasComp){
  if(correction.compOriginalWageDisposition?.mode==='retain-recorded-comp-wage'){
   // Explicit retain: frozen comp credits/intervals keep their recorded original wage; rate correction does not recompute them.
  }else{
   issues.push('historical-comp-original-wage-review-required');
  }
 }else if(correction.compOriginalWageDisposition){
  issues.push('historical-comp-original-wage-disposition-without-comp');
 }
 if(!emp.insuranceSource?.versionId||!emp.insuranceSource?.evidenceVersion||!Array.isArray(emp.insurancePeriods))issues.push('original-insurance-evidence-missing');
 for(const rate of correction.rates){
  const affected=(emp.normalPayDays||[]).filter((d:any)=>d.date>=rate.from&&d.date<=rate.to);
  const expected=(Date.parse(rate.to+'T00:00:00Z')-Date.parse(rate.from+'T00:00:00Z'))/86400000+1;
  if(affected.length!==expected||new Set(affected.map((d:any)=>d.date)).size!==expected||affected.some((d:any)=>d.payBasis!==rate.payBasis||d.payVersion!==rate.originalPayVersion||d.employmentState!=='active')){issues.push('rate-correction-original-period-or-basis-mismatch');continue;}
  for(const d of affected){d.amount=rate.amount;d.payVersion='correction-'+bundleHash;}
 }
 // Keep the original policy, day types, actual-work approvals and enrollment.
 // The explicit insurance-unchanged proof is separately reviewed with the rate.
 // Unsupported or mismatched domains must stop before the general calculator:
 // their stored structures may be incomplete, and cannot supply trusted inputs.
 if(issues.length){
  const unique=[...new Set(issues)],content:Omit<PayrollComparisonSource,'sourceHash'>={schemaVersion:'payroll-comparison-source-v1',empId,month,calculationVersion:PAYROLL_VERSION,status:'needs-review',sources:[{kind:'payroll-inputs',id:empId,version:bundleHash}],lines:[],totals:{gross:null,deductions:null,net:null},inventoryStatus:'unresolved-historical-correction',rounding:null,issues:unique,formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'};
  return sanitizePayrollSnapshot({original,correction,bundleHash,calculatorVersion:PAYROLL_VERSION,adapterVersion,status:'needs-review',issues:unique,source:{...content,sourceHash:evidenceHash(content)},salary:null,formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});
 }
 const salary=calculateSalaryForEmployee(emp,month,loaded.run.inputs.schedules,loaded.run.inputs.records,loaded.run.inputs.leaves);
 const sources=[{kind:'payroll-inputs',id:empId,version:bundleHash},...(emp.insuranceSource?.versionId?[{kind:'insurance-timeline',id:emp.insuranceSource.versionId,version:emp.insuranceSource.evidenceVersion}]:[]),...(item?.source?[{kind:'payroll-item-inventory',id:item.source.id,version:String(item.source.revision)}]:[])];
 const source=projectPayrollComparisonSource({salary,sources,inventory:item?.version});
 issues.push(...source.issues);const unique=[...new Set(issues)];
 if(unique.length){source.status='needs-review';source.issues=unique;source.totals={gross:null,deductions:null,net:null};const {sourceHash:ignored,...content}=source;source.sourceHash=evidenceHash(content);}
 return sanitizePayrollSnapshot({original,correction,bundleHash,calculatorVersion:PAYROLL_VERSION,adapterVersion,status:unique.length?'needs-review':'calculated',issues:unique,source,salary,formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});
}

/** Verifies the comparison envelope itself; trusted loader additionally binds it
 * to original hashes, correction facts and immutable reviewed calculation. */
export function validHistoricalCorrectedSource(source:any,bundleHash?:string):boolean {
 if(!source||typeof source.sourceHash!=='string')return false;const {sourceHash,...content}=source;
 return sourceHash===evidenceHash(content)&&source.formalEligibility==='BLOCKED'&&source.applicationStatus==='not-applied'&&source.paymentStatus==='not-paid'&&(!bundleHash||source.sources?.some((r:any)=>r.kind==='payroll-inputs'&&r.version===bundleHash));
}
