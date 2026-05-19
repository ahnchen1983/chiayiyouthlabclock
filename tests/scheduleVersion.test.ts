import { describe, expect, it } from 'vitest';
import { buildSnapshotFromSchedule, diffSnapshot } from '../netlify/functions/utils/scheduleVersion';
import type { ScheduleEvent, ScheduleVersion } from '../types';

const event = (overrides: Partial<ScheduleEvent>): ScheduleEvent => ({
    date: '2026-06-01',
    dayOfWeek: '一',
    status: '營運',
    openingHours: '08:30-17:30',
    requiredHeadcount: 2,
    shifts: [],
    ...overrides,
});

describe('buildSnapshotFromSchedule — 排班版本快照（Phase 6.2）', () => {
    it('空 schedule 回空 snapshot', () => {
        expect(buildSnapshotFromSchedule([])).toEqual({});
    });

    it('保留兩頭班 shifts，且忽略沒有 date 的資料', () => {
        const snapshot = buildSnapshotFromSchedule([
            event({
                shifts: [
                    { empId: 'E001', name: '甲', role: 'staffA', from: '08:30', to: '12:30' },
                    { empId: 'E001', name: '甲', role: 'staffA', from: '14:00', to: '17:30' },
                ],
            }),
            event({ date: '' }),
        ]);

        expect(Object.keys(snapshot)).toEqual(['2026-06-01']);
        expect(snapshot['2026-06-01'].shifts).toHaveLength(2);
        expect(snapshot['2026-06-01'].requiredHeadcount).toBe(2);
    });

    it('shifts 非陣列時 fallback 成空陣列', () => {
        const snapshot = buildSnapshotFromSchedule([
            event({ shifts: undefined as unknown as ScheduleEvent['shifts'] }),
        ]);

        expect(snapshot['2026-06-01'].shifts).toEqual([]);
    });
});

describe('diffSnapshot — 排班版本差異（Phase 6.2）', () => {
    const base: ScheduleVersion['snapshot'] = buildSnapshotFromSchedule([
        event({ date: '2026-06-01' }),
        event({ date: '2026-06-02', status: '休館', openingHours: undefined, requiredHeadcount: undefined }),
    ]);

    it('完全相同時沒有差異', () => {
        expect(diffSnapshot(base, base)).toEqual({ added: [], removed: [], changed: [] });
    });

    it('辨識 added / removed / changed，並依日期排序', () => {
        const current: ScheduleVersion['snapshot'] = buildSnapshotFromSchedule([
            event({ date: '2026-06-01', requiredHeadcount: 3 }),
            event({ date: '2026-06-03' }),
        ]);

        expect(diffSnapshot(current, base)).toEqual({
            added: ['2026-06-03'],
            removed: ['2026-06-02'],
            changed: ['2026-06-01'],
        });
    });
});
