import {UserRole} from '../../types';
import {review} from './payrollV2';
import {normalPolicy,normalDays} from './normalPay';
import {makeStoredPayrollReview} from '../../netlify/functions/utils/payrollReviewStorage';
// Synthetic approved sources only, never company policy or production activation.
export const terminationSeed=()=>{
 const emp={id:'TERM',name:'合成離職員工',role:UserRole.Employee,hireDate:'2026-01-01',position:'專責人員',monthlySalary:31000,accountKind:'employee'};
 const period={employmentType:'full-time',payBasis:'monthly',amount:31000,policyVersionId:'TP',dayTypeCalendarId:'TD'};
 const r={...review,yearMonth:'2026-08',payBasis:'monthly',policy:{...review.policy,regularDates:normalDays().map(d=>d.date)}};
 return new Map<string,any>([
 ['employees/TERM',emp],['employees/TERM_REVIEWER',{id:'TERM_REVIEWER',role:UserRole.SuperAdmin}],
 ['payrollMasterHeads/TERM',{currentVersionId:'TM',revision:1}],['payrollMasterVersions/TM',{empId:'TERM',status:'approved',approvedBy:'source-reviewer',approvedAt:'2026-01-01T00:00:00Z',timeline:{accountKind:'employee',from:'2026-08-01',to:'2026-09-30',periods:[{...period,from:'2026-08-01',to:'2026-08-15',employmentState:'active'},{...period,from:'2026-08-16',to:'2026-09-30',employmentState:'not-employed'}]}}],
 ['payrollPolicyVersions/TP',{version:review.policy.version,status:'approved',approvedBy:'source-reviewer',approvedAt:'2026-01-01T00:00:00Z',employeeIds:['TERM'],from:'2026-08-01',to:'2026-09-30',normalPay:normalPolicy()}],
 ['dayTypeCalendars/TD',{version:'synthetic-days',status:'approved',approvedBy:'source-reviewer',approvedAt:'2026-01-01T00:00:00Z',employeeIds:['TERM'],days:Object.fromEntries([...normalDays(),...normalDays('2026-09')].map(d=>[d.date,'normal']))}],
 ['payrollReviews/TERM_2026-08',{...makeStoredPayrollReview(emp,r as any),masterVersionId:'TM'}]
 ]);
};
export const terminationManual=()=>({currency:'TWD',precision:2,items:[
 {code:'normal',kind:'earning',amount:'15000.00',sourceCode:'normal:monthly-calendar-segment',reason:'合成逐日來源一致核對'},
 ...['labor','health','pensionSelf'].map(key=>({code:key,kind:'deduction',amount:'0.00',sourceCode:'insurance:'+key,reason:'合成來源明示核定零元'})),
 {code:'net',kind:'net',amount:'15000.00',sourceCode:'manual-net',reason:'合成逐項合計實發核對'}
]});
