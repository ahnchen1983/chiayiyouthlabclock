import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '../types';

const fake = vi.hoisted(() => {
    const data = new Map<string, any>();
    const snapshot = (path: string): any => ({ id: path.split('/').pop(), ref: doc(path), exists: data.has(path), data: () => data.get(path) });
    const doc = (path: string): any => ({
        path, id: path.split('/').pop(), get: async () => snapshot(path),
        set: async (value: any) => data.set(path, value),
        update: async (value: any) => data.set(path, { ...data.get(path), ...value }),
    });
    const collection = (path: string, filters: any[] = [], limit=Infinity): any => ({
        doc: (id = 'synthetic-auto') => doc(`${path}/${id}`),
        where: (field: string, operator: string, value: any) => collection(path, [...filters, [field, operator, value]], limit),
        limit: (n:number) => collection(path,filters,n),
        add: async (value: any) => { const ref = doc(`${path}/synthetic-auto`); await ref.set(value); return ref; },
        get: async () => {
            const docs = [...data.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === 2)
                .map(snapshot).filter(snap => filters.every(([field, operator, value]) => operator === '==' && snap.data()[field] === value));
            const selected=docs.slice(0,limit);return { docs:selected, empty: !selected.length, size:selected.length };
        },
    });
    const db = {
        collection,
        runTransaction: async (work: any) => {
            const writes: (() => Promise<any>)[] = [];
            const tx: any = { get: (ref: any) => ref.get() };
            for (const method of ['set', 'update', 'create']) tx[method] = (ref: any, value: any) => writes.push(() => ref[method === 'create' ? 'set' : method](value));
            const result = await work(tx);
            for (const write of writes) await write();
            return result;
        },
    };
    return { data, db };
});

vi.mock('../netlify/functions/utils/firebaseAdmin', () => ({
    db: fake.db,
    adminAuth: { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'ADMIN' }) },
    adminMessaging: () => ({ sendEachForMulticast: vi.fn().mockResolvedValue({ responses: [] }) }),
}));
import { handler } from '../netlify/functions/api';

beforeEach(() => {
    fake.data.clear();
    fake.data.set('employees/ADMIN', { id: 'ADMIN', name: 'synthetic reviewer', role: UserRole.SuperAdmin });
    for (const [id, clockInTime, clockOutTime] of [['C1', '09:00', '12:00'], ['C2', '14:00', '18:00']]) {
        fake.data.set(`clockRecords/${id}`, { empId: 'SYNTH', date: '2026-04-01', clockInTime, clockOutTime });
    }
    // The employee form submits date + requested times; there is no record selector.
    fake.data.set('makeupRequests/M', { empId: 'SYNTH', name: 'synthetic employee', date: '2026-04-01', type: '下班', requestedClockOut: '18:30', reason: 'synthetic reason', status: '待審核' });
});

describe('PR 13 makeup rejection with multiple sessions', () => {
    it('can reject a pending request without selecting or modifying a clock session', async () => {
        const response: any = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' },
            body: JSON.stringify({ action: 'approve-makeup-request', requestId: 'M', status: '駁回', rejectReason: '請重新確認時段' }),
        } as any, {} as any);
        expect({ statusCode: response.statusCode, body: response.body, requestStatus: fake.data.get('makeupRequests/M').status }).toMatchObject({ statusCode: 200, requestStatus: '駁回' });
    });
});

const call = async (body: any) => await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'approve-makeup-request', requestId: 'M', ...body }) } as any, {} as any) as any;
const attendance = () => [...fake.data.entries()].filter(([path]) => /^(clockRecords|attendanceRevisions)\//.test(path));

describe('makeup rejection preserves attendance under legacy invalid input', () => {
    it.each([
        { requestedClockOutAt: 'invalid-timestamp' },
        { requestedClockOutAt: '2026-04-02T06:00:00+08:00', recordId: 'missing-card' },
        { requestedClockInAt: 'invalid-timestamp', requestedClockOutAt: '2026-04-01T18:00:00' },
        { requestedClockOut: '25:99', recordId: 'C1' },
    ])('rejects without reading/changing cards for $requestedClockOutAt', async fields => {
        Object.assign(fake.data.get('makeupRequests/M'), fields);
        fake.data.get('clockRecords/C1').clockOutAt = '2026-04-02T06:00:00+08:00';
        const before = structuredClone(attendance());
        expect((await call({ status: '駁回', rejectReason: '請重提完整時間' })).statusCode).toBe(200);
        expect(fake.data.get('makeupRequests/M')).toMatchObject({ status: '駁回', approver: 'ADMIN', rejectReason: '請重提完整時間' });
        expect(attendance()).toEqual(before);
    });
    // B4a explicit requirement: every lifecycle mutation now shares the month gate.
    it('blocks rejection on a locked month without any mutation', async () => {
        fake.data.set('monthLocks/2026-04', { yearMonth: '2026-04', lockedAt: '2026-05-01T00:00:00Z' });
        expect((await call({ status: '駁回' })).statusCode).toBe(423);
        expect(fake.data.get('makeupRequests/M').status).toBe('待審核');
        expect(fake.data.has('payrollControl/revision')).toBe(false);
    });
    it('keeps reviewer role and valid request identity requirements', async () => {
        fake.data.get('employees/ADMIN').role = UserRole.Employee;
        expect((await call({ status: '駁回' })).statusCode).toBe(403);
        expect(fake.data.get('makeupRequests/M').status).toBe('待審核');
        fake.data.get('employees/ADMIN').role = UserRole.SuperAdmin;
        expect((await call({ requestId: '', status: '駁回' })).statusCode).toBe(400);
        expect((await call({ requestId: 'not-found', status: '駁回' })).statusCode).toBe(404);
        expect((await call({ requestId: 'bad/path', status: '駁回' })).statusCode).toBe(400);
    });
    it('rejects an already approved request and remains idempotent after rejection', async () => {
        fake.data.get('makeupRequests/M').status = '核准';
        expect((await call({ status: '駁回' })).statusCode).toBe(409);
        expect(fake.data.get('makeupRequests/M').status).toBe('核准');
        fake.data.get('makeupRequests/M').status = '待審核';
        await call({ status: '駁回' }); const before = structuredClone([...fake.data.entries()].filter(([k])=>k!=='payrollControl/revision'));
        expect((await call({ status: '駁回' })).statusCode).toBe(200);
        // A replay may advance the shared serialization gate, never attendance/request/audit.
        expect([...fake.data.entries()].filter(([k])=>k!=='payrollControl/revision')).toEqual(before);
    });
    it.each(['invalid-timestamp', '2026-04-02T06:00:00', '2026-13-02T06:00:00+08:00', '2026-02-31T06:00:00+08:00', '2026-04-02T24:00:00+08:00'])('refuses approval for invalid absolute requested time (%s)', async stamp => {
        Object.assign(fake.data.get('makeupRequests/M'), { recordId: 'C1', requestedClockOutAt: stamp });
        const before = structuredClone(attendance());
        expect((await call({ status: '核准' })).statusCode).toBe(409);
        expect(fake.data.get('makeupRequests/M').status).toBe('待審核'); expect(attendance()).toEqual(before);
    });
});
