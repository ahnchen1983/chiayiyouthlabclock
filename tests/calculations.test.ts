import { describe, it, expect } from 'vitest';
import {
    hashPassword,
    verifyPassword,
    validatePasswordStrength,
    determineClockStatus,
    computeAnnualLeaveDays,
    computeLeaveBalances,
    calculateSalaryForEmployee,
    normalizeScheduleDoc,
    getEmployeeShiftsForDay,
    shiftHours,
    computeCoverageSlots,
    computeCoverageGaps,
    DEFAULT_SYSTEM_CONFIG,
} from '../netlify/functions/utils/calculations';
import { LeaveStatus, LeaveType } from '../types';
import type { ScheduleEvent, ClockRecord, LeaveRequest } from '../types';

// =============================================================
// 密碼
// =============================================================

describe('hashPassword / verifyPassword', () => {
    it('雜湊格式為 salt:hash，且不等於原文', () => {
        const stored = hashPassword('Hello1234');
        expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
        expect(stored).not.toContain('Hello1234');
    });

    it('verifyPassword 對正確密碼回 true', () => {
        const stored = hashPassword('MyPass99');
        expect(verifyPassword('MyPass99', stored)).toBe(true);
    });

    it('verifyPassword 對錯誤密碼回 false', () => {
        const stored = hashPassword('MyPass99');
        expect(verifyPassword('Wrong123', stored)).toBe(false);
    });

    it('向下相容：不含 : 的舊版明文密碼直接比對', () => {
        expect(verifyPassword('legacy', 'legacy')).toBe(true);
        expect(verifyPassword('wrong', 'legacy')).toBe(false);
    });
});

describe('validatePasswordStrength', () => {
    it('合法密碼回 null', () => {
        expect(validatePasswordStrength('Hello123')).toBeNull();
        expect(validatePasswordStrength('Aa123456')).toBeNull();
    });

    it('太短拒絕', () => {
        expect(validatePasswordStrength('Aa1')).toContain('8 個字元');
    });

    it('純數字拒絕（缺英文）', () => {
        expect(validatePasswordStrength('12345678')).toContain('英文字母');
    });

    it('純字母拒絕（缺數字）', () => {
        expect(validatePasswordStrength('abcdefgh')).toContain('數字');
    });
});

// =============================================================
// 遲到 / 早退判定
// =============================================================

describe('determineClockStatus', () => {
    const grace = 5;

    it('準時上下班 = 正常', () => {
        expect(determineClockStatus('08:30-17:30', '08:30', '17:30', grace)).toBe('正常');
    });

    it('上班於寬限內（08:34）= 正常', () => {
        expect(determineClockStatus('08:30-17:30', '08:34', '17:30', grace)).toBe('正常');
    });

    it('上班超過寬限（08:36）= 遲到', () => {
        expect(determineClockStatus('08:30-17:30', '08:36', '17:30', grace)).toBe('遲到');
    });

    it('下班早於排班結束 = 早退', () => {
        expect(determineClockStatus('08:30-17:30', '08:30', '17:20', grace)).toBe('早退');
    });

    it('遲到且早退', () => {
        expect(determineClockStatus('08:30-17:30', '09:00', '17:00', grace)).toBe('遲到+早退');
    });

    it('未設定 shiftTime → 正常', () => {
        expect(determineClockStatus(undefined, '09:30', '20:00', grace)).toBe('正常');
        expect(determineClockStatus('', '09:30', '20:00', grace)).toBe('正常');
    });

    it('未打下班卡（clockOut=null）不算早退', () => {
        expect(determineClockStatus('08:30-17:30', '08:30', null, grace)).toBe('正常');
    });

    it('寬限分鐘可調', () => {
        expect(determineClockStatus('08:30-17:30', '08:40', '17:30', 5)).toBe('遲到');
        expect(determineClockStatus('08:30-17:30', '08:40', '17:30', 15)).toBe('正常');
    });
});

// =============================================================
// 特休天數
// =============================================================

describe('computeAnnualLeaveDays（勞基法）', () => {
    // 以 2026-04-10 為基準日測試
    const asOf = new Date('2026-04-10');

    it('未滿 6 個月 = 0', () => {
        expect(computeAnnualLeaveDays('2026-01-01', asOf)).toBe(0);
    });

    it('6 個月以上未滿 1 年 = 3', () => {
        expect(computeAnnualLeaveDays('2025-10-01', asOf)).toBe(3);
    });

    it('1 年以上未滿 2 年 = 7', () => {
        expect(computeAnnualLeaveDays('2025-01-01', asOf)).toBe(7);
    });

    it('2 年以上未滿 3 年 = 10', () => {
        expect(computeAnnualLeaveDays('2024-01-01', asOf)).toBe(10);
    });

    it('3 年以上未滿 5 年 = 14', () => {
        expect(computeAnnualLeaveDays('2022-01-01', asOf)).toBe(14);
        expect(computeAnnualLeaveDays('2021-05-01', asOf)).toBe(14);
    });

    it('5 年以上未滿 10 年 = 15', () => {
        expect(computeAnnualLeaveDays('2020-01-01', asOf)).toBe(15);
        expect(computeAnnualLeaveDays('2017-01-01', asOf)).toBe(15);
    });

    it('10 年起每年 +1', () => {
        expect(computeAnnualLeaveDays('2016-01-01', asOf)).toBe(16); // 10 年
        expect(computeAnnualLeaveDays('2015-01-01', asOf)).toBe(17); // 11 年
    });

    it('上限 30 天', () => {
        expect(computeAnnualLeaveDays('1990-01-01', asOf)).toBe(30);
    });

    it('空字串或無效日期 = 0', () => {
        expect(computeAnnualLeaveDays('', asOf)).toBe(0);
        expect(computeAnnualLeaveDays('not-a-date', asOf)).toBe(0);
    });
});

// =============================================================
// 留停期間扣除（Phase 8.2）
// =============================================================

describe('computeAnnualLeaveDays — 留停期間扣除（Phase 8.2）', () => {
    it('未留停（傳入空陣列）= 簡單年資計算（向後相容）', () => {
        const asOf = new Date('2026-01-01');
        expect(computeAnnualLeaveDays('2024-01-01', asOf, [])).toBe(10);
        expect(computeAnnualLeaveDays('2024-01-01', asOf)).toBe(10);   // 預設空陣列
    });

    it('留停 183 天（2025-04-01 ~ 2025-09-30）扣 6 個月：24 月 → 18 月 → 7 天', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2025-04-01', end: '2025-09-30' }
        ]);
        expect(days).toBe(7);
    });

    it('留停跨年（2024-10-01 ~ 2025-03-31，182 天）→ 跨年的天數也扣', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2024-10-01', end: '2025-03-31' }
        ]);
        expect(days).toBe(7);
    });

    it('留停尚未結束（end 為空字串）→ 用 asOf 當結束點', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2025-04-01', end: '' }
        ]);
        expect(days).toBe(7);
    });

    it('多次留停累加扣除（helper 支援陣列）', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2024-04-01', end: '2024-06-30' },  // 91 天
            { start: '2025-04-01', end: '2025-06-30' },  // 91 天 → 共 182 天 = 6 個月
        ]);
        expect(days).toBe(7);
    });

    it('留停 < 30 天（不滿一個月）= 不扣月份', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2025-04-01', end: '2025-04-10' }
        ]);
        expect(days).toBe(10);
    });
});

// =============================================================
// 假別餘額
// =============================================================

describe('computeLeaveBalances', () => {
    it('全新員工（無已用）餘額 = 配額', () => {
        const bs = computeLeaveBalances('2025-01-01', [], 2026);
        const annual = bs.find(b => b.leaveType === LeaveType.Annual)!;
        expect(annual.quotaHours).toBe(7 * 8);
        expect(annual.usedHours).toBe(0);
        expect(annual.remainingHours).toBe(56);
    });

    it('累計已用會反映在 used / remaining', () => {
        const bs = computeLeaveBalances('2025-01-01', [
            { leaveType: LeaveType.Annual, hours: 8, startDate: '2026-03-01' },
            { leaveType: LeaveType.Annual, hours: 4, startDate: '2026-04-01' },
        ], 2026);
        const annual = bs.find(b => b.leaveType === LeaveType.Annual)!;
        expect(annual.usedHours).toBe(12);
        expect(annual.remainingHours).toBe(56 - 12);
    });

    it('不同年度不計入', () => {
        const bs = computeLeaveBalances('2025-01-01', [
            { leaveType: LeaveType.Annual, hours: 8, startDate: '2025-12-01' }, // 不同年
        ], 2026);
        const annual = bs.find(b => b.leaveType === LeaveType.Annual)!;
        expect(annual.usedHours).toBe(0);
    });

    it('其他假別不設上限（9999）', () => {
        const bs = computeLeaveBalances('2025-01-01', [], 2026);
        const other = bs.find(b => b.leaveType === LeaveType.Other)!;
        expect(other.quotaHours).toBe(9999);
    });

    it('事假上限 112h / 病假上限 240h', () => {
        const bs = computeLeaveBalances('2025-01-01', [], 2026);
        expect(bs.find(b => b.leaveType === LeaveType.Personal)!.quotaHours).toBe(14 * 8);
        expect(bs.find(b => b.leaveType === LeaveType.Sick)!.quotaHours).toBe(30 * 8);
    });
});

// =============================================================
// 薪資計算
// =============================================================

describe('calculateSalaryForEmployee', () => {
    const fullTimeEmp = {
        id: 'EMP001', name: '小王', position: '專責人員', monthlySalary: 30000, hourlyRate: 0,
    };
    const partTimeEmp = {
        id: 'EMP002', name: '小李', position: '兼職人員', hourlyRate: 200,
    };

    it('專責人員：無打卡 → 底薪即月薪，扣除依配置', () => {
        const result = calculateSalaryForEmployee(fullTimeEmp, '2026-04', [], [], []);
        expect(result.baseSalary).toBe(30000);
        expect(result.overtimePay).toBe(0);
        expect(result.grossSalary).toBe(30000);
        // 勞保 2.3% + 健保 2.11% + 勞退 6% = 10.41% of 30000 ~ 3123
        expect(result.laborInsurance).toBe(Math.round(30000 * 0.023));
        expect(result.healthInsurance).toBe(Math.round(30000 * 0.0211));
        expect(result.laborPensionSelf).toBe(Math.round(30000 * 0.06));
        expect(result.netSalary).toBe(result.grossSalary - result.totalDeductions);
    });

    it('兼職人員：總工時 × 時薪 = 底薪（無加班）', () => {
        const clockRecords: ClockRecord[] = [
            { id: 'C1', empId: 'EMP002', name: '小李', date: '2026-04-01', clockInTime: '09:00', clockOutTime: '13:00', verificationMethod: 'IP', verificationData: '1', workHours: 4, status: '正常' },
            { id: 'C2', empId: 'EMP002', name: '小李', date: '2026-04-02', clockInTime: '09:00', clockOutTime: '13:00', verificationMethod: 'IP', verificationData: '1', workHours: 4, status: '正常' },
        ];
        const schedule: ScheduleEvent[] = [
            { date: '2026-04-01', dayOfWeek: '三', status: '營運', shifts: [
                { empId: 'EMP002', name: '小李', role: 'partTime', from: '09:00', to: '13:00' }
            ] },
            { date: '2026-04-02', dayOfWeek: '四', status: '營運', shifts: [
                { empId: 'EMP002', name: '小李', role: 'partTime', from: '09:00', to: '13:00' }
            ] },
        ];
        const result = calculateSalaryForEmployee(partTimeEmp, '2026-04', schedule, clockRecords, []);
        expect(result.totalWorkHours).toBe(8);
        expect(result.overtimeHours).toBe(0);
        expect(result.baseSalary).toBe(8 * 200);
        expect(result.grossSalary).toBe(8 * 200);
    });

    it('事假扣全薪、病假扣半薪', () => {
        const leaves: LeaveRequest[] = [
            { id: 'L1', empId: 'EMP001', name: '小王', leaveType: LeaveType.Personal, startDate: '2026-04-05T09:00', endDate: '2026-04-05T17:00', hours: 8, reason: '私事', requestDate: '2026-04-04', status: LeaveStatus.Approved },
            { id: 'L2', empId: 'EMP001', name: '小王', leaveType: LeaveType.Sick, startDate: '2026-04-10T09:00', endDate: '2026-04-10T17:00', hours: 8, reason: '感冒', requestDate: '2026-04-09', status: LeaveStatus.Approved },
        ];
        const result = calculateSalaryForEmployee(fullTimeEmp, '2026-04', [], [], leaves);
        const hourly = Math.round(30000 / 30 / 8); // = 125
        // 事假 8h 全扣 + 病假 8h 半扣
        const expectedDeduction = 8 * hourly + Math.round(8 * hourly * 0.5);
        expect(result.leaveDeduction).toBe(expectedDeduction);
        expect(result.totalLeaveHours).toBe(16);
    });

    it('未核准的請假不計扣薪', () => {
        const leaves: LeaveRequest[] = [
            { id: 'L1', empId: 'EMP001', name: '小王', leaveType: LeaveType.Personal, startDate: '2026-04-05T09:00', endDate: '2026-04-05T17:00', hours: 8, reason: '私事', requestDate: '2026-04-04', status: LeaveStatus.Pending },
        ];
        const result = calculateSalaryForEmployee(fullTimeEmp, '2026-04', [], [], leaves);
        expect(result.leaveDeduction).toBe(0);
        expect(result.totalLeaveHours).toBe(0);
    });

    it('config 費率可覆寫', () => {
        const customConfig = { ...DEFAULT_SYSTEM_CONFIG, laborInsuranceRate: 0.05 };
        const result = calculateSalaryForEmployee(fullTimeEmp, '2026-04', [], [], [], customConfig);
        expect(result.laborInsurance).toBe(Math.round(30000 * 0.05));
    });

    it('休館日不計入工作日', () => {
        const schedule: ScheduleEvent[] = [
            { date: '2026-04-01', dayOfWeek: '三', status: '休館', shifts: [] },
        ];
        const result = calculateSalaryForEmployee(fullTimeEmp, '2026-04', schedule, [], []);
        expect(result.totalWorkDays).toBe(0);
    });

    it('兩頭班：同員工同日多筆 shift 時數加總', () => {
        const schedule: ScheduleEvent[] = [
            { date: '2026-04-15', dayOfWeek: '三', status: '營運', shifts: [
                { empId: 'EMP001', name: '小王', role: 'staffA', from: '08:30', to: '13:00' },
                { empId: 'EMP001', name: '小王', role: 'staffA', from: '17:00', to: '20:00' },
            ] },
        ];
        const result = calculateSalaryForEmployee(fullTimeEmp, '2026-04', schedule, [], []);
        expect(result.totalWorkDays).toBe(1);
        // scheduledHours = 4.5 + 3 = 7.5（但 fullTime 是月薪所以工時只影響加班計算）
    });
});

// =============================================================
// 排班 v2 相容層
// =============================================================

describe('normalizeScheduleDoc', () => {
    it('v2 結構（已有 shifts）直接通過', () => {
        const raw = {
            status: '營運',
            shifts: [
                { empId: 'E1', name: '王', role: 'staffA', from: '08:30', to: '17:30' }
            ],
            openingHours: '08:30-17:30',
        };
        const r = normalizeScheduleDoc(raw, '2026-04-15', '三');
        expect(r.shifts).toHaveLength(1);
        expect(r.openingHours).toBe('08:30-17:30');
    });

    it('v1 結構（staffA/B/partTime + shiftTime）自動轉為 shifts', () => {
        const raw = {
            status: '營運',
            shiftTime: '08:30-17:30',
            staffA: '千雯',
            staffB: '小明',
            partTime: ['PT甲', 'PT乙'],
        };
        const r = normalizeScheduleDoc(raw, '2026-04-15', '三');
        expect(r.shifts).toHaveLength(4);
        expect(r.shifts.map(s => s.role)).toEqual(['staffA', 'staffB', 'partTime', 'partTime']);
        expect(r.shifts.every(s => s.from === '08:30' && s.to === '17:30')).toBe(true);
        // 舊資料轉換後 empId 為空，name 保留
        expect(r.shifts[0].empId).toBe('');
        expect(r.shifts[0].name).toBe('千雯');
    });

    it('null/undefined 文件回傳休館空班', () => {
        const r = normalizeScheduleDoc(null, '2026-04-15', '三');
        expect(r.status).toBe('休館');
        expect(r.shifts).toEqual([]);
    });

    it('shiftTime 為空時不轉換 v1 人員（避免無效班次）', () => {
        const r = normalizeScheduleDoc({ status: '休館', staffA: '千雯' }, '2026-04-15', '三');
        expect(r.shifts).toHaveLength(0);
    });
});

describe('getEmployeeShiftsForDay / shiftHours', () => {
    const evt: ScheduleEvent = {
        date: '2026-04-15', dayOfWeek: '三', status: '營運',
        shifts: [
            { empId: 'E1', name: '王', role: 'staffA', from: '08:30', to: '13:00' },
            { empId: 'E1', name: '王', role: 'staffA', from: '17:00', to: '20:00' },
            { empId: 'E2', name: '李', role: 'staffB', from: '13:00', to: '20:00' },
            { empId: '', name: '舊資料張', role: 'partTime', from: '10:00', to: '14:00' },
        ]
    };

    it('依 empId 過濾兩筆兩頭班', () => {
        const r = getEmployeeShiftsForDay(evt, 'E1', '王');
        expect(r).toHaveLength(2);
    });

    it('舊資料 empId 為空時 fallback 用 name', () => {
        const r = getEmployeeShiftsForDay(evt, '', '舊資料張');
        expect(r).toHaveLength(1);
    });

    it('shiftHours 算對', () => {
        expect(shiftHours({ from: '08:30', to: '13:00' })).toBe(4.5);
        expect(shiftHours({ from: '17:00', to: '20:00' })).toBe(3);
        expect(shiftHours({ from: '', to: '13:00' })).toBe(0);
    });
});

// =============================================================
// 時段覆蓋率（Phase 5.2）
// =============================================================

describe('computeCoverageSlots / computeCoverageGaps', () => {
    const evtFull: ScheduleEvent = {
        date: '2026-04-15', dayOfWeek: '三', status: '營運',
        openingHours: '08:30-17:30',
        requiredHeadcount: 2,
        shifts: [
            { empId: 'E1', name: 'A', role: 'staffA', from: '08:30', to: '17:30' },
            { empId: 'E2', name: 'B', role: 'staffB', from: '08:30', to: '17:30' },
        ],
    };

    it('全程覆蓋 2 人 = 無缺人', () => {
        const slots = computeCoverageSlots(evtFull);
        expect(slots.length).toBeGreaterThan(0);
        expect(slots.every(s => s.covered === 2)).toBe(true);
        expect(slots.every(s => s.short === 0)).toBe(true);
        expect(computeCoverageGaps(evtFull)).toEqual([]);
    });

    it('30 分鐘解析度切割正確（9 小時 = 18 個 slot）', () => {
        const slots = computeCoverageSlots(evtFull);
        expect(slots).toHaveLength(18);
        expect(slots[0]).toMatchObject({ from: '08:30', to: '09:00' });
        expect(slots[slots.length - 1]).toMatchObject({ from: '17:00', to: '17:30' });
    });

    it('中午缺人 12:00-13:00 應偵測到', () => {
        const evt: ScheduleEvent = {
            ...evtFull,
            shifts: [
                { empId: 'E1', name: 'A', role: 'staffA', from: '08:30', to: '12:00' },
                { empId: 'E1', name: 'A', role: 'staffA', from: '13:00', to: '17:30' },
                { empId: 'E2', name: 'B', role: 'staffB', from: '08:30', to: '12:00' },
                { empId: 'E2', name: 'B', role: 'staffB', from: '13:00', to: '17:30' },
            ],
        };
        const gaps = computeCoverageGaps(evt);
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toMatchObject({ from: '12:00', to: '13:00', covered: 0, required: 2, short: 2 });
    });

    it('部分覆蓋（1 人在中段）', () => {
        const evt: ScheduleEvent = {
            ...evtFull,
            shifts: [
                { empId: 'E1', name: 'A', role: 'staffA', from: '08:30', to: '13:00' },
                { empId: 'E2', name: 'B', role: 'staffB', from: '12:00', to: '17:30' },
            ],
        };
        const gaps = computeCoverageGaps(evt);
        // 08:30-12:00 只有 A、13:00-17:30 只有 B；中間 12:00-13:00 兩人重疊
        const morningGap = gaps.find(g => g.from === '08:30');
        const afternoonGap = gaps.find(g => g.from === '13:00');
        expect(morningGap?.to).toBe('12:00');
        expect(morningGap?.covered).toBe(1);
        expect(afternoonGap?.to).toBe('17:30');
        expect(afternoonGap?.covered).toBe(1);
    });

    it('無 openingHours 回傳空陣列', () => {
        const evt: ScheduleEvent = {
            date: '2026-04-15', dayOfWeek: '三', status: '營運',
            shifts: [], requiredHeadcount: 2,
        };
        expect(computeCoverageSlots(evt)).toEqual([]);
        expect(computeCoverageGaps(evt)).toEqual([]);
    });

    it('requiredHeadcount=0 時無缺人 gaps', () => {
        const evt: ScheduleEvent = {
            ...evtFull,
            requiredHeadcount: 0,
            shifts: [],
        };
        expect(computeCoverageGaps(evt)).toEqual([]);
    });

    it('兩頭班同人不重複計入覆蓋', () => {
        const evt: ScheduleEvent = {
            date: '2026-04-15', dayOfWeek: '三', status: '營運',
            openingHours: '08:00-20:00',
            requiredHeadcount: 2,
            shifts: [
                { empId: 'E1', name: 'A', role: 'staffA', from: '08:00', to: '13:00' },
                { empId: 'E1', name: 'A', role: 'staffA', from: '15:00', to: '20:00' },
            ],
        };
        const slots = computeCoverageSlots(evt);
        // 即使有 2 筆 shift，同一人覆蓋的 slot 只算 1
        slots.forEach(s => {
            expect(s.covered).toBeLessThanOrEqual(1);
        });
    });
});
