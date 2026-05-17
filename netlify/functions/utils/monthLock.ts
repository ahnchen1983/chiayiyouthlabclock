/**
 * 月結鎖定 — 純函數，無 I/O
 * Phase 6.3
 */
import type { MonthLock } from '../../../types';

/**
 * 將 "YYYY-MM-DD" 或 ISO 日期取出月份 key "YYYY-MM"
 */
export const getMonthKey = (date: string): string => {
    if (!date || date.length < 7) return '';
    const key = date.slice(0, 7);
    // 必須符合 YYYY-MM 格式（簡單檢查）
    if (!/^\d{4}-\d{2}$/.test(key)) return '';
    return key;
};

/**
 * 判斷某月份是否被鎖定
 * - 文件不存在 → false
 * - 文件存在且 unlockedAt 未填 → true（已鎖定）
 * - 文件存在且有 unlockedAt → false（已解鎖）
 */
export const isMonthLocked = (lock: MonthLock | null | undefined): boolean => {
    if (!lock) return false;
    if (lock.unlockedAt) return false;
    return true;
};

/**
 * 判斷某日期是否可以修改（用於 update-schedule / approve-leave 等）
 */
export const canModifyOnDate = (
    date: string,
    locks: Record<string, MonthLock | null | undefined>
): boolean => {
    const monthKey = getMonthKey(date);
    if (!monthKey) return true;
    const lock = locks[monthKey];
    return !isMonthLocked(lock);
};
