import { isMonthLocked } from './monthLock';
import { validDate } from '../../../utils/attendance';
export const monthsInRange = (start: string, end: string = start): string[] => {
    const first = start.slice(0, 10), last = end.slice(0, 10);
    if (!validDate(first) || !validDate(last) || last < first) throw new Error('日期範圍無效');
    const months: string[] = [];
    const date = new Date(first.slice(0, 7) + '-01T00:00:00Z');
    while (date.toISOString().slice(0, 7) <= last.slice(0, 7)) {
        months.push(date.toISOString().slice(0, 7)); date.setUTCMonth(date.getUTCMonth() + 1);
        if (months.length > 1200) throw new Error('日期範圍過大');
    }
    return months;
};
// All attendance/payroll mutations and month locking share this document in the
// same Firestore transaction. A concurrent lock/mutation retries on conflict.
export const runPayrollMutation = async <T>(db: any, months: string[], work: (tx: any) => Promise<T>): Promise<T> => db.runTransaction(async (tx: any) => {
    try {
    const gate = db.collection('payrollControl').doc('revision');
    const revision = await tx.get(gate);
    for (const month of [...new Set(months)].sort()) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份無效');
        const snap = await tx.get(db.collection('monthLocks').doc(month));
        if (snap.exists && isMonthLocked(snap.data())) {
            const error: any = new Error(`${month} 月結已鎖定，不能修改；請走差額覆核`); error.statusCode = 423; throw error;
        }
    }
    let result: T;
    try { result = await work(tx); } catch (error: any) { error.statusCode ||= 409; throw error; }
    tx.set(gate, { revision: (revision.data()?.revision || 0) + 1 });
    return result;
    } catch (error: any) {
        // The emulator can surface a contention-aborted query as INVALID_ARGUMENT
        // with this exact status. Let Firestore's bounded native retry handle it;
        // unrelated invalid arguments and business validation remain failures.
        if (error?.code === 3 && error.details === 'Transaction is invalid or closed.') {
            error.transactionRetryOriginalCode = error.code;
            error.code = 10; // ABORTED; preserve original message/details/stack for logs.
        }
        throw error;
    }
});

export const assertTransactionMonths = async (db: any, tx: any, months: string[]): Promise<void> => {
    for (const month of [...new Set(months)]) {
        const snap = await tx.get(db.collection('monthLocks').doc(month));
        if (snap.exists && isMonthLocked(snap.data())) { const error: any = new Error(`${month} 月結已鎖定`); error.statusCode = 423; throw error; }
    }
};
