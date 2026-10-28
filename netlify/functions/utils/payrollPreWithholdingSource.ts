import {loadPayrollMonthSource,type PayrollSourceReader,type PayrollMonthSource} from './payrollSourceReader';
import {evidenceHash} from './attendanceCaseLifecycle';
import {exemptOvertime} from '../../../utils/payroll/withholding';
import {add,rational,rounded,decimal,mul,validRounding} from '../../../utils/payroll/rational';
import type {PaymentAllocationSource} from '../../../utils/payroll/paymentAllocation';

/** Upstream source never reads payment facts or allocations. In particular its
 * identity excludes calculated tax, net pay and downstream comparison approval.
 * A payment inventory recorded while net is unknown retains its original binding.
 */
export async function loadPayrollPreWithholdingSource(db:any,reader:PayrollSourceReader,args:{empId:string;month:string;at:string},existingSource?:PayrollMonthSource):Promise<{source:PaymentAllocationSource|null;baseSourceHash:string|null;issues:string[]}>{
 const base=existingSource??await loadPayrollMonthSource(db,reader,{month:args.month,at:args.at});
 if(base.kind!=='live')return {source:null,baseSourceHash:null,issues:['pre-withholding-source-requires-unlocked-original-month']};
 const salary=base.evaluation.salaries.find(s=>s.empId===args.empId),employee=(base.snapshotInputs.employees as any[]).find(e=>e.id===args.empId);
 if(!salary||!employee)return {source:null,baseSourceHash:base.sourceHash,issues:['pre-withholding-employee-missing']};
 const n=salary.normalPayPreview,c=n?.combined,insurance=salary.insuranceDetail,issues:string[]=[];
 const unresolved=(issue:string)=>({source:null,baseSourceHash:base.sourceHash,issues:[...issues,issue]});
 if(!n||!c||c.status!=='ready'||n.status!=='ready'||c.amount==null||!validRounding(n.rounding))return unresolved('confirmed-pre-withholding-earnings-unavailable');
 if(!insurance||insurance.status!=='ready'||!employee.insuranceSource?.versionId||!employee.insuranceSource?.evidenceVersion)return unresolved('confirmed-insurance-and-pension-source-unavailable');
 const taxIssues=new Set(salary.withholdingDetail?.issues||[]);
 issues.push(...(salary.reviewReasons||[]).filter(issue=>!taxIssues.has(issue)));
 const itemInventory=base.sourceEvidence.itemInventories[args.empId],execution=base.sourceEvidence.itemExecutions?.[args.empId],application=salary.itemApplication;
 const executableItems=itemInventory?.version?.inventory.mode==='items'&&!!execution?.approved&&execution.assessment?.status==='ready'&&application?.status==='ready'&&!!application.source&&evidenceHash(application.source)===evidenceHash(execution.source);
 if(itemInventory?.assessment.status!=='confirmed-none'&&!executableItems)issues.push('additional-item-treatment-unresolved');
 const ot=n.overtimePreview;
 if(!ot||ot.blocking.length||ot.issues.length)return unresolved('confirmed-overtime-source-unavailable');
 // The extended exemption depends on an applicable lawful 54/138 regime. Until
 // that tax treatment is bound, do not silently tax a potentially exempt balance.
 if(ot.lines.filter(l=>['weekday-overtime','rest-day-additional'].includes(l.kind)).reduce((v,l)=>v+l.minutes,0)>46*60)issues.push('extended-overtime-tax-exemption-regime-unresolved');
 const exemption=exemptOvertime(ot.lines.filter(l=>l.exact));
 if(exemption.d!==1n)return unresolved('fractional-overtime-exemption-allocation-unresolved');
 const fraction=(v:{numerator:string;denominator:string})=>rational(BigInt(v.numerator),BigInt(v.denominator));
 // Canonicalize exact integers after the approved rounding stage. A stored
 // precision-two value such as 32000.00 is the same amount as 32000; this
 // conversion must never round a genuinely fractional statutory basis.
 const integerAmount=(value:string)=>{const v=decimal(value);if(v.n<0n||v.d!==1n)throw Error('pre-withholding-final-amount-not-integral');return v.n.toString();};
 const normalRounded=rounded(fraction(c.normalExact),n.rounding),beforeComp=rounded(add(fraction(c.normalExact),fraction(c.overtimeExact!)),n.rounding);
 const diff=(a:string,b:string)=>{const v=add(decimal(a),mul(decimal(b),rational(-1n)));if(v.n<0n||v.d!==1n)throw Error('pre-withholding-final-allocation-not-integral');return v.n.toString();};
 try{
  const normal=integerAmount(normalRounded);
  const amounts=[['normal',normal],['overtime',diff(beforeComp,normal)],['comp-settlement',diff(c.amount,beforeComp)]];
  if(amounts.some(([,amount])=>!/^\d+$/.test(amount)))return unresolved('pre-withholding-final-amounts-unresolved');
  const evidenceRef=(kind:string,value:unknown)=>kind+':'+evidenceHash(value);
  const earnings=amounts.map(([code,amount])=>({code,amount,sourceRef:evidenceRef('earning',[base.sourceHash,code,amount])}));
  if(executableItems)for(const line of application!.lines.filter(l=>l.kind==='earning')){const amount=integerAmount(line.appliedAmount!);earnings.push({code:line.code,amount,sourceRef:evidenceRef('earning-item',[base.sourceHash,execution!.source,line])});}
  const otherDeductions=['labor','employment','health'].map(item=>({code:'insurance:'+item,amount:String(insurance.lines.filter(l=>l.item===item).reduce((v,l)=>v+l.amount,0)),sourceRef:evidenceRef('insurance',[employee.insuranceSource,item])}));
  if(executableItems)for(const line of application!.lines.filter(l=>l.kind==='deduction')){const amount=integerAmount(line.appliedAmount!);otherDeductions.push({code:line.code,amount,sourceRef:evidenceRef('deduction-item',[base.sourceHash,execution!.source,line])});}
  const content={empId:args.empId,month:args.month,status:issues.length?'needs-review' as const:'ready' as const,issues:[...new Set(issues)],method:salary.withholdingDetail?.method||null,earnings,taxExemptOvertime:{amount:exemption.n.toString(),sourceRef:evidenceRef('exempt-overtime',[base.sourceHash,ot.lines])},pensionSelf:{amount:String(insurance.pensionSelf),sourceRef:evidenceRef('pension',employee.insuranceSource)},otherDeductions};
  const source:PaymentAllocationSource={...content,sourceHash:evidenceHash({baseSourceHash:base.sourceHash,source:content})};
  return {source,baseSourceHash:base.sourceHash,issues:source.issues};
 }catch{return unresolved('pre-withholding-amount-projection-unresolved');}
}
