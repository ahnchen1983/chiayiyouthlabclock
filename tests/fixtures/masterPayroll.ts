import {employee,month,review,card} from './payrollV2';
import {normalDays,normalPolicy} from './normalPay';
import {employeePayrollSourceKey} from '../../netlify/functions/utils/payrollReviewStorage';
/** Explicit synthetic source only; never activates a real historical master. */
export async function seedMasterPayroll(write:(path:string,value:any)=>Promise<void>|void,person:any,admin:string){
 const period={employmentState:'active',employmentType:'part-time',payBasis:'hourly',amount:200,policyVersionId:'CANON_POLICY',dayTypeCalendarId:'CANON_DAYS'};
 const timeline={accountKind:'employee',from:'2026-03-26',to:'2026-05-06',periods:[{...period,from:'2026-03-26',to:'2026-03-31',employmentState:'not-employed'},{...period,from:'2026-04-01',to:'2026-05-06'}]};
 await write('payrollMasterVersions/CANON_MASTER',{empId:employee.id,status:'approved',approvedBy:admin,approvedAt:review.reviewedAt,timeline});
 await write('payrollMasterHeads/'+employee.id,{currentVersionId:'CANON_MASTER',revision:1});
 await write('payrollPolicyVersions/CANON_POLICY',{status:'approved',version:review.policy.version,approvedBy:admin,approvedAt:review.reviewedAt,employeeIds:[employee.id],from:'2026-03-26',to:'2026-05-06',normalPay:{...normalPolicy(),overtimeRules:{schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240}}});
 await write('dayTypeCalendars/CANON_DAYS',{status:'approved',version:'synthetic-canonical-days',approvedBy:admin,approvedAt:review.reviewedAt,employeeIds:[employee.id],days:Object.fromEntries([...normalDays('2026-03'),...normalDays(month),...normalDays('2026-05')].map(d=>[d.date,'normal']))});
 await write('payrollReviews/'+employee.id+'_'+month,{empId:employee.id,yearMonth:month,review:{...review,policy:{...review.policy,regularDates:[]}},employeeSourceKey:employeePayrollSourceKey(person),masterVersionId:'CANON_MASTER'});
 await write('insuranceTimelineHeads/'+employee.id,{currentVersionId:'CANON_INS',revision:1});
 await write('insuranceTimelineVersions/CANON_INS',{empId:employee.id,status:'approved',approvedBy:admin,approvedAt:review.reviewedAt,periods:[{from:'2026-01-01',to:'2026-12-31',laborInsured:false,laborSalary:0,employmentInsured:false,healthInsuredHere:false,healthAmount:0,healthDependants:0,pensionWage:0,pensionSelfPercent:0,withholdingMethod:'table'}]});
 await write('clockRecords/C1',{...card(undefined,'08:00','17:00'),id:'C1'});
}
