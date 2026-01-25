
import React, { useState, useEffect, useCallback } from 'react';
import { User, UserRole, Shift, AttendanceRecord, NetworkInfo } from './types';
import { MOCK_USERS, TRUSTED_IP_PREFIX, COMPANY_WIFI_NAME } from './constants';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import ClockInPanel from './components/ClockInPanel';
import { 
  LayoutDashboard, 
  CalendarCheck, 
  Settings, 
  LogOut, 
  ShieldCheck, 
  Network 
} from 'lucide-react';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User>(MOCK_USERS[1]); // Default to Employee for demo
  const [activeTab, setActiveTab] = useState<'dashboard' | 'attendance' | 'admin'>('dashboard');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [networkStatus, setNetworkStatus] = useState<NetworkInfo>({
    isInternal: false,
    publicIp: '123.45.67.89'
  });

  // Load mock data
  useEffect(() => {
    const savedShifts = localStorage.getItem('shifts');
    if (savedShifts) {
      setShifts(JSON.parse(savedShifts));
    } else {
      const initialShifts: Shift[] = [
        { id: 's1', userId: '2', userName: 'John Doe', date: new Date().toISOString().split('T')[0], startTime: '08:00', endTime: '16:00', type: 'Morning' },
        { id: 's2', userId: '3', userName: 'Jane Smith', date: new Date().toISOString().split('T')[0], startTime: '14:00', endTime: '22:00', type: 'Afternoon' },
      ];
      setShifts(initialShifts);
      localStorage.setItem('shifts', JSON.stringify(initialShifts));
    }

    const savedAttendance = localStorage.getItem('attendance');
    if (savedAttendance) {
      setAttendance(JSON.parse(savedAttendance));
    }
  }, []);

  const handleUpdateShifts = (newShifts: Shift[]) => {
    setShifts(newShifts);
    localStorage.setItem('shifts', JSON.stringify(newShifts));
  };

  const handleClockIn = (record: AttendanceRecord) => {
    const newAttendance = [...attendance, record];
    setAttendance(newAttendance);
    localStorage.setItem('attendance', JSON.stringify(newAttendance));
  };

  const toggleNetwork = () => {
    setNetworkStatus(prev => ({
      ...prev,
      isInternal: !prev.isInternal,
      publicIp: !prev.isInternal ? `${TRUSTED_IP_PREFIX}10` : '123.45.67.89'
    }));
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50">
      {/* Sidebar */}
      <nav className="w-full md:w-64 bg-indigo-900 text-white flex flex-col p-4 space-y-8 sticky top-0 h-auto md:h-screen">
        <div className="flex items-center space-x-3 px-2">
          <div className="bg-indigo-500 p-2 rounded-lg">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">TeamSync Pro</h1>
        </div>

        <div className="flex-1 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-indigo-700 shadow-lg' : 'hover:bg-indigo-800'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="font-medium">Dashboard</span>
          </button>
          <button 
            onClick={() => setActiveTab('attendance')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition ${activeTab === 'attendance' ? 'bg-indigo-700 shadow-lg' : 'hover:bg-indigo-800'}`}
          >
            <CalendarCheck className="w-5 h-5" />
            <span className="font-medium">Attendance</span>
          </button>
          {currentUser.role === UserRole.ADMIN && (
            <button 
              onClick={() => setActiveTab('admin')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition ${activeTab === 'admin' ? 'bg-indigo-700 shadow-lg' : 'hover:bg-indigo-800'}`}
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">Admin Panel</span>
            </button>
          )}
        </div>

        <div className="pt-4 border-t border-indigo-800 space-y-4">
          <div className="px-4 py-2 bg-indigo-800/50 rounded-lg text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-indigo-300">Network Verification</span>
              <Network className={`w-4 h-4 ${networkStatus.isInternal ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className="font-mono truncate">{networkStatus.publicIp}</p>
            <button 
              onClick={toggleNetwork}
              className="mt-2 text-indigo-200 hover:text-white underline"
            >
              Simulate {networkStatus.isInternal ? 'External' : 'Office'} WiFi
            </button>
          </div>
          
          <div className="flex items-center space-x-3 px-4">
            <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center font-bold">
              {currentUser.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{currentUser.name}</p>
              <p className="text-xs text-indigo-300 truncate">{currentUser.role}</p>
            </div>
            <button className="text-indigo-400 hover:text-white">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 capitalize">{activeTab}</h2>
            <p className="text-slate-500">Welcome back, {currentUser.name}</p>
          </div>
          <div className="hidden md:block">
            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-sm font-medium text-slate-600">Office Systems Active</span>
            </div>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <Dashboard 
            shifts={shifts.filter(s => s.userId === currentUser.id)} 
            attendance={attendance.filter(a => a.userId === currentUser.id)}
          />
        )}
        {activeTab === 'attendance' && (
          <ClockInPanel 
            currentUser={currentUser}
            networkStatus={networkStatus}
            onClockIn={handleClockIn}
            currentAttendance={attendance.find(a => a.userId === currentUser.id && a.date === new Date().toISOString().split('T')[0])}
          />
        )}
        {activeTab === 'admin' && currentUser.role === UserRole.ADMIN && (
          <AdminPanel 
            shifts={shifts} 
            users={MOCK_USERS} 
            onUpdateShifts={handleUpdateShifts}
            attendance={attendance}
          />
        )}
      </main>
    </div>
  );
};

export default App;
