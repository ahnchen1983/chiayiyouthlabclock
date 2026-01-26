
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
