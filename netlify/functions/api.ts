import type { Handler } from '@netlify/functions';
import { db, adminAuth } from './utils/firebaseAdmin';
import { UserRole, LeaveStatus, LeaveType, EmployeeStatus } from '../../types';
import type { ClockRecord, LeaveRequest, Employee, ScheduleEvent, SalaryDetail, TodayAttendanceComparison, PendingItem } from '../../types';

const dayOfWeekMap = ['日', '一', '二', '三', '四', '五', '六'];

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

// ==================== 薪資計算 ====================

const calculateSalaryForEmployee = (
    emp: any,
    yearMonth: string,
    scheduleTemplates: any[],
    clockRecords: ClockRecord[],
    leaveRequests: LeaveRequest[]
): SalaryDetail => {
    const [year, month] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    let totalWorkDays = 0;
    let scheduledHours = 0;
    for (let day = 1; day <= daysInMonth; day++) {
        const dow = new Date(year, month - 1, day).getDay();
        const tmpl = scheduleTemplates[dow];
        if (!tmpl || tmpl.status === '休館') continue;
        const staffList = [tmpl.staffA, tmpl.staffB, ...(tmpl.partTime || [])];
        if (staffList.includes(emp.name)) {
            totalWorkDays++;
            if (tmpl.shiftTime) {
                const [start, end] = tmpl.shiftTime.split('-');
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
            const snap = await db.collection('employees').doc(data.empId).get();
            if (!snap.exists) return ok(null);
            const emp = snap.data()!;
            if (emp.password !== data.password) return ok(null);
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
            const check = await db.collection('employees').doc('EMP001').get();
            if (check.exists) return ok({ message: '已初始化' });

            const employees = [
                { id: 'EMP001', name: '王小明', role: UserRole.Admin, position: '專責人員', phone: '0912-345-678', email: 'wang@example.com', hourlyRate: 0, monthlySalary: 38000, hireDate: '2023-01-15', status: '在職' as EmployeeStatus, password: 'password' },
                { id: 'EMP002', name: '李小華', role: UserRole.Admin, position: '專責人員', phone: '0923-456-789', email: 'lee@example.com', hourlyRate: 0, monthlySalary: 36000, hireDate: '2023-02-01', status: '在職' as EmployeeStatus, password: 'password' },
                { id: 'EMP003', name: '張小美', role: UserRole.Employee, position: '兼職人員', phone: '0934-567-890', email: 'chang@example.com', hourlyRate: 183, hireDate: '2023-06-01', status: '在職' as EmployeeStatus, password: 'password' },
                { id: 'EMP004', name: '陳大文', role: UserRole.Employee, position: '兼職人員', phone: '0945-678-901', email: 'chen@example.com', hourlyRate: 183, hireDate: '2023-07-15', status: '在職' as EmployeeStatus, password: 'password' },
                { id: 'EMP005', name: '林小芬', role: UserRole.Employee, position: '兼職人員', phone: '0956-789-012', email: 'lin@example.com', hourlyRate: 183, hireDate: '2024-01-01', status: '在職' as EmployeeStatus, password: 'password' },
            ];
            const batch = db.batch();
            for (const emp of employees) {
                batch.set(db.collection('employees').doc(emp.id), emp);
            }
            const schedule = [
                { status: '營運', shiftTime: '08:30-17:30', staffA: '王小明', staffB: '李小華', partTime: ['陳大文'] },
                { status: '休館', shiftTime: '', staffA: '', staffB: '', partTime: [] },
                { status: '休館', shiftTime: '', staffA: '', staffB: '', partTime: [] },
                { status: '營運', shiftTime: '10:00-20:00', staffA: '王小明', staffB: '', partTime: ['張小美'] },
                { status: '營運', shiftTime: '10:00-20:00', staffA: '王小明', staffB: '', partTime: ['陳大文'] },
                { status: '營運', shiftTime: '08:30-17:30', staffA: '王小明', staffB: '李小華', partTime: ['林小芬'] },
                { status: '營運', shiftTime: '08:30-17:30', staffA: '王小明', staffB: '李小華', partTime: ['張小美'] },
            ];
            for (let i = 0; i < 7; i++) {
                batch.set(db.collection('scheduleTemplate').doc(String(i)), schedule[i]);
            }
            await batch.commit();
            return ok({ message: '初始化完成' });
        } catch (e: any) {
            return fail(500, e.message);
        }
    }

    // ---- 需要驗證的 action ----
    const decoded = await verifyToken(event.headers.authorization);
    if (!decoded) return fail(401, '請先登入');
    const uid = decoded.uid; // uid === empId

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
                await db.collection('clockRecords').add({
                    empId: uid,
                    name: data.name,
                    date: today,
                    clockInTime,
                    clockOutTime: null,
                    verificationMethod: data.verificationMethod,
                    verificationData: data.verificationData,
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
                const [year, month] = data.yearMonth.split('-').map(Number);
                const daysInMonth = new Date(year, month, 0).getDate();
                const [templates, empSnap] = await Promise.all([
                    getScheduleTemplates(),
                    db.collection('employees').doc(uid).get()
                ]);
                if (!empSnap.exists) return ok([]);
                const user = empSnap.data()!;
                const schedule: ScheduleEvent[] = [];
                for (let day = 1; day <= daysInMonth; day++) {
                    const dow = new Date(year, month - 1, day).getDay();
                    const tmpl = templates[dow];
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const pt: string[] = tmpl.partTime || [];
                    if (tmpl.staffA === user.name || tmpl.staffB === user.name || pt.includes(user.name)) {
                        schedule.push({ date: dateStr, dayOfWeek: dayOfWeekMap[dow], ...tmpl });
                    } else if (tmpl.status === '休館') {
                        schedule.push({ date: dateStr, dayOfWeek: dayOfWeekMap[dow], ...tmpl });
                    }
                }
                return ok(schedule);
            }

            case 'get-monthly-schedule': {
                const [year, month] = data.yearMonth.split('-').map(Number);
                const daysInMonth = new Date(year, month, 0).getDate();
                const templates = await getScheduleTemplates();
                const schedule: ScheduleEvent[] = [];
                for (let day = 1; day <= daysInMonth; day++) {
                    const dow = new Date(year, month - 1, day).getDay();
                    schedule.push({
                        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                        dayOfWeek: dayOfWeekMap[dow],
                        ...templates[dow]
                    });
                }
                return ok(schedule);
            }

            case 'update-schedule': {
                const event = data.event as ScheduleEvent;
                const [y, m, d2] = event.date.split('-').map(Number);
                const dow = new Date(y, m - 1, d2).getDay();
                const { date: _d, dayOfWeek: _dw, ...tmplData } = event;
                await db.collection('scheduleTemplate').doc(String(dow)).set(tmplData);
                return ok(true);
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
                const newEmp = { ...data.employee, id: newId, password: data.initialPassword || 'password' };
                await db.collection('employees').doc(newId).set(newEmp);
                const { password: _p, ...empWithoutPwd } = newEmp;
                return ok(empWithoutPwd);
            }

            case 'update-employee': {
                const ref = db.collection('employees').doc(data.empId);
                const snap = await ref.get();
                if (!snap.exists) return ok(null);
                await ref.update(data.updates);
                const updated = await ref.get();
                const { password: _p, ...emp } = updated.data()!;
                return ok(emp);
            }

            case 'delete-employee': {
                const snap = await db.collection('employees').doc(data.empId).get();
                if (!snap.exists) return ok(false);
                await db.collection('employees').doc(data.empId).delete();
                return ok(true);
            }

            // ==================== 密碼管理 ====================

            case 'change-password': {
                const snap = await db.collection('employees').doc(uid).get();
                if (!snap.exists) return ok({ success: false, message: '帳號不存在' });
                if (snap.data()!.password !== data.oldPassword) return ok({ success: false, message: '舊密碼錯誤' });
                if (data.newPassword.length < 4) return ok({ success: false, message: '新密碼至少需要 4 個字元' });
                await db.collection('employees').doc(uid).update({ password: data.newPassword });
                return ok({ success: true, message: '密碼已更新成功' });
            }

            case 'reset-password': {
                const snap = await db.collection('employees').doc(data.empId).get();
                if (!snap.exists) return ok({ success: false, message: '帳號不存在' });
                if (data.newPassword.length < 4) return ok({ success: false, message: '新密碼至少需要 4 個字元' });
                await db.collection('employees').doc(data.empId).update({ password: data.newPassword });
                return ok({ success: true, message: '密碼已重設成功' });
            }

            // ==================== 儀表板 ====================

            case 'get-dashboard-stats': {
                const today = new Date().toISOString().slice(0, 10);
                const yearMonth = today.slice(0, 7);
                const dayOfWeek = new Date().getDay();

                const [templates, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getScheduleTemplates(),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);

                const todaySchedule = templates[dayOfWeek];
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
                const [year, month] = data.yearMonth.split('-').map(Number);
                const daysInMonth = new Date(year, month, 0).getDate();
                const [templates, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getScheduleTemplates(),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);
                const employees = empSnap.docs.map(d => d.data());
                const monthRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord)).filter(r => r.date.startsWith(data.yearMonth));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                const result = [];
                for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dow = new Date(year, month - 1, day).getDay();
                    const tmpl = templates[dow];
                    const scheduledStaff: string[] = [];
                    if (tmpl.staffA) scheduledStaff.push(tmpl.staffA);
                    if (tmpl.staffB) scheduledStaff.push(tmpl.staffB);
                    scheduledStaff.push(...(tmpl.partTime || []));
                    const dayRecords = monthRecords.filter(r => r.date === dateStr);
                    const empList = employees.map(user => {
                        const isScheduled = scheduledStaff.includes(user.name);
                        const record = dayRecords.find(r => r.empId === user.id);
                        const leaveOnDay = leaveRequests.find(lr => lr.empId === user.id && lr.status === LeaveStatus.Approved && lr.startDate.slice(0, 10) <= dateStr && lr.endDate.slice(0, 10) >= dateStr);
                        let attendanceStatus: string = '-';
                        if (tmpl.status === '休館') attendanceStatus = '-';
                        else if (leaveOnDay) attendanceStatus = '休假';
                        else if (isScheduled) attendanceStatus = record ? record.status : '缺勤';
                        return { empId: user.id, name: user.name, position: user.position, scheduled: isScheduled, scheduledShift: isScheduled ? tmpl.shiftTime : null, clockInTime: record?.clockInTime || null, clockOutTime: record?.clockOutTime || null, workHours: record?.workHours || null, attendanceStatus };
                    });
                    result.push({ date: dateStr, dayOfWeek: dayOfWeekMap[dow], status: tmpl.status, employees: empList });
                }
                return ok(result);
            }

            // ==================== 薪資 ====================

            case 'get-all-salary-details': {
                const [templates, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getScheduleTemplates(),
                    db.collection('employees').get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);
                const clockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                const activeEmployees = empSnap.docs.map(d => d.data()).filter(e => e.status === '在職');
                return ok(activeEmployees.map(emp => calculateSalaryForEmployee(emp, data.yearMonth, templates, clockRecords, leaveRequests)));
            }

            case 'get-employee-salary': {
                const [templates, empSnap, clockSnap, leaveSnap] = await Promise.all([
                    getScheduleTemplates(),
                    db.collection('employees').doc(data.empId || uid).get(),
                    db.collection('clockRecords').get(),
                    db.collection('leaveRequests').get(),
                ]);
                if (!empSnap.exists) return ok(null);
                const clockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
                const leaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
                return ok(calculateSalaryForEmployee(empSnap.data()!, data.yearMonth, templates, clockRecords, leaveRequests));
            }

            default:
                return fail(400, `未知的 action: ${action}`);
        }
    } catch (e: any) {
        console.error('API Error:', e);
        return fail(500, e.message || '伺服器錯誤');
    }
};
