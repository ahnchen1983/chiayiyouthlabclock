import type { Handler } from '@netlify/functions';
import { db, adminAuth } from './utils/firebaseAdmin';
import { UserRole, LeaveStatus, LeaveType, EmployeeStatus } from '../../types';
import type { ClockRecord, LeaveRequest, Employee, ScheduleEvent, SalaryDetail, TodayAttendanceComparison, PendingItem } from '../../types';
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
    leaveRequests: LeaveRequest[]
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
    const overtimePay = Math.round(overtimeHours * hourlyForOT * 1.34);
    const grossSalary = baseSalary + overtimePay;

    const hourlyWage = emp.position === '專責人員' ? Math.round((emp.monthlySalary || 30000) / 30 / 8) : emp.hourlyRate;
    let leaveDeduction = 0;
    empLeaves.forEach(lr => {
        if (lr.leaveType === LeaveType.Personal) leaveDeduction += lr.hours * hourlyWage;
        else if (lr.leaveType === LeaveType.Sick) leaveDeduction += Math.round(lr.hours * hourlyWage * 0.5);
    });

    const laborInsurance = Math.round(grossSalary * 0.023);
    const healthInsurance = Math.round(grossSalary * 0.0211);
    const laborPensionSelf = Math.round(grossSalary * 0.06);
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
            // 檢查是否已有任何員工資料（不再綁定特定 EMP001）
            const empSnap = await db.collection('employees').limit(1).get();
            if (!empSnap.empty) return ok({ message: '已初始化' });

            // 只建立空的排班模板結構，不寫入假人名
            const batch = db.batch();
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

            // 建立預設最高管理員帳號（首次使用需由此帳號登入後新增其他員工）
            batch.set(db.collection('employees').doc('ADMIN'), {
                id: 'ADMIN', name: '系統管理員', role: UserRole.SuperAdmin, position: '專責人員',
                phone: '', email: '', hourlyRate: 0, monthlySalary: 0,
                hireDate: new Date().toISOString().slice(0, 10),
                status: '在職' as EmployeeStatus, password: 'admin1234',
            });

            await batch.commit();
            return ok({ message: '初始化完成，請使用帳號 ADMIN / admin1234 登入後新增員工' });
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
                await db.collection('clockRecords').add({
                    empId: uid,
                    name: data.name,
                    date: today,
                    clockInTime,
                    clockOutTime: null,
                    verificationMethod: data.verificationMethod,
                    verificationData,
                    workHours: null,
                    status: '正常',
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
                await docSnap.ref.update({ clockOutTime, workHours });
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
                const hours = Math.round(
                    (new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / (1000 * 60 * 60) * 10
                ) / 10;
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
                await db.collection('leaveRequests').doc(data.requestId).update({
                    status: data.status,
                    approver: data.approverName,
                    approvalDate: new Date().toISOString(),
                });
                await writeAuditLog(uid, '審核請假', data.requestId, `${data.status} by ${data.approverName}`);
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
                const [scheduleEvents, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getMonthlyDailySchedule(data.yearMonth),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);
                const clockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                const activeEmployees = empSnap.docs.map(d => d.data()).filter(e => e.status === '在職');
                return ok(activeEmployees.map(emp => calculateSalaryForEmployee(emp, data.yearMonth, scheduleEvents, clockRecords, leaveRequests)));
            }

            case 'get-employee-salary': {
                const [scheduleEvents, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getMonthlyDailySchedule(data.yearMonth),
                    db.collection('employees').doc(data.empId || uid).get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);
                if (!empSnap.exists) return ok(null);
                const clockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                return ok(calculateSalaryForEmployee(empSnap.data()!, data.yearMonth, scheduleEvents, clockRecords, leaveRequests));
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

            default:
                return fail(400, `未知的 action: ${action}`);
        }
    } catch (e: any) {
        console.error('API Error:', e);
        return fail(500, e.message || '伺服器錯誤');
    }
};
