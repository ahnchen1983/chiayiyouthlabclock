
export enum UserRole {
  Admin = '管理者',
  Employee = '員工',
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  position: '專責人員' | '兼職人員';
}

export interface ClockStatus {
  clockInTime?: string;
  clockOutTime?: string;
}

export interface ClockRecord {
  id: string;
  empId: string;
  name: string;
  date: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  verificationMethod: 'IP' | 'GPS';
  verificationData: string;
  workHours: number | null;
  status: '正常' | '遲到' | '早退';
}

export interface ScheduleEvent {
    date: string;
    dayOfWeek: string;
    status: '營運' | '休館';
    shiftTime: string;
    staffA: string;
    staffB: string;
    partTime: string[];
}

export interface PartTimeHourInfo {
    empId: string;
    name: string;
    month: string;
    scheduledHours: number;
    workedHours: number;
    remainingHours: number;
    status: '正常' | '接近上限';
}

export enum LeaveType {
    Personal = '事假',
    Sick = '病假',
    Annual = '特休',
    Other = '其他',
}

export enum LeaveStatus {
    Pending = '待審核',
    Approved = '核准',
    Rejected = '駁回',
}

export interface LeaveRequest {
    id: string;
    empId: string;
    name: string;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    hours: number;
    reason: string;
    requestDate: string;
    status: LeaveStatus;
    approver?: string;
    approvalDate?: string;
}

// 員工詳細資料（用於員工管理）
export type EmployeeStatus = '在職' | '離職' | '留停';

export interface Employee {
    id: string;
    name: string;
    phone: string;
    email: string;
    hourlyRate: number;
    hireDate: string;
    resignDate?: string;
    status: EmployeeStatus;
    position: '專責人員' | '兼職人員';
    role: UserRole;
}

// 今日排班與出勤對照
export interface TodayAttendanceComparison {
    empId: string;
    name: string;
    position: '專責人員' | '兼職人員';
    scheduledShift: string | null;  // 排班時段 e.g. "08:30-17:30"
    clockInTime: string | null;
    clockOutTime: string | null;
    status: '已到' | '未到' | '遲到' | '早退' | '休假' | '未排班';
}

// 待處理事項
export interface PendingItem {
    id: string;
    type: '請假審核' | '時數警示' | '缺勤異常';
    title: string;
    description: string;
    date: string;
    priority: 'high' | 'medium' | 'low';
}

// 儀表板統計
export interface DashboardStats {
    todayClockedIn: number;
    todayScheduled: number;
    monthlyTotalHours: number;
    pendingLeaves: number;
    hourWarnings: number;
    todayAttendance: TodayAttendanceComparison[];
    pendingItems: PendingItem[];
}

// 薪資明細
export interface SalaryDetail {
    empId: string;
    name: string;
    position: '專責人員' | '兼職人員';
    yearMonth: string;
    // 出勤統計
    totalWorkDays: number;
    totalWorkHours: number;
    totalLeaveHours: number;
    leaveDetails: { type: string; hours: number }[];
    overtimeHours: number;
    // 薪資項目
    baseSalary: number;
    overtimePay: number;
    grossSalary: number;
    // 扣除項目（勞基法）
    laborInsurance: number;
    healthInsurance: number;
    laborPensionSelf: number;
    leaveDeduction: number;
    totalDeductions: number;
    // 最終
    netSalary: number;
}
