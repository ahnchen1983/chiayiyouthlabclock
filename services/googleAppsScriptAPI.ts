
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

let mockClockRecords: ClockRecord[] = [
    { id: 'CLK1', empId: 'EMP003', name: '張小美', date: '2024-07-24', clockInTime: '08:30', clockOutTime: '17:30', verificationMethod: 'IP', verificationData: '127.0.0.1', workHours: 8, status: '正常'},
    { id: 'CLK2', empId: 'EMP004', name: '陳大文', date: '2024-07-24', clockInTime: '10:05', clockOutTime: '20:00', verificationMethod: 'GPS', verificationData: '23.4,120.4', workHours: 8.9, status: '遲到'},
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

export const apiLogin = (username: string, password: string): Promise<User | null> => {
    return new Promise(resolve => {
        setTimeout(() => {
            const user = mockUsers.find(u => u.id === username);
            if (user && password === 'password') { // Simple mock password check
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
            if(!user) return resolve([]);

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
                } else if(eventTemplate.status === '休館') {
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

export const apiGetDashboardStats = (): Promise<{ todayClockedIn: number, monthlyTotalHours: number, pendingLeaves: number, hourWarnings: number }> => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve({
                todayClockedIn: 2,
                monthlyTotalHours: 320.5,
                pendingLeaves: mockLeaveRequests.filter(r => r.status === LeaveStatus.Pending).length,
                hourWarnings: 1
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
