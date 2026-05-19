import { describe, it, expect } from 'vitest';
import { generateSync } from 'otplib';
import {
    generateSecret,
    verifyTotp,
    buildOtpAuthUrl,
    generateRecoveryCodes,
    hashRecoveryCode,
    verifyRecoveryCode,
    findRecoveryCodeIndex,
} from '../netlify/functions/utils/totp';

describe('generateSecret', () => {
    it('回傳非空 base32 字串', () => {
        const s = generateSecret();
        expect(typeof s).toBe('string');
        expect(s.length).toBeGreaterThanOrEqual(16);
        expect(s).toMatch(/^[A-Z2-7]+=*$/);
    });

    it('每次呼叫結果不同', () => {
        const s1 = generateSecret();
        const s2 = generateSecret();
        expect(s1).not.toBe(s2);
    });
});

describe('verifyTotp', () => {
    it('當前 code 通過', () => {
        const secret = generateSecret();
        const code = generateSync({ secret, strategy: 'totp' });
        expect(verifyTotp(secret, code)).toBe(true);
    });

    it('錯誤 code 失敗', () => {
        const secret = generateSecret();
        expect(verifyTotp(secret, '000000')).toBe(false);
    });

    it('非 6 位數字直接失敗', () => {
        const secret = generateSecret();
        expect(verifyTotp(secret, 'abcdef')).toBe(false);
        expect(verifyTotp(secret, '12345')).toBe(false);
        expect(verifyTotp(secret, '1234567')).toBe(false);
        expect(verifyTotp(secret, '')).toBe(false);
    });

    it('空 secret 或空 code 失敗（不會丟例外）', () => {
        expect(verifyTotp('', '123456')).toBe(false);
        expect(verifyTotp('SECRET', '')).toBe(false);
    });
});

describe('buildOtpAuthUrl', () => {
    it('產生符合 otpauth:// scheme 的 URL', () => {
        const url = buildOtpAuthUrl('EMP001', 'JBSWY3DPEHPK3PXP', '嘉義青年實驗室');
        expect(url.startsWith('otpauth://')).toBe(true);
        expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    });
});

describe('generateRecoveryCodes', () => {
    it('預設 10 組', () => {
        const codes = generateRecoveryCodes();
        expect(codes).toHaveLength(10);
    });

    it('每組 8 字元、來自允許字母表', () => {
        const codes = generateRecoveryCodes();
        for (const c of codes) {
            expect(c).toHaveLength(8);
            expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
        }
    });

    it('多次產生互不相同', () => {
        const a = generateRecoveryCodes();
        const b = generateRecoveryCodes();
        expect(new Set([...a, ...b]).size).toBe(20);
    });
});

describe('hashRecoveryCode / verifyRecoveryCode', () => {
    it('儲存格式為 salt:hash', () => {
        const stored = hashRecoveryCode('ABCD1234');
        expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
        expect(stored).not.toContain('ABCD1234');
    });

    it('verifyRecoveryCode 正確比對', () => {
        const stored = hashRecoveryCode('ABCD1234');
        expect(verifyRecoveryCode('ABCD1234', stored)).toBe(true);
        expect(verifyRecoveryCode('WRONG999', stored)).toBe(false);
    });

    it('大小寫不敏感（使用者抄錯也能驗）', () => {
        const stored = hashRecoveryCode('ABCD1234');
        expect(verifyRecoveryCode('abcd1234', stored)).toBe(true);
        expect(verifyRecoveryCode('AbCd1234', stored)).toBe(true);
    });

    it('空 code / 損壞格式不爆', () => {
        expect(verifyRecoveryCode('', 'salt:hash')).toBe(false);
        expect(verifyRecoveryCode('ABC', 'no-colon-here')).toBe(false);
    });
});

describe('findRecoveryCodeIndex', () => {
    it('找到 → 回 index', () => {
        const codes = ['ABCD1234', 'EFGH5678', 'IJKL9023'];
        const hashes = codes.map(hashRecoveryCode);
        expect(findRecoveryCodeIndex('EFGH5678', hashes)).toBe(1);
        expect(findRecoveryCodeIndex('ABCD1234', hashes)).toBe(0);
    });

    it('找不到 → 回 -1', () => {
        const hashes = ['ABCD1234'].map(hashRecoveryCode);
        expect(findRecoveryCodeIndex('XXXX9999', hashes)).toBe(-1);
    });

    it('用過的 code 從陣列移除後就找不到', () => {
        const codes = ['ABCD1234', 'EFGH5678'];
        const hashes = codes.map(hashRecoveryCode);
        const idx = findRecoveryCodeIndex('ABCD1234', hashes);
        expect(idx).toBe(0);
        hashes.splice(idx, 1);
        expect(findRecoveryCodeIndex('ABCD1234', hashes)).toBe(-1);
        // 但 EFGH5678 還在
        expect(findRecoveryCodeIndex('EFGH5678', hashes)).toBe(0);
    });
});
