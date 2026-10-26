import {loadPayrollReconciliationEvidence,reconciliationPrerequisites} from './payrollReconciliation';
import {loadApprovedPayrollPaymentEvidence} from './payrollPaymentEvidence';
import {assessPaymentEvidence} from '../../../utils/payroll/paymentEvidence';
import {loadPayrollAdjustmentEvidence} from './payrollAdjustments';
import type {SalaryDetail} from '../../../types';
import {loadWorktimeSourceEvidence,type WorktimeSourceEvidence} from './worktimeSourceEvidence';
import {loadPayrollMonthWithPaymentEvidence} from './payrollPaymentSource';
import {loadPayrollMonthSource,type PayrollSourceReader,type PayrollMonthSource} from './payrollSourceReader';
import {loadPayrollDifferenceAdoptionEvidence,type PayrollDifferenceAdoptionProof} from './payrollDifference';
import {annotatePayrollFormalEvidence,attendanceCaseIssues,attendanceMonthIssues} from './payrollPreflight';
import {assessPayrollItemInventory} from '../../../utils/payroll/items';
import {evidenceHash} from './attendanceCaseLifecycle';

interface PrerequisiteCheck {satisfied:boolean;issues:string[];identity:unknown|null}
export interface EmployeePayrollFormalEvidence {
 empId:string;month:string;sourceHash:string;
 items:PrerequisiteCheck;attendance:PrerequisiteCheck;difference:PayrollDifferenceAdoptionProof;worktime:WorktimeSourceEvidence;payment?:PrerequisiteCheck;
}
/** Outer trusted reader, deliberately separate from the canonical source reader.
 * Both phases use the caller's same transaction. No proof from this phase enters
 * snapshotInputs, sourceEvidence, sourceHash, or comparison hashes. D mutation
 * paths continue using the base reader and cannot recursively read themselves.
 * There are no writes, amount overrides or payment actions; normal locking requires every current independently reviewed prerequisite. */
/** Accounting annotations are a separate read model: no ledger data feeds
 * calculation hashes, historical target amounts, tax bases or payment facts. */
async function annotateAdjustments(db:any,reader:PayrollSourceReader,month:string,salaries:SalaryDetail[]){
 const result:SalaryDetail[]=[];
 for(const salary of salaries){
  const scopes:Record<string,unknown>={},issues:string[]=[];
  for(const scope of ['current','historical'] as const){
   try{
    const evidence=await loadPayrollAdjustmentEvidence(db,reader,{empId:salary.empId,month,scope});
    if(evidence.runs.length)scopes[scope]={projection:evidence.projection,runs:evidence.runs,targetFreshness:evidence.targetFreshness,paymentStatus:'not-paid',automaticWageDeduction:false};
   }catch{issues.push('薪資調整帳本歷程無法完整核實：'+scope);}
  }
  result.push(Object.keys(scopes).length||issues.length?{...salary,adjustmentEvidence:{status:issues.length?'unknown':'verified',issues,scopes}}:salary);
 }
 return result;
}
export async function loadPayrollMonthWithFormalEvidence(db:any,reader:PayrollSourceReader,args:{month:string;at:string;skipReconciliation?:boolean}){
 const source=await loadPayrollMonthWithPaymentEvidence(db,reader,args);
 if(source.kind==='locked')return {...source,salaries:await annotateAdjustments(db,reader,args.month,source.salaries)};
 if(source.kind!=='live')return source;
 const employees:Record<string,EmployeePayrollFormalEvidence>={};
 const monthCache=new Map<string,Promise<PayrollMonthSource>>([[args.month,Promise.resolve(source)]]);
 const loadMonth=(month:string)=>{if(!monthCache.has(month))monthCache.set(month,loadPayrollMonthSource(db,reader,{month,at:args.at}));return monthCache.get(month)!;};
 for(const salary of source.evaluation.salaries){
  const empId=salary.empId,item=source.sourceEvidence.itemInventories[empId],v=item?.version;
  const assessed=assessPayrollItemInventory(v);
  const noneOkay=!!v&&v.empId===empId&&v.month===args.month&&v.inventory?.mode==='none'&&assessed.status==='confirmed-none'&&item.assessment?.status==='confirmed-none'&&
   item.source?.id===v.id&&item.source.revision===v.revision&&item.source.evidenceVersion===evidenceHash(v);
  const execution=source.sourceEvidence.itemExecutions?.[empId],application=salary.itemApplication;
  const executionOkay=!!v&&v.inventory.mode==='items'&&!!execution?.approved&&execution.assessment?.status==='ready'&&application?.status==='ready'&&!!application.source&&evidenceHash(application.source)===evidenceHash(execution.source)&&execution.binding?.inventory?.id===v.id&&execution.binding.inventory.revision===v.revision;
  const itemOkay=noneOkay||executionOkay;
  const items:PrerequisiteCheck={satisfied:itemOkay,issues:itemOkay?[]:assessed.issues.length?assessed.issues:['當前其他項目清冊不是完整核定的明示無項目證據'],identity:executionOkay?{inventory:item.source,execution:execution!.source}:item?.source||null};
  const month=source.sourceEvidence.attendanceMonthEvidence?.[empId],cases=source.sourceEvidence.caseEvidence[empId];
  const monthIssues=attendanceMonthIssues(args.month,empId,source.sourceEvidence.attendanceMonthEvidence);
  const caseIssues=attendanceCaseIssues(args.month,empId,source.sourceEvidence.cases,cases);
  const attendanceOkay=!!month&&month.empId===empId&&month.month===args.month&&month.inventory==='complete'&&month.scan==='current'&&
   !!cases&&cases.empId===empId&&cases.month===args.month&&cases.inventory==='loaded'&&Array.isArray(cases.assessments)&&cases.assessments.every(a=>a.status==='current-clear'&&['relevant','unrelated'].includes(a.scope))&&
   monthIssues.trial.length===0&&monthIssues.formal.length===0&&caseIssues.length===0;
  const attendance:PrerequisiteCheck={satisfied:attendanceOkay,issues:attendanceOkay?[]:[...monthIssues.trial,...monthIssues.formal,...caseIssues].map(i=>i.message).concat(!cases?['當前案件閉合證據缺漏']:['當前整月與案件證據尚未全部核實']),identity:month?.observationDigest?{observationDigest:month.observationDigest}:null};
  const comparison=source.comparisons[empId];
  const difference:PayrollDifferenceAdoptionProof=comparison?await loadPayrollDifferenceAdoptionEvidence(db,reader,{empId,month:args.month,monthSourceHash:source.sourceHash,source:comparison}):{status:'invalid',identity:null,issues:['當前員工逐項比較來源缺漏']};
  const worktime=await loadWorktimeSourceEvidence(db,reader,{empId,month:args.month,at:args.at},{loadMonth});
  const allocation=source.sourceEvidence.paymentAllocations?.[empId];
  const paymentAssessment=(allocation?.evidence as any)?.assessment;
  const actual=await loadApprovedPayrollPaymentEvidence(db,reader,empId,args.month);
  const baseSourceHash=(allocation?.evidence as any)?.sourceBinding?.preWithholding?.baseSourceHash||source.sourceHash;
  const actualAssessment=actual.approved?assessPaymentEvidence(actual.approved.inventory,{empId,month:args.month,monthlyPayable:comparison?.totals.net,payableSourceRef:baseSourceHash}):null;
  const fresh=!!actual.approved&&actual.approved.sourceBinding.sourceHash===baseSourceHash;
  const paymentOkay=fresh&&actualAssessment?.status==='ready-evidence'&&(!allocation||paymentAssessment?.reconciliationStatus==='zero');
  const payment:PrerequisiteCheck={satisfied:paymentOkay,issues:paymentOkay?[]:[...(!actual.approved?['缺少目前核定的實際給付證據']:[]),...(!fresh?['實際給付證據來源未綁定目前計算']:[]),...(actualAssessment?.issues||[]),...(allocation&&paymentAssessment?.reconciliationStatus!=='zero'?(paymentAssessment?.reconciliationIssues||['實際給付及扣繳尚未對齊']):[])],identity:actual.source?{paymentSource:actual.source,...(allocation?{allocationSource:(allocation.evidence as any)?.allocationSource}:{} )}:null};
  employees[empId]={empId,month:args.month,sourceHash:source.sourceHash,items,attendance,difference,worktime,...(payment?{payment}:{})};
 }
 const prerequisites={schemaVersion:'payroll-formal-evidence-v1' as const,month:args.month,sourceHash:source.sourceHash,employees,legalValidation:'not-certified' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const};
 const initialEvaluation=annotatePayrollFormalEvidence(source.evaluation,prerequisites);
 const candidate={...source,evaluation:initialEvaluation,formalEvidence:prerequisites};
 let reconciliation:{satisfied:boolean;identity:unknown|null;issues:string[]}={satisfied:false,identity:null,issues:['整月對帳尚未核定']};
 if(!args.skipReconciliation){try{reconciliation=await loadPayrollReconciliationEvidence(db,reader,reconciliationPrerequisites(candidate));}catch{reconciliation={satisfied:false,identity:null,issues:['完整員工名冊或月對帳來源無法核實']};}}
 const evaluation=annotatePayrollFormalEvidence(source.evaluation,{...prerequisites,reconciliation});
 const formalEvidence={...prerequisites,reconciliation,formalEligibility:evaluation.status};
 return {...source,evaluation:{...evaluation,salaries:args.skipReconciliation?evaluation.salaries:await annotateAdjustments(db,reader,args.month,evaluation.salaries)},formalEvidence};
}
