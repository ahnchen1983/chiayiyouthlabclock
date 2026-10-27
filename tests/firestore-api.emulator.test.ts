import {clockSourceKey} from '../utils/attendance';
import {evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';
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
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

// Explicit synthetic evidence setup; never called globally for negative tests.
const readyLegacyAttendance = async (targets:Record<string,number>={'2026-04-01':480}) => {
 const {seedAttendanceReady}=await import('./fixtures/attendanceReady');
 const reviewer='EMU_ATTENDANCE_REVIEWER';
 await db.doc('employees/'+reviewer).set({id:reviewer,role:UserRole.SuperAdmin,accountKind:'system-account',hireDate:'2020-01-01'});
 for(const [date,minutes] of Object.entries(targets)){
  const ref=db.doc('dailySchedule/'+date),existing=await ref.get();
  if(!existing.exists){if(minutes!==480&&minutes!==540)throw Error('Explicit schedule required');await ref.set(schedule(date,minutes===540?'08:00':'09:00','17:00'));}
 }
 await seedAttendanceReady(db,{syntheticOnly:true,empId:employee.id,month,proposer:'EMULATOR_ADMIN',reviewer,at:'2026-05-02T00:00:00Z',expectedMinutesByDate:targets,operationPrefix:'emu-legacy-attendance'});
 return (await db.doc('payrollControl/revision').get()).data()!.revision as number;
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
        const setupRevision=await readyLegacyAttendance();
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
        const setupRevision=await readyLegacyAttendance();
        const response = await call('lock-month', { yearMonth: month });
        expect(response.statusCode, response.body).toBe(200);
        const run = await storedRun();
        expect(run.inputs.schedules[0]).not.toHaveProperty('openingHours');
        expect(run.inputs.schedules[0]).not.toHaveProperty('requiredHeadcount');
        expect(run.salaries).toHaveLength(1);
        expect(run.salaries[0].grossSalary).toBe(1600);
        expect(run.salaries[0].calculationStatus).toBe('locked');
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(setupRevision+1);
    });

    it('returns the stored salary after live employee rates change', async () => {
        const setupRevision=await readyLegacyAttendance();
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
        const setupRevision=await readyLegacyAttendance();
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
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(setupRevision+1);
        expect(await storedRun()).toEqual(before);
    });

    it.each(['lock-first', 'mutation-first'] as const)('serializes a concurrent valid card edit and month lock (%s)', async order => {
        // A changed actual interval invalidates the approved scan. Only the
        // unchanged scanned source can win settlement; no automatic rescan.
        const setupRevision=await readyLegacyAttendance();
        const lock = () => call('lock-month', { yearMonth: month });
        const edit = () => call('update-clock-record', {
            recordId: 'C1', clockInTime: '09:00', clockOutTime: '16:00', workIntervals: [{ start: 540, end: 960 }],
        });
        const responses = await Promise.all(order === 'lock-first' ? [lock(), edit()] : [edit(), lock()]);
        const [locked,edited]=order==='lock-first'?responses:[...responses].reverse();
        expect([200,409],locked.body).toContain(locked.statusCode);
        expect([200,423],edited.body).toContain(edited.statusCode);
        expect(responses.filter(r=>r.statusCode===200)).toHaveLength(1);
        const current=(await db.doc('clockRecords/C1').get()).data()!;
        expect(current.clockOutTime).toBe(edited.statusCode===200?'16:00':'17:00');
        expect((await db.collection('attendanceRevisions').get()).size).toBe(edited.statusCode===200?1:0);
        expect((await db.doc('payrollControl/revision').get()).data()?.revision).toBe(setupRevision+1);
        if(locked.statusCode===200){
            const run=await storedRun();expect(run.inputs.records).toHaveLength(1);
            const evidenceFields=['id','empId','date','clockInTime','clockOutTime','clockInAt','clockOutAt','workHours','status','workIntervals','workReview','attendanceRevisionId','rawMinutes','payableMinutes','calculationVersion','reviewReasons','source','manuallyEdited','editedBy','editedAt','note','notes'];
            const expectedEvidence=Object.fromEntries(evidenceFields.filter(key=>current[key]!==undefined).map(key=>[key,current[key]]));
            expect(run.inputs.records[0]).toEqual(expectedEvidence);
            for(const key of ['name','verificationData','verificationMethod','method'])expect(run.inputs.records[0]).not.toHaveProperty(key);
            expect(run.salaries[0].grossSalary).toBe(1600);
        }else{
            expect((await db.collection('payrollRuns').get()).empty).toBe(true);
            expect((await db.collection('monthLocks').get()).empty).toBe(true);
            const salary=JSON.parse((await call('get-employee-salary',{empId:employee.id,yearMonth:month})).body);
            expect(salary.preflight.trialStatus).toBe('BLOCKED');expect(salary.netSalary).toBeNull();
        }
    });

    it('commits exactly one payroll run when two real month-lock requests contend', async () => {
        const setupRevision=await readyLegacyAttendance();
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
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(setupRevision+1);
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
        await readyLegacyAttendance();
        const retry = await call('lock-month', { yearMonth: month });
        expect(retry.statusCode, retry.body).toBe(200);
        expect((await storedRun()).salaries[0].grossSalary).toBe(1600);
    });

    it.each(['lock-first', 'request-first'])('concurrent pending correction and settlement cannot both commit (%s)', async order => {
        const setupRevision=await readyLegacyAttendance();
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
        expect((await db.collection('payrollControl').doc('revision').get()).data()?.revision).toBe(setupRevision+1);
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
        await readyLegacyAttendance();
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
 const setup=async()=>{
  const {handleAttendancePolicyDeclarationAction}=await import('../netlify/functions/utils/attendancePolicyDeclaration');
  await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});
  // Explicit 09–17 and 18–19 sessions versus the retained verified 09–17
  // actual card: the second session has no attendance evidence.
  const day=schedule('2026-04-01','09:00','17:00');
  day.shifts.push({...day.shifts[0],from:'18:00',to:'19:00'});
  await db.doc('dailySchedule/2026-04-01').set(day);
  const reviewer='B4C_POLICY_REVIEWER';await db.doc('employees/'+reviewer).set({id:reviewer,role:UserRole.SuperAdmin,accountKind:'system-account',hireDate:'2020-01-01'});
  const scope={empId:employee.id,month};
  const view=await handleAttendancePolicyDeclarationAction(db,'EMULATOR_ADMIN','get-attendance-policy-declaration',scope);
  expect(view.scheduleTargets).toHaveLength(1);expect(view.scheduleTargets[0].date).toBe('2026-04-01');
  const proposed=await handleAttendancePolicyDeclarationAction(db,'EMULATOR_ADMIN','propose-attendance-policy-declaration',{...scope,expectedRevision:0,operationId:'b4c-policy-propose',reason:'Synthetic explicit full scheduled obligation',closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,workDifferenceTolerance:0,expectedWorkByDate:{'2026-04-01':{minutes:540,scheduleVersion:view.scheduleTargets[0].scheduleVersion}}});
  await handleAttendancePolicyDeclarationAction(db,reviewer,'review-attendance-policy-declaration',{...scope,expectedRevision:proposed.revision,operationId:'b4c-policy-review',mode:'approve',reason:'Independent synthetic detector policy review'});
  const scan=await call('scan-attendance-cases',{empId:employee.id,yearMonth:month});expect(scan.statusCode,scan.body).toBe(200);
  const c=(await db.collection('attendanceCases').get()).docs.find(d=>d.data().anchor==='schedule-day:2026-04-01'&&d.data().type==='unexplained-absence');
  expect(c?.data().observation.outcome).toBe('finding');if(!c)throw Error('Expected source-bound synthetic absence case');return c.id;
 };
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

describe('B5b comp ledger Firestore atomic boundaries',()=>{
 afterEach(()=>vi.useRealTimers());
 const emp=(action:string,data:any)=>call(action,data,'synthetic-employee');
 const input={kind:'credit',overtimeId:'OT',minutes:120,employeeChoice:true,reason:'合成本人選擇補休'};
 const setup=async()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-04-10T00:00:00Z'));await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});await db.collection('clockRecords').doc('C1').set(card('2026-04-01','15:00','17:00'));const {overtimeActualSource}=await import('../netlify/functions/utils/overtimeWorkflow');const {evidenceHash}=await import('../netlify/functions/utils/attendanceCaseLifecycle');const startDate='2026-04-01T15:00:00+08:00',endDate='2026-04-01T17:00:00+08:00';const actual=await overtimeActualSource(db,{get:(r:any)=>r.get()},employee.id,{start:Date.parse(startDate)/60000,end:Date.parse(endDate)/60000});const ot={id:'OT',empId:employee.id,revision:1,status:'approved',startDate,endDate,approvedMinutes:120,approvedIntervals:actual.intervals,actualSource:actual,approvalSourceVersion:actual.version};await db.collection('overtimeRequests').doc('OT').set(ot);await db.collection('compSourceReviews').doc('OT').set({empId:employee.id,status:'approved',version:'synthetic',approvedBy:'EMULATOR_ADMIN',approvedAt:'2026-04-02T00:00:00Z',overtimeVersion:evidenceHash(ot),dayType:'rest',eligibleMinutes:120,originalWageBasis:{status:'pending-payroll',originalDate:'2026-04-01',rate:null,tiers:null}});await db.collection('compPolicies').doc(employee.id).set({empId:employee.id,status:'approved',version:'synthetic',approvedBy:'EMULATOR_ADMIN',approvedAt:'2026-01-01T00:00:00Z',employeeAgreedBy:employee.id,employeeAgreedAt:'2026-01-01T00:00:00Z',reviewerIds:['EMULATOR_ADMIN'],effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',deadline:'2026-12-31',annualEnd:'2026-12-31',reservePending:true,minuteBasis:'explicit-request-interval',conversion:'one-to-one'});};
 const cmd=async(r:any,mode:string)=>{const {evidenceHash}=await import('../netlify/functions/utils/attendanceCaseLifecycle');return {requestId:r.id,expectedRevision:r.revision,sourceVersion:evidenceHash(r),mode,operationId:crypto.randomUUID(),reason:'合成補休交易覆核'};};
 const grant=async()=>{const made=await emp('submit-comp-request',{...input,operationId:'select'});expect(made.statusCode,made.body).toBe(200);const result=await call('act-comp-request',await cmd(JSON.parse(made.body),'agree'));expect(result.statusCode,result.body).toBe(200);return JSON.parse(result.body);};
 it('same source concurrent choice/consent creates one immutable credit',async()=>{await setup();const r=await Promise.all(['a','b'].map(operationId=>emp('submit-comp-request',{...input,operationId})));expect(r.map(x=>x.statusCode).sort()).toEqual([200,409]);const made=JSON.parse(r.find(x=>x.statusCode===200)!.body),c=await cmd(made,'agree');const results=await Promise.all([call('act-comp-request',c),call('act-comp-request',c)]);expect(results.map(x=>x.statusCode)).toEqual([200,200]);expect((await db.collection('compLedger').get()).size).toBe(1);expect((await db.collection('notifications').get()).size).toBe(0);});
 it('competing nonoverlapping uses cannot overreserve and cancellation replay releases once',async()=>{await setup();await grant();const use=(hour:number,operationId:string)=>emp('submit-comp-request',{kind:'use',startDate:`2026-04-12T${hour}:00:00+08:00`,endDate:`2026-04-12T${hour+2}:00:00+08:00`,operationId,reason:'合成補休競爭預占'});const results=await Promise.all([use(10,'one'),use(14,'two')]);expect(results.map(x=>x.statusCode).sort()).toEqual([200,409]);const r=JSON.parse(results.find(x=>x.statusCode===200)!.body),c=await cmd(r,'cancel');expect((await emp('act-comp-request',c)).statusCode).toBe(200);expect((await emp('act-comp-request',c)).statusCode).toBe(200);const {foldCompLedger}=await import('../netlify/functions/utils/compLedger');const entries=(await db.collection('compLedger').get()).docs.map(d=>({...d.data(),id:d.id}));expect(foldCompLedger(entries as any)).toMatchObject({available:120,reserved:0,used:0});expect(entries).toHaveLength(3);});
 it('work source change and cross-month locks fail with zero credit/reservation writes',async()=>{await setup();const r=JSON.parse((await emp('submit-comp-request',{...input,operationId:'select'})).body);await db.collection('clockRecords').doc('C1').update({clockOutTime:'18:00'});expect((await call('act-comp-request',await cmd(r,'agree'))).statusCode).toBe(409);expect((await db.collection('compLedger').get()).size).toBe(0);await db.collection('clockRecords').doc('C1').update({clockOutTime:'17:00'});expect((await call('act-comp-request',await cmd(r,'agree'))).statusCode).toBe(200);await db.collection('monthLocks').doc('2026-05').set({yearMonth:'2026-05',lockedBy:'EMULATOR_ADMIN',lockedAt:review.reviewedAt});const result=await emp('submit-comp-request',{kind:'use',startDate:'2026-04-30T23:30:00+08:00',endDate:'2026-05-01T00:30:00+08:00',operationId:'cross',reason:'合成跨月使用'});expect(result.statusCode,result.body).toBe(423);expect((await db.collection('compRequests').get()).size).toBe(1);});
 it('approval creates one debit and retained original-date pending wage basis',async()=>{await setup();await grant();const made=JSON.parse((await emp('submit-comp-request',{kind:'use',startDate:'2026-04-12T10:00:00+08:00',endDate:'2026-04-12T11:00:00+08:00',operationId:'use',reason:'合成使用補休原因'})).body),c=await cmd(made,'agree');const results=await Promise.all([call('act-comp-request',c),call('act-comp-request',c)]);expect(results.map(x=>x.statusCode)).toEqual([200,200]);const {foldCompLedger}=await import('../netlify/functions/utils/compLedger');const entries=(await db.collection('compLedger').get()).docs.map(d=>({...d.data(),id:d.id}));expect(foldCompLedger(entries as any)).toMatchObject({available:60,reserved:0,used:60});expect(entries.find((e:any)=>e.type==='credit')).toMatchObject({lot:{originalWageBasis:{originalDate:'2026-04-01',rate:null}}});}); it('independent B5b termination change prevents approving future use',async()=>{await setup();await grant();const response=await emp('submit-comp-request',{kind:'use',startDate:'2026-04-12T10:00:00+08:00',endDate:'2026-04-12T11:00:00+08:00',operationId:'independent-use',reason:'合成離職邊界預占'});expect(response.statusCode,response.body).toBe(200);const r=JSON.parse(response.body);await db.collection('employees').doc(employee.id).update({resignDate:'2026-04-11'});const approval=await call('act-comp-request',await cmd(r,'agree'));const {foldCompLedger}=await import('../netlify/functions/utils/compLedger');const entries=(await db.collection('compLedger').get()).docs.map(d=>({...d.data(),id:d.id}));expect.soft(approval.statusCode,approval.body).toBe(409);expect.soft(foldCompLedger(entries as any)).toMatchObject({available:60,reserved:60,used:0});expect.soft((await db.collection('compRequests').doc(r.id).get()).data()?.status).toBe('submitted');});

 it('B5b fixed next-day partial source persists approved start/date in real Firestore',async()=>{await setup();const {clockSourceKey}=await import('../utils/attendance');const {overtimeActualSource}=await import('../netlify/functions/utils/overtimeWorkflow');const {evidenceHash}=await import('../netlify/functions/utils/attendanceCaseLifecycle');const c=card('2026-04-01','23:00','02:00',false);c.clockInAt='2026-04-01T23:00:00+08:00';c.clockOutAt='2026-04-02T02:00:00+08:00';c.workIntervals=[{start:1380,end:1560}];c.workReview={sourceKey:clockSourceKey(c),reviewedBy:'EMULATOR_ADMIN',reviewedAt:review.reviewedAt};await db.collection('clockRecords').doc('C1').set(c);const w={start:Date.parse(c.clockInAt)/60000,end:Date.parse(c.clockOutAt)/60000},actual=await overtimeActualSource(db,{get:(r:any)=>r.get()},employee.id,w);const ot={id:'OT',empId:employee.id,revision:1,status:'partial-approved',startDate:c.clockInAt,endDate:c.clockOutAt,approvedMinutes:60,approvedIntervals:[{start:w.end-60,end:w.end}],actualSource:actual,approvalSourceVersion:actual.version};await db.collection('overtimeRequests').doc('OT').set(ot);await db.collection('compSourceReviews').doc('OT').update({overtimeVersion:evidenceHash(ot),eligibleMinutes:60});const made=await emp('submit-comp-request',{...input,minutes:60,operationId:'partial-source'});expect(made.statusCode,made.body).toBe(200);expect((await call('act-comp-request',await cmd(JSON.parse(made.body),'agree'))).statusCode).toBe(200);const entry=(await db.collection('compLedger').get()).docs[0].data();expect(entry.lot.workStart).toBe(w.end-60);expect(entry.lot.originalWageBasis.originalDate).toBe('2026-04-02');expect(entry.lot.approvedIntervals).toEqual(ot.approvedIntervals);});

 it('independent C1 adopted rehire permits comp use despite legacy exit in real Firestore',async()=>{await setup();await grant();await db.collection('employees').doc(employee.id).update({resignDate:'2026-04-30',role:UserRole.SuperAdmin});const timeline={accountKind:'employee',from:'2026-05-01',to:'2026-05-31',periods:[{from:'2026-05-01',to:'2026-05-31',employmentState:'active',employmentType:'part-time',payBasis:'hourly',amount:200,policyVersionId:'P',dayTypeCalendarId:'D'}]};const proposed=await emp('propose-payroll-master',{empId:employee.id,expectedHeadRevision:0,operationId:'rehire-propose',reason:'合成復職主檔來源',timeline});expect(proposed.statusCode,proposed.body).toBe(200);const approved=await call('review-payroll-master',{empId:employee.id,expectedHeadRevision:0,expectedRevision:1,versionId:JSON.parse(proposed.body).id,operationId:'rehire-approve',mode:'approve',reason:'合成另一人復職核定'});expect(approved.statusCode,approved.body).toBe(200);await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});const used=await emp('submit-comp-request',{kind:'use',startDate:'2026-05-12T09:00:00+08:00',endDate:'2026-05-12T10:00:00+08:00',operationId:'rehire-use',reason:'合成復職後補休使用'});expect(used.statusCode,used.body).toBe(200);});

 it('C2a fix real rejected comp use has no pending payroll source',async()=>{await setup();await grant();const made=await emp('submit-comp-request',{kind:'use',startDate:'2026-04-12T10:00:00+08:00',endDate:'2026-04-12T11:00:00+08:00',operationId:'reviewer-use',reason:'合成補休駁回投影'});expect(made.statusCode,made.body).toBe(200);const replay=await cmd(JSON.parse(made.body),'reject');const result=await call('act-comp-request',replay);expect(result.statusCode,result.body).toBe(200);expect((await call('act-comp-request',replay)).statusCode).toBe(200);expect(JSON.parse(result.body).status).toBe('rejected');const {compNormalPayEvidence}=await import('../netlify/functions/utils/compWorkflow');const before=(await db.collection('compLedger').get()).docs.map(d=>d.data());const evidence=await compNormalPayEvidence(db,null,employee.id,month);expect((await db.collection('compLedger').get()).docs.map(d=>d.data())).toEqual(before);expect(evidence.intervals).toEqual([]);expect(evidence.issues).toEqual([]);});
});

describe('C1 effective master transaction boundaries',()=>{
 afterEach(()=>vi.useRealTimers());
 const timeline=(amount=30000)=>({accountKind:'employee',from:'2026-05-01',to:'2026-05-31',periods:[{from:'2026-05-01',to:'2026-05-31',employmentState:'active',employmentType:'part-time',payBasis:'monthly',amount,policyVersionId:'P',dayTypeCalendarId:'D'}]});
 const setup=async()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-04-10T00:00:00Z'));await db.collection('employees').doc(employee.id).update({role:UserRole.SuperAdmin});};
 const propose=(operationId:string,amount=30000)=>call('propose-payroll-master',{empId:employee.id,timeline:timeline(amount),expectedHeadRevision:0,operationId,reason:'合成未來薪資主檔'} ,'synthetic-employee');
 const cmd=(v:any,operationId:string)=>({empId:employee.id,versionId:v.id,expectedRevision:1,expectedHeadRevision:0,operationId,mode:'approve',reason:'合成非本人核定主檔'});
 it('identical proposal replay creates one draft and no effective head',async()=>{await setup();const r=await Promise.all([propose('same'),propose('same')]);expect(r.map(x=>x.statusCode)).toEqual([200,200]);expect((await db.collection('payrollMasterVersions').get()).size).toBe(1);expect((await db.collection('payrollMasterHeads').get()).size).toBe(0);});
 it('competing approvals activate at most one version and preserve both proposals',async()=>{await setup();const a=JSON.parse((await propose('a')).body),b=JSON.parse((await propose('b',32000)).body);const results=await Promise.all([call('review-payroll-master',cmd(a,'a-approve')),call('review-payroll-master',cmd(b,'b-approve'))]);expect(results.map(x=>x.statusCode).sort()).toEqual([200,409]);expect((await db.collection('payrollMasterVersions').get()).size).toBe(2);expect((await db.collection('payrollMasterActivations').get()).size).toBe(1);});
 it('lock after proposal refuses approval with no activation or partial update',async()=>{await setup();const r=JSON.parse((await propose('draft')).body);await db.collection('monthLocks').doc('2026-05').set({yearMonth:'2026-05',lockedAt:review.reviewedAt,lockedBy:'EMULATOR_ADMIN'});expect((await call('review-payroll-master',cmd(r,'approve'))).statusCode).toBe(423);expect((await db.collection('payrollMasterVersions').doc(r.id).get()).data()?.status).toBe('proposed');expect((await db.collection('payrollMasterHeads').get()).size).toBe(0);});
 it('self approval is denied and ordinary employee cannot read another salary master',async()=>{await setup();const r=JSON.parse((await propose('draft')).body);expect((await call('review-payroll-master',cmd(r,'self'),'synthetic-employee')).statusCode).toBe(403);await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});expect((await call('get-payroll-master',{empId:'EMULATOR_ADMIN'},'synthetic-employee')).statusCode).toBe(403);});
});

it('C1 fix real Firestore cannot approve a review with inferred pay basis',async()=>{await db.collection('employees').doc(employee.id).update({position:'專責人員',monthlySalary:30000,hourlyRate:200,payrollReview:{...review,payBasis:null}});const response=await call('review-payroll-inputs',{empId:employee.id,review:{...review,payBasis:undefined}});expect(response.statusCode).toBe(400);const r=JSON.parse((await call('get-employee-salary',{empId:employee.id,yearMonth:month})).body);expect(r.payBasis).toBeNull();expect(r.baseSalary).toBeNull();expect((await db.collection('payrollReviews').get()).size).toBe(0);});
import {normalPolicy,normalDays} from './fixtures/normalPay';
import {employeePayrollSourceKey,loadMonthlyPayrollEmployees} from '../netlify/functions/utils/payrollReviewStorage';
import {calculateSalaryForEmployee} from '../netlify/functions/utils/payroll';
describe('C2a real Firestore read-only normal-pay projection',()=>{
 const setupNormal=async()=>{
  const e=(await db.collection('employees').doc(employee.id).get()).data()!;
  const timeline={accountKind:'employee',from:'2026-04-01',to:'2026-04-30',periods:[{from:'2026-04-01',to:'2026-04-30',employmentState:'active',employmentType:'full-time',payBasis:'hourly',amount:200,policyVersionId:'C2P',dayTypeCalendarId:'C2D'}]};
  await db.collection('payrollMasterVersions').doc('C2M').set({empId:employee.id,status:'approved',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,timeline});await db.collection('payrollMasterHeads').doc(employee.id).set({currentVersionId:'C2M',revision:1});
  await db.collection('payrollPolicyVersions').doc('C2P').set({status:'approved',version:review.policy.version,approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,employeeIds:[employee.id],from:'2026-04-01',to:'2026-04-30',normalPay:normalPolicy()});
  await db.collection('dayTypeCalendars').doc('C2D').set({status:'approved',version:'synthetic',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,employeeIds:[employee.id],days:Object.fromEntries([...normalDays('2026-04'),...normalDays('2026-05').slice(0,6)].map(d=>[d.date,'normal']))});
  await db.collection('payrollReviews').doc(employee.id+'_'+month).set({empId:employee.id,yearMonth:month,review,employeeSourceKey:employeePayrollSourceKey(e),masterVersionId:'C2M'});return e;
 };
 it('C2b real handler ignores client overtime policy and exposes pending source without writes',async()=>{await setupNormal();const before=(await db.doc('payrollPolicyVersions/C2P').get()).data();const response=await call('get-employee-salary',{empId:employee.id,yearMonth:month,overtime:{status:'approved',wages:[{amount:99999}]}},'synthetic-employee');expect(response.statusCode,response.body).toBe(200);const body=JSON.parse(response.body);expect(body.normalPayPreview.overtimePreview).toMatchObject({status:'needs-review',formalEligibility:'BLOCKED',payableAmount:null});expect(body.normalPayPreview.overtimePreview.issues.join()).toContain('加班計算規則');expect(body.netSalary).toBeNull();expect((await db.doc('payrollPolicyVersions/C2P').get()).data()).toEqual(before);expect((await db.collection('payrollRuns').get()).size).toBe(0);});
 it('transaction reads exact normal segments but never writes an amount or snapshot',async()=>{const e=await setupNormal();const before=(await db.collection('payrollMasterVersions').doc('C2M').get()).data();const projected=await db.runTransaction(async tx=>(await loadMonthlyPayrollEmployees([e],month,db,tx))[0]);const result=calculateSalaryForEmployee(projected,month,[],[card()],[]);expect(result.normalPayPreview).toMatchObject({status:'ready',amount:'1600.00'});expect(result.netSalary).toBeNull();expect((await db.collection('payrollMasterVersions').doc('C2M').get()).data()).toEqual(before);expect((await db.collection('payrollRuns').get()).size).toBe(0);});
 it('unapproved outer source cannot be rescued by approved-looking nested calculation policy',async()=>{const e=await setupNormal();await db.collection('payrollPolicyVersions').doc('C2P').update({status:'draft'});const projected=(await loadMonthlyPayrollEmployees([e],month,db))[0];const result=calculateSalaryForEmployee(projected,month,[],[card()],[]);expect(result.normalPayPreview?.status).toBe('needs-review');expect(result.normalPayPreview?.amount).toBeNull();});
 it('C2a fix real salary handler cannot ready split overnight work across break',async()=>{await setupNormal();for(const col of ['clockRecords','dailySchedule'])for(const d of (await db.collection(col).get()).docs)await d.ref.delete();await db.collection('clockRecords').doc('FIRST').set(card('2026-04-01','20:00','23:30'));await db.collection('clockRecords').doc('SECOND').set(card('2026-04-02','00:30','06:00'));const response=await call('get-employee-salary',{empId:employee.id,yearMonth:month},'synthetic-employee');expect(response.statusCode,response.body).toBe(200);const result=JSON.parse(response.body);expect(result.normalPayPreview.status,JSON.stringify(result.normalPayPreview)).toBe('needs-review');expect(result.normalPayPreview.amount).toBeNull();
 const assignments=[];for(const id of ['FIRST','SECOND']){const c=(await db.doc('clockRecords/'+id).get()).data()!,base=Date.parse(c.date+'T00:00:00+08:00')/60000,w=c.workIntervals[0];assignments.push({sourceId:id,sourceVersion:evidenceHash([clockSourceKey(c as any),c.workIntervals,c.workReview.reviewedBy+'@'+c.workReview.reviewedAt]),workApprovalId:c.workReview.reviewedBy+'@'+c.workReview.reviewedAt,start:base+w.start,end:base+w.end,workdayId:'approved-shift',workdayDate:'2026-04-01'});}
 await db.doc('payrollPolicyVersions/C2P').update({'normalPay.workdayAssignments':assignments});const mapped=JSON.parse((await call('get-employee-salary',{empId:employee.id,yearMonth:month},'synthetic-employee')).body);expect(mapped.normalPayPreview.extraWorkMinutes).toBe(60);expect(mapped.normalPayPreview.amount).toBe('1600.00');expect(mapped.normalPayPreview.combined.amount).toBeNull();expect(mapped.netSalary).toBeNull();
 assignments[1].sourceVersion='stale';await db.doc('payrollPolicyVersions/C2P').update({'normalPay.workdayAssignments':assignments});const stale=JSON.parse((await call('get-employee-salary',{empId:employee.id,yearMonth:month},'synthetic-employee')).body);expect(stale.normalPayPreview.amount).toBeNull();expect((await db.collection('payrollRuns').get()).size).toBe(0);
 });
});

import {terminationSeed,terminationManual} from './fixtures/terminationSettlement';
describe('C2m actual Firestore manual termination',()=>{
 const seed=async()=>{for(const [key,value] of terminationSeed())await db.doc(key).set(value);};
 const payload=()=>({empId:'TERM',month:'2026-08',exitDate:'2026-08-15',expectedRevision:0,operationId:'same-operation',reason:'合成離職逐項核對原因',manual:terminationManual()});
 it('same-operation concurrent saves create one record and immutable version without undefined fields',async()=>{await seed();const results=await Promise.all([call('save-termination-draft',payload()),call('save-termination-draft',payload())]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect(JSON.parse(results[0].body)).toEqual(JSON.parse(results[1].body));expect((await db.collection('terminationSettlementDrafts').get()).size).toBe(1);expect((await db.collection('terminationSettlementVersions').get()).size).toBe(1);});
 it('two reviewers cannot append duplicate approval or change existing payroll snapshots',async()=>{await seed();const r=JSON.parse((await call('save-termination-draft',payload())).body);const p=JSON.parse((await call('submit-termination-draft',{...payload(),draftId:r.id,expectedRevision:1,operationId:'submit'})).body);vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'TERM_REVIEWER'} as any);const c={...payload(),draftId:r.id,expectedRevision:p.revision,mode:'approve'};const res=await Promise.all([call('review-termination-draft',{...c,operationId:'review-a'}),call('review-termination-draft',{...c,operationId:'review-b'})]);expect(res.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await call('get-termination-settlement-version',{empId:'TERM',month:'2026-08',draftId:r.id,revision:1})).statusCode).toBe(200);expect((await db.collection('terminationSettlementVersions').get()).size).toBe(3);expect((await db.collection('payrollRuns').get()).size).toBe(0);expect((await db.collection('employees').doc('TERM').get()).data()?.resignDate).toBeUndefined();});
 it('source change fails approval atomically and retained snapshots remain unchanged',async()=>{await seed();const r=JSON.parse((await call('save-termination-draft',payload())).body);await call('submit-termination-draft',{...payload(),draftId:r.id,expectedRevision:1,operationId:'submit'});await db.doc('payrollMasterHeads/TERM').update({revision:2});vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'TERM_REVIEWER'} as any);expect((await call('review-termination-draft',{...payload(),draftId:r.id,expectedRevision:2,operationId:'review',mode:'approve'})).statusCode).toBe(409);expect((await db.collection('terminationSettlementVersions').get()).size).toBe(2);});
 it('locked original has only one separate adjustment case under race and is never rewritten',async()=>{await seed();const original={lockedAt:'2026-09-01T00:00:00Z',lockedBy:'EMULATOR_ADMIN',payrollRunId:'original'};await db.doc('monthLocks/2026-08').set(original);await db.doc('payrollRuns/original').set({immutable:'synthetic-original'});expect((await call('save-termination-draft',payload())).statusCode).toBe(423);const res=await Promise.all([call('open-termination-adjustment',{...payload(),operationId:'adjust-a'}),call('open-termination-adjustment',{...payload(),operationId:'adjust-b'})]);expect(res.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await db.collection('terminationAdjustmentCases').get()).size).toBe(1);expect((await db.doc('monthLocks/2026-08').get()).data()).toEqual(original);expect((await db.doc('payrollRuns/original').get()).data()).toEqual({immutable:'synthetic-original'});expect((await db.collection('terminationSettlementVersions').get()).size).toBe(0);});
});
it('C2m real pending correction is a persistent approval blocker, not a manual override',async()=>{for(const [key,value] of terminationSeed())await db.doc(key).set(value);await db.doc('makeupRequests/TERM_PENDING').set({empId:'TERM',date:'2026-08-02',status:'待審核'});await db.doc('leaveRequests/TERM_INVALID').set({empId:'TERM',status:'核准',startDate:'invalid',endDate:'invalid'});const body={empId:'TERM',month:'2026-08',exitDate:'2026-08-15',expectedRevision:0,operationId:'draft',reason:'合成未核補卡來源檢查',manual:terminationManual()};const saved=await call('save-termination-draft',body);expect(saved.statusCode).toBe(200);const r=JSON.parse(saved.body);expect(r.manual.issues.some((s:string)=>s.includes('補卡'))).toBe(true);expect(r.manual.issues.some((s:string)=>s.includes('假單期間來源無效'))).toBe(true);await call('submit-termination-draft',{...body,draftId:r.id,expectedRevision:1,operationId:'submit'});vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'TERM_REVIEWER'} as any);expect((await call('review-termination-draft',{...body,draftId:r.id,expectedRevision:2,operationId:'approve',mode:'approve'})).statusCode).toBe(409);expect((await db.collection('terminationSettlementVersions').get()).size).toBe(2);});

describe('C2m independent source-completeness on real Firestore',()=>{
 const seed=async()=>{for(const [key,value] of terminationSeed())await db.doc(key).set(value);};
 const body=()=>({empId:'TERM',month:'2026-08',exitDate:'2026-08-15',expectedRevision:0,operationId:'independent-draft',reason:'合成獨立離職來源覆核',manual:terminationManual()});
 it('a card missing work-date after submission invalidates the source hash and cannot be approved',async()=>{
  await seed();const payload=body(),saved=await call('save-termination-draft',payload);expect(saved.statusCode,saved.body).toBe(200);const draft=JSON.parse(saved.body);
  expect((await call('submit-termination-draft',{...payload,draftId:draft.id,expectedRevision:1,operationId:'independent-submit'})).statusCode).toBe(200);
  await db.doc('clockRecords/TERM_UNKNOWN').set({empId:'TERM',clockInAt:'2026-08-02T09:00:00+08:00',clockOutAt:null,clockInTime:'09:00',clockOutTime:null});
  const read=await call('get-termination-settlement',{empId:'TERM',month:'2026-08',exitDate:'2026-08-15'});expect(read.statusCode,read.body).toBe(200);const source=JSON.parse(read.body).source;
  expect(source.version).not.toBe(draft.source.version);expect(source.issues.some((issue:string)=>issue.includes('打卡日期來源無效'))).toBe(true);
  vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'TERM_REVIEWER'} as any);
  expect((await call('review-termination-draft',{...payload,draftId:draft.id,expectedRevision:2,operationId:'independent-approve',mode:'approve'})).statusCode).toBe(409);
  expect((await db.doc('terminationSettlementDrafts/'+draft.id).get()).data()?.status).toBe('pending');expect((await db.collection('terminationSettlementVersions').get()).size).toBe(2);
 });
 it('real makeup and work-review APIs produce before/after-only revisions that C2m can verify',async()=>{
  await seed();await db.doc('clockRecords/TERM_C').set({id:'TERM_C',empId:'TERM',name:'合成離職員工',date:'2026-08-02',clockInTime:'09:00',clockOutTime:'16:00',clockInAt:'2026-08-02T09:00:00+08:00',clockOutAt:'2026-08-02T16:00:00+08:00',workHours:null,status:'正常'});
  await db.doc('makeupRequests/TERM_M').set({empId:'TERM',name:'合成離職員工',date:'2026-08-02',requestedClockOut:'17:00',reason:'合成核准補卡來源',status:'待審核'});
  const applied=await call('approve-makeup-request',{requestId:'TERM_M',status:'核准'});expect(applied.statusCode,applied.body).toBe(200);
  const reviewed=await call('update-clock-record',{recordId:'TERM_C',workIntervals:[{start:540,end:1020}]});expect(reviewed.statusCode,reviewed.body).toBe(200);
  const revisions=await db.collection('attendanceRevisions').where('recordId','==','TERM_C').get();expect(revisions.size).toBe(2);for(const revision of revisions.docs){expect(revision.data()).not.toHaveProperty('empId');expect(revision.data().after.empId).toBe('TERM');}
  const payload=body(),saved=await call('save-termination-draft',payload);expect(saved.statusCode,saved.body).toBe(200);const draft=JSON.parse(saved.body);expect(draft.manual.issues).toEqual([]);
  const pending=await call('submit-termination-draft',{...payload,draftId:draft.id,expectedRevision:1,operationId:'independent-submit'});expect(pending.statusCode,pending.body).toBe(200);
  vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'TERM_REVIEWER'} as any);
  const approved=await call('review-termination-draft',{...payload,draftId:draft.id,expectedRevision:2,operationId:'independent-approve',mode:'approve'});expect(approved.statusCode,approved.body).toBe(200);expect(JSON.parse(approved.body)).toMatchObject({status:'approved',formalEligibility:'BLOCKED',paymentStatus:'not-paid',applicationStatus:'not-applied'});
  expect((await db.collection('payrollRuns').get()).size).toBe(0);
 });
});
describe('personal 例假／休息日 designation on real Firestore',()=>{
 const body=(extra:any={})=>({yearMonth:'2026-08',regularHolidays:['2026-08-02','2026-08-09','2026-08-16','2026-08-23','2026-08-30'],restDays:['2026-08-01','2026-08-08','2026-08-15','2026-08-22','2026-08-29'],expectedRevision:0,operationId:'emu-daytype-submit',...extra});
 it('employee submit and different-admin approval create one immutable calendar version atomically',async()=>{await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});
  const s=await call('submit-daytype-designation',body(),'synthetic-employee');expect(s.statusCode,s.body).toBe(200);
  const replay=await call('submit-daytype-designation',body(),'synthetic-employee');expect(JSON.parse(replay.body).revision).toBe(1);
  const self=await call('review-daytype-designation',{yearMonth:'2026-08',empId:employee.id,expectedRevision:1,operationId:'emu-self',mode:'approve',reason:'自我核定測試',confirmRemainingNormal:true},'synthetic-employee');expect(self.statusCode).toBe(403);
  const a=await call('review-daytype-designation',{yearMonth:'2026-08',empId:employee.id,expectedRevision:1,operationId:'emu-approve',mode:'approve',reason:'合成核定原因',confirmRemainingNormal:true});expect(a.statusCode,a.body).toBe(200);
  const calendars=await db.collection('dayTypeCalendars').get();expect(calendars.size).toBe(1);const c=calendars.docs[0].data();expect(c.days['2026-08-02']).toBe('regular-holiday');expect(c.approvedBy).toBe('EMULATOR_ADMIN');
  expect((await db.doc(`dayTypeCalendarHeads/${employee.id}_2026-08`).get()).data()?.currentCalendarId).toBe(calendars.docs[0].id);
  await db.collection('monthLocks').doc('2026-08').set({yearMonth:'2026-08',lockedAt:'2026-09-05T00:00:00Z',lockedBy:'EMULATOR_ADMIN'});
  const locked=await call('submit-daytype-designation',body({expectedRevision:2,operationId:'emu-after-lock'}),'synthetic-employee');expect(locked.statusCode).toBe(423);
  expect((await db.collection('dayTypeCalendars').get()).size).toBe(1);
 });
});
describe('C2b official salary on real Firestore: designation → master → overtime',()=>{
 it('approved personal designation and overtime rules put weekday overtime into the official salary',async()=>{
  const e=(await db.collection('employees').doc(employee.id).get()).data()!;await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});
  const sundays=['2026-04-05','2026-04-12','2026-04-19','2026-04-26'],saturdays=['2026-04-04','2026-04-11','2026-04-18','2026-04-25'];
  expect((await call('submit-daytype-designation',{yearMonth:'2026-04',regularHolidays:sundays,restDays:saturdays,expectedRevision:0,operationId:'emu-c2b-designation'},'synthetic-employee')).statusCode).toBe(200);
  expect((await call('review-daytype-designation',{yearMonth:'2026-04',empId:employee.id,expectedRevision:1,operationId:'emu-c2b-approve',mode:'approve',reason:'合成日別核定',confirmRemainingNormal:true})).statusCode).toBe(200);
  const timeline={accountKind:'employee',from:'2026-04-01',to:'2026-04-30',periods:[{from:'2026-04-01',to:'2026-04-30',employmentState:'active',employmentType:'part-time',payBasis:'hourly',amount:200,policyVersionId:'C2BP',dayTypeCalendarId:'personal-monthly'}]};
  timeline.from='2026-03-26';timeline.to='2026-05-06';timeline.periods=[{...timeline.periods[0],from:'2026-03-26',to:'2026-03-31',employmentState:'not-employed'},...timeline.periods,{...timeline.periods[0],from:'2026-05-01',to:'2026-05-06',employmentState:'active'}];
  await db.collection('dayTypeCalendars').doc('C2B_MAY').set({status:'approved',version:'synthetic-boundary',yearMonth:'2026-05',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,employeeIds:[employee.id],days:Object.fromEntries(normalDays('2026-05').map(d=>[d.date,'normal']))});await db.collection('dayTypeCalendarHeads').doc(employee.id+'_2026-05').set({currentCalendarId:'C2B_MAY'});
  await db.collection('payrollMasterVersions').doc('C2BM').set({empId:employee.id,status:'approved',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,timeline});await db.collection('payrollMasterHeads').doc(employee.id).set({currentVersionId:'C2BM',revision:1});
  await db.collection('payrollPolicyVersions').doc('C2BP').set({status:'approved',version:review.policy.version,approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,employeeIds:[employee.id],from:'2026-04-01',to:'2026-05-06',normalPay:{...normalPolicy(),overtimeRules:{schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240}}});
  await db.collection('payrollReviews').doc(employee.id+'_2026-04').set({empId:employee.id,yearMonth:'2026-04',review:{...review,policy:{...review.policy,regularDates:[]}},employeeSourceKey:employeePayrollSourceKey(e),masterVersionId:'C2BM'});
  await db.collection('clockRecords').doc('C2B-OT').set({...card('2026-04-06','08:00','17:00'),id:'C2B-OT'});await db.doc('insuranceTimelineHeads/'+employee.id).set({currentVersionId:'EMU_INS',revision:1});await db.doc('insuranceTimelineVersions/EMU_INS').set({empId:employee.id,status:'approved',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,periods:[{from:'2026-01-01',to:'2026-12-31',laborInsured:false,laborSalary:0,employmentInsured:false,healthInsuredHere:false,healthAmount:0,healthDependants:0,pensionWage:0,pensionSelfPercent:0,withholdingMethod:'table'}]});
  await db.doc('dailySchedule/2026-04-06').set(schedule('2026-04-06','08:00','17:00'));
  await readyLegacyAttendance({'2026-04-01':480,'2026-04-06':540});
  const res=await call('get-employee-salary',{empId:employee.id,yearMonth:'2026-04'});expect(res.statusCode,res.body).toBe(200);const s=JSON.parse(res.body);
  expect(s.normalPayPreview.combined.status,JSON.stringify(s.normalPayPreview.combined.issues)).toBe('ready');// The suite seeds an 8h card on 04-01 too: 1600 + (1600 + 800/3) on 04-06.
  expect(s.normalPayPreview.combined.amount).toBe('3466.67');
  expect(s.calculationStatus,JSON.stringify(s.reviewReasons)).toBe('ready');expect(s.baseSalary).toBe(3200);expect(s.overtimePay).toBe(266.67);expect(s.grossSalary).toBe(3466.67);
 });
});
describe('overtime/comp policy two-person approval on real Firestore',()=>{
 it('propose → employee agrees → a different admin approves writes both policies atomically',async()=>{await db.collection('employees').doc(employee.id).update({role:UserRole.Employee});await db.collection('employees').doc('EMU_ADMIN_2').set({id:'EMU_ADMIN_2',name:'合成管理者二',role:UserRole.Admin,accountKind:'system-account',hireDate:'2020-01-01',hourlyRate:0,monthlySalary:0});
  const base={empId:employee.id,reviewerIds:['EMU_ADMIN_2'],effectiveFrom:'2026-08-01',effectiveTo:'2027-07-31'};
  expect((await call('propose-overtime-comp-policy',{...base,expectedRevision:0,operationId:'emu-ocp-1',reason:'合成政策提案'})).statusCode).toBe(200);
  expect((await call('agree-overtime-comp-policy',{empId:employee.id,expectedRevision:1,operationId:'emu-ocp-2'},'synthetic-employee')).statusCode).toBe(200);
  const self=await call('review-overtime-comp-policy',{empId:employee.id,expectedRevision:2,operationId:'emu-ocp-3',mode:'approve',reason:'提案人自核測試'});expect(self.statusCode).toBe(403);
  vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'EMU_ADMIN_2'} as any);
  const ok=await call('review-overtime-comp-policy',{empId:employee.id,expectedRevision:2,operationId:'emu-ocp-4',mode:'approve',reason:'第二人核定政策'});expect(ok.statusCode,ok.body).toBe(200);
  expect((await db.doc('compPolicies/'+employee.id).get()).data()).toMatchObject({status:'approved',approvedBy:'EMU_ADMIN_2',employeeAgreedBy:employee.id,deadlineRule:'annual-leave-year-end'});
  expect((await db.doc('overtimeWorkflowPolicies/'+employee.id).get()).data()).toMatchObject({status:'approved',reviewerIds:['EMU_ADMIN_2']});
  expect((await db.collection('overtimeCompPolicyVersions').get()).size).toBe(1);
 });
});
describe('payroll policy version created through the API drives the official salary',()=>{
 it('propose → different admin approves → master references it → 9h weekday pays OT, rounded to whole dollars',async()=>{const e=(await db.collection('employees').doc(employee.id).get()).data()!;await db.collection('employees').doc('EMU_ADMIN_2').set({id:'EMU_ADMIN_2',name:'合成管理者二',role:UserRole.Admin,accountKind:'system-account',hireDate:'2020-01-01',hourlyRate:0,monthlySalary:0});
  const p=await call('propose-payroll-policy-version',{operationId:'emu-ppv-1',workRegime:'standard-8-40',workRegimeEvidence:'synthetic confirmed standard regime',employeeIds:[employee.id],from:'2026-04-01',to:'2026-05-06',otherLeave:null,reason:'合成計薪政策提案'});expect(p.statusCode,p.body).toBe(200);const proposal=JSON.parse(p.body);
  expect((await call('review-payroll-policy-version',{operationId:'emu-ppv-2',proposalId:proposal.id,expectedRevision:1,mode:'approve',reason:'提案人自核測試'})).statusCode).toBe(403);
  vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'EMU_ADMIN_2'} as any);const a=await call('review-payroll-policy-version',{operationId:'emu-ppv-3',confirmWorkRegime:true,proposalId:proposal.id,expectedRevision:1,mode:'approve',reason:'第二人核定政策'});expect(a.statusCode,a.body).toBe(200);const versionId=JSON.parse(a.body).versionId;
  const timeline={accountKind:'employee',from:'2026-04-01',to:'2026-04-30',periods:[{from:'2026-04-01',to:'2026-04-30',employmentState:'active',employmentType:'part-time',payBasis:'hourly',amount:200,policyVersionId:versionId,dayTypeCalendarId:'PPVD'}]};
  timeline.from='2026-03-26';timeline.to='2026-05-06';timeline.periods=[{...timeline.periods[0],from:'2026-03-26',to:'2026-03-31',employmentState:'not-employed'},...timeline.periods,{...timeline.periods[0],from:'2026-05-01',to:'2026-05-06',employmentState:'active'}];
  await db.collection('payrollMasterVersions').doc('PPVM').set({empId:employee.id,status:'approved',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,timeline});await db.collection('payrollMasterHeads').doc(employee.id).set({currentVersionId:'PPVM',revision:1});
  await db.collection('dayTypeCalendars').doc('PPVD').set({status:'approved',version:'synthetic',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,employeeIds:[employee.id],days:Object.fromEntries([...normalDays('2026-04'),...normalDays('2026-05').slice(0,6)].map(d=>[d.date,'normal']))});
  await db.collection('payrollReviews').doc(employee.id+'_2026-04').set({empId:employee.id,yearMonth:'2026-04',review:{...review,policy:{...review.policy,version:versionId,regularDates:[]}},employeeSourceKey:employeePayrollSourceKey(e),masterVersionId:'PPVM'});
  await db.collection('clockRecords').doc('PPV-OT').set({...card('2026-04-06','08:00','17:00'),id:'PPV-OT'});await db.doc('insuranceTimelineHeads/'+employee.id).set({currentVersionId:'EMU_INS',revision:1});await db.doc('insuranceTimelineVersions/EMU_INS').set({empId:employee.id,status:'approved',approvedBy:'EMULATOR_ADMIN',approvedAt:review.reviewedAt,periods:[{from:'2026-01-01',to:'2026-12-31',laborInsured:false,laborSalary:0,employmentInsured:false,healthInsuredHere:false,healthAmount:0,healthDependants:0,pensionWage:0,pensionSelfPercent:0,withholdingMethod:'table'}]});
  await db.doc('dailySchedule/2026-04-06').set(schedule('2026-04-06','08:00','17:00'));
  await readyLegacyAttendance({'2026-04-01':480,'2026-04-06':540});
  vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'EMULATOR_ADMIN'} as any);const s=JSON.parse((await call('get-employee-salary',{empId:employee.id,yearMonth:'2026-04'})).body);
  // Seeded 04-01 8h card + 04-06 9h: 1600 + 1600 + 800/3, final whole-dollar rounding → 3467.
  expect(s.normalPayPreview.combined.status,JSON.stringify(s.normalPayPreview.combined.issues)).toBe('ready');expect(s.normalPayPreview.combined.amount).toBe('3467');expect(s.calculationStatus,JSON.stringify(s.reviewReasons)).toBe('ready');expect(s.grossSalary).toBe(3467);
 });
});
describe('insurance timeline two-person approval on real Firestore',()=>{
 const period={from:'2026-04-01',to:'2026-12-31',laborInsured:true,laborSalary:29500,employmentInsured:true,healthInsuredHere:true,healthAmount:29500,healthDependants:1,pensionWage:30300,pensionSelfPercent:6,withholdingMethod:'table'};
 it('propose → different admin approves moves the head; locked months are refused',async()=>{await db.collection('employees').doc('EMU_ADMIN_2').set({id:'EMU_ADMIN_2',name:'合成管理者二',role:UserRole.Admin,accountKind:'system-account',hireDate:'2020-01-01',hourlyRate:0,monthlySalary:0});
  const p=await call('propose-insurance-timeline',{empId:employee.id,periods:[period],expectedHeadRevision:0,operationId:'emu-ins-1',reason:'合成投保資料'});expect(p.statusCode,p.body).toBe(200);const v=JSON.parse(p.body);
  expect((await call('review-insurance-timeline',{empId:employee.id,versionId:v.id,expectedRevision:1,expectedHeadRevision:0,operationId:'emu-ins-2',mode:'approve',reason:'提案人自核測試'})).statusCode).toBe(403);
  vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'EMU_ADMIN_2'} as any);const a=await call('review-insurance-timeline',{empId:employee.id,versionId:v.id,expectedRevision:1,expectedHeadRevision:0,operationId:'emu-ins-3',mode:'approve',reason:'第二人核定投保'});expect(a.statusCode,a.body).toBe(200);
  expect((await db.doc('insuranceTimelineHeads/'+employee.id).get()).data()?.currentVersionId).toBe(v.id);
  await db.collection('monthLocks').doc('2026-04').set({yearMonth:'2026-04',lockedAt:'2026-05-05T00:00:00Z',lockedBy:'EMULATOR_ADMIN'});
  const locked=await call('propose-insurance-timeline',{empId:employee.id,periods:[{...period,healthDependants:2}],expectedHeadRevision:1,operationId:'emu-ins-4',reason:'鎖月後更動測試'});expect(locked.statusCode).toBe(423);
  const later=await call('propose-insurance-timeline',{empId:employee.id,periods:[{...period,to:'2026-05-31'},{...period,from:'2026-06-01',healthDependants:2}],expectedHeadRevision:1,operationId:'emu-ins-5',reason:'六月起眷屬變更'});expect(later.statusCode,later.body).toBe(200);
 });
});

describe('C3a enrollment review regressions on real Firestore',()=>{
 it('rejects unsupported health grade and retains independently approved employment-only enrollment',async()=>{
  await db.collection('employees').doc('EMU_ADMIN_2').set({id:'EMU_ADMIN_2',name:'合成管理者二',role:UserRole.Admin,accountKind:'system-account',hireDate:'2020-01-01',hourlyRate:0,monthlySalary:0});
  const period={from:'2026-04-01',to:'2026-12-31',laborInsured:false,laborSalary:29500,employmentInsured:true,healthInsuredHere:true,healthAmount:30000,healthDependants:0,pensionWage:0,pensionSelfPercent:0,withholdingMethod:'table'};
  const command={empId:employee.id,periods:[period],expectedHeadRevision:0,operationId:'invalid-health-grade',reason:'合成級距回歸測試'};
  expect((await call('propose-insurance-timeline',command)).statusCode).toBe(400);
  const p=await call('propose-insurance-timeline',{...command,operationId:'employment-only-proposal',periods:[{...period,healthAmount:30300}]});expect(p.statusCode,p.body).toBe(200);const v=JSON.parse(p.body);
  vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'EMU_ADMIN_2'} as any);
  const approved=await call('review-insurance-timeline',{empId:employee.id,versionId:v.id,expectedRevision:1,expectedHeadRevision:0,operationId:'employment-only-approval',mode:'approve',reason:'第二人合成資料核對'});expect(approved.statusCode,approved.body).toBe(200);
  expect((await db.doc('insuranceTimelineVersions/'+v.id).get()).data()?.periods[0]).toMatchObject({laborInsured:false,employmentInsured:true,laborSalary:29500,healthAmount:30300});
 });
});

describe('closure freshness uses actual immutable events and transaction sources',()=>{
 const scan=()=>call('scan-attendance-cases',{empId:employee.id,yearMonth:month});
 const findCase=async()=>{const rows=await db.collection('attendanceCases').get();return rows.docs.find(d=>d.data().type==='missing-in'&&d.data().anchor==='card:C1')!;};
 const seedClosed=async()=>{
  await db.collection('clockRecords').doc('C1').set({...card(),clockInTime:null,clockInAt:null,workReview:null,workIntervals:[]});
  const initial=await scan();expect(initial.statusCode,initial.body).toBe(200);
  await db.collection('clockRecords').doc('C1').set(card());const rescanned=await scan();expect(rescanned.statusCode,rescanned.body).toBe(200);
  const c=await findCase();expect(c.data().status).toBe('resolved');return c;
 };
 const salary=async()=>{const r=await call('get-employee-salary',{empId:employee.id,yearMonth:month});expect(r.statusCode,r.body).toBe(200);return JSON.parse(r.body);};
 const issue=(s:any,id:string)=>s.preflight.issues.find((i:any)=>i.source==='attendanceCases'&&i.sourceId===id);
 const evidence=async()=>{const output:any={};for(const name of ['attendanceCases','attendanceCaseEvents','attendanceCaseOutbox','payrollControl']){const s=await db.collection(name).get();output[name]=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id));}return output;};
 it('salary read has no writes; changed-clear source blocks until a new immutable scan event exists',async()=>{
  const c=await seedClosed(),before=await evidence();expect(issue(await salary(),c.id)).toBeUndefined();expect(await evidence()).toEqual(before);
  await db.collection('clockRecords').doc('C1').set(card(undefined,'09:00','18:00'));const changed=await evidence();expect(issue(await salary(),c.id)?.code).toBe('APPLICATION_UNVERIFIED');expect(await evidence()).toEqual(changed);
  const r=await scan();expect(r.statusCode,r.body).toBe(200);expect(issue(await salary(),c.id)).toBeUndefined();expect((await c.ref.get()).data()!.revision).toBeGreaterThan(c.data().revision);
 });
 it('deleted immutable closure event or raw source cannot reuse terminal status',async()=>{
  const c=await seedClosed(),last=c.data().history.at(-1);await db.collection('attendanceCaseEvents').doc(last.id).delete();const before=await evidence();expect(issue(await salary(),c.id)?.code).toBe('APPLICATION_UNVERIFIED');expect(await evidence()).toEqual(before);
  await db.collection('attendanceCaseEvents').doc(last.id).set({...last,caseId:c.id,empId:employee.id});await db.collection('clockRecords').doc('C1').delete();expect(issue(await salary(),c.id)?.code).toBe('APPLICATION_UNVERIFIED');
  let inspected:any;vi.mocked(assertPayrollReady).mockImplementation(r=>{inspected=r;throw Object.assign(new Error('synthetic no formal lock'),{statusCode:409});});
  const r=await call('lock-month',{yearMonth:month});expect(r.statusCode,r.body).toBe(409);expect(issue(inspected.salaries.find((s:any)=>s.empId===employee.id),c.id)?.code).toBe('APPLICATION_UNVERIFIED');expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('monthLocks').get()).empty).toBe(true);
 });
 it.each(['lock-first','edit-first'])('a source edit races lock without using old closure proof (%s)',async order=>{
  await db.collection('dailySchedule').doc('2026-04-01').delete();const c=await seedClosed();
  // Isolate this source-freshness boundary from other detector capability gaps;
  // formal eligibility remains mocked only in this transaction-contract test.
  const all=await db.collection('attendanceCases').get();const batch=db.batch();for(const d of all.docs)if(d.id!==c.id)batch.delete(d.ref);await batch.commit();
  const lock=()=>call('lock-month',{yearMonth:month}),edit=()=>call('update-clock-record',{recordId:'C1',clockInTime:'09:00',clockOutTime:'16:00',workIntervals:[{start:540,end:960}]});
  const results=await Promise.all(order==='lock-first'?[lock(),edit()]:[edit(),lock()]);const [locked,edited]=order==='lock-first'?results:[...results].reverse();
  expect([200,409],locked.body).toContain(locked.statusCode);
  if(locked.statusCode===200){expect(edited.statusCode,edited.body).toBe(423);const run=await storedRun();expect(run.inputs.records[0].clockOutTime).toBe('17:00');}
  else{expect(edited.statusCode,edited.body).toBe(200);expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('monthLocks').get()).empty).toBe(true);}
 });
});

describe('payroll item inventory real transaction evidence',()=>{
 const inventory={empId:employee.id,month,mode:'none',sourceRefs:['SYNTH-CHECK'],reason:'合成本月項目盤點',items:[]};
 const proposal={inventory,expectedRevision:0,operationId:'emu-items-propose'};
 const reviewCommand={empId:employee.id,month,expectedRevision:1,mode:'approve',reason:'第二人合成來源核定',operationId:'emu-items-review'};
 beforeEach(async()=>{
  await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
  await db.doc('employees/ITEM_REVIEWER').set({id:'ITEM_REVIEWER',name:'合成核對人',role:UserRole.SuperAdmin,accountKind:'system-account'});
  vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-reviewer'?'ITEM_REVIEWER':token==='synthetic-employee'?employee.id:'EMULATOR_ADMIN'}) as any);
 });
 it('concurrent exact retry creates one immutable proposal, independent approval remains unapplied',async()=>{
  const results=await Promise.all([call('propose-payroll-item-inventory',proposal),call('propose-payroll-item-inventory',proposal)]);
  expect(results.map(r=>r.statusCode),JSON.stringify(results)).toEqual([200,200]);expect(results[0].body).toBe(results[1].body);
  expect((await db.collection('payrollItemInventoryVersions').get()).size).toBe(1);expect((await db.collection('payrollItemCommands').get()).size).toBe(1);
  expect((await call('review-payroll-item-inventory',reviewCommand)).statusCode).toBe(403);
  const approved=await call('review-payroll-item-inventory',reviewCommand,'synthetic-reviewer');expect(approved.statusCode,approved.body).toBe(200);
  expect(JSON.parse(approved.body)).toMatchObject({revision:2,status:'approved',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'unresolved'});
  const get=await call('get-payroll-item-inventory',{empId:employee.id,month},'synthetic-employee');expect(get.statusCode,get.body).toBe(200);expect(JSON.parse(get.body).assessment.status).toBe('confirmed-none');
  expect((await db.collection('payrollRuns').get()).size).toBe(0);
 });
 it('missing immutable history blocks read and approval with no receipt',async()=>{
  const p=await call('propose-payroll-item-inventory',proposal);expect(p.statusCode,p.body).toBe(200);const id=JSON.parse(p.body).id;
  await db.doc('payrollItemInventoryVersions/'+id+'_1').delete();
  expect((await call('get-payroll-item-inventory',{empId:employee.id,month})).statusCode).toBe(409);
  expect((await call('review-payroll-item-inventory',reviewCommand,'synthetic-reviewer')).statusCode).toBe(409);
  expect((await db.doc('payrollItemInventories/'+id).get()).data()?.revision).toBe(1);expect((await db.collection('payrollItemCommands').get()).size).toBe(1);
 });
 it('locked month rejects new approval but exact earlier proposal replay cannot mutate history',async()=>{
  const p=await call('propose-payroll-item-inventory',proposal);expect(p.statusCode,p.body).toBe(200);
  await db.doc('monthLocks/'+month).set({yearMonth:month,lockedAt:'2026-05-01T00:00:00Z',lockedBy:'EMULATOR_ADMIN'});
  const denied=await call('review-payroll-item-inventory',reviewCommand,'synthetic-reviewer');expect(denied.statusCode,denied.body).toBe(423);
  const replay=await call('propose-payroll-item-inventory',proposal);expect(replay.statusCode,replay.body).toBe(200);expect(replay.body).toBe(p.body);
  expect((await db.collection('payrollItemInventoryVersions').get()).size).toBe(1);expect((await db.collection('payrollItemCommands').get()).size).toBe(1);
 });
});

it('modern master salary snapshot matches the exact read source on real Firestore',async()=>{
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 await db.doc('employees/'+employee.id).update({privateContact:'SYNTHETIC_PRIVATE_FIELD'});
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),(await db.doc('employees/'+employee.id).get()).data(),'EMULATOR_ADMIN');
 await db.doc('dailySchedule/2026-04-01').set(schedule('2026-04-01','08:00','17:00'));
 await readyLegacyAttendance({'2026-04-01':540});
 const response=await call('get-employee-salary',{empId:employee.id,yearMonth:month});expect(response.statusCode,response.body).toBe(200);const salary=JSON.parse(response.body);
 expect(salary.normalPayPreview.combined.amount).toBe('1866.67');
 // Only the existing transaction-contract gate is mocked. Production formal
 // eligibility remains covered by the unmocked blocking regressions above.
 const locked=await call('lock-month',{yearMonth:month});expect(locked.statusCode,locked.body).toBe(200);
 const run=await storedRun();expect(run.salaries.find(s=>s.empId===employee.id)?.normalPayPreview).toEqual(salary.normalPayPreview);
 const person=run.inputs.employees.find((e:any)=>e.id===employee.id) as any;
 expect(person.normalPayDays).toHaveLength(30);expect(person.normalPayContextDays).toHaveLength(12);expect(person.insuranceSource).toMatchObject({versionId:'CANON_INS',headRevision:1});
 expect(JSON.stringify(run)).not.toContain('SYNTHETIC_PRIVATE_FIELD');
 await db.doc('employees/'+employee.id).update({hourlyRate:99999});await db.doc('payrollMasterVersions/CANON_MASTER').update({status:'returned'});await db.doc('insuranceTimelineVersions/CANON_INS').update({periods:[]});
 const replay=JSON.parse((await call('get-employee-salary',{empId:employee.id,yearMonth:month})).body);expect(replay.normalPayPreview).toEqual(salary.normalPayPreview);
});

describe('operational declaration and payment evidence on real Firestore transactions',()=>{
 const reviewer='EVIDENCE_REVIEWER';
 beforeEach(async()=>{
  await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
  await db.doc('employees/'+reviewer).set({id:reviewer,name:'合成證據核對人',role:UserRole.SuperAdmin,accountKind:'system-account'});
  vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-evidence-reviewer'?reviewer:token==='synthetic-employee'?employee.id:'EMULATOR_ADMIN'}) as any);
 });
 const policyProposal=async()=>{
  const r=await call('get-attendance-policy-declaration',{empId:employee.id,month});expect(r.statusCode,r.body).toBe(200);
  const targets=JSON.parse(r.body).scheduleTargets;expect(targets).toHaveLength(1);
  return {empId:employee.id,month,expectedRevision:0,operationId:'emu-policy-proposal',reason:'合成出勤基準來源核對',closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,workDifferenceTolerance:0,expectedWorkByDate:Object.fromEntries(targets.map((t:any)=>[t.date,{minutes:480,scheduleVersion:t.scheduleVersion}]))};
 };
 const policyReview={empId:employee.id,month,expectedRevision:1,operationId:'emu-policy-review',mode:'approve',reason:'合成第二人基準核對'};
 const paymentProposal=()=>({expectedRevision:0,operationId:'emu-payment-proposal',inventory:{empId:employee.id,month,mode:'events',sourceRefs:['SYNTHETIC-MONTH'],reason:'合成實際給付單據核對',events:[{id:'SYNTH-PAY',evidenceLocator:'ROW-1',paidOn:'2026-05-05',amount:'30000',sourceRefs:['SYNTHETIC-STATEMENT'],reason:'合成實際給付紀錄',incomeClassification:'salary-monthly',insuredCategory:'category-2-union',exemption:{kind:'category-2-union',from:'2026-01-01',to:'2026-12-31',sourceRefs:['SYNTHETIC-UNION-PROOF']}}]}});
 const paymentReview={empId:employee.id,month,expectedRevision:1,operationId:'emu-payment-review',mode:'approve',reason:'合成第二人給付單據核對'};
 it('persists independent policy approval with all real SDK reads before writes',async()=>{
  const proposal=await policyProposal(),p=await call('propose-attendance-policy-declaration',proposal);expect(p.statusCode,p.body).toBe(200);const id=JSON.parse(p.body).id;
  expect((await call('review-attendance-policy-declaration',policyReview)).statusCode).toBe(403);
  const approved=await call('review-attendance-policy-declaration',policyReview,'synthetic-evidence-reviewer');expect(approved.statusCode,approved.body).toBe(200);
  expect((await db.doc('attendancePolicyDeclarationVersions/'+id+'_1').get()).data()?.status).toBe('proposed');
  expect((await db.doc('attendancePolicyDeclarationVersions/'+id+'_2').get()).data()?.status).toBe('approved');
  const get=await call('get-attendance-policy-declaration',{empId:employee.id,month});expect(get.statusCode,get.body).toBe(200);expect(JSON.parse(get.body).assessment.status).toBe('verified');
 });
 it('rejects stale schedules, employee mutations and month locks without partial policy approval',async()=>{
  const proposal=await policyProposal();expect((await call('propose-attendance-policy-declaration',proposal,'synthetic-employee')).statusCode).toBe(403);
  const p=await call('propose-attendance-policy-declaration',proposal);expect(p.statusCode,p.body).toBe(200);const id=JSON.parse(p.body).id;
  await db.doc('dailySchedule/2026-04-01').update({shifts:schedule('2026-04-01','09:00','18:00').shifts});
  const stale=await call('review-attendance-policy-declaration',policyReview,'synthetic-evidence-reviewer');expect(stale.statusCode,stale.body).toBe(409);
  await db.doc('monthLocks/'+month).set({yearMonth:month,lockedAt:'2026-05-01T00:00:00Z',lockedBy:'EMULATOR_ADMIN'});
  expect((await call('review-attendance-policy-declaration',policyReview,'synthetic-evidence-reviewer')).statusCode).toBe(423);
  expect((await db.doc('attendancePolicyDeclarations/'+id).get()).data()?.revision).toBe(1);
  expect((await db.collection('attendancePolicyDeclarationVersions').get()).size).toBe(1);expect((await db.collection('attendancePolicyDeclarationCommands').get()).size).toBe(1);
 });
 it('records independently reviewed actual payment facts while canonical net remains unresolved',async()=>{
  const proposal=paymentProposal(),p=await call('propose-payroll-payment-evidence',proposal);expect(p.statusCode,p.body).toBe(200);const draft=JSON.parse(p.body);
  expect(draft.sourceBinding.net).toBeNull();expect(draft.assessment.status).toBe('needs-review');expect(draft.assessment.issues).toContain('monthly-payable-unresolved');
  expect((await call('review-payroll-payment-evidence',paymentReview)).statusCode).toBe(403);
  const hidden=await call('get-payroll-payment-evidence',{empId:employee.id,month},'synthetic-employee');expect(hidden.statusCode,hidden.body).toBe(200);expect(JSON.parse(hidden.body)).toMatchObject({current:null,assessment:null});
  const approved=await call('review-payroll-payment-evidence',paymentReview,'synthetic-evidence-reviewer');expect(approved.statusCode,approved.body).toBe(200);
  expect(JSON.parse(approved.body)).toMatchObject({status:'approved',sourceBinding:{net:null},assessment:{status:'needs-review',formalEligibility:'BLOCKED',incomeTaxBase:null,pensionBasis:null},applicationStatus:'not-applied',paymentExecution:'none',legalValidation:'unresolved'});
  const read=await call('get-payroll-payment-evidence',{empId:employee.id,month});expect(read.statusCode,read.body).toBe(200);expect(JSON.parse(read.body)).toMatchObject({sourceAvailable:true,reconciliationAvailable:false,stale:false});
  expect((await db.collection('payrollPaymentEvidenceVersions').get()).size).toBe(2);expect((await db.collection('payrollRuns').get()).size).toBe(0);
 });
 it('guards payment scope/auth, source changes and locks without writing approval',async()=>{
  const proposal=paymentProposal();expect((await call('propose-payroll-payment-evidence',proposal,'synthetic-employee')).statusCode).toBe(403);
  expect((await call('get-payroll-payment-evidence',{empId:'EMULATOR_ADMIN',month},'synthetic-employee')).statusCode).toBe(403);
  const p=await call('propose-payroll-payment-evidence',proposal);expect(p.statusCode,p.body).toBe(200);const id=JSON.parse(p.body).id;
  await db.doc('clockRecords/C1').update({clockOutTime:'18:00'});
  const stale=await call('review-payroll-payment-evidence',paymentReview,'synthetic-evidence-reviewer');expect(stale.statusCode,stale.body).toBe(409);
  await db.doc('monthLocks/'+month).set({yearMonth:month,lockedAt:'2026-05-01T00:00:00Z',lockedBy:'EMULATOR_ADMIN'});
  expect((await call('review-payroll-payment-evidence',paymentReview,'synthetic-evidence-reviewer')).statusCode).toBe(423);
  expect((await db.doc('payrollPaymentEvidence/'+id).get()).data()?.revision).toBe(1);expect((await db.collection('payrollPaymentEvidenceVersions').get()).size).toBe(1);expect((await db.collection('payrollPaymentEvidenceCommands').get()).size).toBe(1);
 });
});

it('records real-source D review and separate adoption, then rejects a stale replacement without applying salary',async()=>{
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 const {seedAttendanceReady}=await import('./fixtures/attendanceReady');
 const second='DIFFERENCE_REVIEWER';
 await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
 await db.doc('employees/'+second).set({id:second,name:'合成差額核對人',role:UserRole.SuperAdmin,accountKind:'system-account'});
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-difference-reviewer'?second:'EMULATOR_ADMIN'}) as any);
 const person=(await db.doc('employees/'+employee.id).get()).data();
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),person,'EMULATOR_ADMIN');
 // Clear-path fixture explicitly records 09:00–17:00 and 480 verified
 // minutes. No break is inferred or subtracted from a nine-hour source.
 await db.doc('clockRecords/C1').set({...card('2026-04-01','09:00','17:00'),id:'C1'});
 await db.doc('dailySchedule/2026-04-01').set({...schedule('2026-04-01','09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 const ready=await seedAttendanceReady(db,{syntheticOnly:true,empId:employee.id,month,proposer:'EMULATOR_ADMIN',reviewer:second,at:'2026-05-02T00:00:00Z',expectedMinutesByDate:{'2026-04-01':480},operationPrefix:'emu-d-attendance'});
 expect(ready.assessment).toMatchObject({inventory:'complete',scan:'current',findings:[],unknowns:[]});
 const inventory={empId:employee.id,month,mode:'none',sourceRefs:['SYNTHETIC-D-INVENTORY'],reason:'合成逐項盤點無其他項目',items:[]};
 const ip=await call('propose-payroll-item-inventory',{inventory,expectedRevision:0,operationId:'emu-d-items-propose'});expect(ip.statusCode,ip.body).toBe(200);
 const ia=await call('review-payroll-item-inventory',{empId:employee.id,month,expectedRevision:1,operationId:'emu-d-items-approve',mode:'approve',reason:'合成第二人盤點核定'},'synthetic-difference-reviewer');expect(ia.statusCode,ia.body).toBe(200);
 const get=await call('get-payroll-difference',{empId:employee.id,month});expect(get.statusCode,get.body).toBe(200);const source=JSON.parse(get.body).source;
 expect(source.status,JSON.stringify(source)).toBe('comparable');expect(source.formalEligibility).toBe('BLOCKED');expect(source.totals.net).not.toBeNull();
 // Each explicit synthetic actual line mirrors this fixture's independently
 // generated source. Production actual values must come from their own records.
 const actual={currency:'TWD',items:source.lines.map((line:any,index:number)=>({sourceCode:line.code,kind:line.kind,amount:line.amount,sourceRefs:['SYNTHETIC-ACTUAL-ROW-'+index],reason:'合成逐項實際帳冊來源'})),netAmount:source.totals.net,sourceRefs:['SYNTHETIC-ACTUAL-NET'],reason:'合成實發帳冊加總來源'};
 const scope={empId:employee.id,month,reason:'合成差額逐項獨立核對'};
 const p=await call('propose-payroll-difference',{...scope,actual,expectedRevision:0,operationId:'emu-d-propose'});expect(p.statusCode,p.body).toBe(200);const proposed=JSON.parse(p.body);expect(proposed.comparison.varianceStatus).toBe('zero');
 const a=await call('review-payroll-difference',{...scope,expectedRevision:proposed.revision,operationId:'emu-d-review',mode:'approve'},'synthetic-difference-reviewer');expect(a.statusCode,a.body).toBe(200);const reviewed=JSON.parse(a.body);expect(reviewed).toMatchObject({status:'reviewed',adoptionStatus:'not-recorded'});
 const adoptedResponse=await call('adopt-payroll-difference',{...scope,expectedRevision:reviewed.revision,operationId:'emu-d-adopt'},'synthetic-difference-reviewer');expect(adoptedResponse.statusCode,adoptedResponse.body).toBe(200);const adopted=JSON.parse(adoptedResponse.body);
 expect(adopted).toMatchObject({status:'adoption-recorded',adoptionScope:'reviewed-comparison-evidence-only',formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});
 expect((await db.collection('payrollDifferenceAdoptions').get()).size).toBe(1);
 const afterAdoption=await call('get-employee-salary',{empId:employee.id,yearMonth:month});expect(afterAdoption.statusCode,afterAdoption.body).toBe(200);
 const formal=JSON.parse(afterAdoption.body).preflight;expect(formal.status).toBe('BLOCKED');
 for(const satisfied of ['PAYROLL_ITEM_REQUIREMENTS','ATTENDANCE_CASE_WORKFLOW','MANUAL_DIFF_APPROVAL'])expect(formal.gaps).not.toContain(satisfied);
 expect(formal.gaps).toContain('PRODUCTION_RECONCILIATION');expect(formal.gaps).toContain('OT_MONTHLY_AND_QUARTER_LIMITS');
 const replacement=await call('propose-payroll-difference',{...scope,actual,expectedRevision:adopted.revision,operationId:'emu-d-replacement'});expect(replacement.statusCode,replacement.body).toBe(200);const staleProposal=JSON.parse(replacement.body);
 await db.doc('clockRecords/C1').update({clockOutTime:'18:00'});
 const stale=await call('review-payroll-difference',{...scope,expectedRevision:staleProposal.revision,operationId:'emu-d-stale-review',mode:'approve'},'synthetic-difference-reviewer');expect(stale.statusCode,stale.body).toBe(409);
 expect((await db.doc('payrollDifferenceHeads/'+proposed.id).get()).data()?.revision).toBe(staleProposal.revision);
 expect((await db.collection('payrollDifferenceAdoptions').get()).size).toBe(1);
 expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('monthLocks').get()).empty).toBe(true);
 expect((await db.doc('employees/'+employee.id).get()).data()).toEqual(person);
});

it('reviews a genuine stored historical run through the real reader without altering its original bytes',async()=>{
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 const {seedAttendanceReady}=await import('./fixtures/attendanceReady');
 const {loadPayrollMonthSource}=await import('../netlify/functions/utils/payrollSourceReader');
 const reviewer='HISTORICAL_REVIEWER';
 await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
 await db.doc('employees/'+reviewer).set({id:reviewer,name:'合成歷史核對人',role:UserRole.SuperAdmin,accountKind:'system-account'});
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-history-reviewer'?reviewer:'EMULATOR_ADMIN'}) as any);
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),(await db.doc('employees/'+employee.id).get()).data(),'EMULATOR_ADMIN');
 await db.doc('clockRecords/C1').set({...card('2026-04-01','09:00','17:00'),id:'C1'});
 await db.doc('dailySchedule/2026-04-01').set({...schedule('2026-04-01','09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 await seedAttendanceReady(db,{syntheticOnly:true,empId:employee.id,month,proposer:'EMULATOR_ADMIN',reviewer,at:'2026-05-02T00:00:00Z',expectedMinutesByDate:{'2026-04-01':480},operationPrefix:'emu-historical-attendance'});
 const inventory={empId:employee.id,month,mode:'none',sourceRefs:['SYNTHETIC-HISTORY-INVENTORY'],reason:'合成歷史盤點無其他項目',items:[]};
 const ip=await call('propose-payroll-item-inventory',{inventory,expectedRevision:0,operationId:'emu-history-items-propose'});expect(ip.statusCode,ip.body).toBe(200);
 const ia=await call('review-payroll-item-inventory',{empId:employee.id,month,expectedRevision:1,operationId:'emu-history-items-review',mode:'approve',reason:'合成第二人盤點核定'},'synthetic-history-reviewer');expect(ia.statusCode,ia.body).toBe(200);
 const live=await db.runTransaction(tx=>loadPayrollMonthSource(db,tx,{month,at:'2026-05-02T00:00:00Z'}));expect(live.kind).toBe('live');if(live.kind!=='live')throw Error('Synthetic live source required');
 expect(live.comparisons[employee.id].status,JSON.stringify(live.comparisons[employee.id])).toBe('comparable');expect(live.evaluation.status).toBe('BLOCKED');
 // Direct synthetic fixture persistence, not production lock authorization. The
 // genuine source inputs/hash and stored salary fields must satisfy the reader.
 const run={...makePayrollRun('SYNTHETIC-HISTORICAL-RUN',month,'2026-05-02T00:00:00Z',live.evaluation.salaries,live.snapshotInputs),sourceEvidence:live.sourceEvidence};
 const lock={yearMonth:month,payrollRunId:run.id,lockedAt:'2026-05-02T00:00:00Z',lockedBy:'EMULATOR_ADMIN',lockedByName:'Synthetic historical fixture',totalAmount:run.salaries.reduce((n,s)=>n+s.grossSalary,0),employeeCount:run.salaries.length};
 await db.doc('payrollRuns/'+run.id).set(run);await db.doc('monthLocks/'+month).set(lock);
 const originalBytes=async()=>JSON.stringify([(await db.doc('payrollRuns/'+run.id).get()).data(),(await db.doc('monthLocks/'+month).get()).data()]);const before=await originalBytes();
 const loaded=await db.runTransaction(tx=>loadPayrollMonthSource(db,tx,{month,at:'2026-05-03T00:00:00Z'}));expect(loaded.kind).toBe('locked');if(loaded.kind!=='locked')throw Error('Real locked reader must accept fixture');expect(loaded.completeness).toBe('complete');expect(loaded.originalInputHash).toBe(run.inputHash);
 const got=await call('get-historical-payroll-difference',{empId:employee.id,month});expect(got.statusCode,got.body).toBe(200);const view=JSON.parse(got.body);expect(view.original.status).toBe('recorded');expect(view.source.status,JSON.stringify(view.source)).toBe('comparable');
 const actual={currency:'TWD',items:view.source.lines.map((line:any,index:number)=>({sourceCode:line.code,kind:line.kind,amount:line.amount,sourceRefs:['SYNTHETIC-HISTORY-LINE-'+index],reason:'合成歷史逐項帳冊'})),netAmount:view.source.totals.net,sourceRefs:['SYNTHETIC-HISTORY-NET'],reason:'合成歷史實發帳冊'};
 const scope={empId:employee.id,month,reason:'合成原始鎖月差額核對'};
 const proposal={...scope,actual,expectedRevision:0,operationId:'emu-history-propose'};
 const p=await call('propose-historical-payroll-difference',proposal);expect(p.statusCode,p.body).toBe(200);const proposed=JSON.parse(p.body);
 // Current employee/card changes must not recompute the frozen historical basis.
 await db.doc('employees/'+employee.id).update({hourlyRate:99999});await db.doc('clockRecords/C1').update({clockOutTime:'18:00'});
 const reviewedResponse=await call('review-historical-payroll-difference',{...scope,expectedRevision:proposed.revision,mode:'approve',operationId:'emu-history-review'},'synthetic-history-reviewer');expect(reviewedResponse.statusCode,reviewedResponse.body).toBe(200);const reviewed=JSON.parse(reviewedResponse.body);
 const adoptCommand={...scope,expectedRevision:reviewed.revision,operationId:'emu-history-adopt'};
 const adoptedResponse=await call('adopt-historical-payroll-difference',adoptCommand,'synthetic-history-reviewer');expect(adoptedResponse.statusCode,adoptedResponse.body).toBe(200);
 expect(JSON.parse(adoptedResponse.body)).toMatchObject({status:'adoption-recorded',formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'not-certified'});
 expect(await originalBytes()).toBe(before);
 await db.doc('employees/'+reviewer).update({role:UserRole.Employee});
 expect((await call('adopt-historical-payroll-difference',adoptCommand,'synthetic-history-reviewer')).statusCode).toBe(403);
 expect(await originalBytes()).toBe(before);expect((await db.collection('payrollRuns').get()).size).toBe(1);expect((await db.collection('historicalPayrollDifferenceAdoptions').get()).size).toBe(1);
});

it.each([false,true])('540-minute overtime classification requires supervisor verification (%s) and never authorises payroll',async verified=>{
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 const {handleAttendancePolicyDeclarationAction}=await import('../netlify/functions/utils/attendancePolicyDeclaration');
 const {handleAttendanceCaseAction}=await import('../netlify/functions/utils/attendanceCaseService');
 const {loadAttendanceCaseInput}=await import('../netlify/functions/utils/attendanceCaseEvidence');
 const {loadAttendanceScanCertificate}=await import('../netlify/functions/utils/attendanceScanStorage');
 const {assessAttendanceMonth}=await import('../netlify/functions/utils/attendanceMonthEvidence');
 const {loadPayrollMonthSource}=await import('../netlify/functions/utils/payrollSourceReader');
 const {detectAttendanceCases}=await import('../netlify/functions/utils/attendanceCaseDetector');
 const reviewer='OVERTIME_EVIDENCE_REVIEWER',at='2026-05-02T00:00:00Z';
 await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
 await db.doc('employees/'+reviewer).set({id:reviewer,role:UserRole.SuperAdmin,accountKind:'system-account'});
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),(await db.doc('employees/'+employee.id).get()).data(),'EMULATOR_ADMIN');
 // The negative case explicitly lacks supervisor verification. Its actual
 // 08:00–17:00 timestamps and 540 recorded minutes are retained, not shortened.
 if(!verified)await db.doc('clockRecords/C1').set({...card('2026-04-01','08:00','17:00',false),id:'C1',workIntervals:[{start:480,end:1020}]});
 await db.doc('dailySchedule/2026-04-01').set({...schedule('2026-04-01','08:00','17:00'),openingHours:'08:00-17:00',requiredHeadcount:1});
 const scope={empId:employee.id,month},get=await handleAttendancePolicyDeclarationAction(db,'EMULATOR_ADMIN','get-attendance-policy-declaration',scope);
 const proposed=await handleAttendancePolicyDeclarationAction(db,'EMULATOR_ADMIN','propose-attendance-policy-declaration',{...scope,expectedRevision:0,operationId:'emu-540-propose',reason:'合成九小時實際工作證據',closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,workDifferenceTolerance:0,expectedWorkByDate:Object.fromEntries(get.scheduleTargets.map((t:any)=>[t.date,{minutes:540,scheduleVersion:t.scheduleVersion}]))});
 await handleAttendancePolicyDeclarationAction(db,reviewer,'review-attendance-policy-declaration',{...scope,expectedRevision:proposed.revision,operationId:'emu-540-review',reason:'合成獨立九小時來源核對',mode:'approve'});
 await handleAttendanceCaseAction(db,reviewer,'scan-attendance-cases',{empId:employee.id,yearMonth:month},()=>new Date(at));
 const reader={get:(ref:any)=>ref.get()},input=await loadAttendanceCaseInput(db,reader,employee.id,month,at),certificate=await loadAttendanceScanCertificate(db,reader,scope);
 const cases=(await db.collection('attendanceCases').where('empId','==',employee.id).get()).docs.map(d=>({...d.data(),id:d.id}));
 const assessed=assessAttendanceMonth({...scope,input,cases,certificate:certificate.certificate,explanationDigest:input.explanationInventory?.sourceDigest});
 expect(assessed.inventory).toBe('complete');expect(assessed.scan).toBe('current');
 const overtime=detectAttendanceCases(input).observations.find(o=>o.type==='hours-difference'&&o.anchor==='overtime-candidate:2026-04-01');
 expect(overtime).toMatchObject({outcome:verified?'clear':'unknown',payrollDecision:'none'});
 if(verified){expect(input.overtimeClassification).toMatchObject({status:'classified',formalEligibility:'BLOCKED'});expect(overtime?.reason).toContain('不代表法定加班授權');}
 else{expect(input.overtimeClassification?.status).toBe('unknown');expect(assessed.unknowns).toEqual(expect.arrayContaining([expect.objectContaining({type:'hours-difference',anchor:'overtime-candidate:2026-04-01',outcome:'unknown'})]));expect((await db.doc('clockRecords/C1').get()).data()?.workReview).toBeUndefined();}
 const source=await db.runTransaction(tx=>loadPayrollMonthSource(db,tx,{month,at}));expect(source.kind).toBe('live');if(source.kind!=='live')throw Error('Synthetic live source required');
 expect(source.comparisons[employee.id].status).toBe('needs-review');expect(source.evaluation.status).toBe('BLOCKED');
 expect((await db.doc('clockRecords/C1').get()).data()?.workIntervals).toEqual([{start:480,end:1020}]);
 expect((await db.collection('payrollRuns').get()).empty).toBe(true);
});

it('worktime declaration real SDK approval preserves immutable facts and rejects locked writes and demoted receipt replay',async()=>{
 const {loadWorktimeDeclarationEvidence}=await import('../netlify/functions/utils/worktimeDeclarations');
 const reviewer='EMU_WORKTIME_REVIEWER';
 await db.doc('employees/'+reviewer).set({id:reviewer,role:UserRole.SuperAdmin,accountKind:'system-account',hireDate:'2020-01-01'});
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-worktime-reviewer'?reviewer:token==='synthetic-employee'?employee.id:'EMULATOR_ADMIN'}) as any);
 const scope={empId:employee.id,month};
 const declaration={regime:'standard-8-40',weekStartsOn:0,headcount:12,unionExists:false,overtimeMode:'46',cycle:null,rotation:'not-rotating',rotationRest:'unknown',exception:'none',sourceRefs:['SYNTH-WORKTIME-REGISTER'],authorities:[{purpose:'regime',authorityOccurredAt:'2026-03-01T09:15:32.125+08:00',effectiveFrom:'2026-04-01',effectiveTo:'2026-04-30',sourceRefs:['SYNTH-REGIME-EVENT'],reason:'Synthetic recorded regime event; other legal evidence unresolved'}]};
 const proposal={...scope,expectedRevision:0,operationId:'emu-worktime-propose',reason:'Synthetic factual declaration',declaration};
 const proposed=await call('propose-worktime-declaration',proposal);expect(proposed.statusCode,proposed.body).toBe(200);const p=JSON.parse(proposed.body);
 const approval={...scope,expectedRevision:1,operationId:'emu-worktime-review',mode:'approve',reason:'Independent synthetic document facts review'};
 expect((await call('review-worktime-declaration',approval)).statusCode).toBe(403);
 expect((await call('get-worktime-declaration',{...scope,empId:'OTHER'},'synthetic-employee')).statusCode).toBe(403);
 const reviewed=await call('review-worktime-declaration',approval,'synthetic-worktime-reviewer');expect(reviewed.statusCode,reviewed.body).toBe(200);const a=JSON.parse(reviewed.body);
 expect(a).toMatchObject({revision:2,status:'approved',recordApprovedBy:reviewer,approvalScope:'recorded-declaration-only',activationStatus:'not-activated',formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'unresolved'});
 const loaded=await db.runTransaction(tx=>loadWorktimeDeclarationEvidence(db,tx,employee.id,month));
 expect(loaded.approved).toEqual(a);expect(loaded.source?.revision).toBe(2);expect(loaded.issues).toContain('classified-source-history-not-assessed');expect(loaded.issues).toContain('work-rules-evidence-unknown');
 expect(a.declaration.authorities[0].authorityOccurredAt).toBe(declaration.authorities[0].authorityOccurredAt);
 const versionRef=db.doc('worktimeDeclarationVersions/'+p.id+'_1'),original=(await versionRef.get()).data();
 const syntheticLock={yearMonth:month,lockedAt:'2026-05-02T00:00:00Z',lockedBy:'EMULATOR_ADMIN'};
 await db.doc('monthLocks/'+month).set(syntheticLock);
 expect((await call('propose-worktime-declaration',{...proposal,expectedRevision:2,operationId:'emu-worktime-after-lock'})).statusCode).toBe(423);
 const replay=await call('review-worktime-declaration',approval,'synthetic-worktime-reviewer');expect(replay.statusCode,replay.body).toBe(200);expect(JSON.parse(replay.body)).toEqual(a);
 await db.doc('employees/'+reviewer).update({role:UserRole.Employee});
 expect((await call('review-worktime-declaration',approval,'synthetic-worktime-reviewer')).statusCode).toBe(403);
 expect((await db.collection('worktimeDeclarationVersions').get()).size).toBe(2);expect((await db.collection('worktimeDeclarationCommands').get()).size).toBe(2);
 expect((await versionRef.get()).data()).toEqual(original);expect((await db.doc('worktimeDeclarations/'+p.id).get()).data()).toEqual(a);expect((await db.doc('monthLocks/'+month).get()).data()).toEqual(syntheticLock);
 expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('notifications').get()).empty).toBe(true);
});

it('joins approved actual payment allocation to canonical tax, D comparison and blocked production lock with real SDK transactions',async()=>{
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 const {seedAttendanceReady}=await import('./fixtures/attendanceReady');
 const {loadPayrollPreWithholdingSource}=await import('../netlify/functions/utils/payrollPreWithholdingSource');
 const reviewer='EMU_ALLOCATION_REVIEWER',scope={empId:employee.id,month};
 await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
 await db.doc('employees/'+reviewer).set({id:reviewer,role:UserRole.SuperAdmin,accountKind:'system-account'});
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-allocation-reviewer'?reviewer:'EMULATOR_ADMIN'}) as any);
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),(await db.doc('employees/'+employee.id).get()).data(),'EMULATOR_ADMIN');
 const master=(await db.doc('payrollMasterVersions/CANON_MASTER').get()).data()!;
 await db.doc('payrollMasterVersions/CANON_MASTER').set({...master,timeline:{...master.timeline,periods:master.timeline.periods.map((p:any)=>({...p,amount:4000}))}});
 const ins=(await db.doc('insuranceTimelineVersions/CANON_INS').get()).data()!;
 await db.doc('insuranceTimelineVersions/CANON_INS').set({...ins,periods:ins.periods.map((p:any)=>({...p,withholdingMethod:'part-time-5'}))});
 await db.doc('clockRecords/C1').set({...card('2026-04-01','09:00','17:00'),id:'C1'});
 await db.doc('dailySchedule/2026-04-01').set({...schedule('2026-04-01','09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 await seedAttendanceReady(db,{syntheticOnly:true,...scope,proposer:'EMULATOR_ADMIN',reviewer,at:'2026-05-02T00:00:00Z',expectedMinutesByDate:{'2026-04-01':480},operationPrefix:'emu-allocation-attendance'});
 const inventory={...scope,mode:'none',sourceRefs:['SYNTH-ALLOCATION-ITEMS'],reason:'Synthetic no additional items',items:[]};
 const ip=await call('propose-payroll-item-inventory',{inventory,expectedRevision:0,operationId:'emu-allocation-items'});expect(ip.statusCode,ip.body).toBe(200);
 const ia=await call('review-payroll-item-inventory',{...scope,expectedRevision:1,operationId:'emu-allocation-items-review',mode:'approve',reason:'Independent synthetic item review'},'synthetic-allocation-reviewer');expect(ia.statusCode,ia.body).toBe(200);
 const upstream=await db.runTransaction(tx=>loadPayrollPreWithholdingSource(db,tx,{...scope,at:'2026-05-02T00:00:00Z'}));expect(upstream.source?.status,JSON.stringify(upstream)).toBe('ready');expect(upstream.source?.earnings.find(e=>e.code==='normal')?.amount).toBe('32000');
 const event={id:'SYNTH-TRANSFER-1',evidenceLocator:'ROW-1',paidOn:'2026-05-02',amount:'31325',sourceRefs:['SYNTH-TRANSFER-STATEMENT'],reason:'Synthetic actual salary transfer',incomeClassification:'salary-nonmonthly',insuredCategory:'other',exemption:{kind:'none',from:'2026-05-01',to:'2026-05-31',sourceRefs:['SYNTH-NO-EXEMPTION']}};
 const payment={...scope,mode:'events',sourceRefs:['SYNTH-TRANSFER-INVENTORY'],reason:'Synthetic complete payment inventory',events:[event]};
 const pp=await call('propose-payroll-payment-evidence',{inventory:payment,expectedRevision:0,operationId:'emu-payment-facts'});expect(pp.statusCode,pp.body).toBe(200);expect(JSON.parse(pp.body).sourceBinding.net).toBeNull();
 const pa=await call('review-payroll-payment-evidence',{...scope,expectedRevision:1,operationId:'emu-payment-facts-review',mode:'approve',reason:'Independent actual payment facts review'},'synthetic-allocation-reviewer');expect(pa.statusCode,pa.body).toBe(200);
 const originalPayment=JSON.parse(pa.body);
 const allocation={...scope,sourceRefs:['SYNTH-PAYROLL-REGISTER'],reason:'Synthetic complete event allocation',events:[{paymentEventId:event.id,earnings:upstream.source!.earnings.map(({code,amount})=>({code,amount})),taxExemptOvertime:'0',pensionSelf:'0',otherDeductions:upstream.source!.otherDeductions.map(({code,amount})=>({code,amount})),actualIncomeTax:'0',actualSupplementaryPremium:'675',sourceRefs:['SYNTH-REGISTER-ROW-1'],reason:'Synthetic exact gross and deduction allocation'}]};
 const proposed=await call('propose-payroll-payment-allocation',{...scope,allocation,expectedRevision:0,operationId:'emu-allocation-propose',reason:'Synthetic allocation proposal'});expect(proposed.statusCode,proposed.body).toBe(200);
 expect(JSON.parse(proposed.body).assessment).toMatchObject({status:'ready-calculation',reconciliationStatus:'zero',totals:{calculatedIncomeTax:0,calculatedSupplementaryPremium:675,expectedNet:'31325'}});
 const approve={...scope,expectedRevision:1,operationId:'emu-allocation-review',mode:'approve',reason:'Independent exact allocation review'};
 expect((await call('review-payroll-payment-allocation',approve)).statusCode).toBe(403);
 const approved=await call('review-payroll-payment-allocation',approve,'synthetic-allocation-reviewer');expect(approved.statusCode,approved.body).toBe(200);
 const salaryResponse=await call('get-employee-salary',{empId:employee.id,yearMonth:month});expect(salaryResponse.statusCode,salaryResponse.body).toBe(200);
 const salary=JSON.parse(salaryResponse.body);expect(salary).toMatchObject({calculationStatus:'ready',grossSalary:32000,incomeTax:0,supplementaryPremium:675,netSalary:31325});expect(salary.preflight.status).toBe('BLOCKED');
 const d=await call('get-payroll-difference',scope);expect(d.statusCode,d.body).toBe(200);expect(JSON.parse(d.body).source).toMatchObject({status:'comparable',totals:{gross:'32000',net:'31325'}});
 expect((await db.doc('payrollPaymentEvidence/'+originalPayment.id).get()).data()).toEqual(originalPayment);
 const actualGate=await vi.importActual<typeof import('../netlify/functions/utils/payrollPreflight')>('../netlify/functions/utils/payrollPreflight');vi.mocked(assertPayrollReady).mockImplementation(actualGate.assertPayrollReady);
 const locked=await call('lock-month',{yearMonth:month});expect(locked.statusCode,locked.body).toBe(409);expect((await db.collection('payrollRuns').get()).empty).toBe(true);
 await db.doc('payrollMasterVersions/CANON_MASTER').set({...master,timeline:{...master.timeline,periods:master.timeline.periods.map((p:any)=>({...p,amount:4100}))}});
 const stale=await call('get-payroll-payment-allocation',scope);expect(stale.statusCode,stale.body).toBe(200);expect(JSON.parse(stale.body)).toMatchObject({sourceAvailable:false,stale:true});
 const held=await call('get-employee-salary',{empId:employee.id,yearMonth:month});expect(held.statusCode,held.body).toBe(200);expect(JSON.parse(held.body).netSalary).toBeNull();
 expect((await db.doc('payrollPaymentEvidence/'+originalPayment.id).get()).data()).toEqual(originalPayment);expect((await db.collection('notifications').get()).empty).toBe(true);
});

it('builds worktime checks from real approved multi-month sources and closes only evidenced formal prerequisites',async()=>{
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 const {seedAttendanceReady}=await import('./fixtures/attendanceReady');
 const {normalDays}=await import('./fixtures/normalPay');
 const {employeePayrollSourceKey}=await import('../netlify/functions/utils/payrollReviewStorage');
 const reviewer='EMU_HISTORY_REVIEWER',scope={empId:employee.id,month};
 await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
 const person=(await db.doc('employees/'+employee.id).get()).data();
 await db.doc('employees/'+reviewer).set({id:reviewer,role:UserRole.SuperAdmin,accountKind:'system-account'});
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-history-source-reviewer'?reviewer:'EMULATOR_ADMIN'}) as any);
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),person,'EMULATOR_ADMIN');
 const master=(await db.doc('payrollMasterVersions/CANON_MASTER').get()).data()!,period=master.timeline.periods.at(-1);
 await db.doc('payrollMasterVersions/CANON_MASTER').set({...master,timeline:{...master.timeline,from:'2026-01-01',to:'2026-06-30',periods:[{...period,from:'2026-01-01',to:'2026-06-30',employmentState:'active'}]}});
 await db.doc('payrollPolicyVersions/CANON_POLICY').update({from:'2026-01-01',to:'2026-06-30'});
 // Explicit synthetic personal designations, not facility closure or preferences.
 const days=Object.fromEntries(['01','02','03','04','05','06'].flatMap(m=>normalDays('2026-'+m)).map(d=>{const weekday=new Date(d.date+'T00:00:00Z').getUTCDay();return [d.date,weekday===0?'regular-holiday':weekday===6?'rest':'normal'];}));
 await db.doc('dayTypeCalendars/CANON_DAYS').update({days});
 for(const m of ['2026-03','2026-05'])await db.doc('payrollReviews/'+employee.id+'_'+m).set({empId:employee.id,yearMonth:m,review:{...review,yearMonth:m,policy:{...review.policy,regularDates:[]}},employeeSourceKey:employeePayrollSourceKey(person),masterVersionId:'CANON_MASTER'});
 await db.doc('clockRecords/C1').set({...card('2026-04-01','09:00','17:00'),id:'C1'});
 await db.doc('dailySchedule/2026-04-01').set({...schedule('2026-04-01','09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 // Each active hourly month has explicit verified work; an empty monthly
 // interval list is deliberately not treated as approved zero-work payroll.
 for(const date of ['2026-03-23','2026-05-04']){
  const id='HISTORY-'+date;await db.doc('clockRecords/'+id).set({...card(date,'09:00','17:00'),id});
  await db.doc('dailySchedule/'+date).set({...schedule(date,'09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 }
 const historyTargets:Record<string,Record<string,number>>={'2026-03':{'2026-03-23':480},[month]:{'2026-04-01':480},'2026-05':{'2026-05-04':480}};
 for(const m of ['2026-03',month,'2026-05'])await seedAttendanceReady(db,{syntheticOnly:true,empId:employee.id,month:m,proposer:'EMULATOR_ADMIN',reviewer,at:'2026-07-01T00:00:00Z',expectedMinutesByDate:historyTargets[m],operationPrefix:'emu-work-history-'+m});
 const authorities=['regime','collective-overtime','individual-overtime','rotation-applicability'].map(purpose=>({purpose,authorityOccurredAt:'2025-12-01T09:00:00+08:00',effectiveFrom:'2026-01-01',effectiveTo:'2026-06-30',sourceRefs:['SYNTH-AUTH-'+purpose],reason:'Synthetic original timely authority',...(purpose==='collective-overtime'?{consentBody:'labor-management'}:{})}));
 const declaration={regime:'standard-8-40',weekStartsOn:0,headcount:12,unionExists:false,overtimeMode:'46',cycle:null,rotation:'not-rotating',rotationRest:'unknown',exception:'none',sourceRefs:['SYNTH-WORKTIME-REGIME'],authorities,workRules:{status:'recorded',basis:'below-30-recorded-terms',documentState:'effective',versionRef:'SYNTH-TERMS-1',authorityOccurredAt:'2025-12-01T09:00:00+08:00',effectiveFrom:'2026-01-01',effectiveTo:'2026-06-30',sourceRefs:['SYNTH-TERMS-SOURCE'],reason:'Synthetic effective recorded employment terms'}};
 const p=await call('propose-worktime-declaration',{...scope,declaration,expectedRevision:0,operationId:'emu-work-history-declare',reason:'Synthetic complete worktime declaration'});expect(p.statusCode,p.body).toBe(200);
 const a=await call('review-worktime-declaration',{...scope,expectedRevision:1,operationId:'emu-work-history-review',mode:'approve',reason:'Synthetic independent history and authority review'},'synthetic-history-source-reviewer');expect(a.statusCode,a.body).toBe(200);
 const checked=await call('get-worktime-assessment',scope);expect(checked.statusCode,checked.body).toBe(200);const evidence=JSON.parse(checked.body);
 expect(evidence.status,JSON.stringify(evidence)).toBe('within-checked-limits');expect(evidence.input).toBeUndefined();expect(evidence.checks).toHaveLength(6);expect(evidence.checks.every((c:any)=>c.status==='within-checked-limits')).toBe(true);expect(evidence.workRules.status).toBe('recorded-applicable');
 const salary=await call('get-employee-salary',{empId:employee.id,yearMonth:month});expect(salary.statusCode,salary.body).toBe(200);const preflight=JSON.parse(salary.body).preflight;
 for(const code of ['OT_MONTHLY_AND_QUARTER_LIMITS','OT_ROTATION_AND_CONSECUTIVE_REST','OT_REGIME_AND_EXCEPTION_AUTHORIZATION','EFFECTIVE_WORK_RULES_REVIEW'])expect(preflight.gaps).not.toContain(code);
 expect(preflight.status).toBe('BLOCKED');expect(preflight.gaps).toContain('PRODUCTION_RECONCILIATION');expect(preflight.gaps).toContain('MANUAL_DIFF_APPROVAL');
 await db.doc('clockRecords/C1').update({clockOutTime:'18:00'});
 const changed=await call('get-worktime-assessment',scope);expect(changed.statusCode,changed.body).toBe(200);expect(JSON.parse(changed.body).status).toBe('needs-review');
 expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('monthLocks').get()).empty).toBe(true);expect((await db.collection('notifications').get()).empty).toBe(true);
});

it('executes fixed items and accounts for a real nonzero payment difference without rewriting cash facts',async()=>{
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 const {seedAttendanceReady}=await import('./fixtures/attendanceReady');
 const {ITEM_TREATMENT_PURPOSES}=await import('../utils/payroll/itemTreatment');
 const {loadPayrollPreWithholdingSource}=await import('../netlify/functions/utils/payrollPreWithholdingSource');
 const reviewer='EMU_ITEM_REVIEWER',poster='EMU_ADJUSTMENT_REVIEWER',scope={empId:employee.id,month};
 await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
 for(const id of [reviewer,poster])await db.doc('employees/'+id).set({id,role:UserRole.SuperAdmin,accountKind:'system-account'});
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-item-reviewer'?reviewer:token==='synthetic-adjustment-reviewer'?poster:token==='synthetic-employee'?employee.id:'EMULATOR_ADMIN'}) as any);
 const ok=async(action:string,data:any={},token?:string)=>{const r=await call(action,data,token);expect(r.statusCode,action+': '+r.body).toBe(200);return JSON.parse(r.body);};
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),(await db.doc('employees/'+employee.id).get()).data(),'EMULATOR_ADMIN');
 const master=(await db.doc('payrollMasterVersions/CANON_MASTER').get()).data()!;
 await db.doc('payrollMasterVersions/CANON_MASTER').set({...master,timeline:{...master.timeline,periods:master.timeline.periods.map((p:any)=>({...p,amount:4000}))}});
 const ins=(await db.doc('insuranceTimelineVersions/CANON_INS').get()).data()!;
 await db.doc('insuranceTimelineVersions/CANON_INS').set({...ins,periods:ins.periods.map((p:any)=>({...p,withholdingMethod:'part-time-5'}))});
 await db.doc('clockRecords/C1').set({...card('2026-04-01','09:00','17:00'),id:'C1'});
 await db.doc('dailySchedule/2026-04-01').set({...schedule('2026-04-01','09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 await seedAttendanceReady(db,{syntheticOnly:true,...scope,proposer:'EMULATOR_ADMIN',reviewer,at:'2026-05-02T00:00:00Z',expectedMinutesByDate:{'2026-04-01':480},operationPrefix:'emu-items-adjustment-attendance'});
 const items=[{itemCode:'ALLOWANCE',kind:'earning',amount:'1000',from:'2026-04-01',to:'2026-04-30',sourceRefs:['SYNTH-ALLOWANCE'],reason:'Synthetic fixed taxable allowance'},{itemCode:'AUTHORIZED_DEDUCTION',kind:'deduction',amount:'100',from:'2026-04-01',to:'2026-04-30',sourceRefs:['SYNTH-DEDUCTION'],reason:'Synthetic authorized fixed posttax deduction'}];
 const inventory={...scope,mode:'items',sourceRefs:['SYNTH-ITEM-REGISTER'],reason:'Synthetic complete fixed item inventory',items};
 await ok('propose-payroll-item-inventory',{inventory,expectedRevision:0,operationId:'emu-items-inventory'});
 await ok('review-payroll-item-inventory',{...scope,expectedRevision:1,operationId:'emu-items-inventory-review',mode:'approve',reason:'Independent fixed item evidence review'},'synthetic-item-reviewer');
 const initial=await ok('get-payroll-item-execution',scope);
 const policy={sourceRefs:['SYNTH-ITEM-EXECUTION'],reason:'Synthetic explicit supported item recipes',items:items.map(item=>({itemCode:item.itemCode,recipe:item.kind==='earning'?'fixed-taxable-earning':'fixed-posttax-deduction',normalWage:'excluded-by-reviewed-evidence',incomeTax:item.kind==='earning'?'included':'not-applicable',supplementaryPremium:item.kind==='earning'?'included':'not-applicable',insuranceReporting:item.kind==='earning'?'confirmed-timeline':'not-applicable',deductionAuthority:item.kind==='earning'?'not-applicable':'authorized',reason:'Synthetic documented fixed amount treatment',evidence:ITEM_TREATMENT_PURPOSES.map(purpose=>({purpose,status:'documented',sourceRefs:['SYNTH-'+item.itemCode+'-'+purpose],reason:'Synthetic documented governing source',authorityOccurredAt:'2026-03-01T09:00:00+08:00',effectiveFrom:'2026-04-01',effectiveTo:'2026-04-30'}))}))};
 await ok('propose-payroll-item-execution',{...scope,expectedRevision:0,operationId:'emu-items-execution',reason:'Synthetic execution proposal',inventoryBinding:initial.inventoryBinding,policy});
 const execution=await ok('review-payroll-item-execution',{...scope,expectedRevision:1,operationId:'emu-items-execution-review',mode:'approve',reason:'Independent typed recipe review'},'synthetic-item-reviewer');
 expect(execution.assessment).toMatchObject({status:'ready',earningsExact:{numerator:'1000',denominator:'1'},deductionsExact:{numerator:'100',denominator:'1'}});
 const upstream=await db.runTransaction(tx=>loadPayrollPreWithholdingSource(db,tx,{...scope,at:'2026-05-02T00:00:00Z'}));
 expect(upstream.source?.status,JSON.stringify(upstream)).toBe('ready');
 expect(upstream.source!.earnings.reduce((sum,e)=>sum+Number(e.amount),0)).toBe(33000);expect(upstream.source!.otherDeductions.reduce((sum,e)=>sum+Number(e.amount),0)).toBe(100);
 const event={id:'SYNTH-CASH-ITEMS',evidenceLocator:'ROW-ITEMS',paidOn:'2026-05-02',amount:'32104',sourceRefs:['SYNTH-BANK-ITEMS'],reason:'Synthetic actual historical cash transfer',incomeClassification:'salary-nonmonthly',insuredCategory:'other',exemption:{kind:'none',from:'2026-05-01',to:'2026-05-31',sourceRefs:['SYNTH-ELIGIBILITY-ITEMS']}};
 await ok('propose-payroll-payment-evidence',{inventory:{...scope,mode:'events',sourceRefs:['SYNTH-CASH-REGISTER'],reason:'Synthetic complete actual cash facts',events:[event]},expectedRevision:0,operationId:'emu-items-cash'});
 const cash=await ok('review-payroll-payment-evidence',{...scope,expectedRevision:1,operationId:'emu-items-cash-review',mode:'approve',reason:'Independent actual cash fact review'},'synthetic-item-reviewer');
 const allocation={...scope,sourceRefs:['SYNTH-ALLOCATION-ITEMS'],reason:'Synthetic documented actual deductions',events:[{paymentEventId:event.id,earnings:upstream.source!.earnings.map(({code,amount})=>({code,amount})),taxExemptOvertime:'0',pensionSelf:'0',otherDeductions:upstream.source!.otherDeductions.map(({code,amount})=>({code,amount})),actualIncomeTax:'100',actualSupplementaryPremium:'696',sourceRefs:['SYNTH-ACTUAL-DEDUCTIONS'],reason:'Synthetic recorded tax differs from computed obligation'}]};
 await ok('propose-payroll-payment-allocation',{...scope,allocation,expectedRevision:0,operationId:'emu-items-allocation',reason:'Synthetic allocation proposal'});
 const allocated=await ok('review-payroll-payment-allocation',{...scope,expectedRevision:1,operationId:'emu-items-allocation-review',mode:'approve',reason:'Independent actual deductions review'},'synthetic-item-reviewer');
 expect(allocated.assessment).toMatchObject({status:'ready-calculation',reconciliationStatus:'nonzero',totals:{calculatedIncomeTax:0,actualIncomeTax:'100',calculatedSupplementaryPremium:696,expectedNet:'32204'}});
 const paymentDocuments=async()=>{const result:any[]=[];for(const name of ['payrollPaymentEvidence','payrollPaymentEvidenceVersions','payrollPaymentAllocations','payrollPaymentAllocationVersions']){const snap=await db.collection(name).get();result.push(...snap.docs.map(doc=>({path:doc.ref.path,value:doc.data()})));}return JSON.stringify(result.sort((a,b)=>a.path.localeCompare(b.path)));};
 const originalPaymentDocuments=await paymentDocuments();
 const originalCash=JSON.stringify((await db.doc('payrollPaymentEvidence/'+cash.id).get()).data());
 const originalAllocation=JSON.stringify((await db.doc('payrollPaymentAllocations/'+allocated.id).get()).data());
 const readSalary=()=>ok('get-employee-salary',{empId:employee.id,yearMonth:month});
 const salary=await readSalary();expect(salary).toMatchObject({grossSalary:33000,incomeTax:0,supplementaryPremium:696,netSalary:32204});expect(salary.preflight.status).toBe('BLOCKED');
 const difference=await ok('get-payroll-difference',scope);expect(difference.source).toMatchObject({status:'comparable',totals:{gross:'33000',net:'32204'}});
 const actual={currency:'TWD',items:difference.source.lines.map((line:any)=>({sourceCode:line.code,kind:line.kind,amount:line.code==='tax:income'?'100':line.amount,sourceRefs:['SYNTH-ACTUAL-REGISTER'],reason:'Synthetic actual recorded line'})),netAmount:'32104',sourceRefs:['SYNTH-ACTUAL-REGISTER'],reason:'Synthetic actual cash and deductions baseline'};
 expect(actual.items.find((line:any)=>line.sourceCode==='tax:income')?.amount).toBe('100');
 const mismatched={...actual,netAmount:'32204',items:actual.items.map((line:any)=>line.sourceCode==='tax:income'?{...line,amount:'0'}:line)};
 expect((await call('propose-payroll-difference',{...scope,actual:mismatched,expectedRevision:0,operationId:'emu-items-bad-baseline',reason:'Synthetic contradictory baseline must reject'})).statusCode).toBe(409);
 const dp=await ok('propose-payroll-difference',{...scope,actual,expectedRevision:0,operationId:'emu-items-difference',reason:'Synthetic nonzero actual comparison'});
 await ok('review-payroll-difference',{...scope,expectedRevision:dp.revision,operationId:'emu-items-difference-review',mode:'approve',reason:'Independent nonzero difference review'},'synthetic-item-reviewer');
 const adjustmentScope={...scope,scope:'current'};
 const candidate=await ok('get-payroll-adjustment',adjustmentScope);expect(candidate.candidate,JSON.stringify(candidate.candidateIssues)).toBeTruthy();expect(candidate.candidate.projection.outstanding.net).toBe('100');
 let adjustment=await ok('propose-payroll-adjustment',{...adjustmentScope,expectedRevision:0,operationId:'emu-items-adjustment-propose',postingMonth:'2026-06',comparisonRef:candidate.candidate.comparisonRef,sourceRefs:['SYNTH-ADJUSTMENT-REGISTER'],reason:'Synthetic explicit accounting adjustment'});
 for(const [action,operationId,mode] of [['review-payroll-adjustment','emu-items-adjustment-review','approve'],['adopt-payroll-adjustment','emu-items-adjustment-adopt',null],['apply-payroll-adjustment','emu-items-adjustment-apply',null]] as const){adjustment=await ok(action,{...adjustmentScope,expectedRevision:adjustment.revision,operationId,reason:'Independent synthetic accounting action',...(mode?{mode}:{})},'synthetic-adjustment-reviewer');}
 expect(adjustment.status).toBe('applied');
 const accounted=await ok('get-payroll-adjustment',adjustmentScope);expect(accounted.projection).toMatchObject({recordedActualNet:'32104',cumulativeAdjustments:{net:'100'},accountedTarget:{net:'32204'},outstanding:{net:'0'}});expect(accounted.runs).toHaveLength(1);expect(accounted.paymentStatus).toBe('not-paid');
 const after=await readSalary();expect(after).toMatchObject({baseSalary:salary.baseSalary,grossSalary:33000,incomeTax:0,supplementaryPremium:696,netSalary:32204,adjustmentEvidence:{status:'verified',scopes:{current:{projection:{recordedActualNet:'32104',cumulativeAdjustments:{net:'100'},accountedTarget:{net:'32204'}}}}}});expect(after.preflight.status).toBe('BLOCKED');
 expect(JSON.stringify((await db.doc('payrollPaymentEvidence/'+cash.id).get()).data())).toBe(originalCash);expect(JSON.stringify((await db.doc('payrollPaymentAllocations/'+allocated.id).get()).data())).toBe(originalAllocation);
 expect(await paymentDocuments()).toBe(originalPaymentDocuments);
 expect((await db.collection('payrollAdjustmentRuns').get()).size).toBe(1);expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('monthLocks').get()).empty).toBe(true);expect((await db.collection('notifications').get()).empty).toBe(true);
});


// Full synthetic formal prerequisites, using real proposal/review/scan services.
// The accounting month has one paid employee; all managers are explicit system accounts.
async function seedReconciliableSdkMonth(){
 const {seedMasterPayroll}=await import('./fixtures/masterPayroll');
 const {seedAttendanceReady}=await import('./fixtures/attendanceReady');
 const {normalDays}=await import('./fixtures/normalPay');
 const {employeePayrollSourceKey}=await import('../netlify/functions/utils/payrollReviewStorage');
 const reviewer='EMU_HISTORY_REVIEWER',scope={empId:employee.id,month};
 await db.doc('employees/'+employee.id).update({role:UserRole.Employee});
 const person=(await db.doc('employees/'+employee.id).get()).data();
 await db.doc('employees/'+reviewer).set({id:reviewer,role:UserRole.SuperAdmin,accountKind:'system-account'});
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:token==='synthetic-history-source-reviewer'?reviewer:'EMULATOR_ADMIN'}) as any);
 await seedMasterPayroll((path,value)=>db.doc(path).set(value).then(()=>{}),person,'EMULATOR_ADMIN');
 const master=(await db.doc('payrollMasterVersions/CANON_MASTER').get()).data()!,period=master.timeline.periods.at(-1);
 await db.doc('payrollMasterVersions/CANON_MASTER').set({...master,timeline:{...master.timeline,from:'2026-01-01',to:'2026-06-30',periods:[{...period,from:'2026-01-01',to:'2026-06-30',employmentState:'active'}]}});
 await db.doc('payrollPolicyVersions/CANON_POLICY').update({from:'2026-01-01',to:'2026-06-30'});
 // Explicit synthetic personal designations, not facility closure or preferences.
 const days=Object.fromEntries(['01','02','03','04','05','06'].flatMap(m=>normalDays('2026-'+m)).map(d=>{const weekday=new Date(d.date+'T00:00:00Z').getUTCDay();return [d.date,weekday===0?'regular-holiday':weekday===6?'rest':'normal'];}));
 await db.doc('dayTypeCalendars/CANON_DAYS').update({days});
 for(const m of ['2026-03','2026-05'])await db.doc('payrollReviews/'+employee.id+'_'+m).set({empId:employee.id,yearMonth:m,review:{...review,yearMonth:m,policy:{...review.policy,regularDates:[]}},employeeSourceKey:employeePayrollSourceKey(person),masterVersionId:'CANON_MASTER'});
 await db.doc('clockRecords/C1').set({...card('2026-04-01','09:00','17:00'),id:'C1'});
 await db.doc('dailySchedule/2026-04-01').set({...schedule('2026-04-01','09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 // Each active hourly month has explicit verified work; an empty monthly
 // interval list is deliberately not treated as approved zero-work payroll.
 for(const date of ['2026-03-23','2026-05-04']){
  const id='HISTORY-'+date;await db.doc('clockRecords/'+id).set({...card(date,'09:00','17:00'),id});
  await db.doc('dailySchedule/'+date).set({...schedule(date,'09:00','17:00'),openingHours:'09:00-17:00',requiredHeadcount:1});
 }
 const historyTargets:Record<string,Record<string,number>>={'2026-03':{'2026-03-23':480},[month]:{'2026-04-01':480},'2026-05':{'2026-05-04':480}};
 for(const m of ['2026-03',month,'2026-05'])await seedAttendanceReady(db,{syntheticOnly:true,empId:employee.id,month:m,proposer:'EMULATOR_ADMIN',reviewer,at:'2026-07-01T00:00:00Z',expectedMinutesByDate:historyTargets[m],operationPrefix:'emu-work-history-'+m});
 const authorities=['regime','collective-overtime','individual-overtime','rotation-applicability'].map(purpose=>({purpose,authorityOccurredAt:'2025-12-01T09:00:00+08:00',effectiveFrom:'2026-01-01',effectiveTo:'2026-06-30',sourceRefs:['SYNTH-AUTH-'+purpose],reason:'Synthetic original timely authority',...(purpose==='collective-overtime'?{consentBody:'labor-management'}:{})}));
 const declaration={regime:'standard-8-40',weekStartsOn:0,headcount:12,unionExists:false,overtimeMode:'46',cycle:null,rotation:'not-rotating',rotationRest:'unknown',exception:'none',sourceRefs:['SYNTH-WORKTIME-REGIME'],authorities,workRules:{status:'recorded',basis:'below-30-recorded-terms',documentState:'effective',versionRef:'SYNTH-TERMS-1',authorityOccurredAt:'2025-12-01T09:00:00+08:00',effectiveFrom:'2026-01-01',effectiveTo:'2026-06-30',sourceRefs:['SYNTH-TERMS-SOURCE'],reason:'Synthetic effective recorded employment terms'}};
 const p=await call('propose-worktime-declaration',{...scope,declaration,expectedRevision:0,operationId:'emu-work-history-declare',reason:'Synthetic complete worktime declaration'});expect(p.statusCode,p.body).toBe(200);
 const a=await call('review-worktime-declaration',{...scope,expectedRevision:1,operationId:'emu-work-history-review',mode:'approve',reason:'Synthetic independent history and authority review'},'synthetic-history-source-reviewer');expect(a.statusCode,a.body).toBe(200);

 const ok=async(action:string,data:any={},token?:string)=>{const response=await call(action,data,token);expect(response.statusCode,action+': '+response.body).toBe(200);return JSON.parse(response.body);};
 const inventory={...scope,mode:'none',sourceRefs:['SYNTH-FORMAL-ITEMS'],reason:'Synthetic complete no-extra-items declaration',items:[]};
 await ok('propose-payroll-item-inventory',{inventory,expectedRevision:0,operationId:'emu-formal-items'});
 await ok('review-payroll-item-inventory',{...scope,expectedRevision:1,operationId:'emu-formal-items-review',mode:'approve',reason:'Independent complete inventory review'},'synthetic-history-source-reviewer');
 const payment={...scope,mode:'events',sourceRefs:['SYNTH-FORMAL-CASH-REGISTER'],reason:'Synthetic complete actual paid salary inventory',events:[{id:'FORMAL-CASH-1',evidenceLocator:'ROW-1',paidOn:'2026-05-02',amount:'1600',sourceRefs:['SYNTH-FORMAL-BANK-STATEMENT'],reason:'Synthetic actual paid salary',incomeClassification:'salary-nonmonthly',insuredCategory:'other',exemption:{kind:'none',from:'2026-05-01',to:'2026-05-31',sourceRefs:['SYNTH-FORMAL-ELIGIBILITY']}}]};
 await ok('propose-payroll-payment-evidence',{inventory:payment,expectedRevision:0,operationId:'emu-formal-payment'});
 const actualPayment=await ok('review-payroll-payment-evidence',{...scope,expectedRevision:1,operationId:'emu-formal-payment-review',mode:'approve',reason:'Independent actual payment evidence review'},'synthetic-history-source-reviewer');
 const d=await ok('get-payroll-difference',scope);expect(d.source).toMatchObject({status:'comparable',totals:{net:'1600'}});
 const actual={currency:'TWD',items:d.source.lines.map((line:any,index:number)=>({sourceCode:line.code,kind:line.kind,amount:line.amount,sourceRefs:['SYNTH-FORMAL-ACTUAL-'+index],reason:'Synthetic independently checked actual line'})),netAmount:'1600',sourceRefs:['SYNTH-FORMAL-ACTUAL-NET'],reason:'Synthetic actual payment reconciles exactly'};
 const contradictoryCash={...actual,netAmount:'1599',items:actual.items.map((line:any)=>line.sourceCode==='normal'?{...line,amount:'1599'}:line)};
 expect((await call('propose-payroll-difference',{...scope,actual:contradictoryCash,expectedRevision:0,operationId:'formal-contradictory-cash',reason:'Synthetic wrong net must not replace approved cash facts'})).statusCode).toBe(409);
 const difference=await ok('propose-payroll-difference',{...scope,actual,expectedRevision:0,operationId:'emu-formal-difference',reason:'Synthetic exact actual comparison'});
 expect(difference.comparison.varianceStatus).toBe('zero');
 const reviewed=await ok('review-payroll-difference',{...scope,expectedRevision:difference.revision,operationId:'emu-formal-difference-review',mode:'approve',reason:'Independent exact difference review'},'synthetic-history-source-reviewer');
 await ok('adopt-payroll-difference',{...scope,expectedRevision:reviewed.revision,operationId:'emu-formal-difference-adopt',reason:'Separate adoption of exact comparison'},'synthetic-history-source-reviewer');
 const actualGate=await vi.importActual<typeof import('../netlify/functions/utils/payrollPreflight')>('../netlify/functions/utils/payrollPreflight');vi.mocked(assertPayrollReady).mockImplementation(actualGate.assertPayrollReady);
 const before=await ok('get-employee-salary',{empId:employee.id,yearMonth:month});
 expect(before.netSalary).toBe(1600);expect(before.preflight.trialStatus).toBe('READY');expect(before.preflight.gaps).toEqual(['PRODUCTION_RECONCILIATION']);
 const reconciliation=await ok('get-payroll-reconciliation',{month});
 expect(reconciliation.candidate,JSON.stringify(reconciliation.candidateIssues)).toBeTruthy();
 expect(reconciliation.candidate.employeeIds).toEqual([employee.id]);expect(reconciliation.candidate.employees).toEqual([expect.objectContaining({empId:employee.id,netSalary:1600,paymentStatus:'verified-recorded'})]);
 return {ok,reconciliation,actualPayment};
}
async function approveSdkMonthReconciliation(fixture:Awaited<ReturnType<typeof seedReconciliableSdkMonth>>){
 const {ok,reconciliation}=fixture;
 const p=await ok('propose-payroll-reconciliation',{month,expectedRevision:0,operationId:'emu-formal-reconciliation',reason:'Synthetic complete monthly manifest reconciliation',sourceRefs:['SYNTH-FORMAL-MONTH-MANIFEST'],expectedCandidateHash:reconciliation.candidate.prerequisitesHash});
 const command={month,expectedRevision:p.revision,operationId:'emu-formal-reconciliation-review',reason:'Independent full roster and source manifest review',mode:'approve'};
 expect((await call('review-payroll-reconciliation',command)).statusCode).toBe(403);
 return ok('review-payroll-reconciliation',command,'synthetic-history-source-reviewer');
}

it('real formal gate locks only after complete monthly reconciliation and preserves immutable manifest proof',async()=>{
 const fixture=await seedReconciliableSdkMonth(),approved=await approveSdkMonthReconciliation(fixture);
 const manifestBefore=JSON.stringify((await db.doc('payrollReconciliationVersions/'+approved.id+'_'+approved.revision).get()).data());
 const cashBefore=JSON.stringify((await db.doc('payrollPaymentEvidence/'+fixture.actualPayment.id).get()).data());
 const salary=await fixture.ok('get-employee-salary',{empId:employee.id,yearMonth:month});expect(salary.preflight).toMatchObject({status:'READY',trialStatus:'READY',gaps:[],issues:[]});
 const locked=await fixture.ok('lock-month',{yearMonth:month});expect(locked.payrollRunId).toBeTruthy();
 const run=await storedRun();expect(run.salaries).toHaveLength(1);expect(run.salaries[0]).toMatchObject({empId:employee.id,calculationStatus:'locked',netSalary:1600});
 expect((run as any).formalEvidence).toMatchObject({month,formalEligibility:'READY',reconciliation:{satisfied:true,identity:{id:approved.id,revision:approved.revision}}});
 expect((run as any).sourceEvidence.sourceHash).toBe(approved.candidate.sourceHash);
 expect((run as any).formalEvidence.employees[employee.id].payment.satisfied).toBe(true);
 expect(JSON.stringify((await db.doc('payrollReconciliationVersions/'+approved.id+'_'+approved.revision).get()).data())).toBe(manifestBefore);
 expect(JSON.stringify((await db.doc('payrollPaymentEvidence/'+fixture.actualPayment.id).get()).data())).toBe(cashBefore);
 const stored=JSON.stringify(run);await db.doc('employees/'+employee.id).update({hourlyRate:99999});
 const reread=await fixture.ok('get-employee-salary',{empId:employee.id,yearMonth:month});expect(reread).toMatchObject({calculationStatus:'locked',netSalary:1600});expect(JSON.stringify(await storedRun())).toBe(stored);
 expect((await db.collection('notifications').get()).empty).toBe(true);
});
it('real formal gate refuses a missing reconciliation manifest without partial lock or run',async()=>{
 const fixture=await seedReconciliableSdkMonth();
 expect((await db.collection('payrollReconciliationHeads').get()).empty).toBe(true);
 const gateBefore=(await db.doc('payrollControl/revision').get()).data();
 const rejected=await call('lock-month',{yearMonth:month});expect(rejected.statusCode,rejected.body).toBe(409);
 expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('monthLocks').get()).empty).toBe(true);expect((await db.doc('payrollControl/revision').get()).data()).toEqual(gateBefore);
 expect((await fixture.ok('get-employee-salary',{empId:employee.id,yearMonth:month})).preflight.gaps).toContain('PRODUCTION_RECONCILIATION');
});
it('real formal gate refuses a source changed after reconciliation approval and retains its original manifest',async()=>{
 const fixture=await seedReconciliableSdkMonth(),approved=await approveSdkMonthReconciliation(fixture);
 const original=JSON.stringify((await db.doc('payrollReconciliationVersions/'+approved.id+'_'+approved.revision).get()).data());
 await db.doc('clockRecords/C1').update({clockOutTime:'18:00'});
 const view=await fixture.ok('get-payroll-reconciliation',{month});expect(view.stale).toBe(true);
 const rejected=await call('lock-month',{yearMonth:month});expect(rejected.statusCode,rejected.body).toBe(409);
 expect((await db.collection('payrollRuns').get()).empty).toBe(true);expect((await db.collection('monthLocks').get()).empty).toBe(true);
 expect(JSON.stringify((await db.doc('payrollReconciliationVersions/'+approved.id+'_'+approved.revision).get()).data())).toBe(original);
 expect((await db.collection('notifications').get()).empty).toBe(true);
});

it('accounts for an independently corrected historical rate without rewriting the original lock or payment',async()=>{
 const actors=['EMU_RATE_AUTHOR','EMU_RATE_REVIEWER','EMU_CORRECTED_D_AUTHOR','EMU_CORRECTED_D_REVIEWER','EMU_CORRECTED_ADJUSTMENT_AUTHOR','EMU_CORRECTED_ADJUSTMENT_REVIEWER'];
 // Seed the complete manager roster before any canonical source is approved.
 for(const id of actors)await db.doc('employees/'+id).set({id,role:UserRole.SuperAdmin,accountKind:'system-account'});
 const fixture=await seedReconciliableSdkMonth();await approveSdkMonthReconciliation(fixture);
 await fixture.ok('lock-month',{yearMonth:month});
 const originalRun=JSON.stringify(await storedRun());
 const preserved=async()=>{const values:any[]=[];for(const name of ['payrollRuns','monthLocks','payrollPaymentEvidence','payrollPaymentEvidenceVersions','payrollPaymentAllocations','payrollPaymentAllocationVersions']){const snap=await db.collection(name).get();values.push(...snap.docs.map(doc=>({path:doc.ref.path,value:doc.data()})));}return JSON.stringify(values.sort((a,b)=>a.path.localeCompare(b.path)));};
 const originalDocuments=await preserved();
 vi.mocked(adminAuth.verifyIdToken).mockImplementation(async token=>({uid:actors.includes(token)?token:token==='synthetic-history-source-reviewer'?'EMU_HISTORY_REVIEWER':'EMULATOR_ADMIN'}) as any);
 const {ok}=fixture,scope={empId:employee.id,month};
 const view=await ok('get-historical-payroll-correction',scope,actors[0]);
 expect(view.originalSourceAvailable,JSON.stringify(view.sourceIssues)).toBe(true);
 const target=view.rateTargets.find((day:any)=>day.date==='2026-04-01');
 expect(target).toMatchObject({date:'2026-04-01',payBasis:'hourly'});expect(Number(target.amount)).toBe(200);expect(target.payVersion).toBeTruthy();
 const correction={rates:[{from:target.date,to:target.date,payBasis:'hourly',amount:'210',originalPayVersion:target.payVersion,sourceRefs:['SYNTH-CORRECTED-CONTRACT'],authorityOccurredAt:'2026-03-01T00:00:00Z',reason:'Synthetic documented correction for the actual worked date'}],insuranceUnchanged:{sourceRefs:['SYNTH-UNCHANGED-ENROLLMENT'],authorityOccurredAt:'2026-03-01T00:00:00Z',reason:'Synthetic independently reviewed unchanged original enrollment'}};
 let corrected=await ok('propose-historical-payroll-correction',{...scope,expectedRevision:0,operationId:'emu-rate-correction-propose',reason:'Synthetic historical rate correction',correction},actors[0]);
 expect(corrected.assessment,JSON.stringify(corrected.assessment)).toMatchObject({status:'calculated',source:{status:'comparable',totals:{gross:'1680',net:'1680'}},formalEligibility:'BLOCKED'});
 const reviewCorrection={...scope,expectedRevision:corrected.revision,operationId:'emu-rate-correction-review',mode:'approve',reason:'Independent original contract and enrollment review'};
 expect((await call('review-historical-payroll-correction',reviewCorrection,actors[0])).statusCode).toBe(403);
 corrected=await ok('review-historical-payroll-correction',reviewCorrection,actors[1]);
 corrected=await ok('adopt-historical-payroll-correction',{...scope,expectedRevision:corrected.revision,operationId:'emu-rate-correction-adopt',reason:'Independent adoption of the reviewed correction candidate'},actors[1]);expect(corrected.status).toBe('adopted');
 const adopted=await ok('get-historical-payroll-correction',scope,actors[2]);expect(adopted.correctionRef).toEqual(expect.objectContaining({id:corrected.id,revision:corrected.revision,calculatorVersion:corrected.assessment.calculatorVersion,adapterVersion:corrected.assessment.adapterVersion}));
 const plain=await ok('get-historical-payroll-difference',scope,actors[2]);expect(plain.source.totals.net).toBe('1600');
 const selected=await ok('get-historical-payroll-difference',{...scope,correctionRef:adopted.correctionRef},actors[2]);expect(selected).toMatchObject({comparisonBasis:'corrected-historical-rate',source:{status:'comparable',totals:{net:'1680'}}});
 const actual={currency:'TWD',items:selected.source.lines.map((line:any)=>({sourceCode:line.code,kind:line.kind,amount:line.code==='normal'?'1600':'0',sourceRefs:['SYNTH-ORIGINAL-PAID-REGISTER'],reason:'Synthetic original paid amount retained'})),netAmount:'1600',sourceRefs:['SYNTH-ORIGINAL-PAID-REGISTER'],reason:'Original locked and paid payroll remains the actual baseline'};
 expect(actual.items.find((line:any)=>line.sourceCode==='normal')).toBeTruthy();
 const comparison=await ok('propose-historical-payroll-difference',{...scope,correctionRef:adopted.correctionRef,actual,expectedRevision:0,operationId:'emu-corrected-d-propose',reason:'Explicit comparison against independently adopted rate correction'},actors[2]);
 expect(comparison.comparison.varianceStatus).toBe('nonzero');
 const reviewDifference={...scope,expectedRevision:comparison.revision,operationId:'emu-corrected-d-review',mode:'approve',reason:'Independent review of the actual historical eighty dollar difference'};
 expect((await call('review-historical-payroll-difference',reviewDifference,actors[0])).statusCode).toBe(403);
 const reviewed=await ok('review-historical-payroll-difference',reviewDifference,actors[3]);expect(reviewed.status).toBe('reviewed');
 const adjustmentScope={...scope,scope:'historical'};
 const candidate=await ok('get-payroll-adjustment',adjustmentScope,actors[4]);expect(candidate.candidate,JSON.stringify(candidate.candidateIssues)).toBeTruthy();expect(candidate.candidate.projection.outstanding.net).toBe('80');
 let adjustment=await ok('propose-payroll-adjustment',{...adjustmentScope,expectedRevision:0,operationId:'emu-corrected-adjustment-propose',postingMonth:'2026-06',comparisonRef:candidate.candidate.comparisonRef,sourceRefs:['SYNTH-CORRECTION-ADJUSTMENT'],reason:'Explicit separate historical accounting adjustment'},actors[4]);
 for(const [action,operationId,mode] of [['review-payroll-adjustment','emu-corrected-adjustment-review','approve'],['adopt-payroll-adjustment','emu-corrected-adjustment-adopt',null],['apply-payroll-adjustment','emu-corrected-adjustment-apply',null]] as const){adjustment=await ok(action,{...adjustmentScope,expectedRevision:adjustment.revision,operationId,reason:'Independent synthetic historical accounting action',...(mode?{mode}:{})},actors[5]);}
 expect(adjustment.status).toBe('applied');
 const accounted=await ok('get-payroll-adjustment',adjustmentScope,actors[5]);expect(accounted.projection).toMatchObject({recordedActualNet:'1600',cumulativeAdjustments:{net:'80'},accountedTarget:{net:'1680'},outstanding:{net:'0'}});expect(accounted.runs).toHaveLength(1);expect(accounted.paymentStatus).toBe('not-paid');
 const salary=await ok('get-employee-salary',{empId:employee.id,yearMonth:month});expect(salary).toMatchObject({calculationStatus:'locked',baseSalary:1600,netSalary:1600,adjustmentEvidence:{status:'verified',scopes:{historical:{projection:{recordedActualNet:'1600',cumulativeAdjustments:{net:'80'},accountedTarget:{net:'1680'}}}}}});
 expect(await preserved()).toBe(originalDocuments);expect(JSON.stringify(await storedRun())).toBe(originalRun);
 expect((await db.collection('payrollAdjustmentRuns').get()).size).toBe(1);expect((await db.collection('monthLocks').get()).size).toBe(1);expect((await db.collection('notifications').get()).empty).toBe(true);
});
