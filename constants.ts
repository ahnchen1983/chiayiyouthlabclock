
import { Shift, User, UserRole } from './types';

export const COMPANY_WIFI_NAME = "Corporate_Intranet_5G";
export const TRUSTED_IP_PREFIX = "192.168.1."; // Simulated office IP prefix

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Admin User', role: UserRole.ADMIN, email: 'admin@company.com' },
  { id: '2', name: 'John Doe', role: UserRole.EMPLOYEE, email: 'john@company.com' },
  { id: '3', name: 'Jane Smith', role: UserRole.EMPLOYEE, email: 'jane@company.com' },
  { id: '4', name: 'Bob Wilson', role: UserRole.EMPLOYEE, email: 'bob@company.com' },
];

export const SHIFT_TYPES = {
  Morning: { start: '08:00', end: '16:00', color: 'bg-emerald-100 text-emerald-700' },
  Afternoon: { start: '14:00', end: '22:00', color: 'bg-amber-100 text-amber-700' },
  Night: { start: '22:00', end: '06:00', color: 'bg-slate-700 text-slate-100' },
};
