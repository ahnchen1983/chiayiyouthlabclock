import { describe, expect, it } from 'vitest';
import { matchPreferenceForDate, validateStaffPreference } from '../netlify/functions/utils/staffPreferences';
import type { StaffPreference } from '../types';

describe('validateStaffPreference', () => {
    it('normalizes weekdays and dates with stable sorting', () => {
        const result = validateStaffPreference({
            blockedWeekdays: [6, 1, 1, 9, -1, 3.5, 0],
            blockedDates: ['2026-05-20', 'bad', '2026-05-19', '2026-05-20'],
            preferredDates: ['2026-05-21', '2026-05-21'],
            note: '  週末盡量避開  ',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.blockedWeekdays).toEqual([0, 1, 6]);
        expect(result.value.blockedDates).toEqual(['2026-05-19', '2026-05-20']);
        expect(result.value.preferredDates).toEqual(['2026-05-21']);
        expect(result.value.note).toBe('週末盡量避開');
    });

    it('defaults invalid array inputs to empty lists', () => {
        const result = validateStaffPreference({
            blockedWeekdays: undefined,
            blockedDates: undefined,
            preferredDates: undefined,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.blockedWeekdays).toEqual([]);
        expect(result.value.blockedDates).toEqual([]);
        expect(result.value.preferredDates).toEqual([]);
    });

    it('rejects overlap between blocked and preferred dates', () => {
        const result = validateStaffPreference({
            blockedDates: ['2026-05-20'],
            preferredDates: ['2026-05-20'],
        });

        expect(result.ok).toBe(false);
        if (result.ok !== false) return;
        expect(result.error).toContain('同時出現');
    });

    it('rejects more than 200 blocked dates', () => {
        const blockedDates = Array.from({ length: 201 }, (_, idx) => {
            const month = String(Math.floor(idx / 28) + 1).padStart(2, '0');
            const day = String((idx % 28) + 1).padStart(2, '0');
            return `2026-${month}-${day}`;
        });

        const result = validateStaffPreference({ blockedDates });

        expect(result.ok).toBe(false);
        if (result.ok !== false) return;
        expect(result.error).toContain('上限 200');
    });

    it('rejects more than 200 preferred dates', () => {
        const preferredDates = Array.from({ length: 201 }, (_, idx) => {
            const month = String(Math.floor(idx / 28) + 1).padStart(2, '0');
            const day = String((idx % 28) + 1).padStart(2, '0');
            return `2027-${month}-${day}`;
        });

        const result = validateStaffPreference({ preferredDates });

        expect(result.ok).toBe(false);
        if (result.ok !== false) return;
        expect(result.error).toContain('上限 200');
    });

    it('rejects notes longer than 200 characters', () => {
        const result = validateStaffPreference({ note: 'a'.repeat(201) });

        expect(result.ok).toBe(false);
        if (result.ok !== false) return;
        expect(result.error).toContain('備註');
    });
});

describe('matchPreferenceForDate', () => {
    const basePreference: StaffPreference = {
        empId: 'EMP001',
        blockedWeekdays: [6],
        blockedDates: [],
        preferredDates: [],
    };

    it('matches blocked weekday', () => {
        expect(matchPreferenceForDate(basePreference, '2026-05-23')).toBe('blocked');
    });

    it('matches blocked specific date before weekday fallback', () => {
        expect(matchPreferenceForDate({
            ...basePreference,
            blockedWeekdays: [],
            blockedDates: ['2026-05-20'],
        }, '2026-05-20')).toBe('blocked');
    });

    it('matches preferred specific date', () => {
        expect(matchPreferenceForDate({
            ...basePreference,
            blockedWeekdays: [],
            preferredDates: ['2026-05-22'],
        }, '2026-05-22')).toBe('preferred');
    });

    it('lets blocked date win if persisted data is inconsistent', () => {
        expect(matchPreferenceForDate({
            ...basePreference,
            blockedDates: ['2026-05-22'],
            preferredDates: ['2026-05-22'],
        }, '2026-05-22')).toBe('blocked');
    });

    it('returns neutral for null preference and invalid date', () => {
        expect(matchPreferenceForDate(null, '2026-05-20')).toBe('neutral');
        expect(matchPreferenceForDate(basePreference, 'bad-date')).toBe('neutral');
    });

    it('returns neutral when no preference matches', () => {
        expect(matchPreferenceForDate(basePreference, '2026-05-21')).toBe('neutral');
    });
});
