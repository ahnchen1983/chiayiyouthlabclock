import { describe, it, expect } from 'vitest';
import { hasAppliedMakeup, makeupSourceKey } from '../netlify/functions/utils/makeupEvidence';
import { editClock } from '../netlify/functions/utils/clockMutation';
import { card } from './fixtures/payrollV2';
const evidence = () => {
    const before = { ...card(), id: 'C1' };
    const request: any = { id: 'P', empId: before.empId, date: before.date, recordId: 'C1', requestedClockOut: '18:00', approver: 'SYNTH-ADMIN', approvalDate: '2026-04-02T00:00:00Z', status: '核准' };
    const after = { ...editClock(before, { clockOutTime: '18:00' }, request.approver, request.approvalDate), attendanceRevisionId: 'R1' };
    const revision = { id: 'R1', recordId: 'C1', before, after, editedBy: request.approver, editedAt: request.approvalDate, requestId: request.id, requestSourceKey: makeupSourceKey(request), parentRevisionId: null };
    request.appliedEvidence = { version: 'makeup-application-v1', recordId: 'C1', revisionId: 'R1', requestSourceKey: revision.requestSourceKey };
    return { before, request, after, revision };
};
describe('makeup application evidence v1', () => {
    it('valid application proves only attendance correction, not confirmed work', () => {
        const e = evidence(); expect(hasAppliedMakeup(e.request, [e.after], [e.revision])).toBe(true);
        expect(e.after.workReview).toBeNull(); expect(e.after.workIntervals).toEqual([]); expect(e.before.clockOutTime).toBe('17:00');
    });
    it('matching requested time without immutable revision and pointer is insufficient', () => {
        const e = evidence(); expect(hasAppliedMakeup(e.request, [e.after], [])).toBe(false);
        expect(hasAppliedMakeup(e.request, [{ ...e.after, attendanceRevisionId: undefined }], [e.revision])).toBe(false);
    });
    it('changed request contents or mismatched actor cannot reuse prior evidence', () => {
        const e = evidence(); expect(hasAppliedMakeup({ ...e.request, requestedClockOut: '19:00' }, [e.after], [e.revision])).toBe(false);
        expect(hasAppliedMakeup({ ...e.request, approver: 'OTHER' }, [e.after], [e.revision])).toBe(false);
    });
    it('newer legitimate correction follows parents, not timestamp precedence or same requested time', () => {
        const e = evidence(); const later = { ...editClock(e.after, { clockInTime: '09:00', clockOutTime: '17:00' }, 'SYNTH-ADMIN', '2026-04-03T00:00:00Z'), attendanceRevisionId: 'R2' };
        const r2 = { id: 'R2', recordId: 'C1', before: e.after, after: later, parentRevisionId: 'R1', editedBy: 'SYNTH-ADMIN', editedAt: later.editedAt };
        expect(hasAppliedMakeup(e.request, [later], [e.revision, r2])).toBe(true);
        expect(hasAppliedMakeup(e.request, [later], [e.revision, { ...r2, parentRevisionId: 'UNRELATED' }])).toBe(false);
        expect(hasAppliedMakeup(e.request, [later], [e.revision, { ...r2, after: { ...later, clockOutTime: '16:00' } }])).toBe(false);
    });
});
