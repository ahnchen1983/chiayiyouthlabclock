/**
 * 純計算函式集合 — 不依賴 Firebase、HTTP、I/O
 * 抽離以便單元測試（Vitest）
 *
 * Phase 7.1 — Vitest 測試骨架
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { LeaveStatus, LeaveType } from '../../../types';
import type { ClockRecord, LeaveRequest, ScheduleEvent, SalaryDetail, SystemConfig } from '../../../types';

// ==================== 密碼 ====================

export const hashPassword = (password: string): string => {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
    // 向下相容：不含 ':' 視為舊版明文
    if (!stored.includes(':')) return password === stored;
    const [salt, hash] = stored.split(':');
    const hashBuffer = Buffer.from(hash, 'hex');
    const testBuffer = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuffer, testBuffer);
};

export const validatePasswordStrength = (password: string): string | null => {
    if (password.length < 8) return '密碼至少需要 8 個字元';
    if (!/[a-zA-Z]/.test(password)) return '密碼需包含英文字母';
    if (!/[0-9]/.test(password)) return '密碼需包含數字';
    return null;
};

// ==================== 系統設定預設 ====================

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
    laborInsuranceRate: 0.023,
    healthInsuranceRate: 0.0211,
    laborPensionRate: 0.06,
    overtimeMultiplier: 1.34,
    ptMonthlyHourLimit: 80,
    ptWarningThreshold: 70,
    lateGraceMinutes: 5,
};

// ==================== 遲到/早退判定 ====================

export const determineClockStatus = (
    shiftTime: string | undefined,
    clockInTime: string | null,
    clockOutTime: string | null,
    graceMinutes: number
): '正常' | '遲到' | '早退' | '遲到+早退' => {
    if (!shiftTime || !shiftTime.includes('-')) return '正常';
    const [start, end] = shiftTime.split('-');
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm + graceMinutes;
    const endMin = eh * 60 + em;

    let isLate = false, isEarly = false;
    if (clockInTime) {
        const [h, m] = clockInTime.split(':').map(Number);
        if (h * 60 + m > startMin) isLate = true;
    }
    if (clockOutTime) {
        const [h, m] = clockOutTime.split(':').map(Number);
        if (h * 60 + m < endMin) isEarly = true;
    }
    if (isLate && isEarly) return '遲到+早退';
    if (isLate) return '遲到';
    if (isEarly) return '早退';
    return '正常';
};

// ==================== 特休天數計算 ====================

/**
 * 依勞基法計算特休天數（依到職日 → 指定基準日）
 * 6 個月：3 / 1 年：7 / 2 年：10 / 3-4 年：14 / 5-9 年：15
 * 10 年起每增 1 年加 1 天，最多 30 天
 */
export const computeAnnualLeaveDays = (hireDate: string, asOf: Date = new Date()): number => {
    if (!hireDate) return 0;
    const hire = new Date(hireDate);
    if (Number.isNaN(hire.getTime())) return 0;
    const months = (asOf.getFullYear() - hire.getFullYear()) * 12 + (asOf.getMonth() - hire.getMonth());
    if (months < 6) return 0;
    if (months < 12) return 3;
    const years = Math.floor(months / 12);
    if (years < 2) return 7;
    if (years < 3) return 10;
    if (years < 5) return 14;
    if (years < 10) return 15;
    return Math.min(30, 15 + (years - 9));
};

// ==================== 薪資計算 ====================

export const calculateSalaryForEmployee = (
    emp: any,
    yearMonth: string,
    scheduleEvents: ScheduleEvent[],
    clockRecords: ClockRecord[],
    leaveRequests: LeaveRequest[],
    config: SystemConfig = DEFAULT_SYSTEM_CONFIG
): SalaryDetail => {
    let totalWorkDays = 0;
    let scheduledHours = 0;
    for (const event of scheduleEvents) {
        if (!event || event.status === '休館') continue;
        const staffList = [event.staffA, event.staffB, ...(event.partTime || [])];
        if (staffList.includes(emp.name)) {
            totalWorkDays++;
            if (event.shiftTime) {
                const [start, end] = event.shiftTime.split('-');
                const [sh, sm] = start.split(':').map(Number);
                const [eh, em] = end.split(':').map(Number);
                scheduledHours += (eh + em / 60) - (sh + sm / 60);
            }
        }
    }

    const empRecords = clockRecords.filter(r => r.empId === emp.id && r.date.startsWith(yearMonth));
    const totalWorkHours = empRecords.length > 0
        ? empRecords.reduce((sum, r) => sum + (r.workHours || 0), 0)
        : scheduledHours;

    const empLeaves = leaveRequests.filter(
        lr => lr.empId === emp.id && lr.status === LeaveStatus.Approved && lr.startDate.slice(0, 7) === yearMonth
    );
    const totalLeaveHours = empLeaves.reduce((sum, lr) => sum + lr.hours, 0);
    const leaveDetails = empLeaves.map(lr => ({ type: lr.leaveType, hours: lr.hours }));

    const overtimeHours = Math.max(0, totalWorkHours - totalWorkDays * 8);
    let baseSalary: number;
    if (emp.position === '專責人員') {
        baseSalary = emp.monthlySalary || 30000;
    } else {
        baseSalary = Math.round((totalWorkHours - overtimeHours) * emp.hourlyRate);
    }

    const hourlyForOT = emp.position === '專責人員' ? Math.round((emp.monthlySalary || 30000) / 30 / 8) : emp.hourlyRate;
    const overtimePay = Math.round(overtimeHours * hourlyForOT * config.overtimeMultiplier);
    const grossSalary = baseSalary + overtimePay;

    const hourlyWage = emp.position === '專責人員' ? Math.round((emp.monthlySalary || 30000) / 30 / 8) : emp.hourlyRate;
    let leaveDeduction = 0;
    empLeaves.forEach(lr => {
        if (lr.leaveType === LeaveType.Personal) leaveDeduction += lr.hours * hourlyWage;
        else if (lr.leaveType === LeaveType.Sick) leaveDeduction += Math.round(lr.hours * hourlyWage * 0.5);
    });

    const laborInsurance = Math.round(grossSalary * config.laborInsuranceRate);
    const healthInsurance = Math.round(grossSalary * config.healthInsuranceRate);
    const laborPensionSelf = Math.round(grossSalary * config.laborPensionRate);
    const totalDeductions = laborInsurance + healthInsurance + laborPensionSelf + leaveDeduction;
    const netSalary = grossSalary - totalDeductions;

    return {
        empId: emp.id, name: emp.name, position: emp.position, yearMonth,
        totalWorkDays, totalWorkHours: Math.round(totalWorkHours * 10) / 10,
        totalLeaveHours, leaveDetails,
        overtimeHours: Math.round(overtimeHours * 10) / 10,
        baseSalary, overtimePay, grossSalary,
        laborInsurance, healthInsurance, laborPensionSelf,
        leaveDeduction, totalDeductions, netSalary,
    };
};

// ==================== 假別餘額計算（pure 版本，由 api.ts 包裝 DB 讀取） ====================

interface LeaveBalanceQuota {
    leaveType: LeaveType;
    quotaHours: number;
    usedHours: number;
    remainingHours: number;
    note: string;
}

/**
 * 依員工 + 已核准請假紀錄計算各假別年度餘額
 */
export const computeLeaveBalances = (
    hireDate: string,
    approvedLeaves: { leaveType: string; hours: number; startDate: string }[],
    year: number = new Date().getFullYear()
): LeaveBalanceQuota[] => {
    const annualDays = computeAnnualLeaveDays(hireDate);
    const usedByType = new Map<string, number>();
    approvedLeaves.forEach(lr => {
        if (!lr.startDate.startsWith(String(year))) return;
        usedByType.set(lr.leaveType, (usedByType.get(lr.leaveType) || 0) + (lr.hours || 0));
    });

    const quotas: Record<string, { hours: number; note: string }> = {
        [LeaveType.Annual]:   { hours: annualDays * 8, note: `依到職日 ${hireDate || '未設定'} 計算 ${annualDays} 天` },
        [LeaveType.Personal]: { hours: 14 * 8, note: '勞基法事假上限 14 天/年（不給薪）' },
        [LeaveType.Sick]:     { hours: 30 * 8, note: '勞基法普通病假上限 30 天/年（半薪）' },
        [LeaveType.Other]:    { hours: 9999, note: '其他假別不設上限' },
    };

    return Object.entries(quotas).map(([type, q]) => ({
        leaveType: type as LeaveType,
        quotaHours: q.hours,
        usedHours: Math.round((usedByType.get(type) || 0) * 10) / 10,
        remainingHours: Math.round((q.hours - (usedByType.get(type) || 0)) * 10) / 10,
        note: q.note,
    }));
};
