import { createHash } from 'crypto';
import type { SalaryDetail, PayrollRun, MonthLock, ClockRecord, LeaveRequest } from '../../../types';
import { PAYROLL_VERSION, legacySalary } from './payroll';
import { LeaveStatus } from '../../../types';

// Firestore rejects undefined optional object fields. Normalize once before both
// hashing and persistence; never use JSON round-tripping, which corrupts NaN,
// dates, sparse arrays and other unsupported evidence into different values.
export const sanitizePayrollSnapshot = <T>(value: T): T => {
    const active = new Set<object>();
    const visit = (item: any, path: string, inArray = false): any => {
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (typeof item !== 'object' || item === undefined) throw new Error(`快照含不支援資料：${path}`);
        if (active.has(item)) throw new Error(`快照含循環資料：${path}`);
        if (Object.getOwnPropertySymbols(item).length) throw new Error(`快照含不支援欄位：${path}`);
        active.add(item);
        try {
            if (Array.isArray(item)) {
                if (inArray || Object.getOwnPropertyNames(item).some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) throw new Error(`快照含不支援陣列：${path}`);
                const result = [];
                for (let i = 0; i < item.length; i++) {
                    const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
                    if (!descriptor || !('value' in descriptor)) throw new Error(`快照含缺漏或動態欄位：${path}[${i}]`);
                    result.push(visit(descriptor.value, `${path}[${i}]`, true));
                }
                return result;
            }
            if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error(`快照含不支援物件：${path}`);
            const entries: [string, any][] = [];
            for (const key of Object.getOwnPropertyNames(item).sort()) {
                const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
                if (!('value' in descriptor) || !descriptor.enumerable) throw new Error(`快照含動態或隱藏欄位：${path}.${key}`);
                if (descriptor.value !== undefined) entries.push([key, visit(descriptor.value, `${path}.${key}`)]);
            }
            return Object.fromEntries(entries);
        } finally { active.delete(item); }
    };
    return visit(value, 'payroll') as T;
};
export const makePayrollRun = (id: string, yearMonth: string, createdAt: string, salaries: SalaryDetail[], inputs: PayrollRun['inputs']): PayrollRun => {
    if (!salaries.length || salaries.some(s => s.calculationStatus !== 'ready' || s.netSalary == null)) throw new Error('仍有待覆核薪資，不能月結');
    const storedInputs = sanitizePayrollSnapshot(inputs);
    return sanitizePayrollSnapshot({ id, yearMonth, createdAt, salaries: salaries.map(s => ({ ...s, calculationStatus: 'locked' as const })), calculationVersion: PAYROLL_VERSION, inputs: storedInputs, inputHash: createHash('sha256').update(JSON.stringify(storedInputs)).digest('hex') });
};
export const selectSalaryResults = (current: SalaryDetail[], lock: MonthLock | null, run?: PayrollRun | null): SalaryDetail[] => {
    if (!lock || lock.unlockedAt) return current;
    if (lock.payrollRunId && run?.id === lock.payrollRunId && run.yearMonth === lock.yearMonth) return run.salaries;
    return current.map(legacySalary);
};

// clockInterval accepts a workDate-local start and at most 24 hours. Therefore
// only the immediately adjacent workDates can conflict with this month's cards.
// Keep complete boundary records (including invalid ones), not just overlaps,
// so the snapshot preserves the evidence used to rule conflicts out.
export const selectPayrollClockEvidence = (records: ClockRecord[], yearMonth: string, employeeIds: string[]): ClockRecord[] => {
    const first = new Date(`${yearMonth}-01T00:00:00Z`);
    const prior = new Date(first); prior.setUTCDate(0);
    const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + 1);
    const before = prior.toISOString().slice(0, 10), after = next.toISOString().slice(0, 10);
    const included = new Set(employeeIds);
    return records.filter(r => included.has(r.empId) && (r.date.startsWith(yearMonth + '-') || r.date === before || r.date === after));
};

// A last-day overnight card can overlap leave on the next month's first day.
// Retain complete approved evidence for included employees without unrelated history.
export const selectPayrollLeaveEvidence = (leaves: LeaveRequest[], yearMonth: string, employeeIds: string[]): LeaveRequest[] => {
    const first = Date.parse(`${yearMonth}-01T00:00:00+08:00`);
    const next = new Date(`${yearMonth}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    const boundaryEnd = Date.parse(`${next.toISOString().slice(0, 7)}-02T00:00:00+08:00`);
    const instant = (value: string) => Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(value || '') ? value : value + '+08:00');
    const included = new Set(employeeIds);
    return leaves.filter(l => included.has(l.empId) && l.status === LeaveStatus.Approved && instant(l.startDate) < boundaryEnd && instant(l.endDate) > first);
};
