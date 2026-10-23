import { describe, expect, it } from 'vitest';
import { calculateSalaryForEmployee } from '../netlify/functions/utils/payroll';
import { clockSourceKey } from '../utils/attendance';
import { LeaveType } from '../types';
import { employee, card, leave, month, review } from './fixtures/payrollV2';

describe('PR 13 independent payroll review reproducer', () => {
    it('blocks paid leave that overlaps the next-day portion of overnight work', () => {
        const overnight = card('2026-04-01', '22:00', '06:00', false);
        overnight.clockInAt = '2026-04-01T22:00:00+08:00';
        overnight.clockOutAt = '2026-04-02T06:00:00+08:00';
        overnight.workIntervals = [{ start: 1320, end: 1800 }];
        overnight.workReview = { sourceKey: clockSourceKey(overnight), reviewedBy: 'SYNTH-reviewer', reviewedAt: review.reviewedAt };
        const paidLeave = {
            ...leave('2026-04-02', LeaveType.Annual),
            startDate: '2026-04-02T02:00', endDate: '2026-04-02T06:00',
            payrollAllocations: [{ date: '2026-04-02', from: '02:00', to: '06:00', minutes: 240 }],
        };
        const salary = calculateSalaryForEmployee(employee, month, [], [overnight], [paidLeave]);
        console.log('overnight/leave actual result', JSON.stringify(salary));
        expect(salary.calculationStatus).toBe('needs-review');
        expect(salary.netSalary).toBeNull();
    });
});
