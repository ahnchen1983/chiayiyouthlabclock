
import {
    User,
    UserRole,
    ClockStatus,
    ScheduleEvent,
    ClockRecord,
    LeaveRequest,
    LeaveStatus,
    LeaveType,
    PartTimeHourInfo,
    Employee,
    EmployeeStatus,
    TodayAttendanceComparison,
    PendingItem,
    DashboardStats,
    SalaryDetail,
} from '../types';

// This is a mock implementation of the Google Apps Script API.
// In a real application, this would make network requests to the deployed script.
const MOCK_DELAY = 500;

const mockUsers: User[] = [
    { id: 'EMP001', name: '王小明', role: UserRole.Admin, position: '專責人員' },
    { id: 'EMP002', name: '李小華', role: UserRole.Admin, position: '專責人員' },
    { id: 'EMP003', name: '張小美', role: UserRole.Employee, position: '兼職人員' },
    { id: 'EMP004', name: '陳大文', role: UserRole.Employee, position: '兼職人員' },
    { id: 'EMP005', name: '林小芬', role: UserRole.Employee, position: '兼職人員' },
];

let mockEmployees: (Employee & { monthlySalary?: number })[] = [
    { id: 'EMP001', name: '王小明', phone: '0912-345-678', email: 'wang@example.com', hourlyRate: 0, monthlySalary: 38000, hireDate: '2023-01-15', status: '在職' as EmployeeStatus, position: '專責人員', role: UserRole.Admin },
    { id: 'EMP002', name: '李小華', phone: '0923-456-789', email: 'lee@example.com', hourlyRate: 0, monthlySalary: 36000, hireDate: '2023-02-01', status: '在職' as EmployeeStatus, position: '專責人員', role: UserRole.Admin },
    { id: 'EMP003', name: '張小美', phone: '0934-567-890', email: 'chang@example.com', hourlyRate: 183, hireDate: '2023-06-01', status: '在職' as EmployeeStatus, position: '兼職人員', role: UserRole.Employee },
    { id: 'EMP004', name: '陳大文', phone: '0945-678-901', email: 'chen@example.com', hourlyRate: 183, hireDate: '2023-07-15', status: '在職' as EmployeeStatus, position: '兼職人員', role: UserRole.Employee },
    { id: 'EMP005', name: '林小芬', phone: '0956-789-012', email: 'lin@example.com', hourlyRate: 183, hireDate: '2024-01-01', status: '在職' as EmployeeStatus, position: '兼職人員', role: UserRole.Employee },
];

let mockClockRecords: ClockRecord[] = [
    { id: 'CLK1', empId: 'EMP003', name: '張小美', date: '2024-07-24', clockInTime: '08:30', clockOutTime: '17:30', verificationMethod: 'IP', verificationData: '127.0.0.1', workHours: 8, status: '正常' },
    { id: 'CLK2', empId: 'EMP004', name: '陳大文', date: '2024-07-24', clockInTime: '10:05', clockOutTime: '20:00', verificationMethod: 'GPS', verificationData: '23.4,120.4', workHours: 8.9, status: '遲到' },
];

let mockLeaveRequests: LeaveRequest[] = [
    { id: 'LV1', empId: 'EMP003', name: '張小美', leaveType: LeaveType.Personal, startDate: '2024-08-01T09:00', endDate: '2024-08-01T17:00', hours: 8, reason: '家庭因素', requestDate: '2024-07-20', status: LeaveStatus.Pending },
    { id: 'LV2', empId: 'EMP004', name: '陳大文', leaveType: LeaveType.Sick, startDate: '2024-07-22T10:00', endDate: '2024-07-22T14:00', hours: 4, reason: '感冒', requestDate: '2024-07-22', status: LeaveStatus.Approved, approver: '王小明', approvalDate: '2024-07-22' },
];

const mockSchedules: Omit<ScheduleEvent, 'date' | 'dayOfWeek'>[] = [
    { status: '營運', shiftTime: '08:30-17:30', staffA: '王小明', staffB: '李小華', partTime: ['陳大文'] }, // Sun
    { status: '休館', shiftTime: '', staffA: '', staffB: '', partTime: [] }, // Mon
    { status: '休館', shiftTime: '', staffA: '', staffB: '', partTime: [] }, // Tue
    { status: '營運', shiftTime: '10:00-20:00', staffA: '王小明', staffB: '', partTime: ['張小美'] }, // Wed
    { status: '營運', shiftTime: '10:00-20:00', staffA: '王小明', staffB: '', partTime: ['陳大文'] }, // Thu
    { status: '營運', shiftTime: '08:30-17:30', staffA: '王小明', staffB: '李小華', partTime: ['林小芬'] }, // Fri
    { status: '營運', shiftTime: '08:30-17:30', staffA: '王小明', staffB: '李小華', partTime: ['張小美'] }, // Sat
];

const dayOfWeekMap = ['日', '一', '二', '三', '四', '五', '六'];

// 每位使用者的密碼（mock 儲存）
const mockPasswords: Record<string, string> = {
    'EMP001': 'password',
    'EMP002': 'password',
    'EMP003': 'password',
    'EMP004': 'password',
    'EMP005': 'password',
};

export const apiLogin = (username: string, password: string): Promise<User | null> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const user = mockUsers.find(u => u.id === username);
            if (user && mockPasswords[username] === password) {
                resolve(user);
            } else {
                resolve(null);
            }
        }, MOCK_DELAY);
    });
};

export const apiGetTodayClockStatus = (empId: string): Promise<ClockStatus> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const today = new Date().toISOString().slice(0, 10);
            const record = mockClockRecords.find(r => r.empId === empId && r.date === today);
            resolve({
                clockInTime: record?.clockInTime || undefined,
                clockOutTime: record?.clockOutTime || undefined
            });
        }, MOCK_DELAY);
    });
};

export const apiClockIn = (empId: string, name: string, verificationMethod: 'IP' | 'GPS', verificationData: string): Promise<boolean> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const today = new Date().toISOString().slice(0, 10);
            const existing = mockClockRecords.find(r => r.empId === empId && r.date === today);
            if (!existing) {
                mockClockRecords.push({
                    id: `CLK${Date.now()}`,
                    empId,
                    name,
                    date: today,
                    clockInTime: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                    clockOutTime: null,
                    verificationMethod,
                    verificationData,
                    workHours: null,
                    status: '正常'
                });
            }
            resolve(true);
        }, MOCK_DELAY);
    });
};

export const apiClockOut = (empId: string): Promise<boolean> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const today = new Date().toISOString().slice(0, 10);
            const record = mockClockRecords.find(r => r.empId === empId && r.date === today);
            if (record && !record.clockOutTime) {
                record.clockOutTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                // Mock work hours calculation
                record.workHours = 8;
            }
            resolve(true);
        }, MOCK_DELAY);
    });
};

export const apiValidateGPS = (lat: number, lng: number): Promise<{ isValid: boolean, distance?: number }> => {
    return new Promise(resolve => {
        setTimeout(() => {
            // Mock GPS center point and allowed range from specs
            const centerLat = 23.4800;
            const centerLng = 120.4500;
            const allowedRange = 100; // meters

            const R = 6371e3; // metres
            const φ1 = (lat * Math.PI) / 180;
            const φ2 = (centerLat * Math.PI) / 180;
            const Δφ = ((centerLat - lat) * Math.PI) / 180;
            const Δλ = ((centerLng - lng) * Math.PI) / 180;

            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distance = R * c;

            resolve({ isValid: distance <= allowedRange, distance });
        }, MOCK_DELAY);
    });
};

export const apiGetEmployeeSchedule = (empId: string, yearMonth: string): Promise<ScheduleEvent[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const [year, month] = yearMonth.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const schedule: ScheduleEvent[] = [];
            const user = mockUsers.find(u => u.id === empId);
            if (!user) return resolve([]);

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month - 1, day);
                const dayOfWeekIndex = date.getDay();
                const eventTemplate = mockSchedules[dayOfWeekIndex];

                if (eventTemplate.staffA === user.name || eventTemplate.staffB === user.name || eventTemplate.partTime.includes(user.name)) {
                    schedule.push({
                        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                        dayOfWeek: dayOfWeekMap[dayOfWeekIndex],
                        ...eventTemplate
                    });
                } else if (eventTemplate.status === '休館') {
                    schedule.push({
                        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                        dayOfWeek: dayOfWeekMap[dayOfWeekIndex],
                        ...eventTemplate
                    });
                }
            }
            resolve(schedule);
        }, MOCK_DELAY);
    });
};

export const apiGetClockRecords = (empId: string, yearMonth: string): Promise<ClockRecord[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(mockClockRecords.filter(r => r.empId === empId && r.date.startsWith(yearMonth)));
        }, MOCK_DELAY);
    });
};

export const apiGetEmployeeLeaveRequests = (empId: string): Promise<LeaveRequest[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(mockLeaveRequests.filter(r => r.empId === empId));
        }, MOCK_DELAY);
    });
};

export const apiSubmitLeaveRequest = (request: Omit<LeaveRequest, 'id' | 'requestDate' | 'status' | 'approver' | 'approvalDate' | 'hours' | 'name'>): Promise<boolean> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const user = mockUsers.find(u => u.id === request.empId);
            mockLeaveRequests.push({
                ...request,
                id: `LV${Date.now()}`,
                name: user?.name || 'Unknown',
                requestDate: new Date().toISOString(),
                status: LeaveStatus.Pending,
                hours: 8 // Mock calculation
            });
            resolve(true);
        }, MOCK_DELAY);
    });
};

export const apiGetDashboardStats = (): Promise<DashboardStats> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const today = new Date().toISOString().slice(0, 10);
            const dayOfWeek = new Date().getDay();
            const todaySchedule = mockSchedules[dayOfWeek];

            // 計算今日排班人員
            const scheduledStaff: string[] = [];
            if (todaySchedule.staffA) scheduledStaff.push(todaySchedule.staffA);
            if (todaySchedule.staffB) scheduledStaff.push(todaySchedule.staffB);
            scheduledStaff.push(...todaySchedule.partTime);

            // 今日打卡紀錄
            const todayRecords = mockClockRecords.filter(r => r.date === today);

            // 建立今日出勤對照表
            const todayAttendance: TodayAttendanceComparison[] = mockUsers.map(user => {
                const isScheduled = scheduledStaff.includes(user.name);
                const record = todayRecords.find(r => r.empId === user.id);
                const leaveToday = mockLeaveRequests.find(
                    lr => lr.empId === user.id &&
                        lr.status === LeaveStatus.Approved &&
                        lr.startDate.slice(0, 10) <= today &&
                        lr.endDate.slice(0, 10) >= today
                );

                let status: TodayAttendanceComparison['status'] = '未排班';
                if (leaveToday) {
                    status = '休假';
                } else if (isScheduled) {
                    if (record?.clockInTime) {
                        status = record.status === '遲到' ? '遲到' : (record.status === '早退' ? '早退' : '已到');
                    } else {
                        status = '未到';
                    }
                }

                return {
                    empId: user.id,
                    name: user.name,
                    position: user.position,
                    scheduledShift: isScheduled ? todaySchedule.shiftTime : null,
                    clockInTime: record?.clockInTime || null,
                    clockOutTime: record?.clockOutTime || null,
                    status
                };
            });

            // 待處理事項
            const pendingItems: PendingItem[] = [];

            // 待審核請假
            mockLeaveRequests.filter(r => r.status === LeaveStatus.Pending).forEach(lr => {
                pendingItems.push({
                    id: lr.id,
                    type: '請假審核',
                    title: `${lr.name} 申請${lr.leaveType}`,
                    description: `${lr.startDate.slice(0, 10)} ~ ${lr.endDate.slice(0, 10)}`,
                    date: lr.requestDate,
                    priority: 'high'
                });
            });

            // 時數警示（接近上限的兼職人員）
            const partTimers = mockUsers.filter(u => u.position === '兼職人員');
            partTimers.forEach(pt => {
                const scheduledHours = Math.random() * 60 + 10;
                const remainingHours = 80 - scheduledHours;
                if (remainingHours <= 10) {
                    pendingItems.push({
                        id: `WARN-${pt.id}`,
                        type: '時數警示',
                        title: `${pt.name} 時數接近上限`,
                        description: `本月已排 ${scheduledHours.toFixed(1)} 小時，剩餘 ${remainingHours.toFixed(1)} 小時`,
                        date: today,
                        priority: 'medium'
                    });
                }
            });

            resolve({
                todayClockedIn: todayRecords.length,
                todayScheduled: scheduledStaff.length,
                monthlyTotalHours: 320.5,
                pendingLeaves: mockLeaveRequests.filter(r => r.status === LeaveStatus.Pending).length,
                hourWarnings: 1,
                todayAttendance,
                pendingItems
            });
        }, MOCK_DELAY);
    });
};

export const apiGetMonthlySchedule = (yearMonth: string): Promise<ScheduleEvent[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const [year, month] = yearMonth.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const schedule: ScheduleEvent[] = [];
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month - 1, day);
                const dayOfWeekIndex = date.getDay();
                schedule.push({
                    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                    dayOfWeek: dayOfWeekMap[dayOfWeekIndex],
                    ...mockSchedules[dayOfWeekIndex]
                });
            }
            resolve(schedule);
        }, MOCK_DELAY);
    });
};

export const apiUpdateSchedule = (updatedEvent: ScheduleEvent): Promise<boolean> => {
    return new Promise(resolve => {
        setTimeout(() => {
            // In a real app, you'd find and update the schedule in the backend.
            console.log('Updating schedule for:', updatedEvent.date, updatedEvent);
            resolve(true);
        }, MOCK_DELAY);
    });
}

export const apiGetAllEmployees = (): Promise<User[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(mockUsers);
        }, MOCK_DELAY);
    });
};

export const apiGetAllClockRecords = (yearMonth: string): Promise<ClockRecord[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(mockClockRecords.filter(r => r.date.startsWith(yearMonth)));
        }, MOCK_DELAY);
    });
};

export const apiGetAllLeaveRequests = (): Promise<LeaveRequest[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(mockLeaveRequests);
        }, MOCK_DELAY);
    });
};

export const apiApproveLeave = (requestId: string, status: LeaveStatus, approverName: string): Promise<boolean> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const request = mockLeaveRequests.find(r => r.id === requestId);
            if (request) {
                request.status = status;
                request.approver = approverName;
                request.approvalDate = new Date().toISOString();
            }
            resolve(true);
        }, MOCK_DELAY);
    });
};

export const apiGetAllPartTimeHours = (yearMonth: string): Promise<PartTimeHourInfo[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const partTimers = mockUsers.filter(u => u.position === '兼職人員');
            resolve(partTimers.map(pt => {
                const scheduledHours = Math.random() * 60 + 10;
                const remainingHours = 80 - scheduledHours;
                return {
                    empId: pt.id,
                    name: pt.name,
                    month: yearMonth,
                    scheduledHours: scheduledHours,
                    workedHours: Math.random() * scheduledHours,
                    remainingHours: remainingHours,
                    status: remainingHours <= 10 ? '接近上限' : '正常'
                }
            }));
        }, MOCK_DELAY);
    });
};

// ==================== 員工管理 CRUD API ====================

export const apiGetAllEmployeesDetail = (): Promise<Employee[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve([...mockEmployees]);
        }, MOCK_DELAY);
    });
};

export const apiGetEmployee = (empId: string): Promise<Employee | null> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const employee = mockEmployees.find(e => e.id === empId);
            resolve(employee || null);
        }, MOCK_DELAY);
    });
};

export const apiCreateEmployee = (employee: Omit<Employee, 'id'>, initialPassword?: string): Promise<Employee> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const newId = `EMP${String(mockEmployees.length + 1).padStart(3, '0')}`;
            const newEmployee: Employee = { ...employee, id: newId };
            mockEmployees.push(newEmployee);
            // 同步更新 mockUsers
            mockUsers.push({
                id: newId,
                name: employee.name,
                role: employee.role,
                position: employee.position
            });
            // 設定密碼
            mockPasswords[newId] = initialPassword || 'password';
            resolve(newEmployee);
        }, MOCK_DELAY);
    });
};

export const apiUpdateEmployee = (empId: string, updates: Partial<Employee>): Promise<Employee | null> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const index = mockEmployees.findIndex(e => e.id === empId);
            if (index !== -1) {
                mockEmployees[index] = { ...mockEmployees[index], ...updates };
                // 同步更新 mockUsers
                const userIndex = mockUsers.findIndex(u => u.id === empId);
                if (userIndex !== -1 && updates.name) {
                    mockUsers[userIndex].name = updates.name;
                }
                if (userIndex !== -1 && updates.position) {
                    mockUsers[userIndex].position = updates.position;
                }
                if (userIndex !== -1 && updates.role) {
                    mockUsers[userIndex].role = updates.role;
                }
                resolve(mockEmployees[index]);
            } else {
                resolve(null);
            }
        }, MOCK_DELAY);
    });
};

export const apiDeleteEmployee = (empId: string): Promise<boolean> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const index = mockEmployees.findIndex(e => e.id === empId);
            if (index !== -1) {
                mockEmployees.splice(index, 1);
                // 同步刪除 mockUsers
                const userIndex = mockUsers.findIndex(u => u.id === empId);
                if (userIndex !== -1) {
                    mockUsers.splice(userIndex, 1);
                }
                resolve(true);
            } else {
                resolve(false);
            }
        }, MOCK_DELAY);
    });
};

// ==================== 密碼管理 API ====================

export const apiChangePassword = (empId: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    return new Promise(resolve => {
        setTimeout(() => {
            if (!mockPasswords[empId]) {
                resolve({ success: false, message: '帳號不存在' });
                return;
            }
            if (mockPasswords[empId] !== oldPassword) {
                resolve({ success: false, message: '舊密碼錯誤' });
                return;
            }
            if (newPassword.length < 4) {
                resolve({ success: false, message: '新密碼至少需要 4 個字元' });
                return;
            }
            mockPasswords[empId] = newPassword;
            resolve({ success: true, message: '密碼已更新成功' });
        }, MOCK_DELAY);
    });
};

export const apiResetPassword = (empId: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    return new Promise(resolve => {
        setTimeout(() => {
            if (!mockPasswords[empId]) {
                resolve({ success: false, message: '帳號不存在' });
                return;
            }
            if (newPassword.length < 4) {
                resolve({ success: false, message: '新密碼至少需要 4 個字元' });
                return;
            }
            mockPasswords[empId] = newPassword;
            resolve({ success: true, message: '密碼已重設成功' });
        }, MOCK_DELAY);
    });
};

// ==================== 排班 vs 出勤對照 API ====================

export interface ScheduleAttendanceComparison {
    date: string;
    dayOfWeek: string;
    status: '營運' | '休館';
    employees: {
        empId: string;
        name: string;
        position: '專責人員' | '兼職人員';
        scheduled: boolean;
        scheduledShift: string | null;
        clockInTime: string | null;
        clockOutTime: string | null;
        workHours: number | null;
        attendanceStatus: '正常' | '遲到' | '早退' | '缺勤' | '休假' | '-';
    }[];
}

export const apiGetScheduleAttendanceComparison = (yearMonth: string): Promise<ScheduleAttendanceComparison[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const [year, month] = yearMonth.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const result: ScheduleAttendanceComparison[] = [];

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month - 1, day);
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayOfWeekIndex = date.getDay();
                const scheduleTemplate = mockSchedules[dayOfWeekIndex];

                const scheduledStaff: string[] = [];
                if (scheduleTemplate.staffA) scheduledStaff.push(scheduleTemplate.staffA);
                if (scheduleTemplate.staffB) scheduledStaff.push(scheduleTemplate.staffB);
                scheduledStaff.push(...scheduleTemplate.partTime);

                const dayRecords = mockClockRecords.filter(r => r.date === dateStr);

                const employees = mockUsers.map(user => {
                    const isScheduled = scheduledStaff.includes(user.name);
                    const record = dayRecords.find(r => r.empId === user.id);
                    const leaveOnDay = mockLeaveRequests.find(
                        lr => lr.empId === user.id &&
                            lr.status === LeaveStatus.Approved &&
                            lr.startDate.slice(0, 10) <= dateStr &&
                            lr.endDate.slice(0, 10) >= dateStr
                    );

                    let attendanceStatus: '正常' | '遲到' | '早退' | '缺勤' | '休假' | '-' = '-';
                    if (scheduleTemplate.status === '休館') {
                        attendanceStatus = '-';
                    } else if (leaveOnDay) {
                        attendanceStatus = '休假';
                    } else if (isScheduled) {
                        if (record) {
                            attendanceStatus = record.status;
                        } else {
                            attendanceStatus = '缺勤';
                        }
                    }

                    return {
                        empId: user.id,
                        name: user.name,
                        position: user.position,
                        scheduled: isScheduled,
                        scheduledShift: isScheduled ? scheduleTemplate.shiftTime : null,
                        clockInTime: record?.clockInTime || null,
                        clockOutTime: record?.clockOutTime || null,
                        workHours: record?.workHours || null,
                        attendanceStatus
                    };
                });

                result.push({
                    date: dateStr,
                    dayOfWeek: dayOfWeekMap[dayOfWeekIndex],
                    status: scheduleTemplate.status,
                    employees
                });
            }

            resolve(result);
        }, MOCK_DELAY);
    });
};

// ==================== 薪資計算 API ====================

const calculateSalaryForEmployee = (emp: (Employee & { monthlySalary?: number }), yearMonth: string): SalaryDetail => {
    // 模擬出勤資料
    const [year, month] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    // 計算排班天數與工時
    let totalWorkDays = 0;
    let totalWorkHours = 0;
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dow = date.getDay();
        const template = mockSchedules[dow];
        if (template.status === '休館') continue;
        const staffList = [template.staffA, template.staffB, ...template.partTime];
        if (staffList.includes(emp.name)) {
            totalWorkDays++;
            if (template.shiftTime) {
                const [start, end] = template.shiftTime.split('-');
                const [sh, sm] = start.split(':').map(Number);
                const [eh, em] = end.split(':').map(Number);
                totalWorkHours += (eh + em / 60) - (sh + sm / 60);
            }
        }
    }

    // 模擬請假
    const empLeaves = mockLeaveRequests.filter(
        lr => lr.empId === emp.id && lr.status === LeaveStatus.Approved && lr.startDate.slice(0, 7) === yearMonth
    );
    const totalLeaveHours = empLeaves.reduce((sum, lr) => sum + lr.hours, 0);
    const leaveDetails = empLeaves.map(lr => ({ type: lr.leaveType, hours: lr.hours }));

    // 加班（模擬: 超過 8 小時的部分）
    const regularHoursPerDay = 8;
    const overtimeHours = Math.max(0, totalWorkHours - totalWorkDays * regularHoursPerDay);

    // 底薪計算
    let baseSalary: number;
    if (emp.position === '專責人員') {
        baseSalary = emp.monthlySalary || 30000;
    } else {
        baseSalary = Math.round((totalWorkHours - overtimeHours) * emp.hourlyRate);
    }

    // 加班費（勞基法: 前 2 小時 1.34 倍，之後 1.67 倍，簡化為 1.34 倍）
    const hourlyForOT = emp.position === '專責人員'
        ? Math.round((emp.monthlySalary || 30000) / 30 / 8)
        : emp.hourlyRate;
    const overtimePay = Math.round(overtimeHours * hourlyForOT * 1.34);

    const grossSalary = baseSalary + overtimePay;

    // 請假扣薪（事假扣薪，病假扣半薪，特休不扣）
    let leaveDeduction = 0;
    const hourlyWage = emp.position === '專責人員'
        ? Math.round((emp.monthlySalary || 30000) / 30 / 8)
        : emp.hourlyRate;
    empLeaves.forEach(lr => {
        if (lr.leaveType === LeaveType.Personal) {
            leaveDeduction += lr.hours * hourlyWage;
        } else if (lr.leaveType === LeaveType.Sick) {
            leaveDeduction += Math.round(lr.hours * hourlyWage * 0.5);
        }
    });

    // 勞基法扣除項目（簡化計算，依投保薪資級距）
    const insuredSalary = grossSalary; // 簡化：以應發薪資作為投保薪資
    const laborInsurance = Math.round(insuredSalary * 0.023);  // 勞保自付 ~2.3% (含就業保險)
    const healthInsurance = Math.round(insuredSalary * 0.0211); // 健保自付 ~2.11%
    const laborPensionSelf = Math.round(insuredSalary * 0.06);  // 勞退自提 6%

    const totalDeductions = laborInsurance + healthInsurance + laborPensionSelf + leaveDeduction;
    const netSalary = grossSalary - totalDeductions;

    return {
        empId: emp.id,
        name: emp.name,
        position: emp.position,
        yearMonth,
        totalWorkDays,
        totalWorkHours: Math.round(totalWorkHours * 10) / 10,
        totalLeaveHours,
        leaveDetails,
        overtimeHours: Math.round(overtimeHours * 10) / 10,
        baseSalary,
        overtimePay,
        grossSalary,
        laborInsurance,
        healthInsurance,
        laborPensionSelf,
        leaveDeduction,
        totalDeductions,
        netSalary,
    };
};

// 管理者: 取得所有員工薪資明細
export const apiGetAllSalaryDetails = (yearMonth: string): Promise<SalaryDetail[]> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const activeEmployees = mockEmployees.filter(e => e.status === '在職');
            const salaries = activeEmployees.map(emp => calculateSalaryForEmployee(emp, yearMonth));
            resolve(salaries);
        }, MOCK_DELAY);
    });
};

// 員工: 取得自己的薪資明細
export const apiGetEmployeeSalary = (empId: string, yearMonth: string): Promise<SalaryDetail | null> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const emp = mockEmployees.find(e => e.id === empId);
            if (!emp) {
                resolve(null);
                return;
            }
            resolve(calculateSalaryForEmployee(emp, yearMonth));
        }, MOCK_DELAY);
    });
};
