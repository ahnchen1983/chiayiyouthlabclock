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
    const collection = (path: string, filters: any[] = []): any => ({
        doc: (id = 'synthetic-auto') => doc(`${path}/${id}`),
        where: (field: string, operator: string, value: any) => collection(path, [...filters, [field, operator, value]]),
        add: async (value: any) => { const ref = doc(`${path}/synthetic-auto`); await ref.set(value); return ref; },
        get: async () => {
            const docs = [...data.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === 2)
                .map(snapshot).filter(snap => filters.every(([field, operator, value]) => operator === '==' && snap.data()[field] === value));
            return { docs, empty: !docs.length, size: docs.length };
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
