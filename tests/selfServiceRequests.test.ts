import { describe, it, expect } from 'vitest';
import {
    validateLeaveOfAbsenceRequest,
    isTerminalLoaStatus,
} from '../netlify/functions/utils/selfServiceRequests';

const TODAY = new Date('2026-05-20');

describe('validateLeaveOfAbsenceRequest', () => {
    it('合法資料（含 endDate）回 null', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', '2026-09-01', '產假留停三個月', TODAY,
        )).toBeNull();
    });

    it('合法資料（endDate 空值，仍在留停）回 null', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', undefined, '育嬰留職停薪一年', TODAY,
        )).toBeNull();
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', '', '育嬰留職停薪一年', TODAY,
        )).toBeNull();
    });

    it('endDate 等於 startDate 合法', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', '2026-06-01', '短期一日留停', TODAY,
        )).toBeNull();
    });

    it('startDate 格式錯誤回錯誤訊息', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026/06/01', '', '事由完整', TODAY,
        )).toMatch(/startDate/);
        expect(validateLeaveOfAbsenceRequest(
            '', '', '事由完整', TODAY,
        )).toMatch(/startDate/);
    });

    it('endDate 早於 startDate → 錯誤', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', '2026-05-31', '事由完整', TODAY,
        )).toMatch(/endDate/);
    });

    it('endDate 格式錯誤 → 錯誤', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', '2026/06/15', '事由完整', TODAY,
        )).toMatch(/endDate/);
    });

    it('reason 少於 5 字 → 錯誤', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', '', '短', TODAY,
        )).toMatch(/事由/);
        expect(validateLeaveOfAbsenceRequest(
            '2026-06-01', '', '   ', TODAY,
        )).toMatch(/事由/);
    });

    it('startDate 早於今日 30 天以上 → 錯誤', () => {
        // 2026-05-20 - 30 天 = 2026-04-20；2026-04-19 應被擋
        expect(validateLeaveOfAbsenceRequest(
            '2026-04-19', '', '長期病假留停', TODAY,
        )).toMatch(/30 天/);
    });

    it('startDate 剛好今日往前 30 天 → 通過（邊界內）', () => {
        expect(validateLeaveOfAbsenceRequest(
            '2026-04-20', '', '長期病假留停', TODAY,
        )).toBeNull();
    });
});

describe('isTerminalLoaStatus', () => {
    it('核准 / 駁回 = true', () => {
        expect(isTerminalLoaStatus('核准')).toBe(true);
        expect(isTerminalLoaStatus('駁回')).toBe(true);
    });
    it('待審核 = false', () => {
        expect(isTerminalLoaStatus('待審核')).toBe(false);
    });
});
