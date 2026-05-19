import type { StaffPreference } from '../../../types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATES = 200;
const MAX_NOTE_LENGTH = 200;

export type StaffPreferenceInput = Partial<Pick<
    StaffPreference,
    'blockedWeekdays' | 'blockedDates' | 'preferredDates' | 'note'
>>;

export type StaffPreferenceValidation =
    | { ok: true; value: Omit<StaffPreference, 'empId' | 'updatedAt'> }
    | { ok: false; error: string };

const normalizeDateList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value.filter((item): item is string => typeof item === 'string' && DATE_RE.test(item)),
    )).sort();
};

export const validateStaffPreference = (input: StaffPreferenceInput): StaffPreferenceValidation => {
    const blockedWeekdays = Array.from(new Set(
        (Array.isArray(input.blockedWeekdays) ? input.blockedWeekdays : [])
            .filter(day => Number.isInteger(day) && day >= 0 && day <= 6),
    )).sort((a, b) => a - b);

    const blockedDates = normalizeDateList(input.blockedDates);
    const preferredDates = normalizeDateList(input.preferredDates);

    if (blockedDates.length > MAX_DATES) {
        return { ok: false, error: `不可上班日期上限 ${MAX_DATES} 筆` };
    }
    if (preferredDates.length > MAX_DATES) {
        return { ok: false, error: `偏好上班日期上限 ${MAX_DATES} 筆` };
    }

    const preferredSet = new Set(preferredDates);
    const overlap = blockedDates.find(date => preferredSet.has(date));
    if (overlap) {
        return { ok: false, error: `${overlap} 同時出現在不可上與偏好上，請擇一` };
    }

    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > MAX_NOTE_LENGTH) {
        return { ok: false, error: `備註不可超過 ${MAX_NOTE_LENGTH} 字` };
    }

    return {
        ok: true,
        value: {
            blockedWeekdays,
            blockedDates,
            preferredDates,
            ...(note ? { note } : {}),
        },
    };
};

export type StaffPreferenceMatch = 'blocked' | 'preferred' | 'neutral';

export const matchPreferenceForDate = (
    preference: StaffPreference | null | undefined,
    date: string,
): StaffPreferenceMatch => {
    if (!preference || !DATE_RE.test(date)) return 'neutral';
    if ((preference.blockedDates || []).includes(date)) return 'blocked';
    if ((preference.preferredDates || []).includes(date)) return 'preferred';

    const day = new Date(date).getDay();
    return (preference.blockedWeekdays || []).includes(day) ? 'blocked' : 'neutral';
};
