/**
 * Phase 7.5 — Sentry 整合單元測試
 *
 * 設計策略：mock @sentry/react，測試 sentryUser helper 與 ErrorBoundary
 * 的整合點。不依賴 DOM render（沒裝 RTL / jsdom），改用直接呼叫方法的
 * 方式驗證 — 涵蓋了工單 § 4.2「個資紅線」與「scrub 保險絲」兩項要求。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    captureException: vi.fn(),
    setUser: vi.fn(),
}));

import * as Sentry from '@sentry/react';
import { applyUserToSentry, scrubPasswordFields } from '../services/sentryUser';
import ErrorBoundary from '../components/ErrorBoundary';
import React from 'react';

beforeEach(() => {
    vi.clearAllMocks();
});

// =============================================================
// applyUserToSentry
// =============================================================

describe('applyUserToSentry', () => {
    it('user 物件 → 只送 id 與 role（不送 name / email）', () => {
        applyUserToSentry({ id: 'EMP001', role: '員工' });
        expect(Sentry.setUser).toHaveBeenCalledTimes(1);
        const payload = (Sentry.setUser as any).mock.calls[0][0];
        expect(payload).toEqual({ id: 'EMP001', role: '員工' });
        expect(payload).not.toHaveProperty('name');
        expect(payload).not.toHaveProperty('email');
        expect(payload).not.toHaveProperty('username');
    });

    it('null → 清除 user context', () => {
        applyUserToSentry(null);
        expect(Sentry.setUser).toHaveBeenCalledWith(null);
    });

    it('多次呼叫互不污染（後者覆蓋前者）', () => {
        applyUserToSentry({ id: 'EMP001', role: '員工' });
        applyUserToSentry({ id: 'ADMIN', role: '最高管理者' });
        expect(Sentry.setUser).toHaveBeenCalledTimes(2);
        const last = (Sentry.setUser as any).mock.calls.at(-1)[0];
        expect(last).toEqual({ id: 'ADMIN', role: '最高管理者' });
    });
});

// =============================================================
// scrubPasswordFields
// =============================================================

describe('scrubPasswordFields', () => {
    it('過濾 extra.password', () => {
        const event: any = { extra: { password: 'super-secret', other: 'safe' } };
        scrubPasswordFields(event);
        expect(event.extra.password).toBe('[Filtered]');
        expect(event.extra.other).toBe('safe');
    });

    it('過濾巢狀 extra.someObj.newPassword', () => {
        const event: any = { extra: { payload: { newPassword: 'xyz', age: 30 } } };
        scrubPasswordFields(event);
        expect(event.extra.payload.newPassword).toBe('[Filtered]');
        expect(event.extra.payload.age).toBe(30);
    });

    it('過濾 breadcrumbs[].data 內的 oldPassword', () => {
        const event: any = {
            breadcrumbs: [
                { data: { oldPassword: 'abc', endpoint: '/api' } },
                { data: { confirmPassword: 'def' } },
            ],
        };
        scrubPasswordFields(event);
        expect(event.breadcrumbs[0].data.oldPassword).toBe('[Filtered]');
        expect(event.breadcrumbs[0].data.endpoint).toBe('/api');
        expect(event.breadcrumbs[1].data.confirmPassword).toBe('[Filtered]');
    });

    it('event 為空 / 無相關欄位也不爆', () => {
        expect(() => scrubPasswordFields({})).not.toThrow();
        expect(() => scrubPasswordFields(null)).not.toThrow();
    });

    it('不會誤改非密碼欄位（password 開頭但 key 不同）', () => {
        const event: any = { extra: { passwordHash: 'abc', PasswordResetToken: 'xyz' } };
        scrubPasswordFields(event);
        // 大小寫敏感、完整字串比對 → 不在 SENSITIVE_KEYS 內，不改
        expect(event.extra.passwordHash).toBe('abc');
        expect(event.extra.PasswordResetToken).toBe('xyz');
    });
});

// =============================================================
// ErrorBoundary → Sentry.captureException
// =============================================================

describe('ErrorBoundary → Sentry.captureException', () => {
    it('componentDidCatch 會呼叫 Sentry.captureException 並帶 componentStack', () => {
        // 直接 new class，呼叫 lifecycle 方法（不需 DOM render）
        const eb = new ErrorBoundary({ children: null });
        const err = new Error('boom');
        const info = { componentStack: '\n  at Boom\n  at App\n' } as React.ErrorInfo;
        eb.componentDidCatch(err, info);
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [capturedErr, ctx] = (Sentry.captureException as any).mock.calls[0];
        expect(capturedErr).toBe(err);
        expect(ctx).toEqual({ extra: { componentStack: info.componentStack } });
    });

    it('多筆錯誤各自上報', () => {
        const eb = new ErrorBoundary({ children: null });
        const info = { componentStack: '' } as React.ErrorInfo;
        eb.componentDidCatch(new Error('e1'), info);
        eb.componentDidCatch(new Error('e2'), info);
        expect(Sentry.captureException).toHaveBeenCalledTimes(2);
    });
});
