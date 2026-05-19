import type { Page } from '@playwright/test';
import { LeaveType } from '../../../types';
import { adminUser, employeeUser, peerUser, type E2EUser } from './session';

const nextSaturday = (): string => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const add = (6 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + add);
  return date.toISOString().slice(0, 10);
};

export const scheduleDate = nextSaturday();

const scheduleFor = (empId: string) => [{
  date: scheduleDate,
  dayOfWeek: '六',
  status: '營運',
  openingHours: '09:00-18:00',
  requiredHeadcount: 1,
  shifts: [{
    empId,
    name: empId === employeeUser.id ? employeeUser.name : peerUser.name,
    role: 'partTime',
    from: '09:00',
    to: '18:00',
  }],
}];

export interface ApiMockOptions {
  user?: E2EUser;
  onUpdateSchedule?: () => void;
}

export const mockApi = async (page: Page, options: ApiMockOptions = {}) => {
  const loginUser = options.user || employeeUser;
  const clockStatus: { clockInTime?: string; clockOutTime?: string } = {};

  await page.route('**/.netlify/functions/api', async route => {
    const body = route.request().postDataJSON() as { action?: string; [key: string]: unknown };

    switch (body.action) {
      case 'initialize-database':
        return route.fulfill({ json: true });
      case 'login':
        return route.fulfill({ json: { kind: 'success', user: loginUser, customToken: 'e2e-token' } });
      case 'get-totp-status':
        return route.fulfill({ json: { enabled: true } });
      case 'get-today-clock-status':
        return route.fulfill({ json: clockStatus });
      case 'clock-in':
        clockStatus.clockInTime = '09:00';
        return route.fulfill({ json: true });
      case 'clock-out':
        clockStatus.clockOutTime = '18:00';
        return route.fulfill({ json: true });
      case 'get-leave-balance':
        return route.fulfill({
          json: [
            { leaveType: LeaveType.Personal, quotaHours: 112, usedHours: 8, remainingHours: 104, note: 'E2E' },
            { leaveType: LeaveType.Sick, quotaHours: 240, usedHours: 0, remainingHours: 240, note: 'E2E' },
            { leaveType: LeaveType.Annual, quotaHours: 56, usedHours: 0, remainingHours: 56, note: 'E2E' },
          ],
        });
      case 'submit-leave-request':
        return route.fulfill({ json: true });
      case 'get-monthly-schedule':
        return route.fulfill({ json: scheduleFor(employeeUser.id) });
      case 'get-employee-schedule': {
        const empId = String(body.empId || employeeUser.id);
        return route.fulfill({ json: scheduleFor(empId) });
      }
      case 'check-schedule-conflicts':
        return route.fulfill({ json: [] });
      case 'get-all-employees':
        return route.fulfill({ json: [employeeUser, peerUser, adminUser] });
      case 'get-all-staff-preferences':
        return route.fulfill({
          json: [{
            empId: employeeUser.id,
            blockedWeekdays: [6],
            blockedDates: [],
            preferredDates: [],
          }],
        });
      case 'update-schedule':
        options.onUpdateSchedule?.();
        return route.fulfill({ json: true });
      case 'list-shift-swap-requests':
        return route.fulfill({
          json: [{
            id: 'swap-1',
            fromEmpId: employeeUser.id,
            fromName: employeeUser.name,
            fromDate: scheduleDate,
            fromShiftIndex: 0,
            toEmpId: peerUser.id,
            toName: peerUser.name,
            toDate: scheduleDate,
            toShiftIndex: 0,
            reason: 'E2E 換班測試',
            status: 'awaiting-peer',
            createdAt: new Date().toISOString(),
          }],
        });
      case 'get-notifications':
        return route.fulfill({ json: [] });
      default:
        return route.fulfill({ status: 500, json: { error: `Unhandled mock action: ${body.action}` } });
    }
  });
};
