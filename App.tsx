
import React, { useState, useEffect, useCallback } from 'react';
import { User, UserRole, Shift, AttendanceRecord, NetworkInfo } from './types';
import { MOCK_USERS, TRUSTED_IP_PREFIX, COMPANY_WIFI_NAME } from './constants';
import { useStore } from './contexts/StoreContext';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import ClockInPanel from './components/ClockInPanel';
import ScheduleCalendar from './components/ScheduleCalendar';
import {
  LayoutDashboard,
  CalendarCheck,
  Settings,
  LogOut,
  ShieldCheck,
  Network,
  Calendar
} from 'lucide-react';

const App: React.FC = () => {
  // Initialize from store users or fallback to MOCK[0] if store not ready (though store is sync)
  // We'll trust store always has something because of initialization logic.
  const [currentUser, setCurrentUser] = useState<User>(MOCK_USERS[0]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'attendance' | 'calendar' | 'admin'>('dashboard');
  const { users, shifts, attendance, setShifts, clockIn } = useStore();

  // Note: currentUser is initialized from the FIRST user in the store.
  // In a real app, this would be a login process.
  // We use useEffect to sync currentUser if users in store change (e.g. edited).
  useEffect(() => {
    const found = users.find(u => u.id === currentUser.id);
    if (found) setCurrentUser(found);
  }, [users, currentUser.id]);
  const [networkStatus, setNetworkStatus] = useState<NetworkInfo>({
    isInternal: false,
    publicIp: '123.45.67.89'
  });



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
          <h1 className="text-xl font-bold tracking-tight">TeamSync Pro 團隊同步</h1>
        </div>

        <div className="flex-1 space-y-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-indigo-700 shadow-lg' : 'hover:bg-indigo-800'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="font-medium">儀表板</span>
          </button>
          <button
            onClick={() => setActiveTab('attendance')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition ${activeTab === 'attendance' ? 'bg-indigo-700 shadow-lg' : 'hover:bg-indigo-800'}`}
          >
            <CalendarCheck className="w-5 h-5" />
            <span className="font-medium">出勤打卡</span>
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition ${activeTab === 'calendar' ? 'bg-indigo-700 shadow-lg' : 'hover:bg-indigo-800'}`}
          >
            <Calendar className="w-5 h-5" />
            <span className="font-medium">班表</span>
          </button>
          {currentUser.role === UserRole.ADMIN && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition ${activeTab === 'admin' ? 'bg-indigo-700 shadow-lg' : 'hover:bg-indigo-800'}`}
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">管理後台</span>
            </button>
          )}
        </div>

        <div className="pt-4 border-t border-indigo-800 space-y-4">
          <div className="px-4 py-2 bg-indigo-800/50 rounded-lg text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-indigo-300">網路驗證</span>
              <Network className={`w-4 h-4 ${networkStatus.isInternal ? 'text-green-400' : 'text-red-400'}`} />
            </div>
            <p className="font-mono truncate">{networkStatus.publicIp}</p>
            <button
              onClick={toggleNetwork}
              className="mt-2 text-indigo-200 hover:text-white underline"
            >
              模擬 {networkStatus.isInternal ? '外部' : '辦公室'} 網路
            </button>
          </div>

          <div className="flex items-center space-x-3 px-4">
            <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center font-bold">
              {currentUser.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{currentUser.name}</p>
              <p className="text-xs text-indigo-300 truncate">
                {currentUser.role === 'ADMIN' ? '管理員' : '員工'}
              </p>
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
            <h2 className="text-2xl font-bold text-slate-800 capitalize">
              {activeTab === 'dashboard' ? '儀表板' :
                activeTab === 'attendance' ? '出勤打卡' :
                  activeTab === 'calendar' ? '班表' : '管理後台'}
            </h2>
            <p className="text-slate-500">歡迎回來，{currentUser.name}</p>
          </div>
          <div className="hidden md:block">
            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-sm font-medium text-slate-600">辦公室系統運作中</span>
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
            onClockIn={clockIn}
            currentAttendance={attendance.find(a => a.userId === currentUser.id && a.date === new Date().toISOString().split('T')[0])}
          />
        )}
        {activeTab === 'admin' && currentUser.role === UserRole.ADMIN && (
          <AdminPanel
            shifts={shifts}
            users={users}
            onUpdateShifts={setShifts}
            attendance={attendance}
          />
        )}
        {activeTab === 'calendar' && (
          <ScheduleCalendar shifts={shifts} />
        )}
      </main>
    </div>
  );
};

export default App;
