
import { Shift, User, UserRole, EmployeeType } from './types';

export const COMPANY_WIFI_NAME = "公司內部網路_5G";
export const TRUSTED_IP_PREFIX = "192.168.1."; // Simulated office IP prefix

export const MOCK_USERS: User[] = [
  { id: '1', name: '系統管理員', role: UserRole.ADMIN, employeeType: EmployeeType.FULL_TIME, email: 'admin@youthlab.tw' },
  { id: '2', name: '王專員 (正職)', role: UserRole.EMPLOYEE, employeeType: EmployeeType.FULL_TIME, email: 'ft1@youthlab.tw' },
  { id: '3', name: '陳工讀 (兼職)', role: UserRole.EMPLOYEE, employeeType: EmployeeType.PART_TIME, email: 'pt1@youthlab.tw' },
  { id: '4', name: '林工讀 (兼職)', role: UserRole.EMPLOYEE, employeeType: EmployeeType.PART_TIME, email: 'pt2@youthlab.tw' },
  { id: '5', name: '黃工讀 (兼職)', role: UserRole.EMPLOYEE, employeeType: EmployeeType.PART_TIME, email: 'pt3@youthlab.tw' },
];

export const SHIFT_TYPES = {
  Weekday: { start: '10:00', end: '20:00', color: 'bg-indigo-100 text-indigo-700', label: '平日營運' },
  Weekend: { start: '08:30', end: '17:30', color: 'bg-emerald-100 text-emerald-700', label: '假日營運' },
  Closed: { start: '-', end: '-', color: 'bg-slate-100 text-slate-500', label: '休館' },
};
