/**
 * 排班版本歷史 — 純函數，無 I/O
 * Phase 6.2
 */
import type { ScheduleEvent, ScheduleVersion } from '../../../types';

export const buildSnapshotFromSchedule = (
    events: ScheduleEvent[],
): ScheduleVersion['snapshot'] => {
    const snapshot: ScheduleVersion['snapshot'] = {};

    for (const event of events || []) {
        if (!event?.date) continue;
        snapshot[event.date] = {
            status: event.status,
            ...(event.openingHours ? { openingHours: event.openingHours } : {}),
            ...(event.requiredHeadcount !== undefined ? { requiredHeadcount: event.requiredHeadcount } : {}),
            shifts: Array.isArray(event.shifts) ? event.shifts.map(s => ({ ...s })) : [],
        };
    }

    return snapshot;
};

export interface SnapshotDiff {
    added: string[];
    removed: string[];
    changed: string[];
}

export const diffSnapshot = (
    current: ScheduleVersion['snapshot'],
    version: ScheduleVersion['snapshot'],
): SnapshotDiff => {
    const result: SnapshotDiff = { added: [], removed: [], changed: [] };
    const dates = new Set<string>([
        ...Object.keys(current || {}),
        ...Object.keys(version || {}),
    ]);

    for (const date of dates) {
        const inCurrent = !!current?.[date];
        const inVersion = !!version?.[date];
        if (inCurrent && !inVersion) {
            result.added.push(date);
            continue;
        }
        if (!inCurrent && inVersion) {
            result.removed.push(date);
            continue;
        }
        if (inCurrent && inVersion && JSON.stringify(current[date]) !== JSON.stringify(version[date])) {
            result.changed.push(date);
        }
    }

    result.added.sort();
    result.removed.sort();
    result.changed.sort();
    return result;
};
