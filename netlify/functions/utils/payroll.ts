import {employmentWindowStates} from '../../../utils/employmentAuthority';
import {normalPayPreview} from './normalPayPreview';
import type { ClockRecord, LeaveRequest, ScheduleEvent, SalaryDetail, SystemConfig, PayrollReview } from '../../../types';
import { LeaveStatus, isOutingLeaveType } from '../../../types';
import { clockInterval, confirmedWork, shiftIntervals, intervalMinutes, hhmmMinutes, leaveEndMinutes, validDate, clockSourceKey } from '../../../utils/attendance';
import { roundMoney } from '../../../utils/format';

const leaveInstant = (value: string): number => Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(value || '') ? value : value + '+08:00');
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => Math.min(a.end, b.end) > Math.max(a.start, b.start);

export const validLeaveAllocations = (leave: LeaveRequest, allocations = leave.payrollAllocations): boolean => {
    if (typeof leave.startDate !== 'string' || typeof leave.endDate !== 'string' || !Array.isArray(allocations)) return false;
    const from = leaveInstant(leave.startDate), to = leaveInstant(leave.endDate);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !Number.isFinite(leave.hours) || leave.hours < 0 || !allocations.length) return false;
    const ranges = [];
    for (const a of allocations) {
        if (!a || typeof a !== 'object' || typeof a.date !== 'string' || typeof a.from !== 'string' || typeof a.to !== 'string') return false;
        const start = leaveInstant(`${a.date}T${a.from}`), end = leaveInstant(`${a.date}T${a.to}`);
        if (!validDate(a.date) || hhmmMinutes(a.from) === null || leaveEndMinutes(a.to) === null || !Number.isInteger(a.minutes) || a.minutes <= 0 || end - start !== a.minutes * 60000 || start < from || end > to) return false;
        ranges.push({start: start / 60000, end: end / 60000});
    }
    const total = allocations.reduce((n, a) => n + a.minutes, 0);
    return total <= leave.hours * 60 && intervalMinutes(ranges) === total;
};
const canonicalEvidence = (value: any): any => Array.isArray(value) ? value.map(canonicalEvidence)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalEvidence(value[key])])) : value;
// Snapshots and Firestore may reorder object fields. Bind exceptions to the same
// values after replay while preserving the order of shifts, sessions and leave rows.
export const scheduleEvidenceKey = (shifts: any[], records: ClockRecord[], leaves: any[]) => JSON.stringify(canonicalEvidence([shifts, records.map(r => [r.id, clockSourceKey(r)]), leaves]));
type DayLeave = { start: number; end: number; type: string; minutes: number };
const allocationRange = (leave: LeaveRequest, allocation: NonNullable<LeaveRequest['payrollAllocations']>[number]): DayLeave | null => {
    const start = hhmmMinutes(allocation.from), end = leaveEndMinutes(allocation.to);
    if (!validDate(allocation.date) || allocation.date < leave.startDate.slice(0, 10) || allocation.date > leave.endDate.slice(0, 10) || start === null || end === null || end <= start || allocation.minutes !== end - start) return null;
    return { start, end, type: leave.leaveType, minutes: allocation.minutes };
};
const employeeSchedule = (emp: any, yearMonth: string, events: ScheduleEvent[]) => new Map(events.filter(e => e.date.startsWith(yearMonth)).map(e => [e.date, e.shifts.filter(s => s.empId ? s.empId === emp.id : s.name === emp.name)]));
const scheduleCoverage = (shifts: ScheduleEvent['shifts'], records: ClockRecord[], leaves: DayLeave[]) => {
    const ranges = shiftIntervals(shifts);
    if (!ranges) return null;
    const cards = records.flatMap(r => { const span = clockInterval(r); return span ? [span] : []; });
    const coveredMinutes = intervalMinutes(ranges.flatMap(s => [...leaves, ...cards].map(l => ({ start: Math.max(s.start, l.start), end: Math.min(s.end, l.end) }))));
    return { scheduledMinutes: intervalMinutes(ranges), coveredMinutes };
};
const scheduleLeaves = (date: string, shifts: ScheduleEvent['shifts'], byDate: Map<string, DayLeave[]>): DayLeave[] => {
    const own = byDate.get(date) || [];
    const ranges = shiftIntervals(shifts);
    if (!ranges?.some(r => r.end > 1440)) return own;
    const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const following = (byDate.get(next.toISOString().slice(0, 10)) || []).map(l => ({ ...l, start: l.start + 1440, end: l.end + 1440 })).filter(l => ranges.some(r => overlaps(r, l)));
    return [...own, ...following];
};
// Return every uncovered schedule, including an already resolved gap. The caller
// can display the existing exception only when it still binds to this evidence.
export const getScheduleReviewGaps = (emp: any, yearMonth: string, events: ScheduleEvent[], records: ClockRecord[], leaves: LeaveRequest[]): { date: string; sourceKey: string; scheduledMinutes: number; coveredMinutes: number }[] => {
    const dayLeaves = new Map<string, DayLeave[]>();
    for (const leave of leaves) {
        if (leave.empId !== emp.id || leave.status !== LeaveStatus.Approved || !validLeaveAllocations(leave)) continue;
        for (const allocation of leave.payrollAllocations!) {
            const range = allocationRange(leave, allocation);
            if (!range) continue;
            dayLeaves.set(allocation.date, [...(dayLeaves.get(allocation.date) || []), range]);
        }
    }
    return [...employeeSchedule(emp, yearMonth, events)].flatMap(([date, shifts]) => {
        const cards = records.filter(r => r.empId === emp.id && r.date === date);
        const allocations = scheduleLeaves(date, shifts, dayLeaves);
        const coverage = scheduleCoverage(shifts, cards, allocations);
        return coverage && coverage.coveredMinutes < coverage.scheduledMinutes ? [{ date, sourceKey: scheduleEvidenceKey(shifts, cards, allocations), ...coverage }] : [];
    });
};
export const PAYROLL_VERSION = 'payroll-v2-review';
export const calculateSalaryForEmployee = (
    emp: any, yearMonth: string, scheduleEvents: ScheduleEvent[], clockRecords: ClockRecord[],
    leaveRequests: LeaveRequest[], _legacyConfig?: SystemConfig,
): SalaryDetail => {
    const reasons = new Set<string>(emp.masterAssessment?.issues||[]);
    if(emp.employmentAuthority){const start=Date.parse(yearMonth+'-01T00:00:00+08:00')/60000,end=start+new Date(Date.UTC(Number(yearMonth.slice(0,4)),Number(yearMonth.slice(5)),0)).getUTCDate()*1440;if(employmentWindowStates(emp,start,end).includes('unknown'))reasons.add('有效任職主檔未涵蓋本月，需覆核');}
    const review = emp.payrollReview as PayrollReview | undefined;
    const rawPolicy = review?.policy;
    const policy = rawPolicy && Array.isArray(rawPolicy.regularDates) && Array.isArray(rawPolicy.overtimeTiers) ? rawPolicy : undefined;
    if (rawPolicy && !policy) reasons.add('工時政策格式無效');
    if (!review || review.yearMonth !== yearMonth || !review.reviewedBy || !review.reviewedAt || !policy?.version) reasons.add('本月薪制、工時制度與保費尚未覆核');
    if (policy && (policy.workDateRule !== 'clock-in-date' || policy.hoursBasis !== 'actual' || !Number.isFinite(policy.dailyRegularMinutes) || policy.dailyRegularMinutes !== 480 || !Array.isArray(policy.regularDates) || !Array.isArray(policy.overtimeTiers))) reasons.add('工時政策無效');
    if (policy && policy.moneyDecimals !== 0 && policy.moneyDecimals !== 2) reasons.add('結算金額精度待確認');
    const money = (value: number) => roundMoney(value, policy?.moneyDecimals ?? 2);
    const scheduled = employeeSchedule(emp, yearMonth, scheduleEvents);
    const employeeRecords = clockRecords.filter(r => r.empId === emp.id);
    const invalidCardDates = employeeRecords.filter(r => typeof r.date !== 'string' || !validDate(r.date));
    for (const r of invalidCardDates) reasons.add(`打卡日期無效或缺失，無法核定月份 ${r.id}`);
    // Unknown dates cannot be treated as unrelated to this payroll month. Keep
    // the issue visible, while only valid dates enter absolute-time arithmetic.
    const allEmployeeRecords = employeeRecords.filter(r => typeof r.date === 'string' && validDate(r.date));
    const absolute = (r: Pick<ClockRecord, 'date'>, range: {start:number;end:number}) => { const base = Date.parse(r.date + 'T00:00:00+08:00') / 60000; return {start: base + range.start, end: base + range.end}; };
    let crossDateConflict = false;
    for (let i = 0; i < allEmployeeRecords.length; i++) for (let j = i + 1; j < allEmployeeRecords.length; j++) {
        const a = allEmployeeRecords[i], b = allEmployeeRecords[j], ar = clockInterval(a), br = clockInterval(b);
        if (a.date === b.date || !ar || !br || (!a.date.startsWith(yearMonth) && !b.date.startsWith(yearMonth))) continue;
        const x = absolute(a, ar), y = absolute(b, br);
        if (Math.min(x.end, y.end) > Math.max(x.start, y.start)) { crossDateConflict = true; reasons.add('跨日/跨月打卡重疊，須先核實日歸屬'); }
    }
    const records = allEmployeeRecords.filter(r => r.date.startsWith(yearMonth));
    const currentCardRanges = records.flatMap(r => { const span = clockInterval(r); return span ? [absolute(r, span)] : []; });
    const currentScheduleRanges = [...scheduled].flatMap(([date, shifts]) => (shiftIntervals(shifts) || []).map(r => absolute({ date }, r)));
    const workEvidence = allEmployeeRecords.map(r => ({ record: r, span: clockInterval(r), work: confirmedWork(r) }));
    const dates = new Set([...scheduled.entries()].filter(([, s]) => s.length).map(([d]) => d));
    records.forEach(r => dates.add(r.date));
    const leaveByDate = new Map<string, DayLeave[]>();
    const leaves = leaveRequests.filter(l => {
        if (l.empId !== emp.id || l.status !== LeaveStatus.Approved) return false;
        if (typeof l.startDate !== 'string' || typeof l.endDate !== 'string' ||
            !validDate(l.startDate.slice(0, 10)) || !validDate(l.endDate.slice(0, 10)) ||
            !Number.isFinite(leaveInstant(l.startDate)) || !Number.isFinite(leaveInstant(l.endDate)) || leaveInstant(l.endDate) <= leaveInstant(l.startDate)) {
            reasons.add(`請假日期無效或倒置，無法核定月份 ${l.id}`);
            return true;
        }
        if ((l.startDate || '').slice(0, 7) <= yearMonth && (l.endDate || l.startDate || '').slice(0, 7) >= yearMonth) return true;
        if (Array.isArray(l.payrollAllocations) && l.payrollAllocations.some(a => typeof a?.date === 'string' && a.date.startsWith(yearMonth))) return true;
        // Last-day overnight work belongs to this month but can conflict with next month's leave.
        // Boundary evidence only affects this calculation if its approved span touches our cards.
        const span = { start: leaveInstant(l.startDate) / 60000, end: leaveInstant(l.endDate) / 60000 };
        return [...currentCardRanges, ...currentScheduleRanges].some(r => overlaps(r, span));
    });
    const leaveDetails: { type: string; hours: number }[] = [];
    let boundaryAttendanceUnknown = false;
    for (const l of leaves) {
        // Historical elapsed hours are not silently interpreted as paid working time.
        if (!l.payrollAllocations?.length) { reasons.add(`請假/外勤 ${l.id} 尚未按日覆核時段`); continue; }
        if (!validLeaveAllocations(l)) { reasons.add(`請假 ${l.id} 分配超出核准區間/時數或重疊`); continue; }
        let minutes = 0;
        for (const a of l.payrollAllocations) {
            const range = allocationRange(l, a);
            if (!range) { reasons.add(`請假 ${l.id} 分配資料無效`); continue; }
            const allocation = absolute(a, range);
            for (const evidence of workEvidence) {
                if (!a.date.startsWith(yearMonth) && !evidence.record.date.startsWith(yearMonth)) continue;
                if (evidence.work === null) {
                    // An adjacent-month card is not paid here, but unknown work/break evidence
                    // must not silently authorize overlapping leave in this month's payroll.
                    if (a.date.startsWith(yearMonth) && !evidence.record.date.startsWith(yearMonth) && evidence.span && overlaps(allocation, absolute(evidence.record, evidence.span))) {
                        reasons.add(`${evidence.record.date} 跨月實際工作/休息區間待覆核`);
                        boundaryAttendanceUnknown = true;
                    }
                } else if (evidence.work.some(r => overlaps(allocation, absolute(evidence.record, r)))) {
                    reasons.add(`${a.date} 出勤與請假時段重疊待核實`);
                }
            }
            const entries = leaveByDate.get(a.date) || [];
            entries.push(range);
            leaveByDate.set(a.date, entries);
            if (!a.date.startsWith(yearMonth)) continue;
            dates.add(a.date);
            minutes += a.minutes;
        }
        if (!isOutingLeaveType(l.leaveType)) leaveDetails.push({ type: l.leaveType, hours: minutes / 60 });
    }
    let knownMinutes = 0, otMinutes = 0, otMoney = 0, hourlyLeavePay = 0, monthlyDeduction = 0, attendedDays = 0;
    let incompleteAttendance = invalidCardDates.length > 0 || crossDateConflict || boundaryAttendanceUnknown;
    const legacyReviewed=review?.yearMonth===yearMonth&&review.reviewedBy&&review.reviewedAt&&policy?.version;
    const basisCandidate=emp.effectiveMasterVersion?emp.payBasis:(legacyReviewed?review?.payBasis:null);
    const confirmedBasis=['monthly','hourly','daily'].includes(basisCandidate)?basisCandidate:null;
    if(!['monthly','hourly','daily'].includes(confirmedBasis))reasons.add('薪制未明示核定，不依職稱或人員類別推定');
    const monthly = confirmedBasis==='monthly';
    if(confirmedBasis&&!['monthly','hourly','daily'].includes(confirmedBasis))reasons.add('薪制值無效');
    if(confirmedBasis==='daily')reasons.add('日薪計算待核');
    const first=yearMonth+'-01',last=new Date(Date.UTC(Number(yearMonth.slice(0,4)),Number(yearMonth.slice(5)),0)).toISOString().slice(0,10);
    if(monthly&&!emp.effectiveMasterVersion&&((emp.hireDate&&emp.hireDate>first&&emp.hireDate<=last)||(emp.resignDate&&emp.resignDate>=first&&emp.resignDate<last)||(emp.leaveOfAbsenceStart&&emp.leaveOfAbsenceStart<=last&&(!emp.leaveOfAbsenceEnd||emp.leaveOfAbsenceEnd>=first))))reasons.add('部分月到離職／留停折算待C2，不能直接給整月月薪');
    const baseRate = monthly ? Number(emp.monthlySalary) : Number(emp.hourlyRate);
    if (!Number.isFinite(baseRate) || baseRate <= 0) reasons.add('薪資設定缺漏或無效');
    const divisor = policy?.monthlyHourlyDivisor;
    if (monthly && (!Number.isFinite(divisor) || divisor! <= 0)) reasons.add('月薪換算時薪基準待確認');
    const hourly = monthly ? baseRate / (divisor || 1) : baseRate;
    for (const date of [...dates].sort()) {
        if (!policy?.regularDates?.includes(date)) reasons.add(`${date} 日別/跨週工時制度待覆核`);
        const shifts = scheduled.get(date) || [];
        const ranges = shiftIntervals(shifts);
        if (ranges === null) { reasons.add(`${date} 班次跨日資訊待覆核`); incompleteAttendance = true; }
        const dayRecords = records.filter(r => r.date === date);
        const dayLeaves = leaveByDate.get(date) || [];
        if (intervalMinutes(dayLeaves) !== dayLeaves.reduce((n, l) => n + l.minutes, 0)) reasons.add(`${date} 請假時段重疊`);
        const cardRanges = dayRecords.map(clockInterval);
        const reviewedRanges = dayRecords.map(confirmedWork);
        if (reviewedRanges.some(r => r === null)) { reasons.add(`${date} 實際工作/休息區間待覆核`); incompleteAttendance = true; }
        if (cardRanges.some(r => !r)) { reasons.add(`${date} 缺卡或無效/舊跨夜時間待核實`); incompleteAttendance = true; }
        const completeRanges = cardRanges.filter((r): r is NonNullable<typeof r> => r !== null);
        if (intervalMinutes(completeRanges) !== completeRanges.reduce((n, r) => n + r.end - r.start, 0)) { reasons.add(`${date} 重複或重疊打卡待核實`); incompleteAttendance = true; }
        for (const l of dayLeaves) {
            const fraction = monthly ? policy?.monthlyLeaveDeductionFraction?.[l.type] : policy?.hourlyLeavePaidFraction?.[l.type];
            if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) { reasons.add(`${l.type} 給薪規則待確認`); continue; }
            // Hourly pay is built from work + paid leave; never deduct unpaid leave again.
            if (monthly) monthlyDeduction += l.minutes / 60 * hourly * fraction;
            else hourlyLeavePay += l.minutes / 60 * hourly * fraction;
        }
        if (ranges?.length) {
            const allocationEvidence = scheduleLeaves(date, shifts, leaveByDate);
            const coverage = scheduleCoverage(shifts, dayRecords, allocationEvidence)!;
            const exception = review?.scheduleExceptions?.find(x => x.date === date && x.reason?.trim() && x.sourceKey === scheduleEvidenceKey(shifts, dayRecords, allocationEvidence));
            if (coverage.coveredMinutes < coverage.scheduledMinutes && !exception) { reasons.add(`${date} 排班未有完整出勤或核准假證據`); incompleteAttendance = true; }
        }
        if (completeRanges.length) attendedDays++;
        // Summation only after union; no per-record 0.1-hour rounding.
        const work = intervalMinutes(reviewedRanges.flatMap(r => r || []));
        knownMinutes += work;
        const overtime = policy ? Math.max(0, work - policy.dailyRegularMinutes) : 0;
        otMinutes += overtime;
        let remaining = overtime;
        for (const tier of policy?.overtimeTiers || []) {
            if (!Number.isFinite(tier.minutes) || tier.minutes <= 0 || !Number.isFinite(tier.numerator) || tier.numerator <= 0 || !Number.isFinite(tier.denominator) || tier.denominator <= 0) { reasons.add('加班級距無效'); continue; }
            const used = Math.min(remaining, tier.minutes);
            otMoney += used / 60 * hourly * tier.numerator / tier.denominator;
            remaining -= used;
        }
        if (remaining > 0) reasons.add(`${date} 超過已覆核加班級距`);
    }
    knownMinutes = intervalMinutes(records.flatMap(r => (confirmedWork(r) || []).map(range => absolute(r, range))));
    const insurance = review?.insurance;
    if (!insurance || [insurance.labor, insurance.health, insurance.pensionSelf].some(n => !Number.isFinite(n) || n < 0)) reasons.add('本月投保級距/身分及自付金額待覆核');
    const normalPreview = emp.normalPayDays ? normalPayPreview(emp,yearMonth,clockRecords,leaveRequests,validLeaveAllocations,[...reasons].filter(r=>/卡|重疊|排班|實際工作|請假|外勤/.test(r))) : undefined;
    if(normalPreview){reasons.delete('多段雇用／留停／調薪或部分月折算待C2');reasons.delete('部分月到離職／留停折算待C2，不能直接給整月月薪');reasons.add('C2a僅正常薪資分段試算；完整加班／扣項整合待C2b/C3，不可當結算薪資');for(const issue of normalPreview.issues)reasons.add(issue);}
    const ready = reasons.size === 0;
    const base = money(monthly ? baseRate : (knownMinutes - otMinutes) / 60 * hourly + hourlyLeavePay);
    const overtimePay = money(otMoney);
    const gross = money(base + overtimePay);
    const deduction = money(monthlyDeduction);
    const totalDeductions = money((insurance?.labor || 0) + (insurance?.health || 0) + (insurance?.pensionSelf || 0) + deduction);
    return {
        ...(normalPreview?{normalPayPreview:normalPreview}:{}),
        empId: emp.id, name: emp.name, position: emp.position, yearMonth,
        payBasis:confirmedBasis||null,employmentType:emp.employmentType||null,effectiveMasterVersion:emp.effectiveMasterVersion||null,
        calculationVersion: PAYROLL_VERSION, calculationStatus: ready ? 'ready' : 'needs-review', reviewReasons: [...reasons],
        policyVersion: policy?.version || '', knownWorkMinutes: knownMinutes,
        totalWorkDays: attendedDays, totalWorkHours: incompleteAttendance ? null : knownMinutes / 60,
        totalLeaveHours: leaveDetails.reduce((n, l) => n + l.hours, 0), leaveDetails,
        overtimeHours: ready ? otMinutes / 60 : null,
        baseSalary: ready ? base : null, overtimePay: ready ? overtimePay : null, grossSalary: ready ? gross : null,
        laborInsurance: ready ? insurance!.labor : null, healthInsurance: ready ? insurance!.health : null,
        laborPensionSelf: ready ? insurance!.pensionSelf : null, leaveDeduction: ready ? deduction : null,
        totalDeductions: ready ? totalDeductions : null, netSalary: ready ? money(gross - totalDeductions) : null,
    };
};

export const legacySalary = (salary: SalaryDetail): SalaryDetail => ({
    ...salary, calculationStatus: 'legacy-review', reviewReasons: ['歷史月結沒有個人薪資快照，不能重建為已結算明細'],
    baseSalary: null, overtimePay: null, grossSalary: null, laborInsurance: null, healthInsurance: null,
    laborPensionSelf: null, leaveDeduction: null, totalDeductions: null, netSalary: null,
});
