/**
 * CORS 白名單 — 純函數，無 I/O
 * Phase 9.1
 */

const DEFAULT_ALLOWED_ORIGINS = [
    'https://chiayiyouthlabclock.netlify.app',
    'http://localhost:5173',
    'http://localhost:8888',
];

export const parseAllowedOrigins = (envValue: string | undefined): string[] => {
    if (!envValue || !envValue.trim()) return DEFAULT_ALLOWED_ORIGINS;
    return envValue.split(',').map(s => s.trim()).filter(Boolean);
};

/**
 * 比對 request origin 是否在白名單，命中則回傳，否則回 null
 */
export const getAllowedOrigin = (
    requestOrigin: string | undefined,
    envValue: string | undefined = process.env.ALLOWED_ORIGINS,
): string | null => {
    if (!requestOrigin) return null;
    const list = parseAllowedOrigins(envValue);
    return list.includes(requestOrigin) ? requestOrigin : null;
};

/**
 * 不在白名單時，回傳的 headers「不含」Access-Control-Allow-Origin（讓瀏覽器擋）
 */
export const corsHeaders = (
    requestOrigin: string | undefined,
    envValue?: string,
): Record<string, string> => {
    const allowed = getAllowedOrigin(requestOrigin, envValue);
    const base: Record<string, string> = {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Vary': 'Origin',
    };
    if (allowed) base['Access-Control-Allow-Origin'] = allowed;
    return base;
};
