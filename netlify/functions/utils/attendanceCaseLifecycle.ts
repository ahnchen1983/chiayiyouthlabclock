import { createHash } from 'node:crypto';
import { CASE_TYPES } from './attendanceCaseTypes';
import type { AttendanceCase, CaseObservation, CaseStatus, NotificationOutboxIntent } from './attendanceCaseTypes';
const canonical = (v: any): any => v === undefined ? null : Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const evidenceHash = (v: unknown): string => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const caseKey = (empId: string, type: string, anchor: string): string => 'case_' + evidenceHash(['attendance-case-v1', empId, type, anchor]);
const validate = (o: CaseObservation) => {
    if (o.schemaVersion !== 'attendance-case-v1' || o.detectorVersion !== 'detector-v1' || !CASE_TYPES.includes(o.type) || !['finding','clear','unknown'].includes(o.outcome) || !o.evidenceVersion) throw new Error('Invalid observation contract');
    if (o.id !== caseKey(o.empId, o.type, o.anchor) || !Number.isFinite(o.window.start) || !Number.isFinite(o.window.end) || o.window.end <= o.window.start) throw new Error('Invalid case identity/window');
};
const event = (id: string, revision: number, op: string, actor: string, at: string, from: CaseStatus | null, to: CaseStatus, reason: string, evidenceVersion: string) => {
    if (!op || !actor || !reason.trim() || !Number.isFinite(Date.parse(at))) throw new Error('Actor/time/reason/operation required');
    return { commandOwner: null as string | null, id: evidenceHash([id, revision, op]), operationId: op, revision, actor, at, from, to, reason, evidenceVersion };
};
// Only explicit observations are reconciled. Omitted/deleted sources do not
// imply clearance: B2 must emit verified tombstone/clear observations.
export const reconcileCase = (previous: AttendanceCase | undefined, o: CaseObservation, actor: string, at: string): AttendanceCase | undefined => {
    validate(o);
    if (previous && previous.id !== o.id) throw new Error('Identity mismatch');
    if (!previous && o.outcome === 'clear') return undefined;
    if (previous?.observation.evidenceVersion === o.evidenceVersion && previous.observation.outcome === o.outcome) return previous;
    const status: CaseStatus = o.outcome === 'clear' ? 'resolved' : o.outcome === 'unknown' ? 'needs-info'
        : previous && !['resolved', 'cancelled', 'needs-info'].includes(previous.status) ? previous.status : 'open';
    const revision = (previous?.revision || 0) + 1;
    const e = event(o.id, revision, `scan:${o.evidenceVersion}:${o.outcome}`, actor, at, previous?.status || null, status, o.reason, o.evidenceVersion);
    return { schemaVersion: 'attendance-case-v1', id: o.id, empId: o.empId, type: o.type, anchor: o.anchor, revision, status,
        owner: previous?.owner || null, observation: o, history: [...(previous?.history || []), e] };
};
const transitions: Record<CaseStatus, CaseStatus[]> = {
    open: ['awaiting-employee', 'awaiting-review', 'needs-info'],
    'awaiting-employee': ['awaiting-review', 'needs-info'],
    'awaiting-review': ['awaiting-employee', 'needs-info'],
    'needs-info': ['awaiting-employee', 'awaiting-review'], resolved: [], cancelled: [],
};
export const transitionCase = (c: AttendanceCase, command: { expectedRevision: number; expectedEvidenceVersion: string; operationId: string; actor: string; at: string; reason: string; to: CaseStatus; owner?: string; clearedObservation?: CaseObservation }): AttendanceCase => {
    const old = c.history.find(e => e.operationId === command.operationId);
    if (old) {
        if (old.actor !== command.actor || old.to !== command.to || old.reason !== command.reason || (old.commandOwner ?? null) !== (command.owner ?? null)) throw new Error('Operation id conflict');
        return c;
    }
    if (command.expectedRevision !== c.revision || command.expectedEvidenceVersion !== c.observation.evidenceVersion) throw new Error('Stale case version');
    const closing = command.to === 'resolved' || command.to === 'cancelled';
    if (closing) {
        const o = command.clearedObservation;
        if (!o || o.outcome !== 'clear' || o.id !== c.id || o.evidenceVersion !== c.observation.evidenceVersion || c.observation.outcome !== 'clear') throw new Error('Cannot close unresolved or unknown evidence');
    } else if (!transitions[c.status].includes(command.to)) throw new Error('Invalid transition');
    const revision = c.revision + 1;
    const e = event(c.id, revision, command.operationId, command.actor, command.at, c.status, command.to, command.reason, c.observation.evidenceVersion);
    e.commandOwner = command.owner ?? null;
    return { ...c, revision, status: command.to, owner: command.owner ?? c.owner, history: [...c.history, e] };
};
export const outboxIntent = (c: AttendanceCase, recipientId: string | null, templateVersion: string): NotificationOutboxIntent => {
    const last = c.history.at(-1); if (!last || !templateVersion) throw new Error('Case event/template required');
    return { schemaVersion: 'attendance-outbox-v1', id: evidenceHash([c.id, last.id, recipientId, 'sandbox', templateVersion]), caseId: c.id, eventId: last.id,
        recipientId, channel: 'sandbox', templateVersion, state: 'held', attempts: 0, nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, deliveryEvidence: null };
};
