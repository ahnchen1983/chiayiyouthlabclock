import type { ClockRecord } from '../../../types';
import { clockSourceKey, confirmedWork, localInstant, taipeiTime, validDate, resolveClockRecord, clockInterval } from '../../../utils/attendance';
// Explicit presence checks allow clearing a card. Any edit invalidates the old review.
export const editClock = (original: ClockRecord, patch: Record<string, any>, reviewer: string, at: string): ClockRecord => {
    const next = { ...original };
    for (const side of ['In', 'Out'] as const) {
        const time = `clock${side}Time` as const, stamp = `clock${side}At` as const;
        if (Object.prototype.hasOwnProperty.call(patch, stamp)) {
            const value = patch[stamp];
            if (value !== null && (!/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('完整時間必須含日期與時區');
            next[stamp] = value;
            next[time] = value ? taipeiTime(new Date(value)) : null;
        } else if (Object.prototype.hasOwnProperty.call(patch, time)) {
            const value = patch[time] || null;
            const instant = value ? localInstant(next.date, value) : null;
            if (value && !instant) throw new Error('打卡時間無效');
            next[time] = value; next[stamp] = instant;
        }
    }
    if (!validDate(next.date)) throw new Error('打卡日期無效');
    next.workReview = null; next.workIntervals = [];
    if (Object.prototype.hasOwnProperty.call(patch, 'workIntervals')) {
        next.workIntervals = patch.workIntervals;
        next.workReview = { sourceKey: clockSourceKey(next), reviewedBy: reviewer, reviewedAt: at };
        if (confirmedWork(next) === null) throw new Error('實際工作區間必須在完整打卡期間內，使用整數分鐘');
    }
    next.status = clockInterval(next) ? '正常' : '異常';
    next.manuallyEdited = true; next.editedBy = reviewer; next.editedAt = at;
    if (patch.note !== undefined) next.note = patch.note;
    return resolveClockRecord(next);
};
