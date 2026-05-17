import { describe, it, expect } from 'vitest';
import { getMonthKey, isMonthLocked, canModifyOnDate } from '../netlify/functions/utils/monthLock';
import type { MonthLock } from '../types';

const lockedFor = (ym: string): MonthLock => ({
    yearMonth: ym,
    lockedBy: 'ADMIN',
    lockedByName: '系統管理員',
    lockedAt: '2026-05-01T00:00:00Z',
    totalAmount: 500000,
    employeeCount: 5,
});

const unlockedFor = (ym: string): MonthLock => ({
    ...lockedFor(ym),
    unlockedBy: 'ADMIN',
    unlockedByName: '系統管理員',
    unlockedAt: '2026-05-02T00:00:00Z',
    unlockReason: '會計補正',
});

describe('getMonthKey', () => {
    it('取 YYYY-MM-DD 的前 7 碼', () => {
        expect(getMonthKey('2026-04-30')).toBe('2026-04');
        expect(getMonthKey('2026-04-01')).toBe('2026-04');
    });
    it('ISO timestamp 也可用', () => {
        expect(getMonthKey('2026-04-15T10:00:00Z')).toBe('2026-04');
    });
    it('空字串 / 無效輸入回空字串', () => {
        expect(getMonthKey('')).toBe('');
        expect(getMonthKey('abc')).toBe('');
        expect(getMonthKey('2026/04/15')).toBe('');
    });
});

describe('isMonthLocked', () => {
    it('null / undefined → 未鎖定', () => {
        expect(isMonthLocked(null)).toBe(false);
        expect(isMonthLocked(undefined)).toBe(false);
    });
    it('有 lock 且無 unlockedAt → 鎖定', () => {
        expect(isMonthLocked(lockedFor('2026-04'))).toBe(true);
    });
    it('有 lock 且有 unlockedAt → 解鎖', () => {
        expect(isMonthLocked(unlockedFor('2026-04'))).toBe(false);
    });
});

describe('canModifyOnDate', () => {
    const locks = { '2026-04': lockedFor('2026-04') };

    it('鎖定月內任何日期都不可修改', () => {
        expect(canModifyOnDate('2026-04-01', locks)).toBe(false);
        expect(canModifyOnDate('2026-04-15', locks)).toBe(false);
    });
    it('鎖定月最後一天（邊界）也要擋', () => {
        expect(canModifyOnDate('2026-04-30', locks)).toBe(false);
    });
    it('鎖定月隔日（5 月 1 日）可以修改', () => {
        expect(canModifyOnDate('2026-05-01', locks)).toBe(true);
    });
    it('查無 lock 記錄的月份可以修改', () => {
        expect(canModifyOnDate('2026-03-15', locks)).toBe(true);
    });
    it('已解鎖月份可以修改', () => {
        const unlockedMap = { '2026-04': unlockedFor('2026-04') };
        expect(canModifyOnDate('2026-04-15', unlockedMap)).toBe(true);
    });
    it('空字串日期不擋（其他層應已 fail）', () => {
        expect(canModifyOnDate('', locks)).toBe(true);
    });
});
