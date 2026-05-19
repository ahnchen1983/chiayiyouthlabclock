import { describe, expect, it } from 'vitest';
import {
    aggregateClockAnomalies,
    aggregateLeaveDistribution,
    buildSummary,
    rankEmployeesByHours,
} from '../netlify/functions/utils/monthlyReport';
import { LeaveStatus, LeaveType } from '../types';
import type { ClockRecord, LeaveRequest, SalaryDetail } from '../types';

const leave = (overrides: Partial<LeaveRequest>): LeaveRequest => ({
    id: 'LR1',
    empId: 'E001',
    name: '測試員工',
    leaveType: LeaveType.Annual,
    startDate: '2026-05-10',
    endDate: '2026-05-10',
    hours: 8,
    reason: '測試',
    requestDate: '2026-05-01',
    status: LeaveStatus.Approved,
    ...overrides,
});

const clock = (overrides: Partial<ClockRecord>): ClockRecord => ({
    id: 'CR1',
    empId: 'E001',
    name: '測試員工',
    date: '2026-05-10',
    clockInTime: '2026-05-10T08:30:00.000Z',
    clockOutTime: '2026-05-10T17:30:00.000Z',
    verificationMethod: 'IP',
    verificationData: '127.0.0.1',
    workHours: 8,
    status: '正常',
    ...overrides,
});

const salary = (overrides: Partial<SalaryDetail>): SalaryDetail => ({
    empId: 'E001',
    name: '測試員工',
    position: '專責人員',
    yearMonth: '2026-05',
    totalWorkDays: 10,
    totalWorkHours: 80,
    totalLeaveHours: 0,
    leaveDetails: [],
    overtimeHours: 0,
    baseSalary: 0,
    overtimePay: 0,
    grossSalary: 0,
    laborInsurance: 0,
    healthInsurance: 0,
    laborPensionSelf: 0,
    leaveDeduction: 0,
    totalDeductions: 0,
    netSalary: 0,
    ...overrides,
});

describe('aggregateLeaveDistribution — 月結請假分布（Phase 8.4）', () => {
    it('依假別聚合，排除非核准與非當月資料', () => {
        const result = aggregateLeaveDistribution([
            leave({ leaveType: LeaveType.Annual, hours: 8 }),
            leave({ leaveType: LeaveType.Sick, hours: 4.25 }),
            leave({ leaveType: LeaveType.Personal, hours: 1.25 }),
            leave({ leaveType: LeaveType.Other, hours: 2 }),
            leave({ leaveType: LeaveType.Annual, hours: 99, status: LeaveStatus.Pending }),
            leave({ leaveType: LeaveType.Annual, hours: 99, startDate: '2026-04-30' }),
        ], '2026-05');

        expect(result).toEqual({
            [LeaveType.Annual]: 8,
            [LeaveType.Sick]: 4.3,
            [LeaveType.Personal]: 1.3,
            [LeaveType.Other]: 2,
        });
    });
});

describe('aggregateClockAnomalies — 月結打卡異常（Phase 8.4）', () => {
    it('五種異常各自計數，遲到+早退可同時進兩個欄位', () => {
        const result = aggregateClockAnomalies([
            clock({ status: '遲到+早退' }),
            clock({ id: 'CR2', status: '遲到', clockOutTime: null }),
            clock({ id: 'CR3', manuallyEdited: true }),
            clock({ id: 'CR4', source: 'makeup' }),
        ]);

        expect(result).toEqual({
            lateCount: 2,
            earlyLeaveCount: 1,
            missingClockOutCount: 1,
            manuallyEditedCount: 1,
            makeupCount: 1,
        });
    });
});

describe('rankEmployeesByHours — 月結員工工時排名（Phase 8.4）', () => {
    it('依總工時 desc，並用加班、工作天、empId 穩定排序', () => {
        const result = rankEmployeesByHours([
            salary({ empId: 'E003', name: '丙', totalWorkHours: 90, overtimeHours: 2, totalWorkDays: 12 }),
            salary({ empId: 'E002', name: '乙', totalWorkHours: 100, overtimeHours: 1, totalWorkDays: 10 }),
            salary({ empId: 'E004', name: '丁', totalWorkHours: 100, overtimeHours: 1, totalWorkDays: 10 }),
            salary({ empId: 'E001', name: '甲', totalWorkHours: 100, overtimeHours: 3, totalWorkDays: 9 }),
        ]);

        expect(result.map(e => e.empId)).toEqual(['E001', 'E002', 'E004', 'E003']);
    });
});

describe('buildSummary — 月結摘要（Phase 8.4）', () => {
    it('彙總數字四捨五入到 0.1 小時', () => {
        const result = buildSummary([
            salary({ totalWorkDays: 10, totalWorkHours: 80.24, overtimeHours: 1.24, totalLeaveHours: 2.25 }),
            salary({ empId: 'E002', totalWorkDays: 11, totalWorkHours: 70.25, overtimeHours: 2.25, totalLeaveHours: 1.25 }),
        ]);

        expect(result).toEqual({
            totalEmployees: 2,
            totalWorkDays: 21,
            totalWorkHours: 150.5,
            totalOvertimeHours: 3.5,
            totalLeaveHours: 3.5,
            avgWorkHoursPerEmployee: 75.3,
        });
    });

    it('空陣列平均為 0，不產生 NaN', () => {
        const result = buildSummary([]);
        expect(result.totalEmployees).toBe(0);
        expect(result.avgWorkHoursPerEmployee).toBe(0);
        expect(Number.isNaN(result.avgWorkHoursPerEmployee)).toBe(false);
    });
});
