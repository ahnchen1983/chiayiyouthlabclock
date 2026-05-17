/**
 * 純計算函式集合 — 不依賴 Firebase、HTTP、I/O
 * 抽離以便單元測試（Vitest）
 *
 * Phase 7.1 — Vitest 測試骨架
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { LeaveStatus, LeaveType } from '../../../types';
import type { ClockRecord, LeaveRequest, ScheduleEvent, StaffShift, SalaryDetail, SystemConfig } from '../../../types';

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

// ==================== 留停期間（Phase 8.2）====================

export interface LeaveOfAbsencePeriod {
    start: string;       // YYYY-MM-DD
    end?: string;        // 空字串或缺值 = 仍在留停
}

/**
 * 計算所有留停期間在 [hireDate, asOf] 區間內被吃掉的「總天數」。
 * - 含頭含尾：(end - start) + 1 天
 * - end 缺值 = 用 asOf 當結束點
 * - 自動裁切到 [hireDate, asOf]
 * - 多筆留停累加
 */
export const computeLeaveOfAbsenceDays = (
    hireDate: string,
    periods: LeaveOfAbsencePeriod[],
    asOf: Date
): number => {
    if (!periods || periods.length === 0) return 0;
    const hire = new Date(hireDate);
    if (Number.isNaN(hire.getTime())) return 0;
    const asOfTime = asOf.getTime();
    const hireTime = hire.getTime();

    let totalDays = 0;
    for (const p of periods) {
        if (!p.start) continue;
        const start = new Date(p.start);
        if (Number.isNaN(start.getTime())) continue;
        const end = (p.end && p.end.length > 0) ? new Date(p.end) : asOf;
        if (Number.isNaN(end.getTime())) continue;

        const clampedStart = Math.max(start.getTime(), hireTime);
        const clampedEnd = Math.min(end.getTime(), asOfTime);
        if (clampedEnd < clampedStart) continue;

        const days = Math.floor((clampedEnd - clampedStart) / (24 * 60 * 60 * 1000)) + 1;
        totalDays += days;
    }
    return totalDays;
};

// ==================== 特休天數計算 ====================

/**
 * 依勞基法計算特休天數（依到職日 → 指定基準日）
 * 6 個月：3 / 1 年：7 / 2 年：10 / 3-4 年：14 / 5-9 年：15
 * 10 年起每增 1 年加 1 天，最多 30 天
 *
 * Phase 8.2：留停期間從年資中扣除（30 天 = 1 個月）
 */
export const computeAnnualLeaveDays = (
    hireDate: string,
    asOf: Date = new Date(),
    leaveOfAbsencePeriods: LeaveOfAbsencePeriod[] = []
): number => {
    if (!hireDate) return 0;
    const hire = new Date(hireDate);
    if (Number.isNaN(hire.getTime())) return 0;
    const rawMonths = (asOf.getFullYear() - hire.getFullYear()) * 12 + (asOf.getMonth() - hire.getMonth());
    // Phase 8.2：扣除留停天數
    const loaDays = computeLeaveOfAbsenceDays(hireDate, leaveOfAbsencePeriods, asOf);
    const loaMonths = Math.floor(loaDays / 30);
    const months = Math.max(0, rawMonths - loaMonths);
    if (months < 6) return 0;
    if (months < 12) return 3;
    const years = Math.floor(months / 12);
    if (years < 2) return 7;
    if (years < 3) return 10;
    if (years < 5) return 14;
    if (years < 10) return 15;
    return Math.min(30, 15 + (years - 9));
};

// ==================== 排班 v2 相容層（Phase 5.1）====================

/**
 * 將任意 Firestore schedule 文件正規化為 v2 結構。
 * 遇到舊版（含 staffA/staffB/partTime/shiftTime）自動轉換為 shifts[]。
 * 不回寫；只是讓後端讀取舊資料時不會崩潰。
 */
export const normalizeScheduleDoc = (raw: any, date: string, dayOfWeek: string): ScheduleEvent => {
    if (!raw) {
        return { date, dayOfWeek, status: '休館', shifts: [] };
    }
    // v2 結構：已有 shifts 陣列
    if (Array.isArray(raw.shifts)) {
        return {
            date,
            dayOfWeek,
            status: raw.status || '休館',
            openingHours: raw.openingHours,
            requiredHeadcount: raw.requiredHeadcount,
            shifts: raw.shifts as StaffShift[],
        };
    }
    // v1 結構：轉換 staffA/staffB/partTime + shiftTime → shifts
    const shiftTime = raw.shiftTime || '';
    const [from = '', to = ''] = shiftTime.includes('-') ? shiftTime.split('-') : ['', ''];
    const shifts: StaffShift[] = [];
    if (raw.staffA && from && to) shifts.push({ empId: '', name: raw.staffA, role: 'staffA', from, to });
    if (raw.staffB && from && to) shifts.push({ empId: '', name: raw.staffB, role: 'staffB', from, to });
    if (Array.isArray(raw.partTime) && from && to) {
        raw.partTime.forEach((name: string) => {
            if (name) shifts.push({ empId: '', name, role: 'partTime', from, to });
        });
    }
    return {
        date,
        dayOfWeek,
        status: raw.status || '營運',
        openingHours: shiftTime || undefined,
        shifts,
    };
};

/**
 * 取得某員工當日的所有 shifts（支援兩頭班）。
 * 比對優先用 empId，若 shift.empId 為空（舊資料轉換）則 fallback 比對 name。
 */
export const getEmployeeShiftsForDay = (event: ScheduleEvent, empId: string, name: string): StaffShift[] => {
    return event.shifts.filter(s =>
        (s.empId && s.empId === empId) || (!s.empId && s.name === name)
    );
};

/**
 * 計算單筆 shift 的時數
 */
export const shiftHours = (s: { from: string; to: string }): number => {
    if (!s.from || !s.to) return 0;
    const [fh, fm] = s.from.split(':').map(Number);
    const [th, tm] = s.to.split(':').map(Number);
    return Math.max(0, (th * 60 + tm - fh * 60 - fm) / 60);
};

/**
 * 員工該日是否被排班（任何角色、任何時段）
 */
export const isEmployeeScheduledForDay = (event: ScheduleEvent, empId: string, name: string): boolean => {
    return getEmployeeShiftsForDay(event, empId, name).length > 0;
};

// ==================== 時段覆蓋率（Phase 5.2）====================

const toMin = (hhmm: string): number => {
    if (!hhmm || !hhmm.includes(':')) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

const toHHMM = (totalMin: number): string => {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export interface CoverageSlot {
    from: string;
    to: string;
    covered: number;    // 實際覆蓋人數（去重 by empId/name）
    required: number;   // 應到人數
    short: number;      // 缺人數（max(0, required - covered)）
}

export interface CoverageGap {
    from: string;
    to: string;
    covered: number;
    required: number;
    short: number;
}

/**
 * 將營業時段切成 30 分鐘區段，計算每段的覆蓋人數
 */
export const computeCoverageSlots = (event: ScheduleEvent, intervalMin: number = 30): CoverageSlot[] => {
    if (!event.openingHours || !event.openingHours.includes('-')) return [];
    const [startStr, endStr] = event.openingHours.split('-');
    const startMin = toMin(startStr);
    const endMin = toMin(endStr);
    if (endMin <= startMin) return [];

    const required = event.requiredHeadcount ?? 0;
    const slots: CoverageSlot[] = [];
    for (let t = startMin; t < endMin; t += intervalMin) {
        const slotFrom = t;
        const slotTo = Math.min(t + intervalMin, endMin);
        // 找出涵蓋此 slot 中點的 shifts（去重 by empId/name）
        const mid = (slotFrom + slotTo) / 2;
        const covered = new Set<string>();
        for (const s of event.shifts) {
            const sFrom = toMin(s.from);
            const sTo = toMin(s.to);
            if (sFrom <= mid && mid < sTo) {
                covered.add(s.empId || `n:${s.name}`);
            }
        }
        slots.push({
            from: toHHMM(slotFrom),
            to: toHHMM(slotTo),
            covered: covered.size,
            required,
            short: Math.max(0, required - covered.size),
        });
    }
    return slots;
};

/**
 * 合併連續缺人的 slots 為較少筆 gap（方便提示）
 */
export const computeCoverageGaps = (event: ScheduleEvent, intervalMin: number = 30): CoverageGap[] => {
    const slots = computeCoverageSlots(event, intervalMin);
    const gaps: CoverageGap[] = [];
    let cur: CoverageGap | null = null;
    for (const s of slots) {
        if (s.short > 0) {
            if (cur && cur.short === s.short && cur.to === s.from) {
                cur.to = s.to;
            } else {
                if (cur) gaps.push(cur);
                cur = { from: s.from, to: s.to, covered: s.covered, required: s.required, short: s.short };
            }
        } else if (cur) {
            gaps.push(cur);
            cur = null;
        }
    }
    if (cur) gaps.push(cur);
    return gaps;
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
        const myShifts = getEmployeeShiftsForDay(event, emp.id, emp.name);
        if (myShifts.length > 0) {
            totalWorkDays++;
            for (const s of myShifts) scheduledHours += shiftHours(s);
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
