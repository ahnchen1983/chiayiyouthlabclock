import { createHash } from 'node:crypto';
import type { ClockRecord } from '../../../types';
import { clockSourceKey } from '../../../utils/attendance';
import { editClock } from './clockMutation';
export const makeupSourceKey = (r: any): string => createHash('sha256').update(JSON.stringify([
    r.empId, r.date, r.recordId || null, r.requestedClockIn || null, r.requestedClockOut || null,
    r.requestedClockInAt || null, r.requestedClockOutAt || null,
])).digest('hex');
const sameSource = (a: ClockRecord, b: ClockRecord) => a && b && a.empId === b.empId && a.date === b.date && clockSourceKey(a) === clockSourceKey(b);
// Immutable before/after revisions attest application; timestamps alone do not.
export const hasAppliedMakeup = (request: any, records: ClockRecord[], revisions: any[]): boolean => {
    const applied = request.appliedEvidence;
    if (!applied || applied.version !== 'makeup-application-v1' || applied.requestSourceKey !== makeupSourceKey(request)) return false;
    const original = revisions.find(r => r.id === applied.revisionId);
    if (!original || original.requestId !== request.id || original.requestSourceKey !== applied.requestSourceKey || original.recordId !== applied.recordId ||
        original.editedBy !== request.approver || original.editedAt !== request.approvalDate || !original.after || original.after.empId !== request.empId || original.after.date !== request.date) return false;
    if (request.recordId && original.recordId !== request.recordId) return false;
    try {
        const patch: any = {};
        for (const side of ['In', 'Out']) {
            if (request[`requestedClock${side}At`]) patch[`clock${side}At`] = request[`requestedClock${side}At`];
            else if (request[`requestedClock${side}`]) patch[`clock${side}Time`] = request[`requestedClock${side}`];
        }
        const seed = original.before || { ...original.after, clockInTime: null, clockOutTime: null, clockInAt: null, clockOutAt: null };
        if (!sameSource(editClock(seed, patch, original.editedBy, original.editedAt), original.after)) return false;
    } catch { return false; }
    const current = records.find(r => r.id === applied.recordId && r.empId === request.empId);
    if (!current) return false;
    let id = current.attendanceRevisionId, expected = current;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
        seen.add(id);
        const revision = revisions.find(r => r.id === id);
        if (!revision || revision.recordId !== applied.recordId || !revision.editedBy || !revision.editedAt || !sameSource(revision.after, expected)) return false;
        if (id === original.id) return true;
        if (!revision.before || revision.parentRevisionId !== revision.before.attendanceRevisionId) return false;
        expected = revision.before; id = revision.parentRevisionId;
    }
    return false;
};
