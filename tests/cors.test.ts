import { describe, it, expect } from 'vitest';
import { parseAllowedOrigins, getAllowedOrigin, corsHeaders } from '../netlify/functions/utils/cors';

describe('parseAllowedOrigins', () => {
    it('未設環境變數 → fallback 預設清單', () => {
        const list = parseAllowedOrigins(undefined);
        expect(list).toContain('https://chiayiyouthlabclock.netlify.app');
        expect(list).toContain('http://localhost:5173');
        expect(list).toContain('http://localhost:8888');
    });

    it('空字串 → fallback 預設清單', () => {
        expect(parseAllowedOrigins('').length).toBeGreaterThan(0);
        expect(parseAllowedOrigins('   ').length).toBeGreaterThan(0);
    });

    it('逗號分隔解析正確並 trim 空白', () => {
        const list = parseAllowedOrigins('https://a.com, https://b.com ,https://c.com');
        expect(list).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    });

    it('過濾空欄位', () => {
        const list = parseAllowedOrigins('https://a.com,,https://b.com');
        expect(list).toEqual(['https://a.com', 'https://b.com']);
    });
});

describe('getAllowedOrigin', () => {
    it('命中白名單 → 回傳該 origin', () => {
        expect(getAllowedOrigin('http://localhost:5173', '')).toBe('http://localhost:5173');
    });

    it('不在白名單 → 回傳 null', () => {
        expect(getAllowedOrigin('https://evil.com', '')).toBeNull();
    });

    it('undefined origin → 回傳 null（同源請求無 Origin header）', () => {
        expect(getAllowedOrigin(undefined, '')).toBeNull();
    });

    it('使用自訂 env 白名單', () => {
        const env = 'https://custom.example.org,https://another.example.org';
        expect(getAllowedOrigin('https://custom.example.org', env)).toBe('https://custom.example.org');
        expect(getAllowedOrigin('https://chiayiyouthlabclock.netlify.app', env)).toBeNull();
    });
});

describe('corsHeaders', () => {
    it('命中白名單 → 含 Access-Control-Allow-Origin', () => {
        const h = corsHeaders('http://localhost:5173', '');
        expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
        expect(h['Access-Control-Allow-Credentials']).toBe('true');
        expect(h['Vary']).toBe('Origin');
    });

    it('不命中 → 不含 Access-Control-Allow-Origin（瀏覽器自然會擋）', () => {
        const h = corsHeaders('https://evil.com', '');
        expect(h).not.toHaveProperty('Access-Control-Allow-Origin');
        expect(h['Vary']).toBe('Origin');
    });

    it('POST + OPTIONS 都允許', () => {
        const h = corsHeaders('http://localhost:5173', '');
        expect(h['Access-Control-Allow-Methods']).toContain('POST');
        expect(h['Access-Control-Allow-Methods']).toContain('OPTIONS');
    });

    it('Allow-Headers 含 Authorization 與 Content-Type', () => {
        const h = corsHeaders('http://localhost:5173', '');
        expect(h['Access-Control-Allow-Headers']).toContain('Authorization');
        expect(h['Access-Control-Allow-Headers']).toContain('Content-Type');
    });
});
