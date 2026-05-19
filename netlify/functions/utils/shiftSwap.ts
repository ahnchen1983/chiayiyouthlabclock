/**
 * 換班申請 — 純函數，無 I/O
 * Phase 6.1
 */
import type { MonthLock, ScheduleEvent, ShiftSwapRequest } from '../../../types';
import { canModifyOnDate, getMonthKey } from './monthLock';

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

export const validateSwapRequest = (
    req: Pick<ShiftSwapRequest,
        'fromEmpId' | 'fromDate' | 'fromShiftIndex' |
        'toEmpId' | 'toDate' | 'toShiftIndex' | 'reason'
    >,
    schedule: Record<string, ScheduleEvent | undefined>,
    locks: Record<string, MonthLock | null | undefined>,
): ValidationResult => {
    if (req.fromEmpId === req.toEmpId) {
        return { valid: false, error: '不能與自己換班' };
    }
    if (!req.reason || req.reason.trim().length < 5) {
        return { valid: false, error: '原因至少 5 字' };
    }
    if (!canModifyOnDate(req.fromDate, locks)) {
        return { valid: false, error: `${getMonthKey(req.fromDate)} 月結已鎖定，無法換班` };
    }
    if (!canModifyOnDate(req.toDate, locks)) {
        return { valid: false, error: `${getMonthKey(req.toDate)} 月結已鎖定，無法換班` };
    }

    const fromDay = schedule[req.fromDate];
    const toDay = schedule[req.toDate];
    const fromShift = fromDay?.shifts?.[req.fromShiftIndex];
    const toShift = toDay?.shifts?.[req.toShiftIndex];

    if (!fromShift) return { valid: false, error: `${req.fromDate} 找不到 index ${req.fromShiftIndex} 的班次` };
    if (!toShift) return { valid: false, error: `${req.toDate} 找不到 index ${req.toShiftIndex} 的班次` };
    if (fromShift.empId !== req.fromEmpId) return { valid: false, error: '發起人非該班次的擁有者' };
    if (toShift.empId !== req.toEmpId) return { valid: false, error: '對方非該班次的擁有者' };

    return { valid: true };
};

export const executeSwap = (
    schedule: Record<string, ScheduleEvent>,
    req: Pick<ShiftSwapRequest,
        'fromDate' | 'fromShiftIndex' | 'toDate' | 'toShiftIndex' |
        'fromEmpId' | 'fromName' | 'toEmpId' | 'toName'
    >,
): { fromDay: ScheduleEvent; toDay: ScheduleEvent } => {
    const isSameDay = req.fromDate === req.toDate;
    const fromDay = JSON.parse(JSON.stringify(schedule[req.fromDate])) as ScheduleEvent;
    const toDay = isSameDay ? fromDay : JSON.parse(JSON.stringify(schedule[req.toDate])) as ScheduleEvent;

    fromDay.shifts[req.fromShiftIndex].empId = req.toEmpId;
    fromDay.shifts[req.fromShiftIndex].name = req.toName;
    toDay.shifts[req.toShiftIndex].empId = req.fromEmpId;
    toDay.shifts[req.toShiftIndex].name = req.fromName;

    return { fromDay, toDay };
};
