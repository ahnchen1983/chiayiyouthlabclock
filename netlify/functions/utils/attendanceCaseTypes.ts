import type { ClockMakeupRequest, ClockRecord, Employee, LeaveOfAbsenceRequest, LeaveRequest, ScheduleEvent, ShiftSwapRequest } from '../../../types';
export const CASE_TYPES = ['missing-in', 'missing-out', 'unexplained-absence', 'late', 'early', 'hours-difference', 'unscheduled-card', 'sequence-overlap', 'overnight-date', 'work-leave-overlap', 'pending-request', 'approved-unapplied'] as const;
export type CaseType = typeof CASE_TYPES[number];
export type Outcome = 'finding' | 'clear' | 'unknown';
export type CaseStatus = 'open' | 'awaiting-employee' | 'awaiting-review' | 'needs-info' | 'resolved' | 'cancelled';
export interface Window { start: number; end: number } // absolute epoch minutes, half-open
export interface SourceRef { collection: string; id: string; version: string }
export interface CaseObservation {
    schemaVersion: 'attendance-case-v1'; detectorVersion: 'detector-v1';
    id: string; empId: string; type: CaseType; anchor: string;
    window: Window; outcome: Outcome; reason: string; refs: SourceRef[];
    evidenceVersion: string; policyVersion: string | null;
    // No wage/deduction decision can be represented by a detector observation.
    payrollDecision: 'none';
}
export interface CaseEvent {
    id: string; operationId: string; revision: number; actor: string; at: string;
    from: CaseStatus | null; to: CaseStatus; reason: string; evidenceVersion: string; commandOwner?: string | null;
}
export interface AttendanceCase {
    schemaVersion: 'attendance-case-v1'; id: string; empId: string; type: CaseType; anchor: string;
    revision: number; status: CaseStatus; owner: string | null;
    observation: CaseObservation; history: CaseEvent[];
}
export type MakeupEvidenceRequest = ClockMakeupRequest & {
    recordId?: string; requestedClockInAt?: string; requestedClockOutAt?: string;
    appliedEvidence?: { version: 'makeup-application-v1'; recordId: string; revisionId: string; requestSourceKey: string };
};
export interface DetectorInput {
    employee: Pick<Employee, 'id' | 'hireDate' | 'resignDate' | 'leaveOfAbsenceStart' | 'leaveOfAbsenceEnd'>;
    window: Window; asOf: number; // no implicit clock or implicit local timezone
    records: ClockRecord[]; schedules: ScheduleEvent[];
    leaves: LeaveRequest[]; makeups: MakeupEvidenceRequest[];
    absences: LeaveOfAbsenceRequest[]; swaps: ShiftSwapRequest[]; revisions: any[];
    // Trusted adapter assertions, NOT a client API. Incomplete collections can never clear cases.
    coverage: Record<'records' | 'schedules' | 'requests' | 'employment' | 'revisions' | 'explanations', 'complete' | 'unknown'>;
    policy: { version: string; reviewedBy?: string; reviewedAt?: string; lateGraceMinutes?: number; earlyGraceMinutes?: number; closeAfterMinutes?: number;
        workDateRule?: 'clock-in-date'; breaks?: 'explicit'; workDifferenceTolerance?: number;
        expectedWorkByDate?: Record<string, { minutes: number; scheduleVersion: string; reviewedBy: string }> } | null;
}
// B2 interface only: no sender, worker, retry execution, scheduler or delivery credentials.
export interface NotificationOutboxIntent {
    schemaVersion: 'attendance-outbox-v1'; id: string; caseId: string; eventId: string;
    recipientId: string | null; channel: 'in-app' | 'sandbox'; templateVersion: string;
    state: 'held' | 'queued' | 'leased' | 'retry' | 'delivered' | 'unknown-delivery' | 'dead-letter';
    attempts: number; nextAttemptAt: string | null; leaseToken: string | null; leaseExpiresAt: string | null;
    deliveryEvidence: string | null;
}
