/**
 * Phase 9.4 — Firestore Rules 單元測試
 *
 * D9-4 (a)：Firestore client 全 deny，所有讀寫只走後端 API。
 *
 * 本測試使用 @firebase/rules-unit-testing 啟動 Firestore emulator，
 * 需安裝 Java 11+。預設 `npm test` **不**含本測試（會在 CI 因 Java 環境失敗）。
 * 用 `npm run firebase:rules:test` 獨立執行。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { setDoc, getDoc, getDocs, collection, doc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'chiayiyouthlabclock-rules-test',
        firestore: {
            rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
    });
});

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});

describe('Firestore Rules — client 全 deny', () => {
    it('未認證 client 讀 employees → deny', async () => {
        const unauth = testEnv.unauthenticatedContext();
        const db = unauth.firestore();
        await assertFails(getDocs(collection(db, 'employees')));
    });

    it('已認證一般 user 讀 employees → deny（即使有 auth.uid）', async () => {
        const ctx = testEnv.authenticatedContext('EMP001', { role: '員工' });
        const db = ctx.firestore();
        await assertFails(getDocs(collection(db, 'employees')));
    });

    it('已認證一般 user 讀自己的 clockRecords → deny（全 deny 無例外）', async () => {
        const ctx = testEnv.authenticatedContext('EMP001');
        const db = ctx.firestore();
        await assertFails(getDoc(doc(db, 'clockRecords', 'self-record-1')));
    });

    it('未認證 client 寫 monthLocks → deny', async () => {
        const unauth = testEnv.unauthenticatedContext();
        const db = unauth.firestore();
        await assertFails(setDoc(doc(db, 'monthLocks', '2026-05'), { totalAmount: 0 }));
    });

    it('已認證 SuperAdmin 直接寫 auditLogs → deny（rules 無 role 例外）', async () => {
        const ctx = testEnv.authenticatedContext('ADMIN', { role: '最高管理者' });
        const db = ctx.firestore();
        await assertFails(setDoc(doc(db, 'auditLogs', 'fake-id'), {
            timestamp: new Date().toISOString(),
            action: 'test',
            userId: 'ADMIN',
        }));
    });

    it('未來新增 collection（如 staffPreferences、totpSecrets）→ deny（wildcard 覆蓋）', async () => {
        const ctx = testEnv.authenticatedContext('EMP001');
        const db = ctx.firestore();
        await assertFails(getDoc(doc(db, 'staffPreferences', 'EMP001')));
        await assertFails(getDoc(doc(db, 'totpSecrets', 'EMP001')));
    });

    it('withSecurityRulesDisabled（模擬 service account）讀寫所有 collection → allow', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            // 模擬後端 admin SDK 行為：能正常寫入
            await assertSucceeds(setDoc(doc(db, 'employees', 'EMP001'), { name: '測試員' }));
            await assertSucceeds(getDoc(doc(db, 'employees', 'EMP001')));
            await assertSucceeds(setDoc(doc(db, 'monthLocks', '2026-05'), { totalAmount: 0 }));
        });
    });
});
