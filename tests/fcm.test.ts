import { describe, expect, it } from 'vitest';
import {
    buildFcmPayload,
    filterActiveTokens,
    tokenIdFromToken,
    tokensToDelete,
} from '../netlify/functions/utils/fcm';
import type { FcmTokenDoc } from '../types';

const mk = (overrides: Partial<FcmTokenDoc> = {}): FcmTokenDoc => ({
    tokenId: 't1',
    empId: 'E001',
    token: 'token-value',
    createdAt: '2026-04-01T00:00:00Z',
    lastSeenAt: '2026-05-01T00:00:00Z',
    failureCount: 0,
    ...overrides,
});

describe('tokenIdFromToken', () => {
    it('returns a stable 24 hex char id without exposing token content', async () => {
        const id1 = await tokenIdFromToken('sample-fcm-token-value');
        const id2 = await tokenIdFromToken('sample-fcm-token-value');

        expect(id1).toBe(id2);
        expect(id1).toMatch(/^[a-f0-9]{24}$/);
        expect(id1).not.toContain('sample');
    });
});

describe('filterActiveTokens', () => {
    const now = new Date('2026-05-20T00:00:00Z');

    it('keeps normal active tokens', () => {
        expect(filterActiveTokens([mk()], now)).toHaveLength(1);
    });

    it('filters tokens with too many failures', () => {
        const result = filterActiveTokens([
            mk({ tokenId: 't1', failureCount: 5 }),
            mk({ tokenId: 't2', failureCount: 4 }),
        ], now);

        expect(result.map(t => t.tokenId)).toEqual(['t2']);
    });

    it('filters tokens not seen for more than 60 days', () => {
        const result = filterActiveTokens([
            mk({ tokenId: 'old', lastSeenAt: '2026-01-01T00:00:00Z' }),
            mk({ tokenId: 'new', lastSeenAt: '2026-05-15T00:00:00Z' }),
        ], now);

        expect(result.map(t => t.tokenId)).toEqual(['new']);
    });

    it('filters invalid lastSeenAt values', () => {
        expect(filterActiveTokens([mk({ lastSeenAt: 'garbage' })], now)).toHaveLength(0);
    });
});

describe('buildFcmPayload', () => {
    it('builds data-only payload', () => {
        const payload = buildFcmPayload({
            type: 'leave-approved',
            title: '請假已核准',
            message: '5/20 特休',
        });

        expect(payload.data).toEqual({
            type: 'leave-approved',
            title: '請假已核准',
            message: '5/20 特休',
        });
    });

    it('includes link and notificationId when present', () => {
        const payload = buildFcmPayload({
            type: 'shift-swap-approved',
            title: '換班核可',
            message: '已生效',
            link: '/admin/swaps',
            notificationId: 'abc',
        });

        expect(payload.data.link).toBe('/admin/swaps');
        expect(payload.data.notificationId).toBe('abc');
    });
});

describe('tokensToDelete', () => {
    it('selects fatal FCM error codes', () => {
        const result = tokensToDelete([
            { tokenId: 't1' },
            { tokenId: 't2', error: { code: 'messaging/registration-token-not-registered' } },
            { tokenId: 't3', error: { code: 'messaging/server-unavailable' } },
            { tokenId: 't4', error: { code: 'messaging/invalid-registration-token' } },
        ]);

        expect(result.sort()).toEqual(['t2', 't4']);
    });

    it('returns empty list when no errors are fatal', () => {
        expect(tokensToDelete([
            { tokenId: 't1' },
            { tokenId: 't2', error: { code: 'messaging/server-unavailable' } },
        ])).toEqual([]);
    });
});
