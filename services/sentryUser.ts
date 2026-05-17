/**
 * Sentry user context 整合 — 純薄包裝
 * Phase 7.5
 *
 * 抽出來讓單元測試可以 mock @sentry/react 並驗證呼叫形狀，
 * 避免測試需依賴完整 React render。
 *
 * 個資紅線：payload 只能含 id + role。
 */
import * as Sentry from '@sentry/react';

export interface SentryUserPayload {
    id: string;     // empId
    role: string;
}

export const applyUserToSentry = (user: SentryUserPayload | null): void => {
    if (user) {
        Sentry.setUser({ id: user.id, role: user.role });
    } else {
        Sentry.setUser(null);
    }
};

// ==================== Sentry beforeSend 過濾 ====================
//
// 拉出來測試：把可能殘留的密碼欄位抹掉

const SENSITIVE_KEYS = new Set([
    'password',
    'newPassword',
    'oldPassword',
    'currentPassword',
    'confirmPassword',
]);

export const scrubPasswordFields = (event: any): void => {
    const walk = (obj: unknown): void => {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (SENSITIVE_KEYS.has(k) && typeof v === 'string') {
                (obj as Record<string, unknown>)[k] = '[Filtered]';
            } else if (typeof v === 'object') {
                walk(v);
            }
        }
    };
    walk(event?.extra);
    walk(event?.contexts);
    if (Array.isArray(event?.breadcrumbs)) {
        for (const bc of event.breadcrumbs) walk(bc.data);
    }
    if (event?.request) walk(event.request);
};
