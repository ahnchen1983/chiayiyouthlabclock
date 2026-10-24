import { hasAppliedMakeup } from './makeupEvidence';
import type { ClockRecord, LeaveRequest, ScheduleEvent, SalaryDetail, PayrollPreflight, PayrollPreflightIssue } from '../../../types';
import { clockInterval, shiftIntervals, validDate, hhmmMinutes } from '../../../utils/attendance';
import { calculateSalaryForEmployee } from './payroll';

export const PREFLIGHT_GAPS = ['OT_COMP_REQUEST_MODEL', 'PAYROLL_ITEM_REQUIREMENTS', 'MANUAL_DIFF_APPROVAL', 'ATTENDANCE_CASE_WORKFLOW', 'PRODUCTION_RECONCILIATION'] as const;
export type RequestKind = 'leaveRequests' | 'makeupRequests' | 'leaveOfAbsenceRequests' | 'shiftSwapRequests';
export type RequestEvidence = Record<string, any> & { id: string };
export type PendingSources = Record<RequestKind, RequestEvidence[]>;
const kinds: RequestKind[] = ['leaveRequests', 'makeupRequests', 'leaveOfAbsenceRequests', 'shiftSwapRequests'];
const labels: Record<RequestKind, string> = { leaveRequests: '假單/外勤', makeupRequests: '補卡', leaveOfAbsenceRequests: '留停', shiftSwapRequests: '換班' };
const finalStates: Record<RequestKind, string[]> = {
    leaveRequests: ['核准', '駁回'], makeupRequests: ['核准', '駁回', '已取消', '已取代'], leaveOfAbsenceRequests: ['核准', '駁回'],
    shiftSwapRequests: ['approved', 'rejected-by-peer', 'rejected-by-admin', 'cancelled'],
};
const pendingStates: Record<RequestKind, string[]> = {
    leaveRequests: ['待審核'], makeupRequests: ['待審核', '待補件'], leaveOfAbsenceRequests: ['待審核'], shiftSwapRequests: ['awaiting-peer', 'awaiting-admin'],
};
const minute = (date: string) => Date.parse(date + 'T00:00:00+08:00') / 60000;
const instant = (value: unknown): number => {
    if (typeof value !== 'string' || !validDate(value.slice(0, 10))) return NaN;
    return value.length === 10 ? minute(value) : Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + '+08:00') / 60000;
};
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
export const requestEmployeeIds = (kind: RequestKind, r: RequestEvidence): string[] => kind === 'shiftSwapRequests' ? [r.fromEmpId, r.toEmpId] : [r.empId];

// Use the selected calendar month PLUS its actual overnight evidence. Merely
// being in an adjacent month is not sufficient to block an unrelated request.
export const requestAffectsMonth = (kind: RequestKind, r: RequestEvidence, month: string, employeeId: string, records: ClockRecord[], schedules: ScheduleEvent[]): boolean => {
    const first = month + '-01';
    const next = new Date(first + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    const evidence = [{ start: minute(first), end: minute(next.toISOString().slice(0, 10)) }];
    for (const card of records.filter(x => x.empId === employeeId && x.date?.startsWith(month + '-'))) {
        const range = clockInterval(card);
        if (range) evidence.push({ start: minute(card.date) + range.start, end: minute(card.date) + range.end });
    }
    for (const day of schedules.filter(x => x.date?.startsWith(month + '-'))) {
        for (const range of shiftIntervals(day.shifts.filter(x => x.empId === employeeId)) || []) evidence.push({ start: minute(day.date) + range.start, end: minute(day.date) + range.end });
    }
    let ranges: { start: number; end: number }[];
    if (kind === 'shiftSwapRequests') ranges = [r.fromDate, r.toDate].map(date => ({ start: instant(date), end: instant(date) + 1440 }));
    else if (kind === 'makeupRequests') {
        // Keep the original date/record evidence even if the proposed correction moves it.
        ranges = [{ start: instant(r.date), end: instant(r.date) + 1440 }];
        for (const field of ['requestedClockInAt', 'requestedClockOutAt']) if (r[field]) ranges.push({ start: instant(r[field]), end: instant(r[field]) + 1 });
        const original = records.find(x => x.empId === employeeId && x.id === r.recordId);
        const proposed = clockInterval({ ...original, date: r.date, clockInTime: r.requestedClockIn || original?.clockInTime,
            clockOutTime: r.requestedClockOut || original?.clockOutTime,
            clockInAt: r.requestedClockInAt || original?.clockInAt, clockOutAt: r.requestedClockOutAt || original?.clockOutAt } as ClockRecord);
        if (proposed) ranges.push({ start: minute(r.date) + proposed.start, end: minute(r.date) + proposed.end });
        // Ambiguous legacy overnight is NOT approved work. Conservatively block
        // the possible next day until the correction has explicit dates.
        const legacyStart = hhmmMinutes(r.requestedClockIn || original?.clockInTime);
        const legacyEnd = hhmmMinutes(r.requestedClockOut || original?.clockOutTime);
        if (!proposed && legacyStart !== null && legacyEnd !== null && legacyEnd <= legacyStart)
            ranges.push({ start: minute(r.date), end: minute(r.date) + 2880 });
        for (const card of records.filter(x => x.empId === employeeId && x.id === r.recordId)) {
            const span = clockInterval(card);
            ranges.push({ start: minute(card.date), end: minute(card.date) + (span?.end || 1440) });
        }
    } else {
        const start = instant(r.startDate);
        const end = kind === 'leaveOfAbsenceRequests' && !r.endDate ? Infinity : instant(r.endDate) + (typeof r.endDate === 'string' && r.endDate.length === 10 ? 1440 : 0);
        ranges = [{ start, end }];
    }
    // Invalid evidence for this employee is unknown, never an empty period.
    if (ranges.some(x => !Number.isFinite(x.start) || Number.isNaN(x.end) || x.end <= x.start)) return true;
    return ranges.some(x => evidence.some(y => overlaps(x, y)));
};

export const pendingRequestIssues = (month: string, empId: string, sources: Partial<PendingSources>, records: ClockRecord[], schedules: ScheduleEvent[], revisions: any[] = []): PayrollPreflightIssue[] => {
    const issues: PayrollPreflightIssue[] = [];
    for (const kind of kinds) {
        if (!Array.isArray(sources[kind])) {
            issues.push({ code: 'SOURCE_UNAVAILABLE', severity: 'BLOCKED', source: kind, message: `${labels[kind]}預檢資料未載入` }); continue;
        }
        for (const request of sources[kind]!) {
            if (!request || !request.id || requestEmployeeIds(kind, request).some(id => typeof id !== 'string' || !id)) {
                issues.push({ code: 'SOURCE_UNAVAILABLE', severity: 'BLOCKED', source: kind, message: `${labels[kind]}存在無法識別歸屬的申請，須先核實` }); continue;
            }
            if (!requestEmployeeIds(kind, request).includes(empId)) continue;
            if (kind === 'makeupRequests' && request.status === '核准') {
                if (requestAffectsMonth(kind, request, month, empId, records, schedules) && !hasAppliedMakeup(request, records, revisions))
                    issues.push({ code: 'APPLICATION_UNVERIFIED', severity: 'NEEDS_REVIEW', source: kind, sourceId: request.id, message: `補卡 ${request.id} 核准套用證據或後續更正來源鏈待覆核` });
                continue;
            }
            if (finalStates[kind].includes(request.status)) continue;
            if (!requestAffectsMonth(kind, request, month, empId, records, schedules)) continue;
            const pending = pendingStates[kind].includes(request.status);
            issues.push({ code: pending ? 'PENDING_REQUEST' : 'REQUEST_STATUS_UNKNOWN', severity: 'BLOCKED', source: kind, sourceId: request.id,
                message: `${labels[kind]} ${request.id} ${pending ? '待處理，不能月結' : '狀態不明，不能月結'}` });
        }
    }
    return issues;
};

// This is the single entry point used by salary reads AND the locking transaction.
// Trial completeness is distinct from formal settlement eligibility. Missing
// required capabilities block every new lock, with no client/config override.
export const evaluatePayrollMonth = (input: {
    month: string; employees: any[]; records: ClockRecord[]; schedules: ScheduleEvent[]; leaves: LeaveRequest[]; requests: Partial<PendingSources>; revisions?: any[]; cases?: any[];
}): { status: PayrollPreflight['status']; trialStatus: PayrollPreflight['status']; salaries: SalaryDetail[] } => {
    const salaries = input.employees.map(employee => {
        const calculated = calculateSalaryForEmployee(employee, input.month, input.schedules, input.records, input.leaves);
        const issues: PayrollPreflightIssue[] = (calculated.reviewReasons || []).map(message => ({ code: 'CALCULATION_REVIEW', severity: 'NEEDS_REVIEW', source: 'calculation', message }));
        issues.push(...pendingRequestIssues(input.month, employee.id, input.requests, input.records, input.schedules, input.revisions));
        for (const c of input.cases || []) {
            if (c.empId !== employee.id || ['resolved','cancelled'].includes(c.status)) continue;
            const start = Date.parse(input.month+'-01T00:00:00+08:00')/60000;
            const next = new Date(input.month+'-01T00:00:00Z'); next.setUTCMonth(next.getUTCMonth()+1);
            const end = Date.parse(next.toISOString().slice(0,10)+'T00:00:00+08:00')/60000;
            const w = c.observation?.window;
            if (!w || !Number.isFinite(w.start) || !Number.isFinite(w.end) || (w.start < end && w.end > start))
                issues.push({ code: 'CASE_UNRESOLVED', severity: 'NEEDS_REVIEW', source: 'attendanceCases', sourceId: c.id, message: `出勤案件 ${c.id} 尚未完成覆核` });
        }
        if (calculated.calculationStatus !== 'ready' && !issues.length) issues.push({ code: 'CALCULATION_UNAVAILABLE', severity: 'BLOCKED', source: 'calculation', message: '計算結果尚未確認' });
        const status = issues.some(x => x.severity === 'BLOCKED') ? 'BLOCKED' : issues.length ? 'NEEDS_REVIEW' : 'READY';
        const preflight: PayrollPreflight = { version: 'preflight-v1', status: 'BLOCKED', trialStatus: status, scope: 'existing-models', issues: [...issues, ...PREFLIGHT_GAPS.map(gap => ({ code: 'CAPABILITY_MISSING' as const, severity: 'BLOCKED' as const, source: gap, message: `正式結算缺少必要能力或驗收：${gap}` }))], gaps: [...PREFLIGHT_GAPS] };
        if (status === 'READY') return { ...calculated, preflight };
        return { ...calculated, preflight, calculationStatus: 'needs-review' as const, reviewReasons: [...new Set(issues.map(x => x.message))],
            baseSalary: null, overtimePay: null, grossSalary: null, laborInsurance: null, healthInsurance: null, laborPensionSelf: null,
            leaveDeduction: null, totalDeductions: null, netSalary: null };
    });
    const status = !salaries.length || salaries.some(x => x.preflight.trialStatus === 'BLOCKED') ? 'BLOCKED'
        : salaries.some(x => x.preflight.trialStatus === 'NEEDS_REVIEW') ? 'NEEDS_REVIEW' : 'READY';
    return { status: 'BLOCKED', trialStatus: status, salaries };
};

export const assertPayrollReady = (result: ReturnType<typeof evaluatePayrollMonth>): void => {
    if (PREFLIGHT_GAPS.length || result.status !== 'READY' || result.salaries.some(s => !s.preflight || s.preflight.gaps.length)) { const error: any = new Error(`月結預檢 ${result.status}：仍有待處理申請或計薪資料待覆核`); error.statusCode = 409; throw error; }
};
