import { describe, expect, it } from 'vitest';
import { parseWorkIntervals, formatWorkIntervals } from '../utils/attendance';
import { editClock } from '../netlify/functions/utils/clockMutation';
import { card, review } from './fixtures/payrollV2';

describe('reviewed overnight work entered through the attendance form', () => {
    it('excludes a post-midnight break and preserves next-day starts', () => {
        const original = { ...card('2026-04-01', '22:00', '06:00', false), clockInAt: '2026-04-01T22:00:00+08:00', clockOutAt: '2026-04-02T06:00:00+08:00' };
        const text = '22:00-02:00+1,03:00+1-06:00+1';
        const result = editClock(original, { workIntervals: parseWorkIntervals(text) }, 'SYNTH', review.reviewedAt);
        expect(result.payableMinutes).toBe(420);
        expect(result.workHours).toBe(7);
        expect(formatWorkIntervals(result.workIntervals)).toBe(text);
    });
    it('an explicit empty review records zero actual work', () => {
        expect(editClock(card(), { workIntervals: parseWorkIntervals(' ') }, 'SYNTH', review.reviewedAt).workHours).toBe(0);
    });
    it.each(['22:00-06:00', '22:00-02:00+1,,03:00+1-06:00+1', '25:00-06:00+1', '22:00-03:00+2'])('rejects ambiguous or invalid work text %s', text => {
        expect(() => parseWorkIntervals(text)).toThrow();
    });
});
