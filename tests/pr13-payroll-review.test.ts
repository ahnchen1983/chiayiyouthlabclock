import { describe, expect, it } from 'vitest';
import { calculateSalaryForEmployee, getScheduleReviewGaps, validLeaveAllocations } from '../netlify/functions/utils/payroll';
import { clockSourceKey } from '../utils/attendance';
import { LeaveType } from '../types';
import { employee, card, leave, month, review, schedule } from './fixtures/payrollV2';

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

describe('canonical midnight leave allocation', () => {
    const midnightLeave = (date = '2026-04-01', next = '2026-04-02') => ({
        ...paidLeave(date), startDate: `${date}T22:00`, endDate: `${next}T02:00`, hours: 4,
        payrollAllocations: [{ date, from: '22:00', to: '24:00', minutes: 120 }, { date: next, from: '00:00', to: '02:00', minutes: 120 }],
    });
    const overnightSchedule = (date = '2026-04-01') => {
        const day = schedule(date, '22:00', '02:00'); day.shifts[0].endDateOffset = 1; return day;
    };
    it('allocates all four hours and covers the entire overnight schedule', () => {
        const approved = midnightLeave(), day = overnightSchedule();
        expect(validLeaveAllocations(approved)).toBe(true);
        expect(getScheduleReviewGaps(employee, month, [day], [], [approved])).toEqual([]);
        const salary = calculateSalaryForEmployee(employee, month, [day], [], [approved]);
        expect(salary.calculationStatus).toBe('ready');
        expect(salary.totalLeaveHours).toBe(4);
        expect(salary.netSalary).toBe(800);
    });
    it('uses next-month leave only as overnight coverage without moving its pay into this month', () => {
        const approved = midnightLeave('2026-04-30', '2026-05-01');
        const current = { ...approved, endDate: '2026-05-01T00:00', hours: 2, payrollAllocations: [approved.payrollAllocations[0]] };
        const next = { ...paidLeave('2026-05-01', '00:00', '02:00'), id: 'next-month' };
        const salary = calculateSalaryForEmployee(employee, month, [overnightSchedule('2026-04-30')], [], [current, next]);
        expect(salary.calculationStatus).toBe('ready');
        expect(salary.totalLeaveHours).toBe(2);
        expect(salary.netSalary).toBe(400);
    });
    it('keeps a reviewed midnight break separate from actual work', () => {
        const record = overnight('2026-04-01', '2026-04-02');
        record.workIntervals = [{ start: 1320, end: 1380 }, { start: 1440, end: 1800 }];
        const approved = { ...midnightLeave(), startDate: '2026-04-01T23:00', endDate: '2026-04-02T00:00', hours: 1,
            payrollAllocations: [{ date: '2026-04-01', from: '23:00', to: '24:00', minutes: 60 }] };
        const salary = calculateSalaryForEmployee(employee, month, [], [record], [approved]);
        expect(salary.calculationStatus).toBe('ready');
        expect(salary.knownWorkMinutes).toBe(420);
        expect(salary.netSalary).toBe(1600);
    });
    it.each([
        { date: '2026-04-01', from: '22:00', to: '24:01', minutes: 121 },
        { date: '2026-04-01', from: '24:00', to: '24:00', minutes: 1 },
        { date: '2026-04-01', from: '22:00', to: '24:00:00', minutes: 120 },
    ])('rejects invalid midnight endpoint $from-$to', allocation => {
        expect(validLeaveAllocations(midnightLeave(), [allocation])).toBe(false);
    });
    it.each([null, {}, { length: 1 }, [null], [{}], 'not-an-array'].map(allocations => ({ allocations })))('rejects malformed allocations without throwing: %j', ({ allocations }) => {
        expect(validLeaveAllocations(midnightLeave(), allocations as any)).toBe(false);
    });
});

describe('schedule review gap evidence', () => {
    it('settles only when the current gap key has an explicit reason', () => {
        const day = schedule(), record = card('2026-04-01', '09:00', '12:00');
        const gaps = getScheduleReviewGaps(employee, month, [day], [record], []);
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toMatchObject({ date: day.date, scheduledMinutes: 480, coveredMinutes: 180 });
        const withReason = (reason: string) => ({ ...employee, payrollReview: { ...review, scheduleExceptions: [{ date: day.date, sourceKey: gaps[0].sourceKey, reason }] } });
        expect(calculateSalaryForEmployee(withReason(' '), month, [day], [record], []).netSalary).toBeNull();
        expect(calculateSalaryForEmployee(withReason('核實下午未出勤，不補計工時'), month, [day], [record], []).netSalary).toBe(600);
        expect(getScheduleReviewGaps(withReason('核實下午未出勤'), month, [day], [record], [])).toEqual(gaps);
        const changed = card('2026-04-01', '09:00', '11:00');
        expect(calculateSalaryForEmployee(withReason('核實下午未出勤'), month, [day], [changed], []).netSalary).toBeNull();
        expect(getScheduleReviewGaps(employee, month, [day], [changed], [])[0].sourceKey).not.toBe(gaps[0].sourceKey);
    });
    it('binds to schedule and leave changes while excluding other employees', () => {
        const day = schedule(), record = card('2026-04-01', '09:00', '12:00'), approved = paidLeave('2026-04-01', '13:00', '17:00');
        const [gap] = getScheduleReviewGaps(employee, month, [day], [record], [approved]);
        expect(gap.coveredMinutes).toBe(420);
        expect(getScheduleReviewGaps(employee, month, [day], [record, { ...card(), empId: 'OTHER' }], [approved, { ...paidLeave('2026-04-01'), empId: 'OTHER' }])).toEqual([gap]);
        expect(getScheduleReviewGaps(employee, month, [schedule(undefined, '09:00', '18:00')], [record], [approved])[0].sourceKey).not.toBe(gap.sourceKey);
        expect(getScheduleReviewGaps(employee, month, [day], [record], [paidLeave('2026-04-01', '14:00', '17:00')])[0].sourceKey).not.toBe(gap.sourceKey);
    });
});
