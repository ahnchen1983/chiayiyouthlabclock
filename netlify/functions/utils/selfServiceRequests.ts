/**
 * 員工自助申請流程純函數驗證（Phase 8.5）
 * 抽離給 Vitest 跑、給 api.ts 共用。
 */
import type { LeaveOfAbsenceRequestStatus } from '../../../types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RETROACTIVE_MAX_DAYS = 30;
const MIN_REASON_LEN = 5;

/**
 * 驗證留停申請欄位。
 * @returns null 表通過；string 為錯誤訊息（給前端 alert / 後端 fail message）
 */
export const validateLeaveOfAbsenceRequest = (
    startDate: string,
    endDate: string | undefined,
    reason: string,
    today: Date = new Date(),
): string | null => {
    if (!startDate || !DATE_RE.test(startDate)) {
        return 'startDate 格式錯誤，需為 YYYY-MM-DD';
    }
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return 'startDate 無效';

    if (endDate !== undefined && endDate !== null && endDate !== '') {
        if (!DATE_RE.test(endDate)) return 'endDate 格式錯誤，需為 YYYY-MM-DD';
        const end = new Date(endDate);
        if (Number.isNaN(end.getTime())) return 'endDate 無效';
        if (end.getTime() < start.getTime()) return 'endDate 不可早於 startDate';
    }

    if (!reason || reason.trim().length < MIN_REASON_LEN) {
        return `留停事由需至少 ${MIN_REASON_LEN} 字`;
    }

    // startDate 不可早於今日往前 30 天（避免員工自行 retroactive 太久）
    // 用日期（不含時分）比對，避免 timezone 影響
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const earliest = new Date(todayStart.getTime() - RETROACTIVE_MAX_DAYS * 24 * 60 * 60 * 1000);
    if (start.getTime() < earliest.getTime()) {
        return `startDate 不可早於今日往前 ${RETROACTIVE_MAX_DAYS} 天`;
    }

    return null;
};

export const isTerminalLoaStatus = (status: LeaveOfAbsenceRequestStatus): boolean =>
    status === '核准' || status === '駁回';
