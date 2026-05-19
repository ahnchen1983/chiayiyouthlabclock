import { auth } from './firebaseConfig';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import {
    User, ClockStatus, ScheduleEvent, ClockRecord,
    LeaveRequest, LeaveStatus, PartTimeHourInfo,
    Employee, TodayAttendanceComparison, DashboardStats, SalaryDetail,
    SystemConfig, ClockMakeupRequest, Notification,
    LeaveBalance, OpenShift, MonthLock, LoginResult, TotpStatus,
    MonthlyReportData, LeaveOfAbsenceRequest,
    ScheduleVersion, ShiftSwapRequest,
} from '../types';

// ==================== API 呼叫 Helper ====================

const API_URL = '/.netlify/functions/api';

const callAPI = async (action: string, data: Record<string, unknown> = {}): Promise<any> => {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, ...data }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `API 錯誤 ${res.status}`);
    }
    return res.json();
};

// ==================== 登入 / 登出 ====================

export const apiInitializeDatabase = async (): Promise<void> => {
    await callAPI('initialize-database');
};

/**
 * Phase 9.2：兩階段登入
 * - 無 2FA：直接 signInWithCustomToken + 回 'success'
 * - 有 2FA：不登入，回 'requireTotp' + totpToken，由前端進入 stage 2
 */
export const apiLogin = async (username: string, password: string): Promise<LoginResult> => {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', empId: username, password }),
    });
    if (!res.ok) return { kind: 'fail' };
    const result = await res.json();
    if (!result) return { kind: 'fail' };
    if (result.error) throw new Error(result.error);

    if (result.kind === 'requireTotp') {
        return { kind: 'requireTotp', totpToken: result.totpToken, expiresAt: result.expiresAt };
    }
    // kind === 'success'
    await signInWithCustomToken(auth, result.customToken);
    return { kind: 'success', user: result.user, customToken: result.customToken };
};

/**
 * Phase 9.2 stage 2：消費 totpToken + 驗證 6 位數碼或 recovery code
 */
export const apiVerifyTotpLogin = async (
    totpToken: string,
    code: string,
    useRecovery: boolean = false,
): Promise<{ user: User; recoveryCodesRemaining: number } | null> => {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-totp-login', totpToken, code, useRecovery }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `2FA 驗證失敗 ${res.status}`);
    }
    const result = await res.json();
    if (!result) return null;
    if (result.error) throw new Error(result.error);
    await signInWithCustomToken(auth, result.customToken);
    return { user: result.user, recoveryCodesRemaining: result.recoveryCodesRemaining };
};

export const apiLogout = async (): Promise<void> => {
    await signOut(auth);
};

// ==================== 打卡 ====================

export const apiGetTodayClockStatus = async (empId: string): Promise<ClockStatus> => {
    return callAPI('get-today-clock-status', { empId });
};

export const apiClockIn = async (empId: string, name: string, verificationMethod: 'IP' | 'GPS', verificationData: string): Promise<boolean> => {
    return callAPI('clock-in', { empId, name, verificationMethod, verificationData });
};

export const apiClockOut = async (empId: string): Promise<boolean> => {
    return callAPI('clock-out', { empId });
};

export const apiValidateGPS = async (lat: number, lng: number): Promise<{ isValid: boolean, distance?: number }> => {
    return callAPI('validate-gps', { lat, lng });
};

// ==================== 打卡紀錄 ====================

export const apiGetClockRecords = async (empId: string, yearMonth: string): Promise<ClockRecord[]> => {
    return callAPI('get-clock-records', { empId, yearMonth });
};

export const apiGetAllClockRecords = async (yearMonth: string): Promise<ClockRecord[]> => {
    return callAPI('get-all-clock-records', { yearMonth });
};

// ==================== 班表 ====================

export const apiGetEmployeeSchedule = async (empId: string, yearMonth: string): Promise<ScheduleEvent[]> => {
    return callAPI('get-employee-schedule', { empId, yearMonth });
};

export const apiGetMonthlySchedule = async (yearMonth: string): Promise<ScheduleEvent[]> => {
    return callAPI('get-monthly-schedule', { yearMonth });
};

export const apiUpdateSchedule = async (updatedEvent: ScheduleEvent): Promise<boolean> => {
    return callAPI('update-schedule', { event: updatedEvent });
};

export const apiApplyTemplate = async (yearMonth: string): Promise<{ message: string }> => {
    return callAPI('apply-template', { yearMonth });
};

export const apiResetAllSchedule = async (alsoResetTemplate: boolean = false): Promise<{ dailyDeleted: number; templateDeleted: number; message: string }> => {
    return callAPI('reset-all-schedule', { alsoResetTemplate });
};

// ==================== 請假 ====================

export const apiGetEmployeeLeaveRequests = async (empId: string): Promise<LeaveRequest[]> => {
    return callAPI('get-employee-leave-requests', { empId });
};

export const apiGetAllLeaveRequests = async (): Promise<LeaveRequest[]> => {
    return callAPI('get-all-leave-requests');
};

export const apiSubmitLeaveRequest = async (
    request: Omit<LeaveRequest, 'id' | 'requestDate' | 'status' | 'approver' | 'approvalDate' | 'hours' | 'name'>
): Promise<boolean> => {
    return callAPI('submit-leave-request', { ...request });
};

export const apiApproveLeave = async (requestId: string, status: LeaveStatus, approverName: string, rejectReason?: string): Promise<boolean> => {
    return callAPI('approve-leave', { requestId, status, approverName, rejectReason });
};

// ==================== 員工管理 ====================

export const apiGetAllEmployees = async (): Promise<User[]> => {
    return callAPI('get-all-employees');
};

export const apiGetAllEmployeesDetail = async (): Promise<Employee[]> => {
    return callAPI('get-all-employees-detail');
};

export const apiGetEmployee = async (empId: string): Promise<Employee | null> => {
    return callAPI('get-employee', { empId });
};

export const apiCreateEmployee = async (employee: Omit<Employee, 'id'>, initialPassword?: string): Promise<Employee> => {
    return callAPI('create-employee', { employee, initialPassword });
};

export const apiUpdateEmployee = async (empId: string, updates: Partial<Employee>): Promise<Employee | null> => {
    return callAPI('update-employee', { empId, updates });
};

export const apiDeleteEmployee = async (empId: string): Promise<boolean> => {
    return callAPI('delete-employee', { empId });
};

// ==================== 密碼管理 ====================

export const apiChangePassword = async (empId: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    return callAPI('change-password', { empId, oldPassword, newPassword });
};

export const apiResetPassword = async (empId: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    return callAPI('reset-password', { empId, newPassword });
};

// ==================== 儀表板 ====================

export const apiGetDashboardStats = async (): Promise<DashboardStats> => {
    return callAPI('get-dashboard-stats');
};

export const apiGetAllPartTimeHours = async (yearMonth: string): Promise<PartTimeHourInfo[]> => {
    return callAPI('get-all-part-time-hours', { yearMonth });
};

// ==================== 排班 vs 出勤對照 ====================

export interface ScheduleAttendanceComparison {
    date: string;
    dayOfWeek: string;
    status: '營運' | '休館' | '休館(值班)';
    employees: {
        empId: string;
        name: string;
        position: '專責人員' | '兼職人員';
        scheduled: boolean;
        scheduledShift: string | null;
        clockInTime: string | null;
        clockOutTime: string | null;
        workHours: number | null;
        attendanceStatus: '正常' | '遲到' | '早退' | '缺勤' | '休假' | '-';
    }[];
}

export const apiGetScheduleAttendanceComparison = async (yearMonth: string): Promise<ScheduleAttendanceComparison[]> => {
    return callAPI('get-schedule-attendance-comparison', { yearMonth });
};

// ==================== 薪資 ====================

export const apiGetAllSalaryDetails = async (yearMonth: string): Promise<SalaryDetail[]> => {
    return callAPI('get-all-salary-details', { yearMonth });
};

export const apiGetEmployeeSalary = async (empId: string, yearMonth: string): Promise<SalaryDetail | null> => {
    return callAPI('get-employee-salary', { empId, yearMonth });
};

export const apiGetMonthlyReport = async (yearMonth: string): Promise<MonthlyReportData> => {
    return callAPI('get-monthly-report', { yearMonth });
};

// ==================== 稽核日誌 ====================

export interface AuditLog {
    id: string;
    timestamp: string;
    userId: string;
    action: string;
    targetId: string;
    details: string;
}

export const apiGetAuditLogs = async (limit: number = 100): Promise<AuditLog[]> => {
    return callAPI('get-audit-logs', { limit });
};

// ==================== 系統設定（Phase 3.1）====================

export const apiGetSystemConfig = async (): Promise<SystemConfig> => {
    return callAPI('get-system-config');
};

export const apiUpdateSystemConfig = async (config: Partial<SystemConfig>): Promise<SystemConfig> => {
    return callAPI('update-system-config', { config });
};

// ==================== 打卡紀錄編輯（Phase 3.2）====================

export const apiUpdateClockRecord = async (
    recordId: string,
    updates: { clockInTime?: string; clockOutTime?: string; status?: string; note?: string }
): Promise<boolean> => {
    return callAPI('update-clock-record', { recordId, ...updates });
};

// ==================== 補打卡申請（Phase 3.3）====================

export const apiSubmitMakeupRequest = async (
    request: { date: string; type: '上班' | '下班' | '上下班'; requestedClockIn?: string; requestedClockOut?: string; reason: string }
): Promise<ClockMakeupRequest> => {
    return callAPI('submit-makeup-request', request);
};

export const apiGetEmployeeMakeupRequests = async (): Promise<ClockMakeupRequest[]> => {
    return callAPI('get-employee-makeup-requests');
};

export const apiGetMakeupRequests = async (): Promise<ClockMakeupRequest[]> => {
    return callAPI('get-makeup-requests');
};

export const apiApproveMakeupRequest = async (
    requestId: string,
    status: '核准' | '駁回',
    approverName: string,
    rejectReason?: string
): Promise<boolean> => {
    return callAPI('approve-makeup-request', { requestId, status, approverName, rejectReason });
};

// ==================== 通知（Phase 3.6）====================

export const apiGetNotifications = async (limit: number = 30): Promise<Notification[]> => {
    return callAPI('get-notifications', { limit });
};

export const apiMarkNotificationRead = async (notificationId: string): Promise<boolean> => {
    return callAPI('mark-notification-read', { notificationId });
};

export const apiMarkAllNotificationsRead = async (): Promise<number> => {
    return callAPI('mark-all-notifications-read');
};

// ==================== 排班衝突偵測（Phase 3.5）====================

export interface ScheduleConflict {
    date: string;
    type: 'duplicate' | 'understaffed';
    name?: string;
    message: string;
}

export const apiCheckScheduleConflicts = async (yearMonth: string): Promise<ScheduleConflict[]> => {
    return callAPI('check-schedule-conflicts', { yearMonth });
};

// ==================== 排班版本歷史（Phase 6.2）====================

export const apiCreateScheduleVersion = async (yearMonth: string, note?: string): Promise<ScheduleVersion> => {
    return callAPI('create-schedule-version', { yearMonth, note });
};

export const apiListScheduleVersions = async (yearMonth: string): Promise<ScheduleVersion[]> => {
    return callAPI('list-schedule-versions', { yearMonth });
};

export const apiGetScheduleVersion = async (versionId: string): Promise<ScheduleVersion> => {
    return callAPI('get-schedule-version', { versionId });
};

export const apiRestoreScheduleVersion = async (versionId: string, reason: string): Promise<{ restoredDays: number }> => {
    return callAPI('restore-schedule-version', { versionId, reason });
};

// ==================== 換班/替班申請（Phase 6.1）====================

export const apiSubmitShiftSwap = async (data: {
    fromDate: string;
    fromShiftIndex: number;
    toEmpId: string;
    toDate: string;
    toShiftIndex: number;
    reason: string;
}): Promise<ShiftSwapRequest> => {
    return callAPI('submit-shift-swap', data);
};

export const apiPeerRespondShiftSwap = async (
    requestId: string,
    agree: boolean,
    rejectReason?: string,
): Promise<boolean> => {
    return callAPI('peer-respond-shift-swap', { requestId, agree, rejectReason });
};

export const apiAdminApproveShiftSwap = async (
    requestId: string,
    approve: boolean,
    rejectReason?: string,
): Promise<boolean> => {
    return callAPI('admin-approve-shift-swap', { requestId, approve, rejectReason });
};

export const apiCancelShiftSwap = async (requestId: string): Promise<boolean> => {
    return callAPI('cancel-shift-swap', { requestId });
};

export const apiListShiftSwapRequests = async (
    mode: 'mine' | 'admin-pending' | 'admin-all' = 'mine',
): Promise<ShiftSwapRequest[]> => {
    return callAPI('list-shift-swap-requests', { mode });
};

// ==================== 假別餘額（Phase 4.1）====================

export const apiGetLeaveBalance = async (empId?: string): Promise<LeaveBalance[]> => {
    return callAPI('get-leave-balance', empId ? { empId } : {});
};

// ==================== 員工自選班表（Phase 4.2）====================

export const apiCreateOpenShift = async (data: {
    date: string; shiftTime: string; requiredCount: number; note?: string;
}): Promise<OpenShift> => {
    return callAPI('create-open-shift', data);
};

export const apiListOpenShifts = async (onlyOpen: boolean = false): Promise<OpenShift[]> => {
    return callAPI('list-open-shifts', { onlyOpen });
};

export const apiClaimOpenShift = async (shiftId: string): Promise<boolean> => {
    return callAPI('claim-open-shift', { shiftId });
};

export const apiReleaseOpenShift = async (shiftId: string): Promise<boolean> => {
    return callAPI('release-open-shift', { shiftId });
};

export const apiDeleteOpenShift = async (shiftId: string): Promise<boolean> => {
    return callAPI('delete-open-shift', { shiftId });
};

// ==================== 月結鎖定（Phase 6.3）====================

export const apiLockMonth = async (yearMonth: string): Promise<MonthLock> => {
    return callAPI('lock-month', { yearMonth });
};

export const apiUnlockMonth = async (yearMonth: string, reason: string): Promise<boolean> => {
    return callAPI('unlock-month', { yearMonth, reason });
};

export const apiGetMonthLock = async (yearMonth: string): Promise<MonthLock | null> => {
    return callAPI('get-month-lock', { yearMonth });
};

export const apiListMonthLocks = async (): Promise<MonthLock[]> => {
    return callAPI('list-month-locks');
};

// ==================== TOTP 2FA（Phase 9.2）====================

export const apiGetTotpStatus = async (): Promise<TotpStatus> => {
    return callAPI('get-totp-status');
};

export const apiSetupTotp = async (): Promise<{ secret: string; otpauthUrl: string }> => {
    return callAPI('setup-totp');
};

export const apiVerifyTotpSetup = async (code: string): Promise<{ recoveryCodes: string[] }> => {
    return callAPI('verify-totp-setup', { code });
};

export const apiDisableTotp = async (code: string): Promise<boolean> => {
    return callAPI('disable-totp', { code });
};

export const apiRegenerateRecoveryCodes = async (code: string): Promise<{ recoveryCodes: string[] }> => {
    return callAPI('regenerate-recovery-codes', { code });
};

// ==================== 員工自助申請 — 留停（Phase 8.5）====================

export const apiSubmitLeaveOfAbsenceRequest = async (
    payload: { startDate: string; endDate?: string; reason: string; contactInfo?: string },
): Promise<LeaveOfAbsenceRequest> => {
    return callAPI('submit-leave-of-absence-request', payload);
};

export const apiGetMyLeaveOfAbsenceRequests = async (): Promise<LeaveOfAbsenceRequest[]> => {
    return callAPI('get-my-leave-of-absence-requests');
};

export const apiGetLeaveOfAbsenceRequests = async (): Promise<LeaveOfAbsenceRequest[]> => {
    return callAPI('get-leave-of-absence-requests');
};

export const apiApproveLeaveOfAbsenceRequest = async (
    requestId: string,
    status: '核准' | '駁回',
    approverName: string,
    rejectReason?: string,
): Promise<boolean> => {
    return callAPI('approve-leave-of-absence-request', { requestId, status, approverName, rejectReason });
};
