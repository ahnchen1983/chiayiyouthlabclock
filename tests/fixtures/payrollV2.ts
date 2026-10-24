import type { ClockRecord, PayrollReview, ScheduleEvent, LeaveRequest } from '../../types';
import { LeaveType, LeaveStatus } from '../../types';
import { clockSourceKey, clockInterval } from '../../utils/attendance';
export const month = '2026-04';
export const review: PayrollReview = { yearMonth: month, reviewedBy: 'SYNTH-reviewer', reviewedAt: '2026-05-01T00:00:00Z', policy: {
    version: 'fixture-regular-day-8h-actual-v1', hoursBasis: 'actual', moneyDecimals: 2, workDateRule: 'clock-in-date', dailyRegularMinutes: 480,
    regularDates: Array.from({length:30},(_,i)=>`2026-04-${String(i+1).padStart(2,'0')}`),
    overtimeTiers: [{minutes:120,numerator:4,denominator:3},{minutes:120,numerator:5,denominator:3}],
    hourlyLeavePaidFraction: { [LeaveType.Personal]:0, [LeaveType.Annual]:1, [LeaveType.Sick]:0.5 },
    monthlyLeaveDeductionFraction: { [LeaveType.Personal]:1, [LeaveType.Annual]:0, [LeaveType.Sick]:0.5, [LeaveType.OfficialBusiness]:0, [LeaveType.BusinessTrip]:0, [LeaveType.RemoteWork]:0 }, monthlyHourlyDivisor:240,
}, insurance:{labor:0,health:0,pensionSelf:0} };
export const employee = {id:'SYNTH',name:'合成員工',position:'兼職人員',hourlyRate:200,payrollReview:review};
export const card = (date='2026-04-01', from='09:00', to='17:00', approved=true): ClockRecord => {
    const r: ClockRecord = {id:date,empId:employee.id,name:employee.name,date,clockInTime:from,clockOutTime:to,workHours:99,status:'正常',verificationMethod:'IP',verificationData:'synthetic'};
    if(approved) { r.workIntervals=[clockInterval(r)!]; r.workReview={sourceKey:clockSourceKey(r),reviewedBy:'SYNTH-reviewer',reviewedAt:review.reviewedAt}; }
    return r;
};
export const schedule = (date='2026-04-01',from='09:00',to='17:00'): ScheduleEvent => ({date,dayOfWeek:'三',status:'營運',shifts:[{empId:employee.id,name:employee.name,role:'partTime',from,to}]});
export const leave = (date='2026-04-01',type=LeaveType.Personal): LeaveRequest => ({id:'L1',empId:employee.id,name:employee.name,leaveType:type,startDate:`${date}T13:00`,endDate:`${date}T17:00`,hours:4,reason:'synthetic',requestDate:date,status:LeaveStatus.Approved,payrollAllocations:[{date,from:'13:00',to:'17:00',minutes:240}]});
