import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PayrollRun } from '../types';
import { UserRole } from '../types';
import { card, employee, month, schedule } from './fixtures/payrollV2';
import { makePayrollRun } from '../netlify/functions/utils/payrollSnapshot';

const emulator = vi.hoisted(() => {
    const host = process.env.FIRESTORE_EMULATOR_HOST || '';
    const projectId = process.env.FIREBASE_PROJECT_ID || '';
    // This file can also be selected with the normal Vitest config. Keep the
    // safety checks here as well, before constructing any database client.
    if (!/^127\.0\.0\.1:(8086|8087)$/.test(host) || projectId !== 'demo-chiayi-payroll') {
        throw new Error('Only the explicit loopback Firestore emulator and demo-chiayi-payroll are permitted');
    }
    return { host, projectId };
});

vi.mock('../netlify/functions/utils/firebaseAdmin', async () => {
    const { Firestore } = await import('firebase-admin/firestore');
    // Actual SDK, actual emulator transactions and Firestore serialization.
    // No Firebase app, service-account credential, auth, or messaging service.
    const db = new Firestore({ projectId: emulator.projectId, host: emulator.host, ssl: false });
    return {
        db,
        adminAuth: { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'EMULATOR_ADMIN' }) },
        adminMessaging: () => ({ sendEachForMulticast: vi.fn().mockResolvedValue({ responses: [] }) }),
    };
});

import { db } from '../netlify/functions/utils/firebaseAdmin';
import { handler } from '../netlify/functions/api';

const call = async (action: string, body: Record<string, unknown> = {}) => {
    const response = await handler({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer emulator-only-synthetic-token' },
        body: JSON.stringify({ action, ...body }),
    } as any, {} as any);
    if (!response || typeof response.statusCode !== 'number' || typeof response.body !== 'string') {
        throw new Error('API returned an unexpected response');
    }
    return { statusCode: response.statusCode, body: response.body };
};

const clearEmulator = async () => {
    const response = await fetch(`http://${emulator.host}/emulator/v1/projects/${emulator.projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Cannot clear demo Firestore emulator: ${response.status}`);
};

const storedRun = async (): Promise<PayrollRun> => {
    const locks = await db.collection('monthLocks').get();
    const runs = await db.collection('payrollRuns').get();
    expect(locks.size).toBe(1);
    expect(runs.size).toBe(1);
    const lock = locks.docs[0].data();
    const run = runs.docs[0].data() as PayrollRun;
    expect(lock.yearMonth).toBe(month);
    expect(lock.payrollRunId).toBe(runs.docs[0].id);
    expect(run.id).toBe(lock.payrollRunId);
    expect(run.yearMonth).toBe(month);
    expect(run.inputHash).toMatch(/^[a-f0-9]{64}$/);
    // Recompute from the persisted data, after the real SDK's round trip.
    const readySalaries = run.salaries.map(s => ({ ...s, calculationStatus: 'ready' as const }));
    expect(makePayrollRun(run.id, run.yearMonth, run.createdAt, readySalaries, run.inputs).inputHash).toBe(run.inputHash);
    expect(lock.totalAmount).toBe(run.salaries.reduce((total, salary) => total + salary.grossSalary, 0));
    return run;
};

beforeEach(async () => {
    await clearEmulator();
    const batch = db.batch();
    batch.set(db.collection('employees').doc('EMULATOR_ADMIN'), {
        id: 'EMULATOR_ADMIN', name: '合成管理者', role: UserRole.SuperAdmin,
        accountKind: 'system-account', hireDate: '2020-01-01', hourlyRate: 0, monthlySalary: 0,
    });
    batch.set(db.collection('employees').doc(employee.id), {
        ...employee, status: '在職', hireDate: '2026-01-01',
    });
    batch.set(db.collection('clockRecords').doc('C1'), { ...card(), id: 'C1' });
    batch.set(db.collection('dailySchedule').doc('2026-04-01'), {
        ...schedule(), openingHours: '09:00-17:00', requiredHeadcount: 1,
    });
    await batch.commit();
});

afterAll(async () => {
    try { await clearEmulator(); } finally { await db.terminate(); }
});

describe('actual API against a disposable Firestore emulator', () => {
    it('persists a ready month with omitted v2 schedule fields and a reproducible input hash', async () => {
        // Firestore defaults reject undefined. This persisted source is valid,
        // while normalization previously introduced undefined optional fields.
        await db.collection('dailySchedule').doc('2026-04-01').set({
            status: '營運', shifts: schedule().shifts,
        });
        const response = await call('lock-month', { yearMonth: month });
        expect(response.statusCode, response.body).toBe(200);
        const run = await storedRun();
        expect(run.inputs.schedules[0]).not.toHaveProperty('openingHours');
        expect(run.inputs.schedules[0]).not.toHaveProperty('requiredHeadcount');
        expect(run.salaries).toHaveLength(1);
        expect(run.salaries[0].grossSalary).toBe(1600);
        expect(run.salaries[0].calculationStatus).toBe('locked');
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(1);
    });

    it('returns the stored salary after live employee rates change', async () => {
        const locked = await call('lock-month', { yearMonth: month });
        expect(locked.statusCode, locked.body).toBe(200);
        const before = await storedRun();
        await db.collection('employees').doc(employee.id).update({ hourlyRate: 999 });
        const response = await call('get-all-salary-details', { yearMonth: month });
        expect(response.statusCode, response.body).toBe(200);
        expect(JSON.parse(response.body)).toEqual(before.salaries);
        expect(await storedRun()).toEqual(before);
    });

    it('rejects a locked card mutation without writing a revision or changing the run', async () => {
        const locked = await call('lock-month', { yearMonth: month });
        expect(locked.statusCode, locked.body).toBe(200);
        const before = await storedRun();
        const original = (await db.collection('clockRecords').doc('C1').get()).data();
        const response = await call('update-clock-record', {
            recordId: 'C1', clockInTime: '09:00', clockOutTime: '16:00', workIntervals: [{ start: 540, end: 960 }],
        });
        expect(response.statusCode, response.body).toBe(423);
        expect((await db.collection('clockRecords').doc('C1').get()).data()).toEqual(original);
        expect((await db.collection('attendanceRevisions').get()).empty).toBe(true);
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(1);
        expect(await storedRun()).toEqual(before);
    });

    it.each(['lock-first', 'mutation-first'] as const)('serializes a concurrent valid card edit and month lock (%s)', async order => {
        // No schedule restriction: either reviewed 8 h or reviewed 7 h is a
        // valid ready month. The stored evidence must match the committed edit.
        await db.collection('dailySchedule').doc('2026-04-01').delete();
        const lock = () => call('lock-month', { yearMonth: month });
        const edit = () => call('update-clock-record', {
            recordId: 'C1', clockInTime: '09:00', clockOutTime: '16:00', workIntervals: [{ start: 540, end: 960 }],
        });
        const operations = order === 'lock-first' ? [lock(), edit()] : [edit(), lock()];
        const responses = await Promise.all(operations);
        const [lockResponse, editResponse] = order === 'lock-first' ? responses : [...responses].reverse();
        expect(lockResponse.statusCode, lockResponse.body).toBe(200);
        expect([200, 423], editResponse.body).toContain(editResponse.statusCode);
        const current = (await db.collection('clockRecords').doc('C1').get()).data()!;
        const run = await storedRun();
        expect(run.inputs.records).toHaveLength(1);
        expect(run.inputs.records[0]).toEqual(current);
        expect(run.salaries[0].grossSalary).toBe(editResponse.statusCode === 200 ? 1400 : 1600);
        expect(current.clockOutTime).toBe(editResponse.statusCode === 200 ? '16:00' : '17:00');
        expect((await db.collection('attendanceRevisions').get()).size).toBe(editResponse.statusCode === 200 ? 1 : 0);
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(editResponse.statusCode === 200 ? 2 : 1);
    });

    it('commits exactly one payroll run when two real month-lock requests contend', async () => {
        const actualTransaction = db.runTransaction.bind(db);
        let attempts = 0, readyToCommit = 0;
        let release!: () => void;
        let timeout: ReturnType<typeof setTimeout>;
        const bothReady = new Promise<void>((resolve, reject) => {
            release = resolve;
            timeout = setTimeout(() => reject(new Error('Two real transactions did not reach the commit barrier')), 10_000);
        });
        // This hook controls timing only. Every read/write/commit/retry remains
        // the actual SDK transaction against the emulator. Both initial reads
        // finish before either commits, so the SDK must retry the conflict.
        const transactionHook = vi.spyOn(db, 'runTransaction').mockImplementation(((work: any, options: any) =>
            actualTransaction(async tx => {
                const attempt = ++attempts;
                const result = await work(tx);
                if (attempt <= 2) {
                    if (++readyToCommit === 2) { clearTimeout(timeout); release(); }
                    await bothReady;
                }
                return result;
            }, options)) as typeof db.runTransaction);
        let responses: Awaited<ReturnType<typeof call>>[];
        try {
            responses = await Promise.all([
                call('lock-month', { yearMonth: month }), call('lock-month', { yearMonth: month }),
            ]);
        } finally {
            clearTimeout(timeout!);
            transactionHook.mockRestore();
        }
        expect(attempts).toBeGreaterThan(2);
        expect(responses.filter(r => r.statusCode === 200)).toHaveLength(1);
        expect(responses.filter(r => [409, 423].includes(r.statusCode))).toHaveLength(1);
        const run = await storedRun();
        expect(run.salaries[0].grossSalary).toBe(1600);
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(1);
        expect((await db.collection('auditLogs').get()).size).toBe(1);
    });

    it('rolls back all month-lock writes when payroll is incomplete', async () => {
        await db.collection('clockRecords').doc('C1').update({ clockOutTime: null, workReview: null, workIntervals: [] });
        const response = await call('lock-month', { yearMonth: month });
        expect(response.statusCode, response.body).toBe(409);
        const snapshots = await Promise.all(['monthLocks', 'payrollRuns', 'payrollControl', 'auditLogs'].map(name => db.collection(name).get()));
        expect(snapshots.map(s => s.size)).toEqual([0, 0, 0, 0]);
    });
});
