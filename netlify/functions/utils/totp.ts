/**
 * TOTP 雙因素認證 — RFC 6238（30s / 6 digits / SHA-1）
 * Phase 9.2
 *
 * 採用 otplib v13 functional API（v12 的 authenticator.* 已移除）。
 *
 * 個資紅線：
 *   - secret 純後端，不出 Firestore + 不寫 console / Sentry / auditLog
 *   - recoveryCodes 儲存為 scrypt hash（同密碼）
 */
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

// ±30 秒容忍時鐘漂移（epochTolerance 單位為秒）
const EPOCH_TOLERANCE_SEC = 30;

export const generateSecret = (): string => otpGenerateSecret();

export const verifyTotp = (secret: string, code: string): boolean => {
    if (!secret || !code) return false;
    if (!/^\d{6}$/.test(code)) return false;
    try {
        const result = verifySync({
            secret,
            token: code,
            strategy: 'totp',
            epochTolerance: EPOCH_TOLERANCE_SEC,
        });
        return result.valid;
    } catch {
        return false;
    }
};

export const buildOtpAuthUrl = (
    empId: string,
    secret: string,
    issuer: string = '嘉義青年實驗室',
): string => generateURI({
    strategy: 'totp',
    issuer,
    label: empId,
    secret,
});

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const generateRecoveryCodes = (n: number = 10): string[] => {
    const codes: string[] = [];
    for (let i = 0; i < n; i++) {
        const bytes = randomBytes(8);
        let code = '';
        for (let j = 0; j < 8; j++) {
            code += RECOVERY_ALPHABET[bytes[j] % RECOVERY_ALPHABET.length];
        }
        codes.push(code);
    }
    return codes;
};

export const hashRecoveryCode = (code: string): string => {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(code.toUpperCase(), salt, 64).toString('hex');
    return `${salt}:${hash}`;
};

export const verifyRecoveryCode = (code: string, stored: string): boolean => {
    if (!code || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const hashBuf = Buffer.from(hash, 'hex');
    const testBuf = scryptSync(code.toUpperCase(), salt, 64);
    if (hashBuf.length !== testBuf.length) return false;
    return timingSafeEqual(hashBuf, testBuf);
};

/**
 * 找到第一個 match 的 recovery code index；找不到回 -1
 */
export const findRecoveryCodeIndex = (code: string, hashes: string[]): number => {
    for (let i = 0; i < hashes.length; i++) {
        if (verifyRecoveryCode(code, hashes[i])) return i;
    }
    return -1;
};
