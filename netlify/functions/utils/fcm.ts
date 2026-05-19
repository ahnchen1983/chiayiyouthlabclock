import type { FcmTokenDoc, NotificationType } from '../../../types';

const MAX_FAILURE_COUNT = 5;
const PRUNE_AFTER_DAYS = 60;

export const tokenIdFromToken = async (token: string): Promise<string> => {
    const buf = new TextEncoder().encode(token);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
        .slice(0, 12)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

export const filterActiveTokens = (
    tokens: FcmTokenDoc[],
    asOf: Date = new Date(),
): FcmTokenDoc[] => {
    const cutoff = asOf.getTime() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    return tokens.filter(token => {
        if ((token.failureCount ?? 0) >= MAX_FAILURE_COUNT) return false;
        const lastSeen = new Date(token.lastSeenAt || token.createdAt).getTime();
        if (Number.isNaN(lastSeen)) return false;
        return lastSeen >= cutoff;
    });
};

export const buildFcmPayload = (params: {
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    notificationId?: string;
}): { data: Record<string, string> } => {
    const { type, title, message, link, notificationId } = params;
    return {
        data: {
            type,
            title,
            message,
            ...(link ? { link } : {}),
            ...(notificationId ? { notificationId } : {}),
        },
    };
};

export const tokensToDelete = (
    sendResults: Array<{ tokenId: string; error?: { code: string } }>,
): string[] => {
    const fatalCodes = new Set([
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered',
        'messaging/invalid-argument',
    ]);
    return sendResults
        .filter(result => result.error && fatalCodes.has(result.error.code))
        .map(result => result.tokenId);
};
