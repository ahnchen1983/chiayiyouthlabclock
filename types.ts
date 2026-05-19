
export enum UserRole {
  SuperAdmin = '最高管理者',
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

export type ClockRecordStatus = '正常' | '遲到' | '早退' | '遲到+早退' | '異常';

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
  status: ClockRecordStatus;
  note?: string;
  manuallyEdited?: boolean;
  source?: 'normal' | 'makeup';
  editedBy?: string;
  editedAt?: string;
}

// ==================== v2.0 排班模型（Phase 5.1）====================
//
// 改為每員工獨立時段陣列，支援兩頭班（同員工同日最多 2 筆 shift）。
// 舊版 staffA / staffB / partTime / shiftTime 已廢棄。
// 讀取時若遇到舊資料會由 normalizeScheduleDoc 自動轉換，但不回寫。

export type StaffRole = 'staffA' | 'staffB' | 'partTime';

export interface StaffShift {
    empId: string;       // 員工編號（必填）
    name: string;        // 姓名（冗餘儲存，方便顯示）
    role: StaffRole;
    from: string;        // "HH:mm"
    to: string;          // "HH:mm"
    note?: string;
}

export interface ScheduleEvent {
    date: string;
    dayOfWeek: string;
    status: '營運' | '休館' | '休館(值班)';
    openingHours?: string;       // 場館對外營業時段（顯示用，例如 "08:30-20:00"）
    requiredHeadcount?: number;  // 應到人數（Phase 5.2 使用，僅警示不阻擋）
    shifts: StaffShift[];        // 每員工獨立時段
}

// 週模板：不含具體人員，僅記錄營業時段 + 預設班次結構
export interface ScheduleShiftTemplate {
    role: StaffRole;
    from: string;
    to: string;
}

export interface ScheduleTemplate {
    status: '營運' | '休館' | '休館(值班)';
    openingHours?: string;
    requiredHeadcount?: number;
    defaultShifts: ScheduleShiftTemplate[];
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
    rejectReason?: string;
}

// 員工詳細資料（用於員工管理）
export type EmployeeStatus = '在職' | '離職' | '留停';

export interface Employee {
    id: string;
    name: string;
    phone: string;
    email: string;
    hourlyRate: number;
    monthlySalary?: number;
    hireDate: string;
    resignDate?: string;
    status: EmployeeStatus;
    position: '專責人員' | '兼職人員';
    role: UserRole;
    // === Phase 8.2 留停期間 ===
    leaveOfAbsenceStart?: string;   // 留停起始日 YYYY-MM-DD
    leaveOfAbsenceEnd?: string;     // 留停結束日 YYYY-MM-DD；空字串或 undefined = 仍在留停
}

// 系統設定（薪資費率等）
export interface SystemConfig {
    laborInsuranceRate: number;     // 勞保費率（員工負擔）e.g. 0.023
    healthInsuranceRate: number;    // 健保費率（員工負擔）e.g. 0.0211
    laborPensionRate: number;       // 勞退自提率（員工自願）e.g. 0.06
    overtimeMultiplier: number;     // 加班倍率 e.g. 1.34
    ptMonthlyHourLimit: number;     // 兼職月時數上限 e.g. 80
    ptWarningThreshold: number;     // 兼職時數警示閾值 e.g. 70
    lateGraceMinutes: number;       // 遲到寬限分鐘 e.g. 5
    updatedAt?: string;
    updatedBy?: string;
}

// 補打卡申請
export type MakeupRequestStatus = '待審核' | '核准' | '駁回';

export interface ClockMakeupRequest {
    id: string;
    empId: string;
    name: string;
    date: string;                   // 補打卡日期
    type: '上班' | '下班' | '上下班';
    requestedClockIn?: string;      // ISO timestamp
    requestedClockOut?: string;     // ISO timestamp
    reason: string;
    status: MakeupRequestStatus;
    requestDate: string;
    approver?: string;
    approvalDate?: string;
    rejectReason?: string;
}

// 通知
export type NotificationType = 'leave-approved' | 'leave-rejected' | 'makeup-approved' | 'makeup-rejected' | 'schedule-changed' | 'clock-warning' | 'system';

export interface Notification {
    id: string;
    empId: string;                  // 接收者
    type: NotificationType;
    title: string;
    message: string;
    read: boolean;
    createdAt: string;
    link?: string;
}

// 假別餘額（Phase 4.1）
export interface LeaveBalance {
    leaveType: LeaveType;
    quotaHours: number;       // 年度配額（小時）
    usedHours: number;        // 已使用（小時）
    remainingHours: number;   // 剩餘（小時）
    note?: string;            // 計算說明
}

// 員工自選班表（Phase 4.2）
export type OpenShiftStatus = 'open' | 'closed';

export interface OpenShift {
    id: string;
    date: string;             // YYYY-MM-DD
    shiftTime: string;        // 例如 "08:30-17:30"
    requiredCount: number;    // 需要人數
    takenBy: string[];        // 已認領的 empId
    takenNames: string[];     // 已認領的姓名（同步寫入，方便查詢）
    status: OpenShiftStatus;
    note?: string;
    createdBy: string;
    createdAt: string;
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

// TOTP 雙因素認證（Phase 9.2）

export interface TotpSecretDoc {
    secret: string;                 // base32 secret（純後端，前端永遠看不到）
    enabled: boolean;
    enabledAt?: string;
    recoveryCodes: string[];        // 10 個 scrypt hash（用過即移除）
    lastVerifiedAt?: string;
    setupAt?: string;
}

export interface TotpLoginChallenge {
    empId: string;
    expiresAt: string;              // 5 分鐘 TTL
    createdAt: string;
}

export type LoginResult =
    | { kind: 'success'; user: User; customToken: string }
    | { kind: 'requireTotp'; totpToken: string; expiresAt: string }
    | { kind: 'fail'; message?: string };

export interface TotpStatus {
    enabled: boolean;
    enabledAt?: string;
    recoveryCodesRemaining: number;
}

// 月結鎖定（Phase 6.3）
export interface MonthLock {
    yearMonth: string;          // "YYYY-MM"（同時也是文件 ID）
    lockedBy: string;           // empId
    lockedByName: string;       // 操作者姓名（冗餘儲存供顯示）
    lockedAt: string;           // ISO timestamp
    totalAmount: number;        // 鎖定當下的薪資總額（grossSalary 加總，快照用）
    employeeCount: number;      // 鎖定當下的員工數（快照）
    // 解鎖欄位（僅當解鎖時填入）
    unlockedBy?: string;
    unlockedByName?: string;
    unlockedAt?: string;
    unlockReason?: string;      // 必填，解鎖理由
}

