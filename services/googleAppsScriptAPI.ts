import { auth } from './firebaseConfig';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import {
    User, ClockStatus, ScheduleEvent, ClockRecord,
    LeaveRequest, LeaveStatus, PartTimeHourInfo,
    Employee, TodayAttendanceComparison, DashboardStats, SalaryDetail,
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

export const apiLogin = async (username: string, password: string): Promise<User | null> => {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', empId: username, password }),
    });
    if (!res.ok) return null;
    const result = await res.json();
    if (!result) return null;
    // 交換 Custom Token → ID Token（後續請求的憑證）
    await signInWithCustomToken(auth, result.customToken);
    return result.user;
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

export const apiApproveLeave = async (requestId: string, status: LeaveStatus, approverName: string): Promise<boolean> => {
    return callAPI('approve-leave', { requestId, status, approverName });
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
    status: '營運' | '休館';
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
