import { describe, expect, it } from 'vitest';
import { calculateSalaryForEmployee } from '../netlify/functions/utils/payroll';
import { clockSourceKey } from '../utils/attendance';
import { LeaveType } from '../types';
import { employee, card, leave, month, review } from './fixtures/payrollV2';

const overnight = (date: string, next: string) => {
    const record = card(date, '22:00', '06:00', false);
    record.clockInAt = `${date}T22:00:00+08:00`;
    record.clockOutAt = `${next}T06:00:00+08:00`;
    record.workIntervals = [{ start: 1320, end: 1800 }];
    record.workReview = { sourceKey: clockSourceKey(record), reviewedBy: 'SYNTH-reviewer', reviewedAt: review.reviewedAt };
    return record;
};

const paidLeave = (date: string, from = '02:00', to = '06:00') => {
    const minutes = (Number(to.slice(0, 2)) - Number(from.slice(0, 2))) * 60;
    return {
        ...leave(date, LeaveType.Annual), startDate: `${date}T${from}`, endDate: `${date}T${to}`, hours: minutes / 60,
        payrollAllocations: [{ date, from, to, minutes }],
    };
};

describe('PR 13 independent payroll review reproducer', () => {
    it('blocks paid leave that overlaps the next-day portion of overnight work', () => {
        const salary = calculateSalaryForEmployee(employee, month, [], [overnight('2026-04-01', '2026-04-02')], [paidLeave('2026-04-02')]);
        expect(salary.calculationStatus).toBe('needs-review');
        expect(salary.netSalary).toBeNull();
        expect(salary.reviewReasons).toContain('2026-04-02 出勤與請假時段重疊待核實');
        expect(salary.knownWorkMinutes).toBe(480);
    });

    it.each([
        ['previous month work with current month leave', '2026-03-31', '2026-04-01', 0, 4],
        ['current month work with next month leave', '2026-04-30', '2026-05-01', 480, 0],
    ] as const)('blocks %s without importing another month into totals', (_label, date, next, knownMinutes, leaveHours) => {
        const record = overnight(date, next), approved = paidLeave(next);
        const raw = JSON.stringify({ record, approved });
        const salary = calculateSalaryForEmployee(employee, month, [], [record], [approved]);
        expect(salary.calculationStatus).toBe('needs-review');
        expect(salary.netSalary).toBeNull();
        expect(salary.reviewReasons).toEqual([`${next} 出勤與請假時段重疊待核實`]);
        expect(salary.knownWorkMinutes).toBe(knownMinutes);
        expect(salary.totalLeaveHours).toBe(leaveHours);
        expect(JSON.stringify({ record, approved })).toBe(raw);
    });

    it('fails closed when the overlapping prior-month card has no valid work review', () => {
        const record = overnight('2026-03-31', '2026-04-01');
        record.workReview = undefined;
        const salary = calculateSalaryForEmployee(employee, month, [], [record], [paidLeave('2026-04-01')]);
        expect(salary.netSalary).toBeNull();
        expect(salary.totalWorkHours).toBeNull();
        expect(salary.reviewReasons).toContain('2026-03-31 跨月實際工作/休息區間待覆核');
    });

    it('requires reviewed allocations for next-month leave that touches this month overnight card', () => {
        const approved = paidLeave('2026-05-01');
        approved.payrollAllocations = [];
        const salary = calculateSalaryForEmployee(employee, month, [], [overnight('2026-04-30', '2026-05-01')], [approved]);
        expect(salary.netSalary).toBeNull();
        expect(salary.reviewReasons).toContain(`請假/外勤 ${approved.id} 尚未按日覆核時段`);
    });

    it.each([
        ['leave before the overnight shift', '2026-04-01', '02:00', '06:00'],
        ['leave starts exactly when overnight work ends', '2026-04-02', '06:00', '10:00'],
    ])('allows %s', (_label, date, from, to) => {
        const salary = calculateSalaryForEmployee(employee, month, [], [overnight('2026-04-01', '2026-04-02')], [paidLeave(date, from, to)]);
        expect(salary.calculationStatus).toBe('ready');
        expect(salary.netSalary).toBe(2400);
    });

    it('allows paid leave during a reviewed break instead of treating the entire raw card as work', () => {
        const record = overnight('2026-04-01', '2026-04-02');
        record.workIntervals = [{ start: 1320, end: 1560 }, { start: 1620, end: 1800 }];
        const salary = calculateSalaryForEmployee(employee, month, [], [record], [paidLeave('2026-04-02', '02:00', '03:00')]);
        expect(salary.calculationStatus).toBe('ready');
        expect(salary.knownWorkMinutes).toBe(420);
        expect(salary.netSalary).toBe(1600);
    });

    it('ignores unrelated unreviewed boundary evidence and keeps only this month totals', () => {
        const approved = paidLeave('2026-05-01', '13:00', '17:00');
        approved.payrollAllocations = [];
        const unrelatedCard = card('2026-03-31', '09:00', '17:00', false);
        const salary = calculateSalaryForEmployee(employee, month, [], [unrelatedCard, overnight('2026-04-30', '2026-05-01')], [approved]);
        expect(salary.calculationStatus).toBe('ready');
        expect(salary.knownWorkMinutes).toBe(480);
        expect(salary.totalLeaveHours).toBe(0);
        expect(salary.netSalary).toBe(1600);
    });

    it('does not combine work or leave evidence from another employee', () => {
        const ownWork = overnight('2026-04-01', '2026-04-02');
        const otherWork = { ...overnight('2026-03-31', '2026-04-01'), empId: 'OTHER' };
        const otherLeave = { ...paidLeave('2026-04-02'), empId: 'OTHER' };
        const salary = calculateSalaryForEmployee(employee, month, [], [ownWork, otherWork], [paidLeave('2026-04-01'), otherLeave]);
        expect(salary.calculationStatus).toBe('ready');
        expect(salary.knownWorkMinutes).toBe(480);
        expect(salary.totalLeaveHours).toBe(4);
        expect(salary.netSalary).toBe(2400);
    });
});
