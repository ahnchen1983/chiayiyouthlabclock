import type { ClockRecord, LeaveRequest, ScheduleEvent, SalaryDetail, SystemConfig, PayrollReview } from '../../../types';
import { LeaveStatus, isOutingLeaveType } from '../../../types';
import { clockInterval, confirmedWork, resolveAttendance, shiftIntervals, intervalMinutes, hhmmMinutes, validDate, clockSourceKey } from '../../../utils/attendance';
import { roundMoney } from '../../../utils/format';

export const validLeaveAllocations = (leave: LeaveRequest, allocations = leave.payrollAllocations): boolean => {
    const instant = (value: string) => Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(value || '') ? value : value + '+08:00');
    const from = instant(leave.startDate), to = instant(leave.endDate);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !Number.isFinite(leave.hours) || leave.hours < 0 || !allocations?.length) return false;
    const ranges = [];
    for (const a of allocations) {
        const start = instant(`${a.date}T${a.from}`), end = instant(`${a.date}T${a.to}`);
        if (!validDate(a.date) || hhmmMinutes(a.from) === null || hhmmMinutes(a.to) === null || !Number.isInteger(a.minutes) || a.minutes <= 0 || end - start !== a.minutes * 60000 || start < from || end > to) return false;
        ranges.push({start: start / 60000, end: end / 60000});
    }
    const total = allocations.reduce((n, a) => n + a.minutes, 0);
    return total <= leave.hours * 60 && intervalMinutes(ranges) === total;
};
export const scheduleEvidenceKey = (shifts: any[], records: ClockRecord[], leaves: any[]) => JSON.stringify([shifts, records.map(r => [r.id, clockSourceKey(r)]), leaves]);
export const PAYROLL_VERSION = 'payroll-v2-review';
export const calculateSalaryForEmployee = (
    emp: any, yearMonth: string, scheduleEvents: ScheduleEvent[], clockRecords: ClockRecord[],
    leaveRequests: LeaveRequest[], _legacyConfig?: SystemConfig,
): SalaryDetail => {
    const reasons = new Set<string>();
    const review = emp.payrollReview as PayrollReview | undefined;
    const rawPolicy = review?.policy;
    const policy = rawPolicy && Array.isArray(rawPolicy.regularDates) && Array.isArray(rawPolicy.overtimeTiers) ? rawPolicy : undefined;
    if (rawPolicy && !policy) reasons.add('工時政策格式無效');
    if (!review || review.yearMonth !== yearMonth || !review.reviewedBy || !review.reviewedAt || !policy?.version) reasons.add('本月薪制、工時制度與保費尚未覆核');
    if (policy && (policy.workDateRule !== 'clock-in-date' || policy.hoursBasis !== 'actual' || !Number.isFinite(policy.dailyRegularMinutes) || policy.dailyRegularMinutes !== 480 || !Array.isArray(policy.regularDates) || !Array.isArray(policy.overtimeTiers))) reasons.add('工時政策無效');
    if (policy && policy.moneyDecimals !== 0 && policy.moneyDecimals !== 2) reasons.add('結算金額精度待確認');
    const money = (value: number) => roundMoney(value, policy?.moneyDecimals ?? 2);
    const scheduled = new Map(scheduleEvents.filter(e => e.date.startsWith(yearMonth)).map(e => [e.date, e.shifts.filter(s => s.empId ? s.empId === emp.id : s.name === emp.name)]));
    const allEmployeeRecords = clockRecords.filter(r => r.empId === emp.id);
    const absolute = (r: ClockRecord, range: {start:number;end:number}) => { const base = Date.parse(r.date + 'T00:00:00+08:00') / 60000; return {start: base + range.start, end: base + range.end}; };
    let crossDateConflict = false;
    for (let i = 0; i < allEmployeeRecords.length; i++) for (let j = i + 1; j < allEmployeeRecords.length; j++) {
        const a = allEmployeeRecords[i], b = allEmployeeRecords[j], ar = clockInterval(a), br = clockInterval(b);
        if (a.date === b.date || !ar || !br || (!a.date.startsWith(yearMonth) && !b.date.startsWith(yearMonth))) continue;
        const x = absolute(a, ar), y = absolute(b, br);
        if (Math.min(x.end, y.end) > Math.max(x.start, y.start)) { crossDateConflict = true; reasons.add('跨日/跨月打卡重疊，須先核實日歸屬'); }
    }
    const records = clockRecords.filter(r => r.empId === emp.id && r.date.startsWith(yearMonth));
    const dates = new Set([...scheduled.entries()].filter(([, s]) => s.length).map(([d]) => d));
    records.forEach(r => dates.add(r.date));
    const leaveByDate = new Map<string, { start: number; end: number; type: string; minutes: number }[]>();
    const leaves = leaveRequests.filter(l => l.empId === emp.id && l.status === LeaveStatus.Approved && (l.startDate || '').slice(0, 7) <= yearMonth && (l.endDate || l.startDate || '').slice(0, 7) >= yearMonth);
    const leaveDetails: { type: string; hours: number }[] = [];
    for (const l of leaves) {
        // Historical elapsed hours are not silently interpreted as paid working time.
        if (!l.payrollAllocations?.length) { reasons.add(`請假/外勤 ${l.id} 尚未按日覆核時段`); continue; }
        if (!validLeaveAllocations(l)) { reasons.add(`請假 ${l.id} 分配超出核准區間/時數或重疊`); continue; }
        let minutes = 0;
        for (const a of l.payrollAllocations) {
            const start = hhmmMinutes(a.from), end = hhmmMinutes(a.to);
            if (!validDate(a.date) || a.date < l.startDate.slice(0, 10) || a.date > l.endDate.slice(0, 10) || start === null || end === null || end <= start || a.minutes !== end - start) { reasons.add(`請假 ${l.id} 分配資料無效`); continue; }
            if (!a.date.startsWith(yearMonth)) continue;
            dates.add(a.date);
            const entries = leaveByDate.get(a.date) || [];
            entries.push({ start, end, type: l.leaveType, minutes: a.minutes });
            leaveByDate.set(a.date, entries);
            minutes += a.minutes;
        }
        if (!isOutingLeaveType(l.leaveType)) leaveDetails.push({ type: l.leaveType, hours: minutes / 60 });
    }
    let knownMinutes = 0, otMinutes = 0, otMoney = 0, hourlyLeavePay = 0, monthlyDeduction = 0, attendedDays = 0;
    let incompleteAttendance = crossDateConflict;
    const monthly = emp.position === '專責人員';
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
            if (reviewedRanges.flatMap(r => r || []).some(r => Math.min(r.end, l.end) > Math.max(r.start, l.start))) reasons.add(`${date} 出勤與請假時段重疊待核實`);
            const fraction = monthly ? policy?.monthlyLeaveDeductionFraction?.[l.type] : policy?.hourlyLeavePaidFraction?.[l.type];
            if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) { reasons.add(`${l.type} 給薪規則待確認`); continue; }
            // Hourly pay is built from work + paid leave; never deduct unpaid leave again.
            if (monthly) monthlyDeduction += l.minutes / 60 * hourly * fraction;
            else hourlyLeavePay += l.minutes / 60 * hourly * fraction;
        }
        if (ranges?.length) {
            const covered = intervalMinutes(ranges.flatMap(s => [...dayLeaves, ...completeRanges].map(l => ({ start: Math.max(s.start, l.start), end: Math.min(s.end, l.end) }))));
            const exception = review?.scheduleExceptions?.find(x => x.date === date && x.reason?.trim() && x.sourceKey === scheduleEvidenceKey(shifts, dayRecords, dayLeaves));
            if (covered < intervalMinutes(ranges) && !exception) { reasons.add(`${date} 排班未有完整出勤或核准假證據`); incompleteAttendance = true; }
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
    const ready = reasons.size === 0;
    const base = money(monthly ? baseRate : (knownMinutes - otMinutes) / 60 * hourly + hourlyLeavePay);
    const overtimePay = money(otMoney);
    const gross = money(base + overtimePay);
    const deduction = money(monthlyDeduction);
    const totalDeductions = money((insurance?.labor || 0) + (insurance?.health || 0) + (insurance?.pensionSelf || 0) + deduction);
    return {
        empId: emp.id, name: emp.name, position: emp.position, yearMonth,
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
