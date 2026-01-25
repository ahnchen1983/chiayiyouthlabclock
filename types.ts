
export enum UserRole {
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE'
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
}

export interface Shift {
  id: string;
  userId: string;
  userName: string;
  date: string; // ISO format YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  type: 'Morning' | 'Afternoon' | 'Night';
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  networkVerified: boolean;
  locationVerified: boolean;
}

export interface NetworkInfo {
  isInternal: boolean;
  publicIp: string;
  ssid?: string; // Simulated for UI
}
