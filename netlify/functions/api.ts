import type { Handler } from '@netlify/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { db, adminAuth, adminMessaging } from './utils/firebaseAdmin';
import {
    hashPassword, verifyPassword, validatePasswordStrength,
    DEFAULT_SYSTEM_CONFIG, determineClockStatus,
    computeAnnualLeaveDays, computeLeaveBalanceWithCarryover,
    calculateSalaryForEmployee,
    normalizeScheduleDoc, getEmployeeShiftsForDay, isEmployeeScheduledForDay, shiftHours,
    computeCoverageGaps,
} from './utils/calculations';
import { getMonthKey, isMonthLocked } from './utils/monthLock';
import { validateLeaveOfAbsenceRequest } from './utils/selfServiceRequests';
import { validateStaffPreference } from './utils/staffPreferences';
import { buildFcmPayload, filterActiveTokens, tokenIdFromToken, tokensToDelete } from './utils/fcm';
import { executeSwap, validateSwapRequest } from './utils/shiftSwap';
import {
    aggregateClockAnomalies,
    aggregateLeaveDistribution,
    buildSummary,
    rankEmployeesByHours,
} from './utils/monthlyReport';
import { buildSnapshotFromSchedule } from './utils/scheduleVersion';
import { corsHeaders } from './utils/cors';
import {
    generateSecret as totpGenerateSecret,
    verifyTotp,
    buildOtpAuthUrl,
    generateRecoveryCodes,
    hashRecoveryCode,
    findRecoveryCodeIndex,
} from './utils/totp';
import { randomBytes as randomBytesNode } from 'crypto';
import type { StaffShift, StaffRole, MonthLock, MonthlyReportData, LeaveOfAbsenceRequest, ScheduleVersion, ShiftSwapRequest, StaffPreference, FcmTokenDoc } from '../../types';
import { UserRole, LeaveStatus, LeaveType } from '../../types';
import type { ClockRecord, LeaveRequest, Employee, ScheduleEvent, SalaryDetail, TodayAttendanceComparison, PendingItem, SystemConfig, ClockMakeupRequest, Notification, NotificationType } from '../../types';

const dayOfWeekMap = ['日', '一', '二', '三', '四', '五', '六'];

// ==================== 防暴力破解 Helper ====================

const LOGIN_FAIL_LIMIT = 5;
const LOCKOUT_MINUTES = 15;

const checkLoginLockout = async (empId: string): Promise<{ locked: boolean; message?: string }> => {
    const ref = db.collection('loginAttempts').doc(empId);
    const snap = await ref.get();
    if (!snap.exists) return { locked: false };
    const data = snap.data()!;
    if (data.failCount >= LOGIN_FAIL_LIMIT) {
        const lockUntil = new Date(data.lastFailAt).getTime() + LOCKOUT_MINUTES * 60 * 1000;
        if (Date.now() < lockUntil) {
            const remainMin = Math.ceil((lockUntil - Date.now()) / 60000);
            return { locked: true, message: `帳號已鎖定，請 ${remainMin} 分鐘後再試` };
        }
        // 鎖定已過期，重設
        await ref.delete();
    }
    return { locked: false };
};

const recordLoginFail = async (empId: string) => {
    const ref = db.collection('loginAttempts').doc(empId);
    const snap = await ref.get();
    const failCount = snap.exists ? (snap.data()!.failCount || 0) + 1 : 1;
    await ref.set({ failCount, lastFailAt: new Date().toISOString() });
};

const clearLoginFails = async (empId: string) => {
    await db.collection('loginAttempts').doc(empId).delete().catch(() => {});
};

// ==================== 稽核日誌 Helper ====================

const writeAuditLog = async (userId: string, action: string, targetId: string, details: string) => {
    await db.collection('auditLogs').add({
        timestamp: new Date().toISOString(),
        userId,
        action,
        targetId,
        details,
    });
};

// ==================== 系統設定 Helper ====================

const getSystemConfig = async (): Promise<SystemConfig> => {
    const snap = await db.collection('systemConfig').doc('salary').get();
    if (!snap.exists) return { ...DEFAULT_SYSTEM_CONFIG };
    return { ...DEFAULT_SYSTEM_CONFIG, ...(snap.data() as Partial<SystemConfig>) };
};

// ==================== 月結鎖定 Helper（Phase 6.3）====================

const getMonthLock = async (yearMonth: string): Promise<MonthLock | null> => {
    const snap = await db.collection('monthLocks').doc(yearMonth).get();
    if (!snap.exists) return null;
    return snap.data() as MonthLock;
};

const createScheduleVersionInternal = async (
    createdBy: string,
    createdByName: string,
    yearMonth: string,
    auto: ScheduleVersion['auto'],
    note?: string,
): Promise<string> => {
    const events = await getMonthlyDailySchedule(yearMonth);
    const snapshot = buildSnapshotFromSchedule(events);
    const docRef = db.collection('scheduleVersions').doc();
    const version: ScheduleVersion = {
        id: docRef.id,
        yearMonth,
        snapshot,
        auto,
        createdBy,
        createdByName,
        createdAt: new Date().toISOString(),
        ...(note ? { note } : {}),
    };
    await docRef.set(version);
    return docRef.id;
};

// 給 6 個 actions 共用：擋下「修改鎖定月份資料」的請求
const assertMonthNotLocked = async (date: string): Promise<{ locked: boolean; lock?: MonthLock }> => {
    const monthKey = getMonthKey(date);
    if (!monthKey) return { locked: false };
    const lock = await getMonthLock(monthKey);
    if (lock && isMonthLocked(lock)) return { locked: true, lock };
    return { locked: false };
};

// ==================== 通知 Helper ====================

const writeNotification = async (
    empId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string
) => {
    const ref = await db.collection('notifications').add({
        empId,
        type,
        title,
        message,
        read: false,
        createdAt: new Date().toISOString(),
        ...(link ? { link } : {}),
    });
    pushToEmpFcmTokens(empId, { type, title, message, link, notificationId: ref.id }).catch(() => {});
};

const pushToEmpFcmTokens = async (
    empId: string,
    payload: { type: NotificationType; title: string; message: string; link?: string; notificationId: string },
): Promise<void> => {
    const snap = await db.collection('fcmTokens').where('empId', '==', empId).get();
    if (snap.empty) return;
    const allTokens = snap.docs.map(d => ({ ...(d.data() as FcmTokenDoc), tokenId: d.id }));
    const activeTokens = filterActiveTokens(allTokens);
    if (activeTokens.length === 0) return;

    const fcmPayload = buildFcmPayload(payload);
    const messaging = adminMessaging();
    const results = await Promise.all(activeTokens.map(async tokenDoc => {
        try {
            await messaging.send({
                token: tokenDoc.token,
                ...fcmPayload,
            });
            await db.collection('fcmTokens').doc(tokenDoc.tokenId).update({
                failureCount: 0,
                lastSeenAt: new Date().toISOString(),
            });
            return { tokenId: tokenDoc.tokenId };
        } catch (err: any) {
            return { tokenId: tokenDoc.tokenId, error: { code: err?.code || 'unknown' } };
        }
    }));

    const deleteIds = tokensToDelete(results);
    await Promise.all(deleteIds.map(id => db.collection('fcmTokens').doc(id).delete()));

    const deleteSet = new Set(deleteIds);
    await Promise.all(results
        .filter(result => result.error && !deleteSet.has(result.tokenId))
        .map(result => db.collection('fcmTokens').doc(result.tokenId).update({
            failureCount: FieldValue.increment(1),
        })));
};

// ==================== 假別餘額 Helper（Phase 4.1）====================

/**
 * 取得指定員工本年度的假別餘額（依勞基法 + 已核准請假時數）
 */
const getLeaveBalanceForEmployee = async (empId: string): Promise<any[]> => {
    const empSnap = await db.collection('employees').doc(empId).get();
    if (!empSnap.exists) return [];
    const emp = empSnap.data()!;
    const asOf = new Date();
    const year = asOf.getFullYear();
    // Phase 8.2：將員工留停期間傳入年資計算
    const loaPeriods = emp.leaveOfAbsenceStart
        ? [{ start: emp.leaveOfAbsenceStart, end: emp.leaveOfAbsenceEnd }]
        : [];

    // 讀全部已核准假；同時做兩件事：
    //   1) 本年度其他假別 → usedByTypeThisYear（保留原行為）
    //   2) 特休 → 按年份聚合給 computeLeaveBalanceWithCarryover 用
    const lrSnap = await db.collection('leaveRequests').where('empId', '==', empId).get();
    const usedByTypeThisYear = new Map<string, number>();
    const annualLeaveUsageByYear: Record<number, number> = {};
    lrSnap.docs.forEach(d => {
        const lr = d.data();
        if (lr.status !== LeaveStatus.Approved) return;
        if (!lr.startDate) return;
        const lrYear = Number(lr.startDate.slice(0, 4));
        if (Number.isNaN(lrYear)) return;
        if (lrYear === year) {
            usedByTypeThisYear.set(lr.leaveType, (usedByTypeThisYear.get(lr.leaveType) || 0) + (lr.hours || 0));
        }
        if (lr.leaveType === LeaveType.Annual) {
            annualLeaveUsageByYear[lrYear] = (annualLeaveUsageByYear[lrYear] || 0) + (lr.hours || 0);
        }
    });

    // Phase 8.1：特休跨年結轉計算
    const annualSnap = computeLeaveBalanceWithCarryover(emp.hireDate, asOf, loaPeriods, annualLeaveUsageByYear);
    const annualQuotaHours = annualSnap.newGrantedHours + annualSnap.carriedFromPreviousYear;
    const carriedNote = annualSnap.carriedFromPreviousYear > 0
        ? `；其中 ${annualSnap.carriedFromPreviousYear}h 為去年結轉，於 ${annualSnap.carriedExpiresAt} 失效`
        : '';
    const expiredNote = annualSnap.expiredHours > 0
        ? `；已失效 ${annualSnap.expiredHours}h（超過 1 年保留期）`
        : '';

    const quotas: Record<string, { hours: number; note: string }> = {
        [LeaveType.Annual]: {
            hours: annualQuotaHours,
            note: `依到職日 ${emp.hireDate || '未設定'} 計算本年 ${annualSnap.newGrantedHours / 8} 天${carriedNote}${expiredNote}`,
        },
        [LeaveType.Personal]: { hours: 14 * 8, note: '勞基法事假上限 14 天/年（不給薪）' },
        [LeaveType.Sick]:     { hours: 30 * 8, note: '勞基法普通病假上限 30 天/年（半薪）' },
        [LeaveType.Other]:    { hours: 9999, note: '其他假別不設上限' },
    };

    return Object.entries(quotas).map(([type, q]) => {
        if (type === LeaveType.Annual) {
            return {
                leaveType: type,
                quotaHours: q.hours,
                usedHours: annualSnap.usedHours,
                remainingHours: annualSnap.remainingHours,
                note: q.note,
                annualLeaveDetail: annualSnap,
            };
        }
        const used = usedByTypeThisYear.get(type) || 0;
        return {
            leaveType: type,
            quotaHours: q.hours,
            usedHours: Math.round(used * 10) / 10,
            remainingHours: Math.round((q.hours - used) * 10) / 10,
            note: q.note,
        };
    });
};

// ==================== 回應 Helper ====================

// Phase 9.1：module-level event ref，讓 ok()/fail() 自動帶上對應的 CORS headers
// 而不必修改 116 個既有呼叫點。Netlify Functions 每次 invocation 都會在
// handler 開頭重新指派此值，無 race condition 風險。
let _currentRequestOrigin: string | undefined;

const responseHeaders = (extra: Record<string, string> = {}) => ({
    'Content-Type': 'application/json',
    ...corsHeaders(_currentRequestOrigin),
    ...extra,
});

const ok = (data: unknown) => ({
    statusCode: 200,
    headers: responseHeaders(),
    body: JSON.stringify(data),
});

const fail = (status: number, message: string) => ({
    statusCode: status,
    headers: responseHeaders(),
    body: JSON.stringify({ error: message }),
});

// ==================== 驗證 Token ====================

const verifyToken = async (authHeader?: string) => {
    const token = authHeader?.split('Bearer ')[1];
    if (!token) return null;
    try {
        return await adminAuth.verifyIdToken(token);
    } catch {
        return null;
    }
};

// ==================== 班表 Helper ====================

const getScheduleTemplates = async () => {
    const snap = await db.collection('scheduleTemplate').get();
    const templates: any[] = new Array(7);
    snap.docs.forEach(d => { templates[Number(d.id)] = d.data(); });
    return templates;
};

/**
 * 取得指定月份的逐日班表。
 * 優先讀取 dailySchedule/{date}，不存在則 fallback 到 scheduleTemplate。
 */
const getMonthlyDailySchedule = async (yearMonth: string): Promise<ScheduleEvent[]> => {
    const [year, month] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    // 批次讀取該月所有 dailySchedule 文件
    const dateKeys: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
        dateKeys.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    const dailySnap = await db.collection('dailySchedule')
        .where('__name__', 'in', dateKeys.length <= 30 ? dateKeys : dateKeys.slice(0, 30))
        .get();
    // Firestore 'in' 上限 30，剛好一個月最多 31 天，分批處理第 31 天
    let extraDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    if (dateKeys.length > 30) {
        extraDoc = await db.collection('dailySchedule').doc(dateKeys[30]).get();
    }

    const dailyMap = new Map<string, any>();
    dailySnap.docs.forEach(d => dailyMap.set(d.id, d.data()));
    if (extraDoc?.exists) dailyMap.set(extraDoc.id, extraDoc.data());

    // Fallback: 讀取模板
    const templates = await getScheduleTemplates();

    const schedule: ScheduleEvent[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = dateKeys[day - 1];
        const dow = new Date(year, month - 1, day).getDay();
        const dowStr = dayOfWeekMap[dow];
        const daily = dailyMap.get(dateStr);
        if (daily) {
            schedule.push(normalizeScheduleDoc(daily, dateStr, dowStr));
        } else {
            // Fallback：當日無 dailySchedule，從模板提取 status/openingHours，但 shifts 為空
            // （模板僅描述「該星期幾」預設的營業時段與班次結構，不含具體人員）
            const tmpl = templates[dow] || {};
            schedule.push({
                date: dateStr,
                dayOfWeek: dowStr,
                status: tmpl.status || '休館',
                openingHours: tmpl.openingHours || tmpl.shiftTime, // v1 模板可能仍叫 shiftTime
                requiredHeadcount: tmpl.requiredHeadcount,
                shifts: [],
            });
        }
    }
    return schedule;
};

/**
 * 取得單日班表（優先 dailySchedule，fallback template）
 * 回傳已正規化的 ScheduleEvent
 */
const getDaySchedule = async (dateStr: string): Promise<ScheduleEvent> => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dowStr = dayOfWeekMap[dow];
    const dailyDoc = await db.collection('dailySchedule').doc(dateStr).get();
    if (dailyDoc.exists) {
        return normalizeScheduleDoc(dailyDoc.data(), dateStr, dowStr);
    }
    const templates = await getScheduleTemplates();
    const tmpl = templates[dow] || {};
    return {
        date: dateStr, dayOfWeek: dowStr,
        status: tmpl.status || '休館',
        openingHours: tmpl.openingHours || tmpl.shiftTime,
        requiredHeadcount: tmpl.requiredHeadcount,
        shifts: [],
    };
};

/**
 * 求員工當日的「主要排班時段」用於遲到/早退判定。
 * 規則：取最早 from 與最晚 to（兩頭班視為一整天工時範圍）。
 */
const getEmployeeShiftRangeStr = (event: ScheduleEvent, empId: string, empName: string): string | undefined => {
    const shifts = getEmployeeShiftsForDay(event, empId, empName);
    if (shifts.length === 0) return undefined;
    const sortedFrom = shifts.map(s => s.from).filter(Boolean).sort();
    const sortedTo = shifts.map(s => s.to).filter(Boolean).sort();
    if (sortedFrom.length === 0 || sortedTo.length === 0) return undefined;
    return `${sortedFrom[0]}-${sortedTo[sortedTo.length - 1]}`;
};

const getEmployeeScheduledHours = (event: ScheduleEvent, empId: string, empName: string): number => {
    return Math.round(getEmployeeShiftsForDay(event, empId, empName).reduce((sum, s) => sum + shiftHours(s), 0) * 10) / 10;
};

const getApprovedLeaveHoursOnDate = (leaveRequests: LeaveRequest[], empId: string, date: string): number => {
    return leaveRequests
        .filter(lr => lr.empId === empId && lr.status === LeaveStatus.Approved && lr.startDate.slice(0, 10) <= date && lr.endDate.slice(0, 10) >= date)
        .reduce((sum, lr) => sum + (lr.hours || 0), 0);
};

const toMinutes = (hhmm: string | null | undefined): number | null => {
    if (!hhmm || !hhmm.includes(':')) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const getTimeMinutesFromDateTime = (value: string, fallback: number): number => {
    if (!value.includes('T')) return fallback;
    return toMinutes(value.split('T')[1]?.slice(0, 5)) ?? fallback;
};

const getApprovedLeaveWindowsOnDate = (
    leaveRequests: LeaveRequest[],
    empId: string,
    date: string,
): { start: number; end: number; minutes: number }[] => {
    return leaveRequests
        .filter(lr => lr.empId === empId && lr.status === LeaveStatus.Approved && lr.startDate.slice(0, 10) <= date && lr.endDate.slice(0, 10) >= date)
        .map(lr => {
            const startsToday = lr.startDate.slice(0, 10) === date;
            const endsToday = lr.endDate.slice(0, 10) === date;
            const start = startsToday ? getTimeMinutesFromDateTime(lr.startDate, 0) : 0;
            const end = endsToday ? getTimeMinutesFromDateTime(lr.endDate, 24 * 60) : 24 * 60;
            return { start, end, minutes: Math.round((lr.hours || 0) * 60) };
        });
};

const isFullShiftLeave = (leaveHours: number, scheduledHours: number): boolean => {
    return scheduledHours > 0 && leaveHours >= scheduledHours;
};

const adjustClockStatusForPartialLeave = (
    status: '正常' | '遲到' | '早退' | '遲到+早退',
    shiftRange: string | undefined,
    clockInTime: string | null,
    clockOutTime: string | null,
    leaveWindows: { start: number; end: number; minutes: number }[],
    graceMinutes: number,
): '正常' | '遲到' | '早退' | '遲到+早退' => {
    if (status === '正常' || !shiftRange || !shiftRange.includes('-') || leaveWindows.length === 0) return status;
    const [shiftStartStr, shiftEndStr] = shiftRange.split('-');
    const shiftStart = toMinutes(shiftStartStr);
    const shiftEnd = toMinutes(shiftEndStr);
    const clockIn = toMinutes(clockInTime);
    const clockOut = toMinutes(clockOutTime);
    if (shiftStart == null || shiftEnd == null) return status;

    const leaveMinutes = leaveWindows.reduce((sum, w) => sum + w.minutes, 0);
    const lateMinutes = clockIn == null ? 0 : Math.max(0, clockIn - (shiftStart + graceMinutes));
    const earlyMinutes = clockOut == null ? 0 : Math.max(0, shiftEnd - clockOut);
    const leaveCoversLate = lateMinutes > 0 && (
        leaveWindows.some(w => w.start <= shiftStart && w.end >= clockIn!) ||
        leaveMinutes >= lateMinutes
    );
    const leaveCoversEarly = earlyMinutes > 0 && (
        leaveWindows.some(w => w.start <= clockOut! && w.end >= shiftEnd) ||
        leaveMinutes >= earlyMinutes
    );

    const isLate = (status === '遲到' || status === '遲到+早退') && !leaveCoversLate;
    const isEarly = (status === '早退' || status === '遲到+早退') && !leaveCoversEarly;
    if (isLate && isEarly) return '遲到+早退';
    if (isLate) return '遲到';
    if (isEarly) return '早退';
    return '正常';
};

const computeComparisonAttendanceStatus = (
    record: ClockRecord | undefined,
    shiftRange: string | undefined,
    isScheduled: boolean,
    leaveHours: number,
    leaveWindows: { start: number; end: number; minutes: number }[],
    scheduledHours: number,
    graceMinutes: number,
): '正常' | '遲到' | '早退' | '遲到+早退' | '異常' | '缺勤' | '休假' | '-' => {
    if (!isScheduled) return '-';
    if (!record) return isFullShiftLeave(leaveHours, scheduledHours) ? '休假' : '缺勤';
    if (!record.clockInTime || !record.clockOutTime) return '異常';
    const status = determineClockStatus(shiftRange, record.clockInTime, record.clockOutTime, graceMinutes);
    return adjustClockStatusForPartialLeave(status, shiftRange, record.clockInTime, record.clockOutTime, leaveWindows, graceMinutes);
};

const computeTodayAttendanceStatus = (
    record: ClockRecord | undefined,
    shiftRange: string | undefined,
    isScheduled: boolean,
    leaveHours: number,
    leaveWindows: { start: number; end: number; minutes: number }[],
    scheduledHours: number,
    graceMinutes: number,
): TodayAttendanceComparison['status'] => {
    if (!isScheduled) return leaveHours > 0 ? '休假' : '未排班';
    if (!record) return isFullShiftLeave(leaveHours, scheduledHours) ? '休假' : '未到';
    if (!record.clockInTime && record.clockOutTime) return '異常';
    if (!record.clockInTime) return isFullShiftLeave(leaveHours, scheduledHours) ? '休假' : '未到';
    const status = determineClockStatus(shiftRange, record.clockInTime, record.clockOutTime || null, graceMinutes);
    const adjustedStatus = adjustClockStatusForPartialLeave(status, shiftRange, record.clockInTime, record.clockOutTime || null, leaveWindows, graceMinutes);
    return adjustedStatus === '正常' ? '已到' : adjustedStatus;
};

/**
 * 取得指定月份的逐日班表（以 Map 回傳，供薪資等計算用）
 */
const getMonthlyScheduleMap = async (yearMonth: string): Promise<Map<string, any>> => {
    const events = await getMonthlyDailySchedule(yearMonth);
    const map = new Map<string, any>();
    events.forEach(e => map.set(e.date, e));
    return map;
};

const getSwapScheduleContext = async (fromDate: string, toDate: string): Promise<{
    schedule: Record<string, ScheduleEvent>;
    locks: Record<string, MonthLock | null>;
}> => {
    const fromDay = await getDaySchedule(fromDate);
    const toDay = fromDate === toDate ? fromDay : await getDaySchedule(toDate);
    const fromMonth = getMonthKey(fromDate);
    const toMonth = getMonthKey(toDate);
    const locks: Record<string, MonthLock | null> = {};
    if (fromMonth) locks[fromMonth] = await getMonthLock(fromMonth);
    if (toMonth && toMonth !== fromMonth) locks[toMonth] = await getMonthLock(toMonth);
    return {
        schedule: { [fromDate]: fromDay, [toDate]: toDay },
        locks,
    };
};

// ==================== Handler 主體 ====================

export const handler: Handler = async (event) => {
    // Phase 9.1：記錄當次請求 origin，讓所有 ok()/fail() 自動帶 CORS
    _currentRequestOrigin = (event.headers.origin || event.headers.Origin) as string | undefined;

    // CORS Preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders(_currentRequestOrigin), body: '' };
    }

    // CSP violation report（走 Content-Type 判斷，與 action 機制隔離）
    const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '') as string;
    if (event.httpMethod === 'POST' && contentType.includes('application/csp-report')) {
        try {
            console.warn('[CSP Report]', event.body);
        } catch { /* swallow */ }
        return { statusCode: 204, headers: corsHeaders(_currentRequestOrigin), body: '' };
    }

    if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

    let body: any;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return fail(400, 'Invalid JSON');
    }

    const { action, ...data } = body;

    // ---- 不需要驗證的 action ----
    if (action === 'login') {
        try {
            // 防暴力破解：檢查鎖定狀態
            const lockout = await checkLoginLockout(data.empId);
            if (lockout.locked) return ok({ error: lockout.message });

            const snap = await db.collection('employees').doc(data.empId).get();
            if (!snap.exists) {
                await recordLoginFail(data.empId);
                return ok(null);
            }
            const emp = snap.data()!;
            if (!verifyPassword(data.password, emp.password)) {
                await recordLoginFail(data.empId);
                return ok(null);
            }

            // 登入成功，清除失敗紀錄
            await clearLoginFails(data.empId);

            // 如果密碼仍為明文（舊版），自動升級為雜湊
            if (!emp.password.includes(':')) {
                await db.collection('employees').doc(data.empId).update({ password: hashPassword(data.password) });
            }

            // Phase 9.2：檢查 TOTP 啟用狀態
            const totpSnap = await db.collection('totpSecrets').doc(emp.id).get();
            const totpEnabled = totpSnap.exists && totpSnap.data()!.enabled === true;

            if (totpEnabled) {
                // 產生 challenge token（5 分鐘 TTL，僅一次性使用）
                const totpToken = randomBytesNode(32).toString('hex');
                const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
                await db.collection('totpChallenges').doc(totpToken).set({
                    empId: emp.id,
                    expiresAt,
                    createdAt: new Date().toISOString(),
                });
                return ok({ kind: 'requireTotp', totpToken, expiresAt });
            }

            // 無 TOTP → 直接核發 customToken
            const customToken = await adminAuth.createCustomToken(emp.id);
            return ok({
                kind: 'success',
                user: { id: emp.id, name: emp.name, role: emp.role, position: emp.position },
                customToken,
            });
        } catch (e: any) {
            return fail(500, e.message);
        }
    }

    if (action === 'verify-totp-login') {
        // Phase 9.2 stage 2：消費 challenge token + 驗證 TOTP 或 recovery code
        try {
            const totpToken = data.totpToken as string;
            const code = (data.code as string || '').trim();
            const useRecovery = data.useRecovery === true;
            if (!totpToken || !code) return fail(400, 'totpToken 與 code 為必填');

            const chRef = db.collection('totpChallenges').doc(totpToken);
            const chSnap = await chRef.get();
            if (!chSnap.exists) return fail(401, '驗證階段已過期，請重新登入');
            const ch = chSnap.data()!;
            // consume challenge（用後立即刪除，防 replay）
            await chRef.delete();
            if (new Date(ch.expiresAt).getTime() < Date.now()) {
                return fail(401, '驗證階段已過期，請重新登入');
            }

            const empId = ch.empId as string;
            // 防暴力破解：用 stage-2 失敗也計入鎖定
            const lockout2 = await checkLoginLockout(empId);
            if (lockout2.locked) return ok({ error: lockout2.message });

            const totpSnap = await db.collection('totpSecrets').doc(empId).get();
            if (!totpSnap.exists) return fail(401, '帳號未啟用 2FA');
            const totpData = totpSnap.data()!;

            let pass = false;
            if (useRecovery) {
                const idx = findRecoveryCodeIndex(code, totpData.recoveryCodes || []);
                if (idx >= 0) {
                    const remaining = [...totpData.recoveryCodes];
                    remaining.splice(idx, 1);
                    await totpSnap.ref.update({
                        recoveryCodes: remaining,
                        lastVerifiedAt: new Date().toISOString(),
                    });
                    pass = true;
                }
            } else {
                if (verifyTotp(totpData.secret, code)) {
                    await totpSnap.ref.update({ lastVerifiedAt: new Date().toISOString() });
                    pass = true;
                }
            }

            if (!pass) {
                await recordLoginFail(empId);
                return ok(null);
            }
            await clearLoginFails(empId);

            const empSnap = await db.collection('employees').doc(empId).get();
            if (!empSnap.exists) return fail(404, '員工不存在');
            const emp = empSnap.data()!;
            const customToken = await adminAuth.createCustomToken(empId);
            return ok({
                kind: 'success',
                user: { id: emp.id, name: emp.name, role: emp.role, position: emp.position },
                customToken,
                recoveryCodesRemaining: useRecovery
                    ? Math.max(0, (totpData.recoveryCodes?.length || 0) - 1)
                    : (totpData.recoveryCodes?.length || 0),
            });
        } catch (e: any) {
            return fail(500, e.message);
        }
    }

    if (action === 'initialize-database') {
        try {
            const batch = db.batch();

            // 排班模板：若不存在才建立
            const templateSnap = await db.collection('scheduleTemplate').limit(1).get();
            if (templateSnap.empty) {
                // v2.0 預設模板：openingHours + defaultShifts（無具體人員）
                const mkTmpl = (status: string, openingHours: string, requiredHeadcount: number = 2): any => ({
                    status, openingHours, requiredHeadcount,
                    defaultShifts: openingHours ? [
                        { role: 'staffA', from: openingHours.split('-')[0], to: openingHours.split('-')[1] },
                        { role: 'staffB', from: openingHours.split('-')[0], to: openingHours.split('-')[1] },
                    ] : [],
                });
                const defaultSchedule = [
                    mkTmpl('營運', '08:30-17:30'),  // 日
                    mkTmpl('休館', ''),              // 一
                    mkTmpl('休館', ''),              // 二
                    mkTmpl('營運', '10:00-20:00'),   // 三
                    mkTmpl('營運', '10:00-20:00'),   // 四
                    mkTmpl('營運', '08:30-17:30'),   // 五
                    mkTmpl('營運', '08:30-17:30'),   // 六
                ];
                for (let i = 0; i < 7; i++) {
                    batch.set(db.collection('scheduleTemplate').doc(String(i)), defaultSchedule[i]);
                }
            }

            // SuperAdmin 帳號：若不存在才建立
            const adminSnap = await db.collection('employees').doc('ADMIN').get();
            if (!adminSnap.exists) {
                batch.set(db.collection('employees').doc('ADMIN'), {
                    id: 'ADMIN', name: '系統管理員', role: UserRole.SuperAdmin, position: '專責人員',
                    phone: '', email: '', hourlyRate: 0, monthlySalary: 0,
                    hireDate: new Date().toISOString().slice(0, 10),
                    status: '在職', password: hashPassword('admin1234'),
                });
                await batch.commit();
                return ok({ message: '已建立 SuperAdmin 帳號，請使用 ADMIN / admin1234 登入' });
            }

            await batch.commit();
            return ok({ message: '已初始化' });
        } catch (e: any) {
            return fail(500, e.message);
        }
    }

    // ---- 需要驗證的 action ----
    const decoded = await verifyToken(event.headers.authorization);
    if (!decoded) return fail(401, '請先登入');
    const uid = decoded.uid; // uid === empId

    // 取得當前使用者角色（用於權限檢查）
    const currentUserSnap = await db.collection('employees').doc(uid).get();
    const currentUserRole = currentUserSnap.exists ? currentUserSnap.data()!.role : null;
    const isSuperAdmin = currentUserRole === UserRole.SuperAdmin;
    const isAdmin = currentUserRole === UserRole.Admin || isSuperAdmin;

    try {
        switch (action) {

            // ==================== 打卡 ====================

            case 'get-today-clock-status': {
                const today = new Date().toISOString().slice(0, 10);
                const snap = await db.collection('clockRecords')
                    .where('empId', '==', uid).where('date', '==', today).limit(1).get();
                if (snap.empty) return ok({});
                const d = snap.docs[0].data();
                return ok({ clockInTime: d.clockInTime || null, clockOutTime: d.clockOutTime || null });
            }

            case 'clock-in': {
                const today = new Date().toISOString().slice(0, 10);
                const existing = await db.collection('clockRecords')
                    .where('empId', '==', uid).where('date', '==', today).limit(1).get();
                if (!existing.empty) return ok(true);
                // 伺服器時間（防止前端竄改）
                const now = new Date();
                const clockInTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
                // IP 驗證時從 request header 取得真實 IP
                let verificationData = data.verificationData;
                if (data.verificationMethod === 'IP') {
                    verificationData = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
                        || event.headers['client-ip']
                        || 'unknown';
                }
                // 遲到判定：與當日「該員工自己的 shift 範圍」比對
                const [todayDaySchedule, sysConfig, empSnapForClockIn] = await Promise.all([
                    getDaySchedule(today),
                    getSystemConfig(),
                    db.collection('employees').doc(uid).get(),
                ]);
                const empName = empSnapForClockIn.exists ? empSnapForClockIn.data()!.name : data.name;
                const myShiftRange = getEmployeeShiftRangeStr(todayDaySchedule, uid, empName);
                const status = determineClockStatus(myShiftRange, clockInTime, null, sysConfig.lateGraceMinutes);
                // Phase 6.3：月結後打卡不擋，但留 note 警示
                const lockChk = await assertMonthNotLocked(today);
                const lockedNote = lockChk.locked
                    ? `[警示] 月結後打卡（${getMonthKey(today)} 已鎖定）`
                    : '';
                await db.collection('clockRecords').add({
                    empId: uid,
                    name: data.name,
                    date: today,
                    clockInTime,
                    clockOutTime: null,
                    verificationMethod: data.verificationMethod,
                    verificationData,
                    workHours: null,
                    status,
                    source: 'normal',
                    ...(lockedNote ? { note: lockedNote, manuallyEdited: true, editedBy: 'system' } : {}),
                });
                return ok(true);
            }

            case 'clock-out': {
                const today = new Date().toISOString().slice(0, 10);
                const snap = await db.collection('clockRecords')
                    .where('empId', '==', uid).where('date', '==', today).limit(1).get();
                const now = new Date();
                const clockOutTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
                const [todayDaySchedule, sysConfig, empSnapForClockOut] = await Promise.all([
                    getDaySchedule(today),
                    getSystemConfig(),
                    db.collection('employees').doc(uid).get(),
                ]);
                const empName = empSnapForClockOut.exists ? empSnapForClockOut.data()!.name : data.name || '';
                const myShiftRange = getEmployeeShiftRangeStr(todayDaySchedule, uid, empName);
                if (snap.empty) {
                    await db.collection('clockRecords').add({
                        empId: uid,
                        name: empName,
                        date: today,
                        clockInTime: null,
                        clockOutTime,
                        verificationMethod: 'IP',
                        verificationData: event.headers['x-forwarded-for']?.split(',')[0]?.trim()
                            || event.headers['client-ip']
                            || 'unknown',
                        workHours: null,
                        status: '異常',
                        source: 'normal',
                        note: '缺少上班打卡',
                    });
                    return ok(true);
                }
                const docSnap = snap.docs[0];
                const existingClock = docSnap.data() as ClockRecord;
                if (existingClock.clockOutTime) return ok(true);
                const hasClockIn = !!existingClock.clockInTime;
                const workHours = hasClockIn ? (() => {
                    const [inH, inM] = existingClock.clockInTime!.split(':').map(Number);
                    const [outH, outM] = clockOutTime.split(':').map(Number);
                    return Math.round(((outH * 60 + outM) - (inH * 60 + inM)) / 60 * 10) / 10;
                })() : null;
                // 早退判定：用該員工自己的 shift 範圍；缺上班卡則保留異常。
                const status = determineClockStatus(
                    myShiftRange,
                    existingClock.clockInTime,
                    clockOutTime,
                    sysConfig.lateGraceMinutes
                );
                // Phase 6.3：月結後下班打卡不擋，但 merge 警示 note
                const recDate = existingClock.date;
                const lockChk = await assertMonthNotLocked(recDate);
                const existingNote = existingClock.note || '';
                const lockedNote = lockChk.locked
                    ? `[警示] 月結後下班打卡（${getMonthKey(recDate)} 已鎖定）`
                    : '';
                const missingInNote = hasClockIn ? '' : '缺少上班打卡';
                const mergedNote = [existingNote, lockedNote, missingInNote].filter(Boolean).join(' ').trim();
                await docSnap.ref.update({
                    clockOutTime,
                    workHours,
                    status: hasClockIn ? status : '異常',
                    ...(mergedNote ? { note: mergedNote } : {}),
                });
                return ok(true);
            }

            case 'validate-gps': {
                const { lat, lng } = data;
                const centerLat = 23.4800, centerLng = 120.4500, allowedRange = 100;
                const R = 6371e3;
                const φ1 = (lat * Math.PI) / 180, φ2 = (centerLat * Math.PI) / 180;
                const Δφ = ((centerLat - lat) * Math.PI) / 180;
                const Δλ = ((centerLng - lng) * Math.PI) / 180;
                const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
                const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return ok({ isValid: distance <= allowedRange, distance });
            }

            // ==================== 打卡紀錄 ====================

            case 'get-clock-records': {
                const snap = await db.collection('clockRecords').where('empId', '==', uid).get();
                const records = snap.docs
                    .map(d => ({ id: d.id, ...d.data() } as ClockRecord))
                    .filter(r => r.date.startsWith(data.yearMonth));
                return ok(records);
            }

            case 'get-all-clock-records': {
                const snap = await db.collection('clockRecords').get();
                const records = snap.docs
                    .map(d => ({ id: d.id, ...d.data() } as ClockRecord))
                    .filter(r => r.date.startsWith(data.yearMonth));
                return ok(records);
            }

            // ==================== 班表 ====================

            case 'get-employee-schedule': {
                const [allEvents, empSnap] = await Promise.all([
                    getMonthlyDailySchedule(data.yearMonth),
                    db.collection('employees').doc(uid).get()
                ]);
                if (!empSnap.exists) return ok([]);
                const user = empSnap.data()!;
                // v2：保留有自己 shift 的日子 + 全部休館日（讓員工知道哪天休館）
                const schedule = allEvents.filter(event =>
                    event.status === '休館' || isEmployeeScheduledForDay(event, uid, user.name)
                );
                return ok(schedule);
            }

            case 'get-monthly-schedule': {
                const schedule = await getMonthlyDailySchedule(data.yearMonth);
                return ok(schedule);
            }

            case 'update-schedule': {
                // 寫入 dailySchedule/{date}，v2 結構（shifts + openingHours + requiredHeadcount）
                const event = data.event as ScheduleEvent;
                const { date: dateStr, dayOfWeek: _dw, ...scheduleData } = event;
                // 兩頭班限制：同 empId 同日最多 2 筆 shift
                const counter = new Map<string, number>();
                for (const s of event.shifts || []) {
                    const key = s.empId || `name:${s.name}`;
                    counter.set(key, (counter.get(key) || 0) + 1);
                }
                for (const [k, n] of counter) {
                    if (n > 2) return fail(400, `員工 ${k.replace('name:', '')} 同日班次超過 2 段（兩頭班上限）`);
                }
                // Phase 6.3：月結鎖定檢查
                const lockChk = await assertMonthNotLocked(dateStr);
                if (lockChk.locked) return fail(423, `${getMonthKey(dateStr)} 月結已鎖定，無法修改排班`);
                await db.collection('dailySchedule').doc(dateStr).set(scheduleData);
                const shiftSummary = (event.shifts || []).map(s => `${s.name}(${s.role}/${s.from}-${s.to})`).join(', ');
                await writeAuditLog(uid, '更新排班', dateStr, `${event.status} 營業:${event.openingHours || '-'} 應到:${event.requiredHeadcount ?? '-'} 班次:${shiftSummary || '(空)'}`);
                return ok(true);
            }

            case 'apply-template': {
                // 套用模板：v2 模板僅描述 status + openingHours + defaultShifts 結構
                // 套到 dailySchedule 時 shifts=[]（具體人員之後由管理員填）
                const [year, month] = data.yearMonth.split('-').map(Number);
                const daysInMonth = new Date(year, month, 0).getDate();
                const templates = await getScheduleTemplates();
                const batch = db.batch();
                for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dow = new Date(year, month - 1, day).getDay();
                    const tmpl = templates[dow] || {};
                    batch.set(db.collection('dailySchedule').doc(dateStr), {
                        status: tmpl.status || '休館',
                        openingHours: tmpl.openingHours || tmpl.shiftTime || '',
                        requiredHeadcount: tmpl.requiredHeadcount ?? 2,
                        shifts: [],
                    });
                }
                await batch.commit();
                await writeAuditLog(uid, '套用模板', data.yearMonth, `套用至 ${daysInMonth} 天（v2 結構，人員待填）`);
                return ok({ message: `已將模板套用至 ${data.yearMonth}，共 ${daysInMonth} 天。請進入排班管理填入人員。` });
            }

            // ==================== 排班重置（Phase 5.5 / Onboarding）====================

            case 'reset-all-schedule': {
                if (!isSuperAdmin) return fail(403, '僅最高管理者可重置排班');
                // 刪除 dailySchedule 全部文件
                const dailySnap = await db.collection('dailySchedule').get();
                const tmplSnap = await db.collection('scheduleTemplate').get();
                let dailyCount = 0, tmplCount = 0;
                // 分批刪除（Firestore batch 上限 500）
                let batch = db.batch();
                let count = 0;
                for (const doc of dailySnap.docs) {
                    batch.delete(doc.ref);
                    dailyCount++; count++;
                    if (count >= 450) { await batch.commit(); batch = db.batch(); count = 0; }
                }
                if (data.alsoResetTemplate) {
                    for (const doc of tmplSnap.docs) {
                        batch.delete(doc.ref);
                        tmplCount++; count++;
                        if (count >= 450) { await batch.commit(); batch = db.batch(); count = 0; }
                    }
                }
                if (count > 0) await batch.commit();
                await writeAuditLog(uid, '重置排班資料', '*', `刪除 dailySchedule:${dailyCount} 筆${data.alsoResetTemplate ? ` + scheduleTemplate:${tmplCount} 筆` : ''}`);
                return ok({
                    dailyDeleted: dailyCount,
                    templateDeleted: data.alsoResetTemplate ? tmplCount : 0,
                    message: `已清空 ${dailyCount} 筆逐日排班${data.alsoResetTemplate ? `、${tmplCount} 筆週模板` : ''}`,
                });
            }

            // ==================== 請假 ====================

            case 'get-employee-leave-requests': {
                const snap = await db.collection('leaveRequests').where('empId', '==', uid).get();
                return ok(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            }

            case 'get-all-leave-requests': {
                const snap = await db.collection('leaveRequests').get();
                return ok(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            }

            case 'submit-leave-request': {
                const empSnap = await db.collection('employees').doc(uid).get();
                const name = empSnap.exists ? empSnap.data()!.name : 'Unknown';
                // 日期驗證
                const startMs = new Date(data.startDate).getTime();
                const endMs = new Date(data.endDate).getTime();
                if (Number.isNaN(startMs) || Number.isNaN(endMs)) return fail(400, '日期格式錯誤');
                if (endMs <= startMs) return fail(400, '結束時間必須晚於開始時間');
                const hours = Math.round((endMs - startMs) / (1000 * 60 * 60) * 10) / 10;
                if (hours < 0.5) return fail(400, '請假時數至少 0.5 小時');
                // Phase 4.1：檢查假別餘額（特休/事假/病假）
                if (data.leaveType === LeaveType.Annual || data.leaveType === LeaveType.Personal || data.leaveType === LeaveType.Sick) {
                    const balances = await getLeaveBalanceForEmployee(uid);
                    const bal = balances.find(b => b.leaveType === data.leaveType);
                    if (bal && hours > bal.remainingHours) {
                        return fail(400, `${data.leaveType}剩餘 ${bal.remainingHours} 小時，不足以申請 ${hours} 小時`);
                    }
                }
                await db.collection('leaveRequests').add({
                    empId: uid, name, hours,
                    leaveType: data.leaveType,
                    startDate: data.startDate,
                    endDate: data.endDate,
                    reason: data.reason,
                    requestDate: new Date().toISOString(),
                    status: LeaveStatus.Pending,
                });
                return ok(true);
            }

            case 'approve-leave': {
                if (!isAdmin) return fail(403, '僅管理者可審核請假');
                const lrRef = db.collection('leaveRequests').doc(data.requestId);
                const lrSnap = await lrRef.get();
                if (!lrSnap.exists) return fail(404, '請假申請不存在');
                const lr = lrSnap.data()!;
                // Phase 6.3：鎖定月份請假審核擋下
                const leaveDate = (lr.startDate || '').slice(0, 10);
                const lockChkLeave = await assertMonthNotLocked(leaveDate);
                if (lockChkLeave.locked) return fail(423, `${getMonthKey(leaveDate)} 月結已鎖定，無法審核該月請假`);
                const updates: any = {
                    status: data.status,
                    approver: data.approverName,
                    approvalDate: new Date().toISOString(),
                };
                if (data.status === LeaveStatus.Rejected && data.rejectReason) {
                    updates.rejectReason = data.rejectReason;
                }
                await lrRef.update(updates);
                await writeAuditLog(uid, '審核請假', data.requestId, `${data.status} by ${data.approverName}${data.rejectReason ? ` 理由:${data.rejectReason}` : ''}`);
                // 通知申請人
                const notifType: NotificationType = data.status === LeaveStatus.Approved ? 'leave-approved' : 'leave-rejected';
                const title = data.status === LeaveStatus.Approved ? '請假已核准' : '請假已駁回';
                const msg = `${lr.leaveType} ${lr.startDate.slice(0,10)}~${lr.endDate.slice(0,10)}${data.rejectReason ? `（${data.rejectReason}）` : ''}`;
                await writeNotification(lr.empId, notifType, title, msg);
                return ok(true);
            }

            // ==================== 員工管理 ====================

            case 'get-all-employees': {
                const snap = await db.collection('employees').get();
                return ok(snap.docs.map(d => {
                    const { password: _p, ...emp } = d.data();
                    return { id: d.id, name: emp.name, role: emp.role, position: emp.position };
                }));
            }

            case 'get-all-employees-detail': {
                const snap = await db.collection('employees').get();
                return ok(snap.docs.map(d => {
                    const { password: _p, ...emp } = d.data();
                    return emp;
                }));
            }

            case 'get-employee': {
                const snap = await db.collection('employees').doc(data.empId).get();
                if (!snap.exists) return ok(null);
                const { password: _p, ...emp } = snap.data()!;
                return ok(emp);
            }

            case 'create-employee': {
                const snap = await db.collection('employees').get();
                const existingIds = snap.docs.map(d => d.id);
                let num = existingIds.length + 1;
                let newId = `EMP${String(num).padStart(3, '0')}`;
                while (existingIds.includes(newId)) { num++; newId = `EMP${String(num).padStart(3, '0')}`; }
                const rawPwd = data.initialPassword || 'Aa123456';
                const newEmp = { ...data.employee, id: newId, password: hashPassword(rawPwd) };
                await db.collection('employees').doc(newId).set(newEmp);
                const { password: _p, ...empWithoutPwd } = newEmp;
                await writeAuditLog(uid, '新增員工', newId, `${data.employee.name} (${data.employee.position})`);
                return ok(empWithoutPwd);
            }

            case 'update-employee': {
                const ref = db.collection('employees').doc(data.empId);
                const snap = await ref.get();
                if (!snap.exists) return ok(null);
                const before = snap.data()!;
                await ref.update(data.updates);
                const updated = await ref.get();
                const { password: _p, ...emp } = updated.data()!;
                await writeAuditLog(uid, '更新員工', data.empId, JSON.stringify(data.updates));

                // Phase 8.2：留停欄位變動專屬 audit log
                const startChanged = 'leaveOfAbsenceStart' in (data.updates || {}) && data.updates.leaveOfAbsenceStart !== before.leaveOfAbsenceStart;
                const endChanged = 'leaveOfAbsenceEnd' in (data.updates || {}) && data.updates.leaveOfAbsenceEnd !== before.leaveOfAbsenceEnd;
                if (startChanged || endChanged) {
                    const newStart = data.updates.leaveOfAbsenceStart ?? before.leaveOfAbsenceStart;
                    const newEnd = data.updates.leaveOfAbsenceEnd ?? before.leaveOfAbsenceEnd;
                    if (newStart && !newEnd) {
                        await writeAuditLog(uid, '設定留停', data.empId, `${before.name} 留停起始 ${newStart}`);
                    } else if (newStart && newEnd) {
                        await writeAuditLog(uid, '結束留停', data.empId, `${before.name} 留停 ${newStart} ~ ${newEnd}`);
                    } else if (!newStart && before.leaveOfAbsenceStart) {
                        await writeAuditLog(uid, '清除留停', data.empId, `${before.name} 原留停 ${before.leaveOfAbsenceStart} ~ ${before.leaveOfAbsenceEnd || '進行中'}`);
                    }
                }
                return ok(emp);
            }

            case 'delete-employee': {
                const snap = await db.collection('employees').doc(data.empId).get();
                if (!snap.exists) return ok(false);
                const deletedName = snap.data()!.name;
                await db.collection('employees').doc(data.empId).delete();
                await writeAuditLog(uid, '刪除員工', data.empId, deletedName);
                return ok(true);
            }

            // ==================== 密碼管理 ====================

            case 'change-password': {
                const snap = await db.collection('employees').doc(uid).get();
                if (!snap.exists) return ok({ success: false, message: '帳號不存在' });
                if (!verifyPassword(data.oldPassword, snap.data()!.password)) return ok({ success: false, message: '舊密碼錯誤' });
                const pwdError = validatePasswordStrength(data.newPassword);
                if (pwdError) return ok({ success: false, message: pwdError });
                await db.collection('employees').doc(uid).update({ password: hashPassword(data.newPassword) });
                return ok({ success: true, message: '密碼已更新成功' });
            }

            case 'reset-password': {
                if (!isAdmin) return fail(403, '僅管理者可重設密碼');
                const snap = await db.collection('employees').doc(data.empId).get();
                if (!snap.exists) return ok({ success: false, message: '帳號不存在' });
                const pwdError2 = validatePasswordStrength(data.newPassword);
                if (pwdError2) return ok({ success: false, message: pwdError2 });
                await db.collection('employees').doc(data.empId).update({ password: hashPassword(data.newPassword) });
                await clearLoginFails(data.empId);
                await writeAuditLog(uid, '重設密碼', data.empId, '');
                return ok({ success: true, message: '密碼已重設成功' });
            }

            // ==================== 儀表板 ====================

            case 'get-dashboard-stats': {
                const today = new Date().toISOString().slice(0, 10);
                const yearMonth = today.slice(0, 7);

                const [todaySchedule, empSnap, clockSnap, leaveSnap, sysConfig] = await Promise.all([
                    getDaySchedule(today),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                    getSystemConfig(),
                ]);
                const employees = empSnap.docs.map(d => d.data());
                const allRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const todayRecords = allRecords.filter(r => r.date === today);
                const monthRecords = allRecords.filter(r => r.date.startsWith(yearMonth));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));

                // v2：scheduledStaff 從 shifts 提取（去重 by empId+name）
                const scheduledEmpKeys = new Set<string>();
                (todaySchedule.shifts || []).forEach(s => scheduledEmpKeys.add(s.empId || `name:${s.name}`));
                const scheduledStaffCount = scheduledEmpKeys.size;

                const todayAttendance: TodayAttendanceComparison[] = employees.map(user => {
                    const myShifts = getEmployeeShiftsForDay(todaySchedule, user.id, user.name);
                    const isScheduled = myShifts.length > 0;
                    const myShiftRange = getEmployeeShiftRangeStr(todaySchedule, user.id, user.name);
                    const scheduledHours = getEmployeeScheduledHours(todaySchedule, user.id, user.name);
                    const record = todayRecords.find(r => r.empId === user.id);
                    const leaveHours = getApprovedLeaveHoursOnDate(leaveRequests, user.id, today);
                    const leaveWindows = getApprovedLeaveWindowsOnDate(leaveRequests, user.id, today);
                    const status = computeTodayAttendanceStatus(record, myShiftRange, isScheduled, leaveHours, leaveWindows, scheduledHours, sysConfig.lateGraceMinutes);
                    return {
                        empId: user.id, name: user.name, position: user.position,
                        scheduledShift: isScheduled ? (myShiftRange || null) : null,
                        clockInTime: record?.clockInTime || null,
                        clockOutTime: record?.clockOutTime || null,
                        status,
                    };
                });

                const pendingItems: PendingItem[] = [];
                leaveRequests.filter(r => r.status === LeaveStatus.Pending).forEach(lr => {
                    pendingItems.push({
                        id: lr.id, type: '請假審核',
                        title: `${lr.name} 申請${lr.leaveType}`,
                        description: `${lr.startDate.slice(0, 10)} ~ ${lr.endDate.slice(0, 10)}`,
                        date: lr.requestDate, priority: 'high',
                    });
                });
                for (const pt of employees.filter(u => u.position === '兼職人員')) {
                    const ptHours = monthRecords.filter(r => r.empId === pt.id).reduce((s, r) => s + (r.workHours || 0), 0);
                    if (80 - ptHours <= 10) {
                        pendingItems.push({
                            id: `WARN-${pt.id}`, type: '時數警示',
                            title: `${pt.name} 時數接近上限`,
                            description: `本月已工作 ${ptHours.toFixed(1)} 小時，剩餘 ${(80 - ptHours).toFixed(1)} 小時`,
                            date: today, priority: 'medium',
                        });
                    }
                }

                return ok({
                    todayClockedIn: todayRecords.length,
                    todayScheduled: scheduledStaffCount,
                    monthlyTotalHours: Math.round(monthRecords.reduce((s, r) => s + (r.workHours || 0), 0) * 10) / 10,
                    pendingLeaves: leaveRequests.filter(r => r.status === LeaveStatus.Pending).length,
                    hourWarnings: pendingItems.filter(p => p.type === '時數警示').length,
                    todayAttendance,
                    pendingItems,
                });
            }

            case 'get-all-part-time-hours': {
                const [empSnap, clockSnap, scheduleEvents, sysConfig] = await Promise.all([
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    getMonthlyDailySchedule(data.yearMonth),
                    getSystemConfig(),
                ]);
                const partTimers = empSnap.docs.map(d => d.data()).filter(u => u.position === '兼職人員');
                const monthRecords = clockSnap.docs.map(d => d.data() as ClockRecord).filter(r => r.date.startsWith(data.yearMonth));
                return ok(partTimers.map(pt => {
                    const workedHours = Math.round(monthRecords.filter(r => r.empId === pt.id).reduce((s, r) => s + (r.workHours || 0), 0) * 10) / 10;
                    const scheduledHours = Math.round(scheduleEvents.reduce((sum, event) => {
                        if (event.status === '休館') return sum;
                        return sum + getEmployeeScheduledHours(event, pt.id, pt.name);
                    }, 0) * 10) / 10;
                    const limit = sysConfig.ptMonthlyHourLimit || DEFAULT_SYSTEM_CONFIG.ptMonthlyHourLimit;
                    const remainingHours = Math.round((limit - scheduledHours) * 10) / 10;
                    const status = scheduledHours >= (sysConfig.ptWarningThreshold || DEFAULT_SYSTEM_CONFIG.ptWarningThreshold) ? '接近上限' : '正常';
                    return { empId: pt.id, name: pt.name, month: data.yearMonth, scheduledHours, workedHours, remainingHours, status };
                }));
            }

            case 'get-schedule-attendance-comparison': {
                const [scheduleEvents, empSnap, clockSnap, leaveSnap, sysConfig] = await Promise.all([
                    getMonthlyDailySchedule(data.yearMonth),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                    getSystemConfig(),
                ]);
                const employees = empSnap.docs.map(d => d.data());
                const monthRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord)).filter(r => r.date.startsWith(data.yearMonth));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                const result = scheduleEvents.map(event => {
                    const dayRecords = monthRecords.filter(r => r.date === event.date);
                    const empList = employees.map(user => {
                        const myShiftRange = getEmployeeShiftRangeStr(event, user.id, user.name);
                        const isScheduled = !!myShiftRange;
                        const scheduledHours = getEmployeeScheduledHours(event, user.id, user.name);
                        const record = dayRecords.find(r => r.empId === user.id);
                        const leaveHours = getApprovedLeaveHoursOnDate(leaveRequests, user.id, event.date);
                        const leaveWindows = getApprovedLeaveWindowsOnDate(leaveRequests, user.id, event.date);
                        let attendanceStatus = computeComparisonAttendanceStatus(record, myShiftRange, isScheduled, leaveHours, leaveWindows, scheduledHours, sysConfig.lateGraceMinutes);
                        if (event.status === '休館') attendanceStatus = '-';
                        return { empId: user.id, name: user.name, position: user.position, scheduled: isScheduled, scheduledShift: myShiftRange || null, clockInTime: record?.clockInTime || null, clockOutTime: record?.clockOutTime || null, workHours: record?.workHours || null, attendanceStatus };
                    });
                    return { date: event.date, dayOfWeek: event.dayOfWeek, status: event.status, employees: empList };
                });
                return ok(result);
            }

            // ==================== 薪資 ====================

            case 'get-all-salary-details': {
                if (!isSuperAdmin) return fail(403, '僅最高管理者可查看全員薪資');
                const [scheduleEvents, empSnap, clockSnap, leaveSnap, cfg] = await Promise.all([
                    getMonthlyDailySchedule(data.yearMonth),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                    getSystemConfig(),
                ]);
                const clockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                const activeEmployees = empSnap.docs.map(d => d.data()).filter(e => e.status === '在職');
                return ok(activeEmployees.map(emp => calculateSalaryForEmployee(emp, data.yearMonth, scheduleEvents, clockRecords, leaveRequests, cfg)));
            }

            case 'get-employee-salary': {
                const [scheduleEvents, empSnap, clockSnap, leaveSnap, cfg] = await Promise.all([
                    getMonthlyDailySchedule(data.yearMonth),
                    db.collection('employees').doc(data.empId || uid).get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                    getSystemConfig(),
                ]);
                if (!empSnap.exists) return ok(null);
                const clockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                return ok(calculateSalaryForEmployee(empSnap.data()!, data.yearMonth, scheduleEvents, clockRecords, leaveRequests, cfg));
            }

            case 'get-monthly-report': {
                if (!isAdmin) return fail(403, '僅管理者可查看月結報表');
                const yearMonth = data.yearMonth as string;
                if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) {
                    return fail(400, 'yearMonth 格式錯誤（需 YYYY-MM）');
                }

                const [scheduleEvents, empSnap, clockSnap, leaveSnap, cfg, lock] = await Promise.all([
                    getMonthlyDailySchedule(yearMonth),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                    getSystemConfig(),
                    getMonthLock(yearMonth),
                ]);

                const allEmployees = empSnap.docs.map(d => d.data() as Employee);
                const activeEmployees = allEmployees.filter(e => e.status === '在職' || e.status === '留停');
                const allClockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const monthClockRecords = allClockRecords.filter(r => r.date?.startsWith(yearMonth));
                const allLeaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));

                const salaries = activeEmployees.map(emp =>
                    calculateSalaryForEmployee(emp, yearMonth, scheduleEvents, allClockRecords, allLeaveRequests, cfg)
                );
                const summary = buildSummary(salaries);
                const leaveDistribution = aggregateLeaveDistribution(allLeaveRequests, yearMonth);
                const clockAnomalies = aggregateClockAnomalies(monthClockRecords);

                const limit = cfg.ptMonthlyHourLimit ?? 80;
                const partTimeStatus = activeEmployees
                    .filter(e => e.position === '兼職人員')
                    .map(pt => {
                        const monthHours = Math.round(
                            monthClockRecords
                                .filter(r => r.empId === pt.id)
                                .reduce((sum, r) => sum + (r.workHours || 0), 0) * 10
                        ) / 10;
                        const usagePercent = limit > 0 ? Math.round((monthHours / limit) * 1000) / 10 : 0;
                        return {
                            empId: pt.id,
                            name: pt.name,
                            monthHours,
                            limit,
                            usagePercent,
                            overLimit: monthHours > limit,
                        };
                    })
                    .sort((a, b) => b.usagePercent - a.usagePercent);

                const report: MonthlyReportData = {
                    yearMonth,
                    lock: lock || null,
                    summary,
                    leaveDistribution,
                    clockAnomalies,
                    partTimeStatus,
                    employeeRanking: rankEmployeesByHours(salaries),
                };

                return ok(report);
            }

            // ==================== 稽核日誌 ====================

            case 'get-audit-logs': {
                if (!isSuperAdmin) return fail(403, '僅最高管理者可查看稽核日誌');
                const snap = await db.collection('auditLogs')
                    .orderBy('timestamp', 'desc')
                    .limit(data.limit || 100)
                    .get();
                return ok(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            }

            // ==================== 系統設定（Phase 3.1）====================

            case 'get-system-config': {
                const cfg = await getSystemConfig();
                return ok(cfg);
            }

            case 'update-system-config': {
                if (!isSuperAdmin) return fail(403, '僅最高管理者可修改系統設定');
                const next: SystemConfig = {
                    ...DEFAULT_SYSTEM_CONFIG,
                    ...data.config,
                    updatedAt: new Date().toISOString(),
                    updatedBy: uid,
                };
                await db.collection('systemConfig').doc('salary').set(next);
                await writeAuditLog(uid, '更新系統設定', 'salary', JSON.stringify(data.config));
                return ok(next);
            }

            // ==================== 月結鎖定（Phase 6.3）====================

            case 'lock-month': {
                if (!isSuperAdmin) return fail(403, '僅最高管理者可鎖定月結');
                const yearMonth = data.yearMonth as string;
                if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return fail(400, 'yearMonth 格式錯誤（需 YYYY-MM）');
                // 重複鎖定檢查
                const existing = await getMonthLock(yearMonth);
                if (existing && isMonthLocked(existing)) return fail(400, `${yearMonth} 已鎖定`);
                // 計算當下薪資總額作為快照
                const [scheduleEvents, empSnap, clockSnap, leaveSnap, sysConfig] = await Promise.all([
                    getMonthlyDailySchedule(yearMonth),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                    getSystemConfig(),
                ]);
                const clockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                const employees = empSnap.docs.map(d => d.data()).filter(e => e.status === '在職' || e.status === '留停');
                let totalAmount = 0;
                let employeeCount = 0;
                for (const emp of employees) {
                    const detail = calculateSalaryForEmployee(emp, yearMonth, scheduleEvents, clockRecords, leaveRequests, sysConfig);
                    totalAmount += detail.grossSalary;
                    employeeCount++;
                }
                const meSnap = await db.collection('employees').doc(uid).get();
                const lockedByName = meSnap.exists ? meSnap.data()!.name : uid;
                const snapshotVersionId = await createScheduleVersionInternal(
                    uid,
                    lockedByName,
                    yearMonth,
                    'month-lock',
                );
                const lock: MonthLock = {
                    yearMonth,
                    lockedBy: uid,
                    lockedByName,
                    lockedAt: new Date().toISOString(),
                    totalAmount: Math.round(totalAmount),
                    employeeCount,
                    snapshotVersionId,
                };
                await db.collection('monthLocks').doc(yearMonth).set(lock);
                await writeAuditLog(uid, '鎖定月結', yearMonth, `總額 ${Math.round(totalAmount)} / ${employeeCount} 人`);
                return ok(lock);
            }

            case 'unlock-month': {
                if (!isSuperAdmin) return fail(403, '僅最高管理者可解鎖月結');
                const yearMonth = data.yearMonth as string;
                const reason = ((data.reason as string) || '').trim();
                if (!yearMonth) return fail(400, '缺少 yearMonth');
                if (reason.length < 5) return fail(400, '解鎖理由至少 5 字');
                const existing = await getMonthLock(yearMonth);
                if (!existing) return fail(404, `${yearMonth} 尚未鎖定`);
                if (!isMonthLocked(existing)) return fail(400, `${yearMonth} 已是解鎖狀態`);
                const meSnap = await db.collection('employees').doc(uid).get();
                const unlockedByName = meSnap.exists ? meSnap.data()!.name : uid;
                await db.collection('monthLocks').doc(yearMonth).update({
                    unlockedBy: uid,
                    unlockedByName,
                    unlockedAt: new Date().toISOString(),
                    unlockReason: reason,
                });
                await writeAuditLog(uid, '解鎖月結', yearMonth, `理由：${reason}`);
                return ok(true);
            }

            case 'get-month-lock': {
                const yearMonth = data.yearMonth as string;
                if (!yearMonth) return fail(400, '缺少 yearMonth');
                const lock = await getMonthLock(yearMonth);
                return ok(lock);
            }

            case 'list-month-locks': {
                if (!isAdmin) return fail(403, '僅管理者可查看鎖定歷史');
                const snap = await db.collection('monthLocks').get();
                const list = snap.docs.map(d => d.data() as MonthLock);
                list.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
                return ok(list);
            }

            // ==================== 員工偏好班次設定（Phase 6.4）====================

            case 'get-my-staff-preference': {
                const snap = await db.collection('staffPreferences').doc(uid).get();
                if (!snap.exists) {
                    return ok({
                        empId: uid,
                        blockedWeekdays: [],
                        blockedDates: [],
                        preferredDates: [],
                    } as StaffPreference);
                }
                return ok({ empId: uid, ...snap.data() } as StaffPreference);
            }

            case 'update-my-staff-preference': {
                const validation = validateStaffPreference((data.preference || {}) as Partial<StaffPreference>);
                if (validation.ok === false) return fail(400, validation.error);

                const doc: StaffPreference = {
                    empId: uid,
                    ...validation.value,
                    updatedAt: new Date().toISOString(),
                };
                await db.collection('staffPreferences').doc(uid).set(doc);
                return ok(doc);
            }

            case 'get-all-staff-preferences': {
                if (!isAdmin) return fail(403, '僅管理者可查看員工偏好');
                const snap = await db.collection('staffPreferences').get();
                const list = snap.docs.map(d => ({ empId: d.id, ...d.data() } as StaffPreference));
                list.sort((a, b) => a.empId.localeCompare(b.empId));
                return ok(list);
            }

            // ==================== 排班版本歷史（Phase 6.2）====================

            case 'create-schedule-version': {
                if (!isAdmin) return fail(403, '僅管理者可建立排班版本');
                const yearMonth = data.yearMonth as string;
                const note = ((data.note as string | undefined) || '').trim() || undefined;
                if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return fail(400, 'yearMonth 格式錯誤');

                const meSnap = await db.collection('employees').doc(uid).get();
                const createdByName = meSnap.exists ? meSnap.data()!.name : uid;
                const versionId = await createScheduleVersionInternal(uid, createdByName, yearMonth, 'manual', note);
                await writeAuditLog(uid, '建立排班版本', `${yearMonth}/${versionId}`, `manual${note ? ` 備註:${note}` : ''}`);
                const snap = await db.collection('scheduleVersions').doc(versionId).get();
                return ok(snap.data() as ScheduleVersion);
            }

            case 'list-schedule-versions': {
                if (!isAdmin) return fail(403, '僅管理者可查詢版本歷史');
                const yearMonth = data.yearMonth as string;
                if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return fail(400, 'yearMonth 格式錯誤');
                const snap = await db.collection('scheduleVersions')
                    .where('yearMonth', '==', yearMonth)
                    .get();
                const list = snap.docs.map(d => d.data() as ScheduleVersion);
                list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                return ok(list);
            }

            case 'get-schedule-version': {
                if (!isAdmin) return fail(403, '僅管理者可查看排班版本');
                const versionId = data.versionId as string;
                if (!versionId) return fail(400, '缺少 versionId');
                const snap = await db.collection('scheduleVersions').doc(versionId).get();
                if (!snap.exists) return fail(404, '版本不存在');
                return ok(snap.data() as ScheduleVersion);
            }

            case 'restore-schedule-version': {
                if (!isSuperAdmin) return fail(403, '僅最高管理者可回溯排班版本');
                const versionId = data.versionId as string;
                const reason = ((data.reason as string) || '').trim();
                if (!versionId) return fail(400, '缺少 versionId');
                if (reason.length < 5) return fail(400, '回溯理由至少 5 字');

                const verSnap = await db.collection('scheduleVersions').doc(versionId).get();
                if (!verSnap.exists) return fail(404, '版本不存在');
                const version = verSnap.data() as ScheduleVersion;
                const lock = await getMonthLock(version.yearMonth);
                if (lock && isMonthLocked(lock)) {
                    return fail(423, `${version.yearMonth} 月結已鎖定，請先解鎖才能回溯`);
                }

                const batch = db.batch();
                const entries = Object.entries(version.snapshot || {});
                for (const [dateStr, entry] of entries) {
                    batch.set(db.collection('dailySchedule').doc(dateStr), {
                        status: entry.status,
                        ...(entry.openingHours ? { openingHours: entry.openingHours } : {}),
                        ...(entry.requiredHeadcount !== undefined ? { requiredHeadcount: entry.requiredHeadcount } : {}),
                        shifts: entry.shifts || [],
                    });
                }
                if (entries.length > 0) await batch.commit();
                await writeAuditLog(
                    uid,
                    '回溯排班版本',
                    `${version.yearMonth}/${versionId}`,
                    `理由：${reason}（共 ${entries.length} 日）`,
                );
                return ok({ restoredDays: entries.length });
            }

            // ==================== 換班/替班申請（Phase 6.1）====================

            case 'submit-shift-swap': {
                const fromDate = data.fromDate as string;
                const toDate = data.toDate as string;
                const fromShiftIndex = Number(data.fromShiftIndex);
                const toShiftIndex = Number(data.toShiftIndex);
                const toEmpId = data.toEmpId as string;
                const reason = ((data.reason as string) || '').trim();
                if (!fromDate || !toDate || !toEmpId || Number.isNaN(fromShiftIndex) || Number.isNaN(toShiftIndex)) {
                    return fail(400, '欄位不完整');
                }
                if (uid === toEmpId) return fail(400, '不能與自己換班');

                const [fromLock, toLock, fromEmpSnap, toEmpSnap] = await Promise.all([
                    assertMonthNotLocked(fromDate),
                    assertMonthNotLocked(toDate),
                    db.collection('employees').doc(uid).get(),
                    db.collection('employees').doc(toEmpId).get(),
                ]);
                if (fromLock.locked) return fail(423, `${getMonthKey(fromDate)} 月結已鎖定，無法換班`);
                if (toLock.locked) return fail(423, `${getMonthKey(toDate)} 月結已鎖定，無法換班`);
                if (!fromEmpSnap.exists || !toEmpSnap.exists) return fail(404, '員工不存在');
                const fromName = fromEmpSnap.data()!.name;
                const toName = toEmpSnap.data()!.name;
                const ctx = await getSwapScheduleContext(fromDate, toDate);
                const validation = validateSwapRequest({
                    fromEmpId: uid,
                    fromDate,
                    fromShiftIndex,
                    toEmpId,
                    toDate,
                    toShiftIndex,
                    reason,
                }, ctx.schedule, ctx.locks);
                if (!validation.valid) return fail(400, validation.error || '換班申請不合法');

                const docRef = db.collection('shiftSwapRequests').doc();
                const request: ShiftSwapRequest = {
                    id: docRef.id,
                    fromEmpId: uid,
                    fromName,
                    fromDate,
                    fromShiftIndex,
                    toEmpId,
                    toName,
                    toDate,
                    toShiftIndex,
                    reason,
                    status: 'awaiting-peer',
                    createdAt: new Date().toISOString(),
                };
                await docRef.set(request);
                await writeNotification(toEmpId, 'shift-swap-requested', '新的換班確認', `${fromName} 想與你交換 ${fromDate} 與 ${toDate} 的班次`);
                await writeAuditLog(uid, '提交換班申請', docRef.id, `${fromName} ${fromDate}[${fromShiftIndex}] ⇄ ${toName} ${toDate}[${toShiftIndex}]`);
                return ok(request);
            }

            case 'peer-respond-shift-swap': {
                const requestId = data.requestId as string;
                const agree = data.agree === true;
                const rejectReason = ((data.rejectReason as string) || '').trim();
                if (!requestId) return fail(400, '缺少 requestId');
                const ref = db.collection('shiftSwapRequests').doc(requestId);
                const snap = await ref.get();
                if (!snap.exists) return fail(404, '換班申請不存在');
                const req = snap.data() as ShiftSwapRequest;
                if (req.toEmpId !== uid) return fail(403, '僅對方可回覆此申請');
                if (req.status !== 'awaiting-peer') return fail(400, '該申請目前不可回覆');

                const now = new Date().toISOString();
                if (agree) {
                    const fromLock = await assertMonthNotLocked(req.fromDate);
                    const toLock = await assertMonthNotLocked(req.toDate);
                    if (fromLock.locked) return fail(423, `${getMonthKey(req.fromDate)} 月結已鎖定，無法換班`);
                    if (toLock.locked) return fail(423, `${getMonthKey(req.toDate)} 月結已鎖定，無法換班`);
                    await ref.update({ status: 'awaiting-admin', peerResponseAt: now });
                    await writeNotification('ADMIN', 'shift-swap-peer-agreed', '換班待核可', `${req.toName} 已同意 ${req.fromName} 的換班申請`);
                    await writeAuditLog(uid, '同意換班申請', requestId, `${req.fromName} ⇄ ${req.toName}`);
                    return ok(true);
                }

                if (rejectReason.length < 2) return fail(400, '拒絕理由至少 2 字');
                await ref.update({ status: 'rejected-by-peer', peerResponseAt: now, peerRejectReason: rejectReason });
                await writeNotification(req.fromEmpId, 'shift-swap-peer-rejected', '換班申請被拒絕', `${req.toName} 已拒絕換班申請：${rejectReason}`);
                await writeAuditLog(uid, '拒絕換班申請', requestId, `理由：${rejectReason}`);
                return ok(true);
            }

            case 'admin-approve-shift-swap': {
                if (!isAdmin) return fail(403, '僅管理者可審核換班');
                const requestId = data.requestId as string;
                const approve = data.approve === true;
                const rejectReason = ((data.rejectReason as string) || '').trim();
                if (!requestId) return fail(400, '缺少 requestId');
                const ref = db.collection('shiftSwapRequests').doc(requestId);
                const snap = await ref.get();
                if (!snap.exists) return fail(404, '換班申請不存在');
                const req = snap.data() as ShiftSwapRequest;
                if (req.status !== 'awaiting-admin') return fail(400, '該申請目前不可審核');
                const meSnap = await db.collection('employees').doc(uid).get();
                const adminName = meSnap.exists ? meSnap.data()!.name : (data.approverName as string || uid);
                const now = new Date().toISOString();

                if (!approve) {
                    if (rejectReason.length < 2) return fail(400, '駁回理由至少 2 字');
                    await ref.update({
                        status: 'rejected-by-admin',
                        adminResponseBy: uid,
                        adminResponseByName: adminName,
                        adminResponseAt: now,
                        adminRejectReason: rejectReason,
                    });
                    await Promise.all([
                        writeNotification(req.fromEmpId, 'shift-swap-rejected', '換班申請未核可', `管理員駁回換班申請：${rejectReason}`),
                        writeNotification(req.toEmpId, 'shift-swap-rejected', '換班申請未核可', `管理員駁回換班申請：${rejectReason}`),
                        writeAuditLog(uid, '駁回換班申請', requestId, `理由：${rejectReason}`),
                    ]);
                    return ok(true);
                }

                const fromLock = await assertMonthNotLocked(req.fromDate);
                const toLock = await assertMonthNotLocked(req.toDate);
                if (fromLock.locked) return fail(423, `${getMonthKey(req.fromDate)} 月結已鎖定，無法換班`);
                if (toLock.locked) return fail(423, `${getMonthKey(req.toDate)} 月結已鎖定，無法換班`);
                const ctx = await getSwapScheduleContext(req.fromDate, req.toDate);
                const validation = validateSwapRequest(req, ctx.schedule, ctx.locks);
                if (!validation.valid) return fail(400, validation.error || '換班申請已不符合目前班表');
                const swapped = executeSwap(ctx.schedule, req);
                const batch = db.batch();
                const writeDay = (event: ScheduleEvent) => {
                    const { date: dateStr, dayOfWeek: _dw, ...scheduleData } = event;
                    batch.set(db.collection('dailySchedule').doc(dateStr), scheduleData);
                };
                writeDay(swapped.fromDay);
                if (req.toDate !== req.fromDate) writeDay(swapped.toDay);
                batch.update(ref, {
                    status: 'approved',
                    adminResponseBy: uid,
                    adminResponseByName: adminName,
                    adminResponseAt: now,
                });
                await batch.commit();
                await Promise.all([
                    writeNotification(req.fromEmpId, 'shift-swap-approved', '換班申請已核准', `${req.fromDate} 與 ${req.toDate} 的換班已生效`),
                    writeNotification(req.toEmpId, 'shift-swap-approved', '換班申請已核准', `${req.fromDate} 與 ${req.toDate} 的換班已生效`),
                    writeAuditLog(uid, '核准換班申請', requestId, `${req.fromName} ${req.fromDate}[${req.fromShiftIndex}] ⇄ ${req.toName} ${req.toDate}[${req.toShiftIndex}]`),
                ]);
                return ok(true);
            }

            case 'cancel-shift-swap': {
                const requestId = data.requestId as string;
                if (!requestId) return fail(400, '缺少 requestId');
                const ref = db.collection('shiftSwapRequests').doc(requestId);
                const snap = await ref.get();
                if (!snap.exists) return fail(404, '換班申請不存在');
                const req = snap.data() as ShiftSwapRequest;
                if (req.fromEmpId !== uid) return fail(403, '僅發起人可取消申請');
                if (req.status !== 'awaiting-peer' && req.status !== 'awaiting-admin') return fail(400, '該申請目前不可取消');
                await ref.update({ status: 'cancelled' });
                await writeNotification(req.toEmpId, 'shift-swap-rejected', '換班申請已取消', `${req.fromName} 已取消換班申請`);
                await writeAuditLog(uid, '取消換班申請', requestId, `${req.fromName} 取消換班`);
                return ok(true);
            }

            case 'list-shift-swap-requests': {
                const mode = (data.mode as string) || 'mine';
                const snap = await db.collection('shiftSwapRequests').get();
                let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftSwapRequest));
                if (mode === 'admin-pending' || mode === 'admin-all') {
                    if (!isAdmin) return fail(403, '僅管理者可查看換班審核');
                    if (mode === 'admin-pending') list = list.filter(r => r.status === 'awaiting-admin');
                } else {
                    list = list.filter(r => r.fromEmpId === uid || r.toEmpId === uid);
                }
                list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
                return ok(list);
            }

            // ==================== 員工自助申請（Phase 8.5）====================
            // 留停走獨立 collection leaveOfAbsenceRequests，不混進 leaveRequests

            case 'submit-leave-of-absence-request': {
                const empSnap = await db.collection('employees').doc(uid).get();
                if (!empSnap.exists) return fail(404, '員工不存在');
                const emp = empSnap.data()!;

                const startDate = (data.startDate as string || '').trim();
                const endDate = (data.endDate as string || '').trim();
                const reason = (data.reason as string || '').trim();
                const contactInfo = (data.contactInfo as string || '').trim();

                const validationErr = validateLeaveOfAbsenceRequest(startDate, endDate || undefined, reason);
                if (validationErr) return fail(400, validationErr);

                // 已在留停中（status=留停 且無 end）→ 擋
                if (emp.status === '留停' && !emp.leaveOfAbsenceEnd) {
                    return fail(400, '目前已在留停中，無法再次申請');
                }

                // 同員工已有待審核申請 → 擋
                const pendingSnap = await db.collection('leaveOfAbsenceRequests')
                    .where('empId', '==', uid)
                    .where('status', '==', '待審核')
                    .limit(1)
                    .get();
                if (!pendingSnap.empty) return fail(400, '您已有待審核的留停申請，請等待 Admin 處理');

                const reqDoc: Omit<LeaveOfAbsenceRequest, 'id'> = {
                    empId: uid,
                    name: emp.name,
                    startDate,
                    endDate: endDate || undefined,
                    reason,
                    contactInfo: contactInfo || undefined,
                    requestDate: new Date().toISOString(),
                    status: '待審核',
                };
                const refNew = await db.collection('leaveOfAbsenceRequests').add(reqDoc);

                // 通知系統管理員（單一 ADMIN；廣播改進列為 follow-up）
                await writeNotification('ADMIN', 'loa-submitted', '新的留停申請', `${emp.name} 申請留停 ${startDate}${endDate ? ` ~ ${endDate}` : ' 起'}`);
                await writeAuditLog(uid, '提交留停申請', refNew.id, `${emp.name} ${startDate}${endDate ? ` ~ ${endDate}` : ''}`);
                return ok({ id: refNew.id, ...reqDoc });
            }

            case 'get-my-leave-of-absence-requests': {
                const snap = await db.collection('leaveOfAbsenceRequests').where('empId', '==', uid).get();
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveOfAbsenceRequest));
                list.sort((a, b) => (b.requestDate || '').localeCompare(a.requestDate || ''));
                return ok(list);
            }

            case 'get-leave-of-absence-requests': {
                if (!isAdmin) return fail(403, '僅管理者可查看留停申請');
                const snap = await db.collection('leaveOfAbsenceRequests').get();
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveOfAbsenceRequest));
                // 待審核排前，再依 requestDate desc
                list.sort((a, b) => {
                    if (a.status === '待審核' && b.status !== '待審核') return -1;
                    if (a.status !== '待審核' && b.status === '待審核') return 1;
                    return (b.requestDate || '').localeCompare(a.requestDate || '');
                });
                return ok(list);
            }

            case 'approve-leave-of-absence-request': {
                if (!isAdmin) return fail(403, '僅管理者可審核留停申請');
                const requestId = data.requestId as string;
                const status = data.status as '核准' | '駁回';
                const approverName = (data.approverName as string || '').trim();
                const rejectReason = (data.rejectReason as string || '').trim();
                if (!requestId) return fail(400, '缺少 requestId');
                if (status !== '核准' && status !== '駁回') return fail(400, 'status 必須為「核准」或「駁回」');

                const reqRef = db.collection('leaveOfAbsenceRequests').doc(requestId);
                const reqSnap = await reqRef.get();
                if (!reqSnap.exists) return fail(404, '留停申請不存在');
                const req = reqSnap.data() as LeaveOfAbsenceRequest;

                if (req.status !== '待審核') return fail(400, '該申請已被審核過，無法重複處理');
                if (status === '駁回' && rejectReason.length < 2) return fail(400, '駁回理由至少 2 字');

                // 月結鎖定檢查：對 startDate 做擋（兼顧 retroactive 與已鎖月度）
                const lockChk = await assertMonthNotLocked(req.startDate);
                if (lockChk.locked) {
                    return fail(423, `${getMonthKey(req.startDate)} 月結已鎖定，無法審核該月留停申請`);
                }

                const nowIso = new Date().toISOString();
                const updates: Partial<LeaveOfAbsenceRequest> = {
                    status,
                    approver: approverName || (await db.collection('employees').doc(uid).get()).data()?.name || uid,
                    approvalDate: nowIso,
                };
                if (status === '駁回') updates.rejectReason = rejectReason;
                await reqRef.update(updates as any);

                if (status === '核准') {
                    // 更新 employee 狀態與留停期間
                    await db.collection('employees').doc(req.empId).update({
                        status: '留停',
                        leaveOfAbsenceStart: req.startDate,
                        leaveOfAbsenceEnd: req.endDate || '',
                    });
                    await writeAuditLog(uid, '核准留停', requestId, `${req.name} ${req.startDate}${req.endDate ? ` ~ ${req.endDate}` : ' 起（無結束日）'}`);
                    await writeNotification(req.empId, 'loa-approved', '留停申請已核准',
                        `${req.startDate}${req.endDate ? ` ~ ${req.endDate}` : ' 起'} 留停申請已核准，期間特休年資將凍結。`);
                } else {
                    await writeAuditLog(uid, '駁回留停', requestId, `${req.name} 理由：${rejectReason}`);
                    await writeNotification(req.empId, 'loa-rejected', '留停申請已駁回',
                        `${req.startDate}${req.endDate ? ` ~ ${req.endDate}` : ' 起'} 留停申請被駁回。理由：${rejectReason}`);
                }
                return ok(true);
            }

            // ==================== TOTP 2FA（Phase 9.2）====================
            // 個資紅線：secret / recoveryCodes 明文絕對不寫 console / Sentry / auditLog
            // SuperAdmin 不可 disable 自己（強制啟用，D9-1 a）

            case 'get-totp-status': {
                const snap = await db.collection('totpSecrets').doc(uid).get();
                if (!snap.exists) return ok({ enabled: false, recoveryCodesRemaining: 0 });
                const d = snap.data()!;
                return ok({
                    enabled: d.enabled === true,
                    enabledAt: d.enabledAt,
                    recoveryCodesRemaining: (d.recoveryCodes || []).length,
                });
            }

            case 'setup-totp': {
                // 已啟用不可再 setup（避免覆蓋現有 secret 損毀現存綁定）
                const existing = await db.collection('totpSecrets').doc(uid).get();
                if (existing.exists && existing.data()!.enabled === true) {
                    return fail(400, '已啟用 2FA，若要更換金鑰請先停用');
                }
                const secret = totpGenerateSecret();
                await db.collection('totpSecrets').doc(uid).set({
                    secret,
                    enabled: false,
                    recoveryCodes: [],
                    setupAt: new Date().toISOString(),
                });
                const empSnap = await db.collection('employees').doc(uid).get();
                const labelId = empSnap.exists ? empSnap.data()!.id : uid;
                const otpauthUrl = buildOtpAuthUrl(labelId, secret);
                // 注意：otpauthUrl 含 secret，**只** return 給前端用於 QR；
                // auditLog 只記動作名，**不**寫 URL
                await writeAuditLog(uid, '啟動 2FA 設定流程', uid, '');
                return ok({ secret, otpauthUrl });
            }

            case 'verify-totp-setup': {
                // setup 階段：驗證一次 TOTP，通過後產 recovery codes 並啟用
                const code = ((data.code as string) || '').trim();
                if (!/^\d{6}$/.test(code)) return fail(400, '驗證碼格式錯誤');
                const ref = db.collection('totpSecrets').doc(uid);
                const snap = await ref.get();
                if (!snap.exists) return fail(400, '尚未啟動 2FA 設定');
                const d = snap.data()!;
                if (d.enabled === true) return fail(400, '已啟用 2FA');
                if (!verifyTotp(d.secret, code)) return fail(401, '驗證碼錯誤');
                // 產 10 組 recovery codes 並雜湊存
                const plainCodes = generateRecoveryCodes(10);
                const hashedCodes = plainCodes.map(hashRecoveryCode);
                const now = new Date().toISOString();
                await ref.update({
                    enabled: true,
                    enabledAt: now,
                    recoveryCodes: hashedCodes,
                    lastVerifiedAt: now,
                });
                await writeAuditLog(uid, '啟用 2FA', uid, '');
                // 只回明文一次，前端顯示完即丟
                return ok({ recoveryCodes: plainCodes });
            }

            case 'disable-totp': {
                // D9-1：SuperAdmin 強制啟用，**不可關**
                if (isSuperAdmin) return fail(403, '最高管理者帳號不可停用 2FA');
                const code = ((data.code as string) || '').trim();
                if (!code) return fail(400, '請輸入當前 6 位數驗證碼');
                const ref = db.collection('totpSecrets').doc(uid);
                const snap = await ref.get();
                if (!snap.exists || snap.data()!.enabled !== true) return fail(400, '尚未啟用 2FA');
                if (!verifyTotp(snap.data()!.secret, code)) return fail(401, '驗證碼錯誤');
                await ref.delete();
                await writeAuditLog(uid, '停用 2FA', uid, '');
                return ok(true);
            }

            case 'regenerate-recovery-codes': {
                const code = ((data.code as string) || '').trim();
                if (!code) return fail(400, '請輸入當前 6 位數驗證碼');
                const ref = db.collection('totpSecrets').doc(uid);
                const snap = await ref.get();
                if (!snap.exists || snap.data()!.enabled !== true) return fail(400, '尚未啟用 2FA');
                if (!verifyTotp(snap.data()!.secret, code)) return fail(401, '驗證碼錯誤');
                const plainCodes = generateRecoveryCodes(10);
                const hashedCodes = plainCodes.map(hashRecoveryCode);
                await ref.update({
                    recoveryCodes: hashedCodes,
                    lastVerifiedAt: new Date().toISOString(),
                });
                await writeAuditLog(uid, '重新產生 2FA 備援碼', uid, '');
                return ok({ recoveryCodes: plainCodes });
            }

            // ==================== 打卡紀錄編輯（Phase 3.2）====================

            case 'update-clock-record': {
                if (!isAdmin) return fail(403, '僅管理者可修改打卡紀錄');
                const ref = db.collection('clockRecords').doc(data.recordId);
                const snap = await ref.get();
                if (!snap.exists) return fail(404, '紀錄不存在');
                const orig = snap.data()!;
                // Phase 6.3：鎖定月份打卡紀錄不可改
                const lockChkCR = await assertMonthNotLocked(orig.date);
                if (lockChkCR.locked) return fail(423, `${getMonthKey(orig.date)} 月結已鎖定，無法修改打卡紀錄`);
                const updates: any = {
                    manuallyEdited: true,
                    editedBy: uid,
                    editedAt: new Date().toISOString(),
                };
                if (data.clockInTime !== undefined) updates.clockInTime = data.clockInTime;
                if (data.clockOutTime !== undefined) updates.clockOutTime = data.clockOutTime;
                if (data.note !== undefined) updates.note = data.note;
                if (data.status !== undefined) updates.status = data.status;
                // 重新計算工時
                const ci = updates.clockInTime ?? orig.clockInTime;
                const co = updates.clockOutTime ?? orig.clockOutTime;
                if (ci && co) {
                    const [ih, im] = ci.split(':').map(Number);
                    const [oh, om] = co.split(':').map(Number);
                    updates.workHours = Math.round(((oh * 60 + om) - (ih * 60 + im)) / 60 * 10) / 10;
                }
                await ref.update(updates);
                await writeAuditLog(uid, '修改打卡', data.recordId, `${orig.name} ${orig.date} ${JSON.stringify({ clockInTime: updates.clockInTime, clockOutTime: updates.clockOutTime, status: updates.status })}`);
                return ok(true);
            }

            // ==================== 補打卡申請（Phase 3.3）====================

            case 'submit-makeup-request': {
                const empSnap = await db.collection('employees').doc(uid).get();
                if (!empSnap.exists) return fail(404, '員工不存在');
                const name = empSnap.data()!.name;
                if (!data.date || !data.type || !data.reason) return fail(400, '欄位不完整');
                if (data.reason.length < 5) return fail(400, '請填寫詳細理由（至少 5 字）');
                const reqDoc = {
                    empId: uid,
                    name,
                    date: data.date,
                    type: data.type,
                    requestedClockIn: data.requestedClockIn || null,
                    requestedClockOut: data.requestedClockOut || null,
                    reason: data.reason,
                    status: '待審核',
                    requestDate: new Date().toISOString(),
                };
                const refNew = await db.collection('makeupRequests').add(reqDoc);
                return ok({ id: refNew.id, ...reqDoc });
            }

            case 'get-employee-makeup-requests': {
                const snap = await db.collection('makeupRequests').where('empId', '==', uid).get();
                return ok(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            }

            case 'get-makeup-requests': {
                if (!isAdmin) return fail(403, '僅管理者可查看補打卡申請');
                const snap = await db.collection('makeupRequests').get();
                return ok(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            }

            case 'approve-makeup-request': {
                if (!isAdmin) return fail(403, '僅管理者可審核補打卡');
                const reqRef = db.collection('makeupRequests').doc(data.requestId);
                const reqSnap = await reqRef.get();
                if (!reqSnap.exists) return fail(404, '申請不存在');
                const req = reqSnap.data()!;
                // Phase 6.3：鎖定月份補打卡審核擋下
                const lockChkMK = await assertMonthNotLocked(req.date);
                if (lockChkMK.locked) return fail(423, `${getMonthKey(req.date)} 月結已鎖定，無法審核該月補打卡`);
                const updates: any = {
                    status: data.status,
                    approver: data.approverName,
                    approvalDate: new Date().toISOString(),
                };
                if (data.status === '駁回' && data.rejectReason) updates.rejectReason = data.rejectReason;
                await reqRef.update(updates);

                // 核准 → 寫入或合併 clockRecords
                if (data.status === '核准') {
                    const existing = await db.collection('clockRecords')
                        .where('empId', '==', req.empId)
                        .where('date', '==', req.date)
                        .limit(1).get();
                    const ci = req.requestedClockIn || null;
                    const co = req.requestedClockOut || null;
                    if (existing.empty) {
                        const recDoc: any = {
                            empId: req.empId,
                            name: req.name,
                            date: req.date,
                            clockInTime: ci,
                            clockOutTime: co,
                            verificationMethod: 'IP',
                            verificationData: 'makeup',
                            workHours: null,
                            status: '正常',
                            source: 'makeup',
                            manuallyEdited: true,
                            editedBy: uid,
                            editedAt: new Date().toISOString(),
                            note: `補打卡：${req.reason}`,
                        };
                        if (ci && co) {
                            const [ih, im] = ci.split(':').map(Number);
                            const [oh, om] = co.split(':').map(Number);
                            recDoc.workHours = Math.round(((oh * 60 + om) - (ih * 60 + im)) / 60 * 10) / 10;
                        }
                        await db.collection('clockRecords').add(recDoc);
                    } else {
                        const docSnap = existing.docs[0];
                        const orig = docSnap.data();
                        const u: any = { manuallyEdited: true, editedBy: uid, editedAt: new Date().toISOString(), note: `補打卡：${req.reason}` };
                        if (ci) u.clockInTime = ci;
                        if (co) u.clockOutTime = co;
                        const finalCi = u.clockInTime ?? orig.clockInTime;
                        const finalCo = u.clockOutTime ?? orig.clockOutTime;
                        if (finalCi && finalCo) {
                            const [ih, im] = finalCi.split(':').map(Number);
                            const [oh, om] = finalCo.split(':').map(Number);
                            u.workHours = Math.round(((oh * 60 + om) - (ih * 60 + im)) / 60 * 10) / 10;
                        }
                        await docSnap.ref.update(u);
                    }
                }

                await writeAuditLog(uid, '審核補打卡', data.requestId, `${req.name} ${req.date} ${data.status}`);
                const notifType: NotificationType = data.status === '核准' ? 'makeup-approved' : 'makeup-rejected';
                const title = data.status === '核准' ? '補打卡已核准' : '補打卡已駁回';
                const msg = `${req.date} ${req.type}${data.rejectReason ? `（${data.rejectReason}）` : ''}`;
                await writeNotification(req.empId, notifType, title, msg);
                return ok(true);
            }

            // ==================== 通知（Phase 3.6）====================

            case 'get-notifications': {
                const snap = await db.collection('notifications')
                    .where('empId', '==', uid)
                    .get();
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Notification))
                    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
                    .slice(0, data.limit || 30);
                return ok(list);
            }

            case 'mark-notification-read': {
                const ref = db.collection('notifications').doc(data.notificationId);
                const snap = await ref.get();
                if (!snap.exists || snap.data()!.empId !== uid) return fail(404, '通知不存在');
                await ref.update({ read: true });
                return ok(true);
            }

            case 'mark-all-notifications-read': {
                const snap = await db.collection('notifications')
                    .where('empId', '==', uid)
                    .where('read', '==', false)
                    .get();
                const batch = db.batch();
                snap.docs.forEach(d => batch.update(d.ref, { read: true }));
                await batch.commit();
                return ok(snap.size);
            }

            case 'register-fcm-token': {
                const token = ((data.token as string) || '').trim();
                if (!token || token.length < 30) return fail(400, 'token 無效');
                const tokenId = await tokenIdFromToken(token);
                const now = new Date().toISOString();
                const existing = await db.collection('fcmTokens').doc(tokenId).get();
                const doc: FcmTokenDoc = {
                    tokenId,
                    empId: uid,
                    token,
                    userAgent: (((data.userAgent as string) || '').slice(0, 200) || undefined),
                    createdAt: existing.exists ? (existing.data() as FcmTokenDoc).createdAt : now,
                    lastSeenAt: now,
                    failureCount: 0,
                };
                await db.collection('fcmTokens').doc(tokenId).set(doc, { merge: true });
                return ok({ tokenId });
            }

            case 'unregister-fcm-token': {
                const token = ((data.token as string) || '').trim();
                if (!token) return fail(400, 'token 必填');
                const tokenId = await tokenIdFromToken(token);
                const ref = db.collection('fcmTokens').doc(tokenId);
                const snap = await ref.get();
                if (snap.exists && (snap.data() as FcmTokenDoc).empId === uid) {
                    await ref.delete();
                }
                return ok(true);
            }

            // ==================== 排班衝突檢查（Phase 3.5）====================

            case 'check-schedule-conflicts': {
                // v2：偵測超過兩頭班上限、應到人數不足、營運日無 staffA
                const events = await getMonthlyDailySchedule(data.yearMonth);
                const conflicts: any[] = [];
                events.forEach(e => {
                    if (e.status === '休館') return;
                    // 1. 兩頭班 > 2 段
                    const empShiftCount = new Map<string, { name: string; n: number }>();
                    for (const s of e.shifts) {
                        const key = s.empId || `name:${s.name}`;
                        const cur = empShiftCount.get(key) || { name: s.name, n: 0 };
                        cur.n++;
                        empShiftCount.set(key, cur);
                    }
                    for (const { name, n } of empShiftCount.values()) {
                        if (n > 2) conflicts.push({ date: e.date, type: 'duplicate', name, message: `${name} 在 ${e.date} 排了 ${n} 段班次（兩頭班上限 2）` });
                    }
                    // 2. 應到人數不足（決策 3：僅警示）
                    if (e.requiredHeadcount && empShiftCount.size < e.requiredHeadcount) {
                        conflicts.push({ date: e.date, type: 'understaffed', message: `${e.date} 應到 ${e.requiredHeadcount} 人，目前只排了 ${empShiftCount.size} 人` });
                    }
                    // 3. 營運日無 staffA
                    if (e.status === '營運' && !e.shifts.some(s => s.role === 'staffA')) {
                        conflicts.push({ date: e.date, type: 'understaffed', message: `${e.date} 營運日無專責人員 A` });
                    }
                    // 4. 30 分鐘區段覆蓋率（Phase 5.2）
                    if (e.status === '營運' && (e.requiredHeadcount ?? 0) > 0) {
                        const gaps = computeCoverageGaps(e);
                        for (const g of gaps) {
                            conflicts.push({
                                date: e.date,
                                type: 'understaffed',
                                message: `${e.date} ${g.from}-${g.to} 缺 ${g.short} 人（應到 ${g.required}，實際 ${g.covered}）`,
                            });
                        }
                    }
                });
                return ok(conflicts);
            }

            // ==================== 假別餘額（Phase 4.1）====================

            case 'get-leave-balance': {
                const targetId = data.empId && isAdmin ? data.empId : uid;
                const balances = await getLeaveBalanceForEmployee(targetId);
                return ok(balances);
            }

            // ==================== 員工自選班表（Phase 4.2）====================

            case 'create-open-shift': {
                if (!isAdmin) return fail(403, '僅管理者可建立開放排班');
                if (!data.date || !data.shiftTime || !data.requiredCount) return fail(400, '欄位不完整');
                const doc = {
                    date: data.date,
                    shiftTime: data.shiftTime,
                    requiredCount: Number(data.requiredCount),
                    takenBy: [],
                    takenNames: [],
                    status: 'open',
                    note: data.note || '',
                    createdBy: uid,
                    createdAt: new Date().toISOString(),
                };
                const ref = await db.collection('openShifts').add(doc);
                await writeAuditLog(uid, '建立開放排班', ref.id, `${data.date} ${data.shiftTime} 需 ${data.requiredCount} 人`);
                return ok({ id: ref.id, ...doc });
            }

            case 'list-open-shifts': {
                const snap = await db.collection('openShifts').get();
                const list = snap.docs
                    .map(d => ({ id: d.id, ...d.data() } as any))
                    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                // 過濾未來/過去
                if (data.onlyOpen) {
                    return ok(list.filter(s => s.status === 'open'));
                }
                return ok(list);
            }

            case 'claim-open-shift': {
                const ref = db.collection('openShifts').doc(data.shiftId);
                const result = await db.runTransaction(async (tx) => {
                    const snap = await tx.get(ref);
                    if (!snap.exists) throw new Error('班次不存在');
                    const shift = snap.data()!;
                    if (shift.status !== 'open') throw new Error('班次已關閉');
                    const takenBy: string[] = shift.takenBy || [];
                    if (takenBy.includes(uid)) throw new Error('已認領此班次');
                    if (takenBy.length >= shift.requiredCount) throw new Error('班次已額滿');
                    const empSnap = await tx.get(db.collection('employees').doc(uid));
                    if (!empSnap.exists) throw new Error('員工不存在');
                    const name = empSnap.data()!.name;
                    const newTakenBy = [...takenBy, uid];
                    const newTakenNames = [...(shift.takenNames || []), name];
                    const closed = newTakenBy.length >= shift.requiredCount;
                    tx.update(ref, {
                        takenBy: newTakenBy,
                        takenNames: newTakenNames,
                        status: closed ? 'closed' : 'open',
                    });
                    return { name, date: shift.date, shiftTime: shift.shiftTime };
                });

                // v2：同步寫入 dailySchedule.shifts（push 一筆 StaffShift）
                const [from = '', to = ''] = (result.shiftTime || '').split('-');
                const newShift: StaffShift = { empId: uid, name: result.name, role: 'partTime', from, to };
                const dailyRef = db.collection('dailySchedule').doc(result.date);
                const dailySnap = await dailyRef.get();
                if (dailySnap.exists) {
                    const cur = dailySnap.data()!;
                    const normalized = normalizeScheduleDoc(cur, result.date, '');
                    // 避免重複 push（同員工同時段）
                    const dup = normalized.shifts.some(s => s.empId === uid && s.from === from && s.to === to);
                    if (!dup) {
                        await dailyRef.set({
                            status: normalized.status,
                            openingHours: normalized.openingHours,
                            requiredHeadcount: normalized.requiredHeadcount,
                            shifts: [...normalized.shifts, newShift],
                        });
                    }
                } else {
                    // 從模板取 status，再加入認領者
                    const [y, m, d] = result.date.split('-').map(Number);
                    const dow = new Date(y, m - 1, d).getDay();
                    const templates = await getScheduleTemplates();
                    const tmpl = templates[dow] || {};
                    await dailyRef.set({
                        status: tmpl.status || '營運',
                        openingHours: tmpl.openingHours || tmpl.shiftTime || result.shiftTime,
                        requiredHeadcount: tmpl.requiredHeadcount ?? 2,
                        shifts: [newShift],
                    });
                }
                await writeAuditLog(uid, '認領開放排班', data.shiftId, `${result.date} ${result.shiftTime}`);
                return ok(true);
            }

            case 'release-open-shift': {
                const ref = db.collection('openShifts').doc(data.shiftId);
                const releaseInfo = await db.runTransaction(async (tx) => {
                    const snap = await tx.get(ref);
                    if (!snap.exists) throw new Error('班次不存在');
                    const shift = snap.data()!;
                    const takenBy: string[] = shift.takenBy || [];
                    const idx = takenBy.indexOf(uid);
                    if (idx < 0) throw new Error('未認領此班次');
                    const empSnap = await tx.get(db.collection('employees').doc(uid));
                    const name = empSnap.exists ? empSnap.data()!.name : '';
                    const newTakenBy = takenBy.filter(id => id !== uid);
                    const newTakenNames = (shift.takenNames || []).filter((n: string) => n !== name);
                    tx.update(ref, {
                        takenBy: newTakenBy,
                        takenNames: newTakenNames,
                        status: 'open',
                    });
                    return { name, date: shift.date };
                });

                // v2：從 dailySchedule.shifts 移除該員工的 partTime shift
                const dailyRef = db.collection('dailySchedule').doc(releaseInfo.date);
                const dailySnap = await dailyRef.get();
                if (dailySnap.exists) {
                    const normalized = normalizeScheduleDoc(dailySnap.data(), releaseInfo.date, '');
                    const filtered = normalized.shifts.filter(s =>
                        !(s.role === 'partTime' && ((s.empId && s.empId === uid) || (!s.empId && s.name === releaseInfo.name)))
                    );
                    await dailyRef.set({
                        status: normalized.status,
                        openingHours: normalized.openingHours,
                        requiredHeadcount: normalized.requiredHeadcount,
                        shifts: filtered,
                    });
                }
                await writeAuditLog(uid, '釋出開放排班', data.shiftId, releaseInfo.date);
                return ok(true);
            }

            case 'delete-open-shift': {
                if (!isAdmin) return fail(403, '僅管理者可刪除開放排班');
                await db.collection('openShifts').doc(data.shiftId).delete();
                await writeAuditLog(uid, '刪除開放排班', data.shiftId, '');
                return ok(true);
            }

            default:
                return fail(400, `未知的 action: ${action}`);
        }
    } catch (e: any) {
        console.error('API Error:', e);
        return fail(500, e.message || '伺服器錯誤');
    }
};
