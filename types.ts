
export enum UserRole {
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE'
}

export enum EmployeeType {
  FULL_TIME = 'Full-Time',
  PART_TIME = 'Part-Time'
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  employeeType: EmployeeType;
  email: string;
}

export interface Shift {
  id: string;
  userId: string;
  userName: string;
  date: string; // ISO format YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  type: string; // Flexible type string
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
