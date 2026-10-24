vi.mock('../netlify/functions/utils/makeupAttachmentRuntime', async importOriginal => ({...await importOriginal<typeof import('../netlify/functions/utils/makeupAttachmentRuntime')>(),getMakeupAttachmentRuntime:vi.fn(),getLeaveAttachmentRuntime:vi.fn()}));
import {getMakeupAttachmentRuntime,getLeaveAttachmentRuntime} from '../netlify/functions/utils/makeupAttachmentRuntime';
import {syntheticAttachmentRuntime,syntheticPdf} from './fixtures/makeupAttachments';
let attachmentFixture:ReturnType<typeof syntheticAttachmentRuntime>;
beforeEach(()=>{attachmentFixture=syntheticAttachmentRuntime(false);vi.mocked(getMakeupAttachmentRuntime).mockReturnValue(attachmentFixture.runtime);vi.mocked(getLeaveAttachmentRuntime).mockReturnValue(attachmentFixture.runtime);});
// Snapshot transaction contract tests isolate formal eligibility below. Separate
// unmocked eligibility regressions assert that production lock-month always blocks.
vi.mock('../netlify/functions/utils/payrollPreflight', async importOriginal => {
    const actual = await importOriginal<typeof import('../netlify/functions/utils/payrollPreflight')>();
    return { ...actual, assertPayrollReady: vi.fn() };
});
import { assertPayrollReady } from '../netlify/functions/utils/payrollPreflight';
const trialTransactionGate = (r: any) => { if (r.trialStatus !== 'READY') { const e: any = new Error('BLOCKED trial inputs'); e.statusCode = 409; throw e; } };
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PayrollRun } from '../types';
import { UserRole } from '../types';
import { card, employee, month, schedule, review } from './fixtures/payrollV2';
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

import { db, adminAuth } from '../netlify/functions/utils/firebaseAdmin';
import { handler } from '../netlify/functions/api';

const call = async (action: string, body: Record<string, unknown> = {}, token = 'emulator-only-synthetic-token') => {
    const response = await handler({
        httpMethod: 'POST',
        headers: { authorization: `Bearer ${token}` },
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
    vi.mocked(assertPayrollReady).mockImplementation(trialTransactionGate);
    vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token => ({ uid: token === 'synthetic-employee' ? employee.id : 'EMULATOR_ADMIN' }) as any);
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
    it('retains two month reviews and uses only the selected month for actual settlement', async () => {
        const nextReview = { ...review, yearMonth: '2026-05', policy: { ...review.policy, version: 'synthetic-may', regularDates: ['2026-05-01'] } };
        for (const input of [review, nextReview]) {
            const response = await call('review-payroll-inputs', { empId: employee.id, review: input });
            expect(response.statusCode, response.body).toBe(200);
        }
        expect((await db.collection('payrollReviews').get()).size).toBe(2);
        const response = await call('get-payroll-review-inputs', { yearMonth: month });
        expect(response.statusCode, response.body).toBe(200);
        expect(JSON.parse(response.body).employees.find(e => e.id === employee.id).payrollReview.policy.version).toBe(review.policy.version);
        const locked = await call('lock-month', { yearMonth: month });
        expect(locked.statusCode, locked.body).toBe(200);
        expect((await storedRun()).salaries[0].grossSalary).toBe(1600);
    });

    it('rejects a stale form basis before writing any monthly review', async () => {
        const response = await call('get-payroll-review-inputs', { yearMonth: month });
        const sourceKey = JSON.parse(response.body).employees.find(e => e.id === employee.id).employeeSourceKey;
        await db.collection('employees').doc(employee.id).update({ hourlyRate: 250 });
        const saved = await call('review-payroll-inputs', { empId: employee.id, review, expectedEmployeeSourceKey: sourceKey });
        expect(saved.statusCode, saved.body).toBe(409);
        expect((await db.collection('payrollReviews').get()).empty).toBe(true);
        expect((await db.collection('payrollControl').get()).empty).toBe(true);
    });

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


describe('pending request settlement barrier with actual Firestore transactions', () => {
    it('pending correction blocks lock atomically, then rejection allows settlement', async () => {
        const submitted = await call('submit-makeup-request', { date: '2026-04-01', type: '補下班', reason: '合成案例核實下班時間', recordId: 'C1', requestedClockOut: '17:00' }, 'synthetic-employee');
        expect(submitted.statusCode, submitted.body).toBe(200);
        const lock = await call('lock-month', { yearMonth: month });
        expect(lock.statusCode, lock.body).toBe(409);
        expect((await db.collection('monthLocks').get()).empty).toBe(true);
        expect((await db.collection('payrollRuns').get()).empty).toBe(true);
        await db.collection('makeupRequests').doc(JSON.parse(submitted.body).id).update({ status: '駁回' });
        const retry = await call('lock-month', { yearMonth: month });
        expect(retry.statusCode, retry.body).toBe(200);
        expect((await storedRun()).salaries[0].grossSalary).toBe(1600);
    });

    it.each(['lock-first', 'request-first'])('concurrent pending correction and settlement cannot both commit (%s)', async order => {
        const lock = () => call('lock-month', { yearMonth: month });
        const submit = () => call('submit-makeup-request', { date: '2026-04-01', type: '補下班', reason: '合成案例核實下班時間', recordId: 'C1', requestedClockOut: '17:00' }, 'synthetic-employee');
        const responses = await Promise.all(order === 'lock-first' ? [lock(), submit()] : [submit(), lock()]);
        const [locked, submitted] = order === 'lock-first' ? responses : [...responses].reverse();
        expect([200, 409], locked.body).toContain(locked.statusCode);
        expect([200, 423], submitted.body).toContain(submitted.statusCode);
        expect(responses.filter(x => x.statusCode === 200)).toHaveLength(1);
        expect((await db.collection('payrollRuns').get()).size).toBe(locked.statusCode === 200 ? 1 : 0);
        expect((await db.collection('monthLocks').get()).size).toBe(locked.statusCode === 200 ? 1 : 0);
        expect((await db.collection('makeupRequests').get()).size).toBe(submitted.statusCode === 200 ? 1 : 0);
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(1);
    });
});

describe('actual formal gate and application evidence against emulator', () => {
    beforeEach(async () => {
        const actual = await vi.importActual<typeof import('../netlify/functions/utils/payrollPreflight')>('../netlify/functions/utils/payrollPreflight');
        vi.mocked(assertPayrollReady).mockImplementation(actual.assertPayrollReady);
    });
    it('complete trial still cannot write formal settlement while mandatory capabilities are absent', async () => {
        const response = await call('lock-month', { yearMonth: month, skipGaps: true });
        expect(response.statusCode, response.body).toBe(409);
        for (const name of ['monthLocks', 'payrollRuns', 'payrollControl']) expect((await db.collection(name).get()).empty).toBe(true);
    });
    it('approval and repeated approval preserve immutable evidence and reconcile newer correction', async () => {
        const raw = (await db.collection('clockRecords').doc('C1').get()).data();
        const submitted = await call('submit-makeup-request', { date: '2026-04-01', type: '補下班', reason: '合成核實下班更正', recordId: 'C1', requestedClockOut: '18:00' }, 'synthetic-employee');
        const requestId = JSON.parse(submitted.body).id;
        const approve = () => call('approve-makeup-request', { requestId, status: '核准' });
        const responses = await Promise.all([approve(), approve()]);
        expect(responses.map(x => x.statusCode)).toEqual([200, 200]);
        const revisions = await db.collection('attendanceRevisions').get();
        expect(revisions.size).toBe(1); expect(revisions.docs[0].data().before).toEqual(raw);
        const savedEvidence = revisions.docs[0].data();
        const edited = await call('update-clock-record', { recordId: 'C1', clockInTime: '09:00', clockOutTime: '17:00', workIntervals: [{ start: 540, end: 1020 }] });
        expect(edited.statusCode, edited.body).toBe(200);
        const salaryResponse = await call('get-all-salary-details', { yearMonth: month });
        const salary = JSON.parse(salaryResponse.body)[0];
        expect(salary.preflight).toMatchObject({ status: 'BLOCKED', trialStatus: 'READY' });
        expect(salary.netSalary).toBe(1600);
        expect((await revisions.docs[0].ref.get()).data()).toEqual(savedEvidence);
        expect((await call('lock-month', { yearMonth: month })).statusCode).toBe(409);
    });
    it('failed approval transaction leaves original card and pending request intact', async () => {
        await db.collection('monthLocks').doc(month).set({ yearMonth: month, lockedAt: review.reviewedAt, lockedBy: 'EMULATOR_ADMIN' });
        await db.collection('makeupRequests').doc('P').set({ empId: employee.id, date: '2026-04-01', recordId: 'C1', status: '待審核', requestedClockOut: '18:00' });
        const before = (await db.collection('clockRecords').doc('C1').get()).data();
        expect((await call('approve-makeup-request', { requestId: 'P', status: '核准' })).statusCode).toBe(423);
        expect((await db.collection('clockRecords').doc('C1').get()).data()).toEqual(before);
        expect((await db.collection('makeupRequests').doc('P').get()).data()?.status).toBe('待審核');
        expect((await db.collection('attendanceRevisions').get()).empty).toBe(true);
    });
});

import { runSandboxOutbox } from '../netlify/functions/utils/attendanceSandboxOutbox';
import { runAttendanceScanTrigger } from '../netlify/functions/utils/attendanceCaseService';

describe('B2 actual case persistence and sandbox-only retry',()=>{
 const scan=()=>call('scan-attendance-cases',{empId:employee.id,yearMonth:month});
 const seed=async()=>{await db.collection('clockRecords').doc('C1').update({clockInTime:null,clockInAt:null,workReview:null,workIntervals:[]});const r=await scan();expect(r.statusCode,r.body).toBe(200);const snap=await db.collection('attendanceCases').get();return snap.docs.map(d=>({...d.data(),id:d.id})).find((c:any)=>c.type==='missing-in'&&c.anchor==='card:C1') as any;};
 const command=(c:any,id:string)=>({caseId:c.id,mode:'explain',operationId:id,reason:'synthetic evidence provided',expectedRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion});
 it('concurrent scans and repeat scan leave one history and held outbox per actual event',async()=>{
  const responses=await Promise.all([scan(),scan()]);expect(responses.map(r=>r.statusCode)).toEqual([200,200]);
  const cases=await db.collection('attendanceCases').get(),events=await db.collection('attendanceCaseEvents').get(),outbox=await db.collection('attendanceCaseOutbox').get();
  expect(cases.size).toBeGreaterThan(0);expect(events.size).toBe(cases.size);expect(outbox.size).toBe(events.size);
  expect(outbox.docs.every(d=>d.data().state==='held'&&d.data().channel==='sandbox')).toBe(true);
  expect((await scan()).statusCode).toBe(200);expect((await db.collection('attendanceCaseEvents').get()).size).toBe(events.size);
 });
 it('competing transitions reject one stale request without partial audit/outbox writes',async()=>{
  const c=await seed(),before=(await db.collection('attendanceCaseEvents').get()).size;
  const results=await Promise.all([call('act-attendance-case',command(c,'one')),call('act-attendance-case',command(c,'two'))]);
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
  expect((await db.collection('attendanceCaseEvents').get()).size).toBe(before+1);
  expect((await db.collection('attendanceCaseOutbox').get()).size).toBe(before+1);
 });
 it('locked case is immutable and disabled trigger does no work',async()=>{
  const c=await seed();await db.collection('monthLocks').doc(month).set({yearMonth:month,lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'});
  const before=(await db.collection('attendanceCases').doc(c.id).get()).data();const count=(await db.collection('attendanceCaseOutbox').get()).size;
  expect((await call('act-attendance-case',command(c,'locked'))).statusCode).toBe(423);expect((await scan()).statusCode).toBe(423);
  expect((await db.collection('attendanceCases').doc(c.id).get()).data()).toEqual(before);expect((await db.collection('attendanceCaseOutbox').get()).size).toBe(count);
  expect(await runAttendanceScanTrigger(db,'EMULATOR_ADMIN',{empId:employee.id,yearMonth:month})).toEqual({disabled:true});
 });
 it('sandbox defaults off; failures back off and dead-letter at three without deleting case',async()=>{
  const c=await seed(),job=(await db.collection('attendanceCaseOutbox').get()).docs[0];let now=Date.now();
  const deliver=vi.fn().mockRejectedValue(new Error('synthetic-sensitive-provider-detail'));
  const adapter={kind:'sandbox' as const,deliver};
  expect(await runSandboxOutbox(db,job.id,adapter)).toEqual({disabled:true});expect(deliver).not.toHaveBeenCalled();
  for(let attempt=1;attempt<=3;attempt++){
   const result=await runSandboxOutbox(db,job.id,adapter,{enabled:true,clock:()=>now});expect(result).toMatchObject({attempt,state:attempt===3?'dead-letter':'retry'});
   if(attempt<3){expect(await runSandboxOutbox(db,job.id,adapter,{enabled:true,clock:()=>now})).toEqual({claimed:false});now+=60000*2**(attempt-1);}
  }
  expect(deliver).toHaveBeenCalledTimes(3);expect(await runSandboxOutbox(db,job.id,adapter,{enabled:true,clock:()=>now+999999})).toEqual({claimed:false});
  expect((await db.collection('attendanceCases').doc(c.id).get()).exists).toBe(true);expect(JSON.stringify((await job.ref.get()).data())).not.toContain('sensitive');
 });
 it('concurrent sandbox workers acquire one lease, retry delivery is deduped by stable key',async()=>{
  await seed();const job=(await db.collection('attendanceCaseOutbox').get()).docs[0];const deliver=vi.fn().mockResolvedValue({receipt:'SYNTH-RECEIPT'});const adapter={kind:'sandbox' as const,deliver};
  await Promise.all([runSandboxOutbox(db,job.id,adapter,{enabled:true}),runSandboxOutbox(db,job.id,adapter,{enabled:true})]);
  expect(deliver).toHaveBeenCalledTimes(1);expect(deliver).toHaveBeenCalledWith(job.id);expect((await job.ref.get()).data()?.state).toBe('delivered');
  expect(await runSandboxOutbox(db,job.id,adapter,{enabled:true})).toEqual({claimed:false});
 });
 it('expired lease can be recovered with bounded attempts',async()=>{
  await seed();const job=(await db.collection('attendanceCaseOutbox').get()).docs[0];
  await job.ref.update({state:'leased',attempts:1,leaseToken:'synthetic-abandoned',leaseExpiresAt:'2020-01-01T00:00:00Z'});
  const result=await runSandboxOutbox(db,job.id,{kind:'sandbox',deliver:async()=>({receipt:'SYNTH-RECOVERED'})},{enabled:true});
  expect(result).toMatchObject({state:'delivered',attempt:2});
 });
});

import { runPayrollMutation } from '../netlify/functions/utils/monthGuard';
it('B2 scan serializes with the actual shared month guard (synthetic lock, not payroll authorization)',async()=>{
 const scan=()=>call('scan-attendance-cases',{empId:employee.id,yearMonth:month});
 const lock=()=>runPayrollMutation(db,[month],async tx=>{tx.set(db.collection('monthLocks').doc(month),{yearMonth:month,lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'});});
 const [result]=await Promise.all([scan(),lock()]);expect([200,423]).toContain(result.statusCode);
 const count=(await db.collection('attendanceCases').get()).size;expect(count>0).toBe(result.statusCode===200);
 expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(result.statusCode===200?2:1);
});
it('B2 sandbox worker rejects missing demo guard before invoking adapter',async()=>{
 const prior=process.env.FIREBASE_PROJECT_ID;const deliver=vi.fn();delete process.env.FIREBASE_PROJECT_ID;
 try{await expect(runSandboxOutbox(db,'a'.repeat(64),{kind:'sandbox',deliver},{enabled:true})).rejects.toThrow('demo emulator');expect(deliver).not.toHaveBeenCalled();}finally{process.env.FIREBASE_PROJECT_ID=prior;}
});
it('B3 scoped filtered query and notification summary use real Firestore without delivery or writes',async()=>{
 await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});
 const scan=await call('scan-attendance-cases',{empId:employee.id,yearMonth:month});expect(scan.statusCode).toBe(200);
 const cases=await db.collection('attendanceCases').get();const c=cases.docs[0];
 const queried=await call('list-attendance-cases',{empId:employee.id,yearMonth:month,status:c.data().status,type:c.data().type},'synthetic-employee');expect(queried.statusCode,queried.body).toBe(200);expect(JSON.parse(queried.body).cases.some(x=>x.id===c.id)).toBe(true);
 const before=(await db.collection('attendanceCaseOutbox').get()).size;
 const response=await call('get-attendance-case',{caseId:c.id},'synthetic-employee');expect(response.statusCode,response.body).toBe(200);expect(JSON.parse(response.body).notifications).toMatchObject({mode:'sandbox-only',deliveryEnabled:false,complete:true,counts:{held:1}});
 expect((await db.collection('attendanceCaseOutbox').get()).size).toBe(before);
});

describe('B4a versioned makeup actual transactions',()=>{
 const draft={date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOut:'18:00',reason:'合成版本化補卡理由',operationId:'emulator-create'};
 const employeeCall=(action:string,data:any)=>call(action,data,'synthetic-employee');
 const create=async()=>{await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});const r=await employeeCall('submit-makeup-version',draft);expect(r.statusCode,r.body).toBe(200);return JSON.parse(r.body);};
 const cmd=(r:any,mode:string,op:string)=>({requestId:r.id,mode,expectedRevision:r.revision,operationId:op,reason:'合成核實操作原因'});
 it('concurrent same operation creates one request/event and no real notification',async()=>{
  await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});const results=await Promise.all([employeeCall('submit-makeup-version',draft),employeeCall('submit-makeup-version',draft)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect(JSON.parse(results[0].body).id).toBe(JSON.parse(results[1].body).id);expect((await db.collection('makeupRequests').get()).size).toBe(1);expect((await db.collection('makeupRequestEvents').get()).size).toBe(1);expect((await db.collection('notifications').get()).empty).toBe(true);
 });
 it('concurrent cancel and return serialize; stale party writes no additional event',async()=>{
  const r=await create();const results=await Promise.all([employeeCall('act-makeup-request',cmd(r,'cancel','cancel')),call('act-makeup-request',cmd(r,'return','return'))]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await db.collection('makeupRequestEvents').get()).size).toBe(2);expect((await db.collection('makeupRequests').doc(r.id).get()).data()?.revision).toBe(2);
 });
 it('resubmit and approval retry retain raw before/after lineage without a second card application',async()=>{
  const r=await create(),returned=JSON.parse((await call('act-makeup-request',cmd(r,'return','return'))).body);const resubmit={...cmd(returned,'resubmit','resubmit'),patch:{...draft,requestedClockOut:'19:00'}};
  const responses=await Promise.all([employeeCall('act-makeup-request',resubmit),employeeCall('act-makeup-request',resubmit)]);expect(responses.map(r=>r.statusCode)).toEqual([200,200]);const next=JSON.parse(responses[0].body);expect(next.supersedesRequestId).toBe(r.id);expect((await db.collection('makeupRequests').get()).size).toBe(2);
  const raw=(await db.collection('clockRecords').doc('C1').get()).data();const approvals=await Promise.all([call('act-makeup-request',cmd(next,'approve','approve')),call('act-makeup-request',cmd(next,'approve','approve'))]);expect(approvals.map(r=>r.statusCode)).toEqual([200,200]);const revs=await db.collection('attendanceRevisions').get();expect(revs.size).toBe(1);expect(revs.docs[0].data().before.clockOutTime).toBe(raw?.clockOutTime);expect(revs.docs[0].data().after.clockOutTime).toBe('19:00');
  expect((await employeeCall('act-makeup-request',cmd(JSON.parse(approvals[0].body),'cancel','cancel-approved'))).statusCode).toBe(409);
 });
 it('same gate serializes versioned submit against a synthetic month lock',async()=>{
  await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});const lock=()=>runPayrollMutation(db,[month],async tx=>tx.set(db.collection('monthLocks').doc(month),{yearMonth:month,lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'}));
  const [r]=await Promise.all([employeeCall('submit-makeup-version',draft),lock()]);expect([200,423]).toContain(r.statusCode);expect((await db.collection('makeupRequests').get()).size).toBe(r.statusCode===200?1:0);expect((await db.collection('makeupRequestEvents').get()).size).toBe(r.statusCode===200?1:0);
 });
 it('linked create and blocked unlink preserve case and audit atomically',async()=>{
  await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});await db.collection('clockRecords').doc('C1').update({clockInTime:null,clockInAt:null,workReview:null,workIntervals:[]});await call('scan-attendance-cases',{empId:employee.id,yearMonth:month});
  const c=(await db.collection('attendanceCases').get()).docs.find(d=>d.data().type==='missing-in'&&d.data().anchor==='card:C1')!;
  const created=await employeeCall('submit-makeup-version',{...draft,type:'上班',requestedClockIn:'09:00',requestedClockOut:null,caseId:c.id,expectedCaseRevision:c.data().revision});expect(created.statusCode,created.body).toBe(200);const r=JSON.parse(created.body),links=await db.collection('caseRequestLinks').get();expect(links.size).toBe(1);const before=(await c.ref.get()).data();
  await db.collection('monthLocks').doc(month).set({yearMonth:month,lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'});
  const response=await employeeCall('link-case-request',{caseId:c.id,requestId:r.id,mode:'unlink',expectedRevision:r.revision,expectedCaseRevision:before?.revision,expectedLinkRevision:1,operationId:'unlink',reason:'合成解除原因'});expect(response.statusCode).toBe(423);expect((await links.docs[0].ref.get()).data()?.state).toBe('active');expect((await db.collection('caseRequestLinkEvents').get()).size).toBe(1);expect((await c.ref.get()).data()).toEqual(before);
 });
});
it('B4a capacity guard serializes two contenders for the last retained case slot without partial requests',async()=>{
 await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});const id='CAPACITY',c={id,empId:employee.id,revision:1,anchor:'card:C1',observation:{window:{start:Date.parse('2026-04-01T09:00:00+08:00')/60000,end:Date.parse('2026-04-01T17:00:00+08:00')/60000}}};await db.collection('attendanceCases').doc(id).set(c);
 const batch=db.batch();for(let n=0;n<99;n++)batch.set(db.collection('caseRequestLinks').doc('retained-'+n),{caseId:id,requestId:'prior-'+n,state:n%2?'inactive':'active'});await batch.commit();
 const draft={date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOut:'18:00',reason:'合成最後名額競爭',caseId:id,expectedCaseRevision:1};
 const responses=await Promise.all(['one','two'].map(operationId=>call('submit-makeup-version',{...draft,operationId},'synthetic-employee')));expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await db.collection('caseRequestLinks').where('caseId','==',id).get()).size).toBe(100);expect((await db.collection('makeupRequests').get()).size).toBe(1);expect((await db.collection('makeupRequestEvents').get()).size).toBe(1);expect((await db.collection('caseRequestLinkEvents').get()).size).toBe(1);
 expect((await call('get-case-request-links',{caseId:id},'synthetic-employee')).statusCode).toBe(200);
});
describe('B4b metadata transactions with fake private storage/scanner (not a storage emulator)',()=>{
 const employeeCall=(action:string,data:any)=>call(action,data,'synthetic-employee');
 const draft=async()=>{await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});const r=await employeeCall('create-makeup-attachment-draft',{date:'2026-04-01',operationId:'draft'});expect(r.statusCode,r.body).toBe(200);return JSON.parse(r.body);};
 const upload=(d:any,extra:any={})=>employeeCall('upload-makeup-attachment',{draftId:d.id,expectedDraftRevision:d.revision,operationId:'upload',name:'synthetic.pdf',mime:'application/pdf',contentBase64:syntheticPdf,...extra});
 const submit=(d:any,rev:number)=>employeeCall('submit-makeup-version',{date:d.date,type:'下班',recordId:'C1',requestedClockOut:'18:00',reason:'合成附件交易核對',operationId:'submit',attachmentDraftId:d.id,expectedAttachmentDraftRevision:rev});
 it('duplicate concurrent upload creates one immutable object and metadata history',async()=>{const d=await draft();const results=await Promise.all([upload(d),upload(d)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect(attachmentFixture.writes).toBe(1);expect((await db.collection('makeupAttachments').get()).size).toBe(1);expect((await db.collection('makeupAttachmentEvents').get()).size).toBe(2);expect((await db.collection('makeupAttachmentDrafts').doc(d.id).get()).data()?.revision).toBe(2);});
 it('competing uploads at one-file policy create only one reserved object',async()=>{attachmentFixture.runtime.policy!.maxFiles=1;const d=await draft();const results=await Promise.all([upload(d),upload(d,{operationId:'second'})]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await db.collection('makeupAttachments').get()).size).toBe(1);expect(attachmentFixture.objects.size).toBe(1);});
 it('pending scanner blocks submission; completion binds atomically once and preserves private source',async()=>{
  const d=await draft();let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>started=r),wait=new Promise<void>(r=>release=r);attachmentFixture.runtime.scanner={async scan(){started();await wait;return {verdict:'clean',mime:'application/pdf',engine:'synthetic-only',version:'v1'};}};
  const uploading=upload(d);await entered;expect((await submit(d,2)).statusCode).toBe(409);expect((await db.collection('makeupRequests').get()).size).toBe(0);release();expect((await uploading).statusCode).toBe(200);
  const results=await Promise.all([submit(d,2),submit(d,2)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect((await db.collection('makeupRequests').get()).size).toBe(1);const r=JSON.parse(results[0].body),m=(await db.collection('makeupAttachments').get()).docs[0].data();expect(m.requestId).toBe(r.id);expect((await db.collection('makeupAttachmentDrafts').doc(d.id).get()).data()?.status).toBe('submitted');expect((await db.collection('makeupAttachmentEvents').get()).size).toBe(3);
 });
 it('withdraw during scanning cannot resurrect metadata or expose retained bytes',async()=>{
  const d=await draft();let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>started=r),wait=new Promise<void>(r=>release=r);attachmentFixture.runtime.scanner={async scan(){started();await wait;return {verdict:'clean',mime:'application/pdf',engine:'synthetic-only',version:'v1'};}};
  const uploading=upload(d);await entered;const m=(await db.collection('makeupAttachments').get()).docs[0];expect((await employeeCall('withdraw-makeup-attachment',{attachmentId:m.id,expectedRevision:1,expectedDraftRevision:2,operationId:'withdraw',reason:'合成撤除進行中上傳'})).statusCode).toBe(200);release();expect((await uploading).statusCode).toBe(409);expect((await m.ref.get()).data()?.status).toBe('removed');expect((await employeeCall('issue-makeup-attachment-access',{attachmentId:m.id})).statusCode).toBe(409);expect(attachmentFixture.objects.size).toBe(1);
 });
 it('one-use download access serializes two consumers and denies other principals',async()=>{const d=await draft(),m=JSON.parse((await upload(d)).body);await submit(d,2);const grant=JSON.parse((await employeeCall('issue-makeup-attachment-access',{attachmentId:m.id})).body);expect((await call('download-makeup-attachment',grant)).statusCode).toBe(403);const results=await Promise.all([employeeCall('download-makeup-attachment',grant),employeeCall('download-makeup-attachment',grant)]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,403]);expect(JSON.parse(results.find(r=>r.statusCode===200)!.body).contentBase64).toBe(syntheticPdf);});
});
describe('B4c independent explanation/leave actual metadata transactions',()=>{
 const employeeCall=(action:string,data:any)=>call(action,data,'synthetic-employee');
 const setup=async()=>{await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});await call('scan-attendance-cases',{empId:employee.id,yearMonth:month});const c=(await db.collection('attendanceCases').get()).docs.find(d=>d.data().anchor==='scope:'+month)!;return c.id;};
 const cmd=async(id:string,extra:any={})=>{const c=(await db.collection('attendanceCases').doc(id).get()).data()!;return {caseId:id,expectedCaseRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:crypto.randomUUID(),reason:'合成異常來源核對',...extra};};
 const leaveInput={leaveType:'事假',startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T17:00:00+08:00'};
 it('same explanation operation concurrency persists once, including sandbox event',async()=>{const id=await setup(),command=await cmd(id,{text:'合成本人說明不改薪資'});const before=(await db.collection('attendanceCaseOutbox').get()).size;const r=await Promise.all([employeeCall('submit-anomaly-explanation',command),employeeCall('submit-anomaly-explanation',command)]);expect(r.map(x=>x.statusCode)).toEqual([200,200]);expect((await db.collection('anomalyExplanations').get()).size).toBe(1);expect((await db.collection('anomalyExplanationEvents').get()).size).toBe(1);expect((await db.collection('attendanceCaseOutbox').get()).size).toBe(before+1);expect((await db.collection('notifications').get()).size).toBe(0);});
 it('owner supplement chain and manager adoption preserve original text and require actual source',async()=>{const id=await setup(),r=await employeeCall('submit-anomaly-explanation',await cmd(id,{text:'合成原始說明內容'}));expect(r.statusCode,r.body).toBe(200);const e=JSON.parse(r.body);expect((await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:1,mode:'request-info'}))).statusCode).toBe(200);const newer=await employeeCall('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:2,mode:'resubmit',text:'合成補充後說明內容'}));expect(newer.statusCode,newer.body).toBe(200);const next=JSON.parse(newer.body);expect((await call('act-anomaly-explanation',await cmd(id,{explanationId:next.id,expectedRevision:1,mode:'accept'}))).statusCode).toBe(200);expect((await db.collection('anomalyExplanations').doc(e.id).get()).data()?.text).toBe('合成原始說明內容');expect((await db.collection('leaveRequests').get()).size).toBe(0);expect((await db.collection('clockRecords').doc('C1').get()).data()?.clockOutTime).toBe('17:00');});
 it('two different operations cannot create overlapping pending backdated leave',async()=>{const id=await setup();const base=await cmd(id,leaveInput);const results=await Promise.all([employeeCall('submit-case-leave',base),employeeCall('submit-case-leave',{...base,operationId:'other-leave'})]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await db.collection('leaveRequests').get()).size).toBe(1);expect((await db.collection('caseLeaveLinks').get()).size).toBe(1);});
 it('approve then allocate replays once; conflict remains a case rather than becoming paid by explanation',async()=>{const id=await setup(),created=await employeeCall('submit-case-leave',await cmd(id,leaveInput));expect(created.statusCode,created.body).toBe(200);const r=JSON.parse(created.body),command=await cmd(id,{leaveRequestId:r.id,expectedRevision:1,mode:'approve'});const results=await Promise.all([call('review-case-leave',command),call('review-case-leave',command)]);expect(results.map(x=>x.statusCode)).toEqual([200,200]);const allocation={requestId:r.id,expectedRevision:2,allocations:[{date:'2026-04-01',from:'13:00',to:'17:00',minutes:240}]};const allocated=await Promise.all([call('review-leave-allocation',allocation),call('review-leave-allocation',allocation)]);expect(allocated.map(x=>x.statusCode)).toEqual([200,200]);expect((await db.collection('leaveRevisions').get()).size).toBe(2);expect((await db.collection('leaveRequests').doc(r.id).get()).data()?.revision).toBe(3);const cases=(await db.collection('attendanceCases').get()).docs.map(d=>d.data());expect(cases.some(c=>c.type==='work-leave-overlap'&&c.observation.outcome==='finding'&&c.status!=='resolved')).toBe(true);expect((await db.collection('notifications').get()).size).toBe(0);});
 it('cross-month case window prevents writes into locked next month',async()=>{const id=await setup();await db.collection('attendanceCases').doc(id).update({'observation.window':{start:Date.parse('2026-04-30T22:00:00+08:00')/60000,end:Date.parse('2026-05-01T06:00:00+08:00')/60000}});await db.collection('monthLocks').doc('2026-05').set({yearMonth:'2026-05',lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'});expect((await employeeCall('submit-anomaly-explanation',await cmd(id,{text:'合成跨月不得修改'}))).statusCode).toBe(423);expect((await db.collection('anomalyExplanations').get()).size).toBe(0);expect((await db.collection('caseExplanationLinks').get()).size).toBe(0);});
 it('last retained explanation slot race yields one commit without overflowing read contract',async()=>{const id=await setup(),batch=db.batch();for(let n=0;n<99;n++){batch.set(db.collection('caseExplanationLinks').doc('prior-'+n),{caseId:id,sourceId:'prior-'+n});batch.set(db.collection('anomalyExplanations').doc('prior-'+n),{id:'prior-'+n,caseId:id,empId:employee.id,status:'cancelled',revision:1,text:'合成保留歷史'});}await batch.commit();const base=await cmd(id,{text:'合成最後名額說明'});const results=await Promise.all([employeeCall('submit-anomaly-explanation',base),employeeCall('submit-anomaly-explanation',{...base,operationId:'other-explanation'})]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await db.collection('caseExplanationLinks').where('caseId','==',id).get()).size).toBe(100);expect((await db.collection('anomalyExplanationEvents').get()).size).toBe(1);expect((await employeeCall('get-case-explanation-workflow',{caseId:id})).statusCode).toBe(200);});
});
it('B4c fix: accepted source is immutable and rechecked against current raw evidence in leave transaction',async()=>{
 await db.collection('dailySchedule').doc('2026-04-01').delete();await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});await call('scan-attendance-cases',{empId:employee.id,yearMonth:month});const c=(await db.collection('attendanceCases').get()).docs.find(d=>d.data().anchor==='card:C1'&&d.data().type==='unscheduled-card')!;
 const command=async(extra:any)=>{const current=(await c.ref.get()).data()!;return {caseId:c.id,expectedCaseRevision:current.revision,expectedEvidenceVersion:current.observation.evidenceVersion,operationId:crypto.randomUUID(),reason:'合成採納來源重新核實',...extra};};
 const explained=await call('submit-anomaly-explanation',await command({text:'合成原始09至17說明'}),'synthetic-employee');expect(explained.statusCode,explained.body).toBe(200);const ex=JSON.parse(explained.body);expect((await call('act-anomaly-explanation',await command({explanationId:ex.id,expectedRevision:1,mode:'accept'}))).statusCode).toBe(200);const proof=(await db.collection('anomalyExplanations').doc(ex.id).get()).data()!.acceptedSource;
 await db.collection('clockRecords').doc('C1').update({clockOutTime:'18:00'});await call('scan-attendance-cases',{empId:employee.id,yearMonth:month});const r=await call('submit-case-leave',await command({leaveType:'事假',startDate:'2026-04-01T17:00:00+08:00',endDate:'2026-04-01T18:00:00+08:00',explanationId:ex.id}),'synthetic-employee');expect(r.statusCode,r.body).toBe(409);expect((await db.collection('leaveRequests').get()).size).toBe(0);expect((await db.collection('anomalyExplanations').doc(ex.id).get()).data()!.acceptedSource).toEqual(proof);
});
describe('B4d leave lifecycle transactions',()=>{
 const emp=(action:string,data:any)=>call(action,data,'synthetic-employee');
 const seed=async(id='LV',hour=13)=>{await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});await db.collection('leaveRequests').doc(id).set({id,empId:employee.id,name:'Synthetic',status:'待審核',revision:1,schemaVersion:'leave-version-v1',leaveType:'事假',startDate:`2026-04-01T${hour}:00:00+08:00`,endDate:`2026-04-01T${hour+1}:00:00+08:00`,hours:1,reason:'合成來源',history:[]});};
 const cmd=async(id:string,mode:string,extra:any={})=>{const w=JSON.parse((await emp('get-leave-workflow',{requestId:id})).body);return {requestId:id,expectedRevision:w.request.revision,sourceVersion:w.sourceVersion,operationId:crypto.randomUUID(),reason:'合成假單版本核實',mode,...extra};};
 it('concurrent identical cancellation commits one revision/receipt and preserves source',async()=>{await seed();const c=await cmd('LV','cancel');const results=await Promise.all([emp('act-leave-version',c),emp('act-leave-version',c)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect((await db.collection('leaveRequests').doc('LV').get()).data()).toMatchObject({status:'已取消',revision:2,reason:'合成來源'});expect((await db.collection('leaveRevisions').get()).size).toBe(1);expect((await db.collection('leaveWorkflowCommands').get()).size).toBe(1);});
 it('manager supplement then owner resubmit keeps old version and fake attachment boundary',async()=>{await seed();expect((await call('act-leave-version',await cmd('LV','request-info'))).statusCode).toBe(200);const c=await cmd('LV','resubmit',{leaveType:'事假',startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00'});const result=await emp('act-leave-version',c);expect(result.statusCode,result.body).toBe(200);expect((await db.collection('leaveRequests').doc('LV').get()).data()?.status).toBe('已取代');expect((await db.collection('leaveRequests').get()).size).toBe(2);expect(JSON.parse(result.body).leavePolicyAssessment.status).toBe('needs-review');expect((await db.collection('notifications').get()).size).toBe(0);});
 it('quota reservation contenders serialize with no overbooking or partial supersede',async()=>{await seed('ONE',13);await seed('TWO',15);await db.collection('leaveRequests').doc('ONE').update({status:'已取消'});await db.collection('leaveRequests').doc('TWO').update({status:'已取消'});await db.collection('leavePolicyVersions').doc('P').set({version:'synthetic',status:'approved',approvedBy:'EMULATOR_ADMIN',approvedAt:'2026-01-01T00:00:00Z',employeeIds:[employee.id],leaveType:'事假',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',backdatedMaxDays:1000,quota:{periodStart:'2026-01-01',periodEnd:'2026-12-31',minutes:60,basis:'requested-span-minutes',reservePending:true}});const commands=await Promise.all([cmd('ONE','resubmit',{leaveType:'事假',startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00'}),cmd('TWO','resubmit',{leaveType:'事假',startDate:'2026-04-01T15:00:00+08:00',endDate:'2026-04-01T16:00:00+08:00'})]);const results=await Promise.all(commands.map(c=>emp('act-leave-version',c)));expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);const rows=(await db.collection('leaveRequests').get()).docs.map(d=>d.data());expect(rows.filter(r=>r.status==='待審核')).toHaveLength(1);expect(rows.filter(r=>r.status==='已取消')).toHaveLength(1);});
 it('locked boundary refuses lifecycle transitions with zero revisions',async()=>{await seed();await db.collection('leaveRequests').doc('LV').update({startDate:'2026-04-30T22:00:00+08:00',endDate:'2026-05-01T06:00:00+08:00'});await db.collection('monthLocks').doc('2026-05').set({yearMonth:'2026-05',lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'});expect((await emp('act-leave-version',await cmd('LV','cancel'))).statusCode).toBe(423);expect((await db.collection('leaveRevisions').get()).size).toBe(0);});
 it('leave attachment namespace isolates makeup objects and upload replay',async()=>{await seed();const d=JSON.parse((await emp('create-leave-attachment-draft',{date:'2026-04-01',operationId:'draft'})).body);const c={draftId:d.id,expectedDraftRevision:1,operationId:'upload',name:'synthetic.pdf',mime:'application/pdf',contentBase64:syntheticPdf};const results=await Promise.all([emp('upload-leave-attachment',c),emp('upload-leave-attachment',c)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);const m=JSON.parse(results[0].body);expect(m.subjectType).toBe('leave');expect((await db.collection('leaveAttachments').get()).size).toBe(1);expect((await db.collection('makeupAttachments').get()).size).toBe(0);expect((await emp('issue-makeup-attachment-access',{attachmentId:m.id})).statusCode).toBe(404);});
});

it('independent B4d normal versioned leave supports actual Firestore payroll allocation',async()=>{
 await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});
 const created=await call('submit-leave-request',{leaveType:'事假',startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00',reason:'合成一般新版假單'},'synthetic-employee');expect(created.statusCode,created.body).toBe(200);
 const r=(await db.collection('leaveRequests').get()).docs[0];const w=JSON.parse((await call('get-leave-workflow',{requestId:r.id})).body);
 const approved=await call('act-leave-version',{requestId:r.id,expectedRevision:1,sourceVersion:w.sourceVersion,operationId:'normal-approve',mode:'approve',reason:'合成一般假核准原因'});expect(approved.statusCode,approved.body).toBe(200);
 const allocated=await call('review-leave-allocation',{requestId:r.id,expectedRevision:2,allocations:[{date:'2026-04-01',from:'13:00',to:'14:00',minutes:60}]});const after=(await r.ref.get()).data()!;expect(after.revision).toBe(3);expect(after.payrollAllocations).toHaveLength(1);expect(allocated.statusCode,allocated.body).toBe(200);
});

it.each([null,'','unsupported-legacy'])('unknown quota status %s blocks without partial writes in Firestore',async(status)=>{
 await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});
 await db.collection('leavePolicyVersions').doc('P').set({version:'synthetic',status:'approved',approvedBy:'EMULATOR_ADMIN',approvedAt:'2026-01-01T00:00:00Z',employeeIds:[employee.id],leaveType:'事假',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',backdatedMaxDays:1000,quota:{periodStart:'2026-01-01',periodEnd:'2026-12-31',minutes:60,basis:'requested-span-minutes',reservePending:true}});
 await db.collection('leaveRequests').doc('UNKNOWN').set({empId:employee.id,leaveType:'事假',status,startDate:'2026-04-01T09:00:00+08:00',endDate:'2026-04-01T10:00:00+08:00'});
 const result=await call('submit-leave-request',{leaveType:'事假',startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00',reason:'合成未知來源狀態'},'synthetic-employee');
 expect(result.statusCode,result.body).toBe(409);expect((await db.collection('leaveRequests').get()).size).toBe(1);expect((await db.collection('leaveRequests').doc('UNKNOWN').get()).data()?.status).toBe(status);expect((await db.collection('leaveRevisions').get()).size).toBe(0);
});

describe('B5a overtime transaction boundaries',()=>{
 const emp=(a:string,d:any)=>call(a,d,'synthetic-employee');
 const input={phase:'after',kind:'on-site',startDate:'2026-04-01T15:00:00+08:00',endDate:'2026-04-01T17:00:00+08:00',reason:'合成加班申請原因'};
 const setup=async()=>{await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});await db.collection('overtimeWorkflowPolicies').doc(employee.id).set({status:'approved',version:'synthetic',reviewerIds:['EMULATOR_ADMIN'],approvedBy:'EMULATOR_ADMIN',approvedAt:'2026-01-01T00:00:00Z',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31'});};
 const command=async(r:any,mode:string,extra:any={})=>{const {evidenceHash}=await import('../netlify/functions/utils/attendanceCaseLifecycle');const current:any={...(await db.collection('overtimeRequests').doc(r.id).get()).data(),id:r.id};return {requestId:r.id,expectedRevision:current.revision,sourceVersion:evidenceHash(current),mode,operationId:crypto.randomUUID(),reason:'合成指定主管覆核',...extra};};
 it('duplicate submit commits one request, event, stable case link and held outbox',async()=>{await setup();const c={...input,operationId:'same-ot'};const results=await Promise.all([emp('submit-overtime-request',c),emp('submit-overtime-request',c)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect((await db.collection('overtimeRequests').get()).size).toBe(1);expect((await db.collection('overtimeEvents').get()).size).toBe(1);expect((await db.collection('caseOvertimeLinks').get()).size).toBe(1);expect((await db.collection('notifications').get()).size).toBe(0);});
 it('competing overlapping requests cannot both commit',async()=>{await setup();const r=await Promise.all([emp('submit-overtime-request',{...input,operationId:'one'}),emp('submit-overtime-request',{...input,operationId:'two'})]);expect(r.map(x=>x.statusCode).sort()).toEqual([200,409]);expect((await db.collection('overtimeRequests').get()).size).toBe(1);});
 it('partial review replay writes once and preserves raw confirmed work and unknown statutory amount',async()=>{await setup();const r=JSON.parse((await emp('submit-overtime-request',{...input,operationId:'submit'})).body),raw=(await db.collection('clockRecords').doc('C1').get()).data();const c=await command(r,'partial-approve',{intervals:[{startDate:input.startDate,endDate:'2026-04-01T16:00:00+08:00'}]});const results=await Promise.all([call('act-overtime-request',c),call('act-overtime-request',c)]);expect(results.map(x=>x.statusCode)).toEqual([200,200]);expect((await db.collection('overtimeEvents').get()).size).toBe(2);expect((await db.collection('clockRecords').doc('C1').get()).data()).toEqual(raw);expect(JSON.parse(results[0].body)).toMatchObject({approvedMinutes:60,statutoryPayableMinutes:null});});
 it('source change rejects approval and locked boundary rejects new cross-month requests',async()=>{await setup();const r=JSON.parse((await emp('submit-overtime-request',{...input,operationId:'submit'})).body);await db.collection('clockRecords').doc('C1').update({clockOutTime:'18:00'});expect((await call('act-overtime-request',await command(r,'approve',{intervals:[input]}))).statusCode).toBe(409);await db.collection('monthLocks').doc('2026-05').set({yearMonth:'2026-05',lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'});expect((await emp('submit-overtime-request',{...input,operationId:'cross',startDate:'2026-04-30T22:00:00+08:00',endDate:'2026-05-01T02:00:00+08:00'})).statusCode).toBe(423);expect((await db.collection('overtimeRequests').get()).size).toBe(1);});
});
