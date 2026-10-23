import { createHash } from 'crypto';
import type { SalaryDetail, PayrollRun, MonthLock, ClockRecord } from '../../../types';
import { PAYROLL_VERSION, legacySalary } from './payroll';
export const makePayrollRun = (id: string, yearMonth: string, createdAt: string, salaries: SalaryDetail[], inputs: PayrollRun['inputs']): PayrollRun => {
    if (!salaries.length || salaries.some(s => s.calculationStatus !== 'ready' || s.netSalary == null)) throw new Error('仍有待覆核薪資，不能月結');
    return { id, yearMonth, createdAt, salaries: salaries.map(s => ({ ...s, calculationStatus: 'locked' })), calculationVersion: PAYROLL_VERSION, inputs, inputHash: createHash('sha256').update(JSON.stringify(inputs)).digest('hex') };
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
