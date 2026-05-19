import { describe, expect, it } from 'vitest';
import { executeSwap, validateSwapRequest } from '../netlify/functions/utils/shiftSwap';
import type { MonthLock, ScheduleEvent, ShiftSwapRequest } from '../types';

const day = (date: string, shifts: ScheduleEvent['shifts']): ScheduleEvent => ({
    date,
    dayOfWeek: '一',
    status: '營運',
    openingHours: '08:30-17:30',
    requiredHeadcount: 2,
    shifts,
});

const baseSchedule: Record<string, ScheduleEvent> = {
    '2026-06-01': day('2026-06-01', [
        { empId: 'A', name: '小青', role: 'staffA', from: '08:30', to: '12:30' },
        { empId: 'C', name: '小橘', role: 'staffB', from: '13:30', to: '17:30' },
    ]),
    '2026-06-02': day('2026-06-02', [
        { empId: 'B', name: '小藍', role: 'partTime', from: '10:00', to: '14:00' },
    ]),
};

const req = (overrides: Partial<ShiftSwapRequest> = {}) => ({
    fromEmpId: 'A',
    fromDate: '2026-06-01',
    fromShiftIndex: 0,
    toEmpId: 'B',
    toDate: '2026-06-02',
    toShiftIndex: 0,
    reason: '家中臨時有事需要協調',
    ...overrides,
});

describe('validateSwapRequest — 換班申請驗證（Phase 6.1）', () => {
    it('合法換班申請通過', () => {
        expect(validateSwapRequest(req(), baseSchedule, {})).toEqual({ valid: true });
    });

    it('不能跟自己換班', () => {
        const result = validateSwapRequest(req({ toEmpId: 'A' }), baseSchedule, {});
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能與自己換班');
    });

    it('原因至少 5 字', () => {
        const result = validateSwapRequest(req({ reason: '太短' }), baseSchedule, {});
        expect(result.valid).toBe(false);
        expect(result.error).toContain('原因至少 5 字');
    });

    it('班次 index 不存在時拒絕', () => {
        const result = validateSwapRequest(req({ fromShiftIndex: 9 }), baseSchedule, {});
        expect(result.valid).toBe(false);
        expect(result.error).toContain('找不到 index 9');
    });

    it('月份已鎖定時拒絕', () => {
        const locks: Record<string, MonthLock> = {
            '2026-06': {
                yearMonth: '2026-06',
                lockedBy: 'ADMIN',
                lockedByName: '管理員',
                lockedAt: '2026-07-01T00:00:00Z',
                totalAmount: 1000,
                employeeCount: 2,
            },
        };
        const result = validateSwapRequest(req(), baseSchedule, locks);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('2026-06 月結已鎖定');
    });

    it('班次擁有者不符時拒絕', () => {
        const result = validateSwapRequest(req({ fromEmpId: 'Z' }), baseSchedule, {});
        expect(result.valid).toBe(false);
        expect(result.error).toContain('發起人非該班次的擁有者');
    });
});

describe('executeSwap — 換班執行（Phase 6.1）', () => {
    it('只交換 empId/name，不改 role/from/to', () => {
        const { fromDay, toDay } = executeSwap(baseSchedule, {
            fromDate: '2026-06-01',
            fromShiftIndex: 0,
            toDate: '2026-06-02',
            toShiftIndex: 0,
            fromEmpId: 'A',
            fromName: '小青',
            toEmpId: 'B',
            toName: '小藍',
        });

        expect(fromDay.shifts[0]).toMatchObject({ empId: 'B', name: '小藍', role: 'staffA', from: '08:30', to: '12:30' });
        expect(toDay.shifts[0]).toMatchObject({ empId: 'A', name: '小青', role: 'partTime', from: '10:00', to: '14:00' });
    });

    it('支援同日兩頭班互換，回傳同一日物件', () => {
        const { fromDay, toDay } = executeSwap(baseSchedule, {
            fromDate: '2026-06-01',
            fromShiftIndex: 0,
            toDate: '2026-06-01',
            toShiftIndex: 1,
            fromEmpId: 'A',
            fromName: '小青',
            toEmpId: 'C',
            toName: '小橘',
        });

        expect(fromDay).toBe(toDay);
        expect(fromDay.shifts[0].empId).toBe('C');
        expect(fromDay.shifts[1].empId).toBe('A');
    });
});
