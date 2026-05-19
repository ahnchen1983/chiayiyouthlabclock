/**
 * 月結報表 — 純聚合函數，無 I/O
 * Phase 8.4
 */
import type { ClockRecord, LeaveRequest, SalaryDetail, MonthlyReportData } from '../../../types';
import { LeaveStatus, LeaveType } from '../../../types';

const round1 = (value: number): number => Math.round(value * 10) / 10;

export const aggregateLeaveDistribution = (
    leaveRequests: LeaveRequest[],
    yearMonth: string,
): MonthlyReportData['leaveDistribution'] => {
    const dist: MonthlyReportData['leaveDistribution'] = {
        [LeaveType.Annual]: 0,
        [LeaveType.Sick]: 0,
        [LeaveType.Personal]: 0,
        [LeaveType.Other]: 0,
    };

    for (const lr of leaveRequests) {
        if (lr.status !== LeaveStatus.Approved) continue;
        if (!lr.startDate || lr.startDate.slice(0, 7) !== yearMonth) continue;
        if (dist[lr.leaveType] !== undefined) {
            dist[lr.leaveType] += lr.hours || 0;
        }
    }

    (Object.keys(dist) as LeaveType[]).forEach(k => {
        dist[k] = round1(dist[k]);
    });

    return dist;
};

/**
 * 異常打卡分類聚合。
 * 一筆紀錄可能同時被算進多個欄位（如同時遲到 + 漏打卡）。
 */
export const aggregateClockAnomalies = (
    records: ClockRecord[],
): MonthlyReportData['clockAnomalies'] => {
    let lateCount = 0;
    let earlyLeaveCount = 0;
    let missingClockOutCount = 0;
    let manuallyEditedCount = 0;
    let makeupCount = 0;

    for (const r of records) {
        if (r.status && r.status.includes('遲到')) lateCount++;
        if (r.status && r.status.includes('早退')) earlyLeaveCount++;
        if (r.clockInTime && !r.clockOutTime) missingClockOutCount++;
        if (r.manuallyEdited === true) manuallyEditedCount++;
        if (r.source === 'makeup') makeupCount++;
    }

    return { lateCount, earlyLeaveCount, missingClockOutCount, manuallyEditedCount, makeupCount };
};

/**
 * 員工工時排名（desc by totalHours，穩定排序）。
 * tie-break: overtimeHours desc → workDays desc → empId asc。
 */
export const rankEmployeesByHours = (
    salaries: SalaryDetail[],
): MonthlyReportData['employeeRanking'] => {
    return [...salaries]
        .map(s => ({
            empId: s.empId,
            name: s.name,
            totalHours: s.totalWorkHours,
            overtimeHours: s.overtimeHours,
            workDays: s.totalWorkDays,
        }))
        .sort((a, b) => {
            if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
            if (b.overtimeHours !== a.overtimeHours) return b.overtimeHours - a.overtimeHours;
            if (b.workDays !== a.workDays) return b.workDays - a.workDays;
            return a.empId.localeCompare(b.empId);
        });
};

export const buildSummary = (
    salaries: SalaryDetail[],
): MonthlyReportData['summary'] => {
    const totalEmployees = salaries.length;
    const totalWorkDays = salaries.reduce((sum, salary) => sum + salary.totalWorkDays, 0);
    const totalWorkHours = round1(salaries.reduce((sum, salary) => sum + salary.totalWorkHours, 0));
    const totalOvertimeHours = round1(salaries.reduce((sum, salary) => sum + salary.overtimeHours, 0));
    const totalLeaveHours = round1(salaries.reduce((sum, salary) => sum + salary.totalLeaveHours, 0));
    const avgWorkHoursPerEmployee = totalEmployees > 0 ? round1(totalWorkHours / totalEmployees) : 0;

    return {
        totalEmployees,
        totalWorkDays,
        totalWorkHours,
        totalOvertimeHours,
        totalLeaveHours,
        avgWorkHoursPerEmployee,
    };
};
