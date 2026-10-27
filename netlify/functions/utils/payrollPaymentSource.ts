import {loadPayrollMonthSource,type PayrollSourceReader} from './payrollSourceReader';
import {loadPayrollPreWithholdingSource} from './payrollPreWithholdingSource';
import {loadApprovedPayrollPaymentEvidence} from './payrollPaymentEvidence';
import {loadApprovedPayrollPaymentAllocationEvidence} from './payrollPaymentAllocation';
import {assessPaymentAllocation} from '../../../utils/payroll/paymentAllocation';
import {evidenceHash} from './attendanceCaseLifecycle';
import {decimal,evidence,sum} from '../../../utils/payroll/rational';
import type {WithholdingResult} from '../../../utils/payroll/withholding';

/** Base inputs -> approved actual events/allocation -> calculated withholding.
 * Allocation workflows read only the base upstream projection, never this layer.
 * The resulting evidence enters the canonical archive/hash before D comparison.
 * All reads share the caller's transaction; no record is rebound or rewritten.
 */
export async function loadPayrollMonthWithPaymentEvidence(db:any,reader:PayrollSourceReader,args:{month:string;at:string}){
 const base=await loadPayrollMonthSource(db,reader,args);
 if(base.kind!=='live')return base;
 const resolved:Record<string,{result:WithholdingResult;evidence:unknown}>={};
 for(const salary of base.evaluation.salaries){
  if(salary.withholdingDetail?.method!=='part-time-5')continue;
  const allocation=await loadApprovedPayrollPaymentAllocationEvidence(db,reader,salary.empId,args.month);
  if(!allocation.approved||!allocation.source)continue;
  const payment=await loadApprovedPayrollPaymentEvidence(db,reader,salary.empId,args.month);
  if(!payment.approved||!payment.source)continue;
  const upstream=await loadPayrollPreWithholdingSource(db,reader,{...args,empId:salary.empId},base);
  if(!upstream.source||upstream.source.status!=='ready'||upstream.baseSourceHash!==base.sourceHash||payment.approved.sourceBinding.sourceHash!==base.sourceHash)continue;
  const bound={payment:payment.source,preWithholding:{sourceHash:upstream.source.sourceHash,baseSourceHash:base.sourceHash}};
  const approved=allocation.approved;
  if(evidenceHash(approved.sourceBinding)!==evidenceHash(bound)||evidenceHash(approved.sourceSnapshot)!==evidenceHash(upstream.source)||evidenceHash(approved.paymentInventory)!==evidenceHash(payment.approved.inventory))continue;
  const assessment=assessPaymentAllocation(approved.allocation,{source:upstream.source,paymentEvidence:payment.approved.inventory});
  if(assessment.status!=='ready-calculation'||evidenceHash(assessment)!==evidenceHash(approved.assessment)||assessment.totals.calculatedIncomeTax===null||assessment.totals.calculatedSupplementaryPremium===null)continue;
  const results=assessment.eventResults;
  if(results.some(r=>r.taxableBase===null||r.supplementaryBase===null))continue;
  const result:WithholdingResult={status:'ready',issues:[],method:'part-time-5',exemptOvertime:evidence(decimal(upstream.source.taxExemptOvertime.amount)),taxableBase:evidence(sum(results.map(r=>decimal(r.taxableBase!)))),supplementaryBase:evidence(sum(results.map(r=>decimal(r.supplementaryBase!)))),incomeTax:assessment.totals.calculatedIncomeTax,supplementaryPremium:assessment.totals.calculatedSupplementaryPremium};
  resolved[salary.empId]={result,evidence:{paymentSource:payment.source,allocationSource:allocation.source,sourceBinding:bound,sourceSnapshot:upstream.source,paymentInventory:payment.approved.inventory,allocation:approved.allocation,assessment}};
 }
 if(!Object.keys(resolved).length)return base;
 // Re-evaluate all original source inventories, not a narrowed display snapshot.
 // The transaction guarantees that the approved bindings and recalculation see
 // one consistent source, and all new evidence is included in its archive hash.
 return loadPayrollMonthSource(db,reader,args,resolved);
}
