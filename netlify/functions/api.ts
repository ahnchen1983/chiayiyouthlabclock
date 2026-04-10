import type { Handler } from '@netlify/functions';
import { db, adminAuth } from './utils/firebaseAdmin';
import { UserRole, LeaveStatus, LeaveType, EmployeeStatus } from '../../types';
import type { ClockRecord, LeaveRequest, Employee, ScheduleEvent, SalaryDetail, TodayAttendanceComparison, PendingItem, SystemConfig, ClockMakeupRequest, Notification, NotificationType } from '../../types';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const dayOfWeekMap = ['日', '一', '二', '三', '四', '五', '六'];

// ==================== 密碼 Helper ====================

const hashPassword = (password: string): string => {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
};

const verifyPassword = (password: string, stored: string): boolean => {
    // 向下相容：如果 stored 不含 ':'，則為舊版明文密碼
    if (!stored.includes(':')) return password === stored;
    const [salt, hash] = stored.split(':');
    const hashBuffer = Buffer.from(hash, 'hex');
    const testBuffer = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuffer, testBuffer);
};

// 密碼強度驗證：至少 8 字元，含英文+數字
const validatePasswordStrength = (password: string): string | null => {
    if (password.length < 8) return '密碼至少需要 8 個字元';
    if (!/[a-zA-Z]/.test(password)) return '密碼需包含英文字母';
    if (!/[0-9]/.test(password)) return '密碼需包含數字';
    return null;
};

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

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
    laborInsuranceRate: 0.023,
    healthInsuranceRate: 0.0211,
    laborPensionRate: 0.06,
    overtimeMultiplier: 1.34,
    ptMonthlyHourLimit: 80,
    ptWarningThreshold: 70,
    lateGraceMinutes: 5,
};

const getSystemConfig = async (): Promise<SystemConfig> => {
    const snap = await db.collection('systemConfig').doc('salary').get();
    if (!snap.exists) return { ...DEFAULT_SYSTEM_CONFIG };
    return { ...DEFAULT_SYSTEM_CONFIG, ...(snap.data() as Partial<SystemConfig>) };
};

// ==================== 通知 Helper ====================

const writeNotification = async (
    empId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string
) => {
    await db.collection('notifications').add({
        empId,
        type,
        title,
        message,
        read: false,
        createdAt: new Date().toISOString(),
        ...(link ? { link } : {}),
    });
};

// ==================== 遲到/早退判定 ====================

const determineClockStatus = (
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

// ==================== 假別餘額 Helper（Phase 4.1）====================

/**
 * 依勞基法計算特休天數（依到職日 → 指定基準日）
 * 6 個月：3 天 / 1 年：7 天 / 2 年：10 天 / 3-4 年：14 天 / 5-9 年：15 天
 * 10 年起每增 1 年加 1 天，最多 30 天
 */
const computeAnnualLeaveDays = (hireDate: string, asOf: Date = new Date()): number => {
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

/**
 * 取得指定員工本年度的假別餘額（依勞基法 + 已核准請假時數）
 */
const getLeaveBalanceForEmployee = async (empId: string): Promise<any[]> => {
    const empSnap = await db.collection('employees').doc(empId).get();
    if (!empSnap.exists) return [];
    const emp = empSnap.data()!;
    const year = new Date().getFullYear();
    const annualDays = computeAnnualLeaveDays(emp.hireDate);

    // 本年度已核准假
    const lrSnap = await db.collection('leaveRequests').where('empId', '==', empId).get();
    const usedByType = new Map<string, number>();
    lrSnap.docs.forEach(d => {
        const lr = d.data();
        if (lr.status !== LeaveStatus.Approved) return;
        if (!lr.startDate || !lr.startDate.startsWith(String(year))) return;
        usedByType.set(lr.leaveType, (usedByType.get(lr.leaveType) || 0) + (lr.hours || 0));
    });

    const quotas: Record<string, { hours: number; note: string }> = {
        [LeaveType.Annual]:   { hours: annualDays * 8, note: `依到職日 ${emp.hireDate || '未設定'} 計算 ${annualDays} 天` },
        [LeaveType.Personal]: { hours: 14 * 8, note: '勞基法事假上限 14 天/年（不給薪）' },
        [LeaveType.Sick]:     { hours: 30 * 8, note: '勞基法普通病假上限 30 天/年（半薪）' },
        [LeaveType.Other]:    { hours: 9999, note: '其他假別不設上限' },
    };

    return Object.entries(quotas).map(([type, q]) => ({
        leaveType: type,
        quotaHours: q.hours,
        usedHours: Math.round((usedByType.get(type) || 0) * 10) / 10,
        remainingHours: Math.round((q.hours - (usedByType.get(type) || 0)) * 10) / 10,
        note: q.note,
    }));
};

// ==================== 回應 Helper ====================

const ok = (data: unknown) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
});

const fail = (status: number, message: string) => ({
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
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
        const daily = dailyMap.get(dateStr);
        if (daily) {
            schedule.push({ date: dateStr, dayOfWeek: dayOfWeekMap[dow], status: daily.status, shiftTime: daily.shiftTime, staffA: daily.staffA, staffB: daily.staffB, partTime: daily.partTime || [] });
        } else {
            const tmpl = templates[dow];
            schedule.push({ date: dateStr, dayOfWeek: dayOfWeekMap[dow], ...tmpl });
        }
    }
    return schedule;
};

/**
 * 取得單日班表（優先 dailySchedule，fallback template）
 */
const getDaySchedule = async (dateStr: string): Promise<any> => {
    const dailyDoc = await db.collection('dailySchedule').doc(dateStr).get();
    if (dailyDoc.exists) return dailyDoc.data();
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const templates = await getScheduleTemplates();
    return templates[dow];
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

// ==================== 薪資計算 ====================

const calculateSalaryForEmployee = (
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

// ==================== Handler 主體 ====================

export const handler: Handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
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

            // 產生 custom token（UID = empId）
            const customToken = await adminAuth.createCustomToken(data.empId);
            return ok({
                user: { id: emp.id, name: emp.name, role: emp.role, position: emp.position },
                customToken
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
                const defaultSchedule = [
                    { status: '營運', shiftTime: '08:30-17:30', staffA: '', staffB: '', partTime: [] },  // 日
                    { status: '休館', shiftTime: '', staffA: '', staffB: '', partTime: [] },              // 一
                    { status: '休館', shiftTime: '', staffA: '', staffB: '', partTime: [] },              // 二
                    { status: '營運', shiftTime: '10:00-20:00', staffA: '', staffB: '', partTime: [] },   // 三
                    { status: '營運', shiftTime: '10:00-20:00', staffA: '', staffB: '', partTime: [] },   // 四
                    { status: '營運', shiftTime: '08:30-17:30', staffA: '', staffB: '', partTime: [] },   // 五
                    { status: '營運', shiftTime: '08:30-17:30', staffA: '', staffB: '', partTime: [] },   // 六
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
                    status: '在職' as EmployeeStatus, password: hashPassword('admin1234'),
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
                // 遲到判定：與當日排班時段比對
                const [todayDaySchedule, sysConfig] = await Promise.all([
                    getDaySchedule(today),
                    getSystemConfig(),
                ]);
                const status = determineClockStatus(todayDaySchedule?.shiftTime, clockInTime, null, sysConfig.lateGraceMinutes);
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
                });
                return ok(true);
            }

            case 'clock-out': {
                const today = new Date().toISOString().slice(0, 10);
                const snap = await db.collection('clockRecords')
                    .where('empId', '==', uid).where('date', '==', today).limit(1).get();
                if (snap.empty) return ok(false);
                const docSnap = snap.docs[0];
                if (docSnap.data().clockOutTime) return ok(true);
                const now = new Date();
                const clockOutTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
                const [inH, inM] = docSnap.data().clockInTime.split(':').map(Number);
                const [outH, outM] = clockOutTime.split(':').map(Number);
                const workHours = Math.round(((outH * 60 + outM) - (inH * 60 + inM)) / 60 * 10) / 10;
                // 早退判定
                const [todayDaySchedule, sysConfig] = await Promise.all([
                    getDaySchedule(today),
                    getSystemConfig(),
                ]);
                const status = determineClockStatus(
                    todayDaySchedule?.shiftTime,
                    docSnap.data().clockInTime,
                    clockOutTime,
                    sysConfig.lateGraceMinutes
                );
                await docSnap.ref.update({ clockOutTime, workHours, status });
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
                const schedule = allEvents.filter(event => {
                    const pt: string[] = event.partTime || [];
                    return event.staffA === user.name || event.staffB === user.name || pt.includes(user.name) || event.status === '休館';
                });
                return ok(schedule);
            }

            case 'get-monthly-schedule': {
                const schedule = await getMonthlyDailySchedule(data.yearMonth);
                return ok(schedule);
            }

            case 'update-schedule': {
                // 寫入 dailySchedule/{date}，不再覆寫整週模板
                const event = data.event as ScheduleEvent;
                const { date: dateStr, dayOfWeek: _dw, ...scheduleData } = event;
                await db.collection('dailySchedule').doc(dateStr).set(scheduleData);
                await writeAuditLog(uid, '更新排班', dateStr, `${event.status} ${event.shiftTime} A:${event.staffA} B:${event.staffB} PT:${event.partTime?.join(',')}`);
                return ok(true);
            }

            case 'apply-template': {
                // 將模板套用到指定月份，批次產生 dailySchedule
                const [year, month] = data.yearMonth.split('-').map(Number);
                const daysInMonth = new Date(year, month, 0).getDate();
                const templates = await getScheduleTemplates();
                const batch = db.batch();
                for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dow = new Date(year, month - 1, day).getDay();
                    batch.set(db.collection('dailySchedule').doc(dateStr), templates[dow]);
                }
                await batch.commit();
                await writeAuditLog(uid, '套用模板', data.yearMonth, `套用至 ${daysInMonth} 天`);
                return ok({ message: `已將模板套用至 ${data.yearMonth}，共 ${daysInMonth} 天` });
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
                await ref.update(data.updates);
                const updated = await ref.get();
                const { password: _p, ...emp } = updated.data()!;
                await writeAuditLog(uid, '更新員工', data.empId, JSON.stringify(data.updates));
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

                const [todaySchedule, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getDaySchedule(today),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);
                const employees = empSnap.docs.map(d => d.data());
                const allRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const todayRecords = allRecords.filter(r => r.date === today);
                const monthRecords = allRecords.filter(r => r.date.startsWith(yearMonth));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));

                const scheduledStaff: string[] = [];
                if (todaySchedule.staffA) scheduledStaff.push(todaySchedule.staffA);
                if (todaySchedule.staffB) scheduledStaff.push(todaySchedule.staffB);
                scheduledStaff.push(...(todaySchedule.partTime || []));

                const todayAttendance: TodayAttendanceComparison[] = employees.map(user => {
                    const isScheduled = scheduledStaff.includes(user.name);
                    const record = todayRecords.find(r => r.empId === user.id);
                    const leaveToday = leaveRequests.find(
                        lr => lr.empId === user.id && lr.status === LeaveStatus.Approved &&
                            lr.startDate.slice(0, 10) <= today && lr.endDate.slice(0, 10) >= today
                    );
                    let status: TodayAttendanceComparison['status'] = '未排班';
                    if (leaveToday) status = '休假';
                    else if (isScheduled) {
                        status = record?.clockInTime
                            ? (record.status === '遲到' ? '遲到' : record.status === '早退' ? '早退' : '已到')
                            : '未到';
                    }
                    return {
                        empId: user.id, name: user.name, position: user.position,
                        scheduledShift: isScheduled ? todaySchedule.shiftTime : null,
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
                    todayScheduled: scheduledStaff.length,
                    monthlyTotalHours: Math.round(monthRecords.reduce((s, r) => s + (r.workHours || 0), 0) * 10) / 10,
                    pendingLeaves: leaveRequests.filter(r => r.status === LeaveStatus.Pending).length,
                    hourWarnings: pendingItems.filter(p => p.type === '時數警示').length,
                    todayAttendance,
                    pendingItems,
                });
            }

            case 'get-all-part-time-hours': {
                const [empSnap, clockSnap] = await Promise.all([
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                ]);
                const partTimers = empSnap.docs.map(d => d.data()).filter(u => u.position === '兼職人員');
                const monthRecords = clockSnap.docs.map(d => d.data() as ClockRecord).filter(r => r.date.startsWith(data.yearMonth));
                return ok(partTimers.map(pt => {
                    const workedHours = Math.round(monthRecords.filter(r => r.empId === pt.id).reduce((s, r) => s + (r.workHours || 0), 0) * 10) / 10;
                    return { empId: pt.id, name: pt.name, month: data.yearMonth, scheduledHours: workedHours, workedHours, remainingHours: Math.round((80 - workedHours) * 10) / 10, status: 80 - workedHours <= 10 ? '接近上限' : '正常' };
                }));
            }

            case 'get-schedule-attendance-comparison': {
                const [scheduleEvents, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getMonthlyDailySchedule(data.yearMonth),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);
                const employees = empSnap.docs.map(d => d.data());
                const monthRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord)).filter(r => r.date.startsWith(data.yearMonth));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                const result = scheduleEvents.map(event => {
                    const scheduledStaff: string[] = [];
                    if (event.staffA) scheduledStaff.push(event.staffA);
                    if (event.staffB) scheduledStaff.push(event.staffB);
                    scheduledStaff.push(...(event.partTime || []));
                    const dayRecords = monthRecords.filter(r => r.date === event.date);
                    const empList = employees.map(user => {
                        const isScheduled = scheduledStaff.includes(user.name);
                        const record = dayRecords.find(r => r.empId === user.id);
                        const leaveOnDay = leaveRequests.find(lr => lr.empId === user.id && lr.status === LeaveStatus.Approved && lr.startDate.slice(0, 10) <= event.date && lr.endDate.slice(0, 10) >= event.date);
                        let attendanceStatus: string = '-';
                        if (event.status === '休館') attendanceStatus = '-';
                        else if (leaveOnDay) attendanceStatus = '休假';
                        else if (isScheduled) attendanceStatus = record ? record.status : '缺勤';
                        return { empId: user.id, name: user.name, position: user.position, scheduled: isScheduled, scheduledShift: isScheduled ? event.shiftTime : null, clockInTime: record?.clockInTime || null, clockOutTime: record?.clockOutTime || null, workHours: record?.workHours || null, attendanceStatus };
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

            // ==================== 打卡紀錄編輯（Phase 3.2）====================

            case 'update-clock-record': {
                if (!isAdmin) return fail(403, '僅管理者可修改打卡紀錄');
                const ref = db.collection('clockRecords').doc(data.recordId);
                const snap = await ref.get();
                if (!snap.exists) return fail(404, '紀錄不存在');
                const orig = snap.data()!;
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

            // ==================== 排班衝突檢查（Phase 3.5）====================

            case 'check-schedule-conflicts': {
                // 回傳該月份所有衝突清單：同一人同日重複、人力不足
                const events = await getMonthlyDailySchedule(data.yearMonth);
                const conflicts: any[] = [];
                events.forEach(e => {
                    if (e.status === '休館') return;
                    const all = [e.staffA, e.staffB, ...(e.partTime || [])].filter(Boolean);
                    // 同人重複
                    const seen = new Set<string>();
                    all.forEach(n => {
                        if (seen.has(n)) conflicts.push({ date: e.date, type: 'duplicate', name: n, message: `${n} 在 ${e.date} 被排兩次以上` });
                        seen.add(n);
                    });
                    // 人力不足（營運日無 staffA）
                    if (e.status === '營運' && !e.staffA) {
                        conflicts.push({ date: e.date, type: 'understaffed', message: `${e.date} 無專責人員 A` });
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

                // 同步寫入 dailySchedule.partTime
                const dailyRef = db.collection('dailySchedule').doc(result.date);
                const dailySnap = await dailyRef.get();
                if (dailySnap.exists) {
                    const cur = dailySnap.data()!;
                    const pt: string[] = cur.partTime || [];
                    if (!pt.includes(result.name)) {
                        await dailyRef.update({ partTime: [...pt, result.name] });
                    }
                } else {
                    // 從模板初始化該日，再加入認領者
                    const [y, m, d] = result.date.split('-').map(Number);
                    const dow = new Date(y, m - 1, d).getDay();
                    const templates = await getScheduleTemplates();
                    const tmpl = templates[dow] || { status: '營運', shiftTime: result.shiftTime, staffA: '', staffB: '', partTime: [] };
                    await dailyRef.set({
                        ...tmpl,
                        partTime: [...(tmpl.partTime || []), result.name],
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

                // 從 dailySchedule.partTime 移除
                const dailyRef = db.collection('dailySchedule').doc(releaseInfo.date);
                const dailySnap = await dailyRef.get();
                if (dailySnap.exists && releaseInfo.name) {
                    const cur = dailySnap.data()!;
                    const pt: string[] = (cur.partTime || []).filter((n: string) => n !== releaseInfo.name);
                    await dailyRef.update({ partTime: pt });
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
