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
