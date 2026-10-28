import { describe, expect, it } from 'vitest';
import { runPayrollMutation } from '../netlify/functions/utils/monthGuard';

// Mirrors only the SDK's bounded retry decision: ABORTED is retryable, other
// invalid arguments and application errors are terminal. Actual SDK races have
// separate emulator coverage.
const boundedSdk = () => {
    let attempts = 0;
    const db = {
        collection: (path: string) => ({ doc: (id: string) => ({ path: `${path}/${id}` }) }),
        async runTransaction(work: any) {
            for (let attempt = 0; attempt < 5; attempt++) {
                attempts++;
                try { return await work({ get: async () => ({ exists: false, data: () => undefined }), set: () => {} }); }
                catch (error: any) { if (error.code !== 10 || attempt === 4) throw error; }
            }
        },
    };
    return { db, attempts: () => attempts };
};

describe('native bounded retry for the exact closed Firestore transaction status', () => {
    it('normalizes only the known code/details status inside the transaction and preserves provenance', async () => {
        const sdk = boundedSdk();
        const original = Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'), { code: 3, details: 'Transaction is invalid or closed.' });
        const stack = original.stack;
        const result = await runPayrollMutation(sdk.db, ['2026-04'], async () => { if (sdk.attempts() === 1) throw original; return 'committed'; });
        expect(result).toBe('committed'); expect(sdk.attempts()).toBe(2);
        expect(original).toMatchObject({ code: 10, transactionRetryOriginalCode: 3, details: 'Transaction is invalid or closed.', message: '3 INVALID_ARGUMENT: Transaction is invalid or closed.', stack });
    });
    it.each([
        { code: 3, details: 'Invalid query argument.' },
        { code: 3, details: 'Transaction is invalid or closed' },
        { code: 5, details: 'Transaction is invalid or closed.' },
        { code: 3, message: 'Transaction is invalid or closed.' },
    ])('leaves unrelated errors terminal (%j)', async fields => {
        const sdk = boundedSdk(); const error = Object.assign(new Error('original failure'), fields);
        await expect(runPayrollMutation(sdk.db, [], async () => { throw error; })).rejects.toBe(error);
        expect(sdk.attempts()).toBe(1); expect((error as any).transactionRetryOriginalCode).toBeUndefined();
    });
    it('keeps business validation failures terminal', async () => {
        const sdk = boundedSdk(); const error = new Error('仍有待覆核薪資，不能月結');
        await expect(runPayrollMutation(sdk.db, [], async () => { throw error; })).rejects.toBe(error);
        expect(sdk.attempts()).toBe(1); expect((error as any).statusCode).toBe(409);
    });
    it('lets native retry limits terminate repeated closed-transaction failures', async () => {
        const sdk = boundedSdk();
        await expect(runPayrollMutation(sdk.db, [], async () => { throw Object.assign(new Error('closed transaction'), { code: 3, details: 'Transaction is invalid or closed.' }); })).rejects.toMatchObject({ code: 10, transactionRetryOriginalCode: 3 });
        expect(sdk.attempts()).toBe(5);
    });
});
