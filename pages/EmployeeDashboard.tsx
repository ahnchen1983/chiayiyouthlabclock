// FIX: Correctly import React and the useState hook.
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ClockIn from '../components/employee/ClockIn';
import MyScheduleCalendar from '../components/employee/MyScheduleCalendar';
import MyRecords from '../components/employee/MyRecords';
import LeaveRequestForm from '../components/employee/LeaveRequestForm';
import FullScheduleCalendar from '../components/employee/FullScheduleCalendar';
import MySalary from '../components/employee/MySalary';
import ClockMakeupForm from '../components/employee/ClockMakeupForm';
import MyLeaveBalance from '../components/employee/MyLeaveBalance';
import OpenShiftPicker from '../components/employee/OpenShiftPicker';
import ChangePasswordModal from '../components/ChangePasswordModal';
import NotificationBell from '../components/NotificationBell';
import { ClockIcon, CalendarIcon, ListIcon, SendIcon, LogOutIcon, UsersIcon, DollarIcon } from '../components/icons';

// 鑰匙圖示
const KeyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
  </svg>
);

type View = 'clock' | 'schedule' | 'records' | 'leave' | 'fullSchedule' | 'salary' | 'makeup' | 'leaveBalance' | 'openShifts';

const EmployeeDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('clock');
  const [showChangePassword, setShowChangePassword] = useState(false);

  const renderView = () => {
    switch (currentView) {
      case 'clock':
        return <ClockIn />;
      case 'schedule':
        return <MyScheduleCalendar />;
      case 'fullSchedule':
        return <FullScheduleCalendar />;
      case 'records':
        return <MyRecords />;
      case 'leave':
        return <LeaveRequestForm />;
      case 'salary':
        return <MySalary />;
      case 'makeup':
        return <ClockMakeupForm />;
      case 'leaveBalance':
        return <MyLeaveBalance />;
      case 'openShifts':
        return <OpenShiftPicker />;
      default:
        return <ClockIn />;
    }
  };

  const NavItem: React.FC<{
    view: View;
    icon: React.ReactNode;
    label: string;
  }> = ({ view, icon, label }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={`flex flex-col items-center justify-center min-w-[72px] flex-shrink-0 py-2 px-2 space-y-1 transition-colors duration-200 ${currentView === view
        ? 'text-brand-green-dark border-b-4 border-brand-green-dark font-semibold'
        : 'text-gray-500 hover:bg-green-50'
        }`}
    >
      {icon}
      <span className="text-xs sm:text-sm">{label}</span>
    </button>
  );

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex items-center justify-between p-4 bg-white shadow-md">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-brand-green-dark flex items-center justify-center text-white font-bold">青</div>
          <h1 className="text-xl font-bold text-gray-800">員工後台</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-600 hidden sm:block">
            {user?.name}
          </span>
          <NotificationBell />
          <button
            onClick={() => setShowChangePassword(true)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
            title="修改密碼"
          >
            <KeyIcon className="w-5 h-5" />
          </button>
          <button
            onClick={logout}
            className="flex items-center px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            <LogOutIcon className="w-4 h-4 mr-2 hidden sm:block" />
            <span className="hidden sm:block">登出</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {renderView()}
      </main>

      <nav className="flex bg-white border-t border-gray-200 shadow-t-lg overflow-x-auto">
        <NavItem view="clock" icon={<ClockIcon className="w-6 h-6" />} label="打卡" />
        <NavItem view="schedule" icon={<CalendarIcon className="w-6 h-6" />} label="我的班表" />
        <NavItem view="fullSchedule" icon={<UsersIcon className="w-6 h-6" />} label="總班表" />
        <NavItem view="openShifts" icon={<CalendarIcon className="w-6 h-6" />} label="認領班次" />
        <NavItem view="records" icon={<ListIcon className="w-6 h-6" />} label="打卡紀錄" />
        <NavItem view="leave" icon={<SendIcon className="w-6 h-6" />} label="請假申請" />
        <NavItem view="leaveBalance" icon={<ListIcon className="w-6 h-6" />} label="假別餘額" />
        <NavItem view="makeup" icon={<SendIcon className="w-6 h-6" />} label="補打卡" />
        <NavItem view="salary" icon={<DollarIcon className="w-6 h-6" />} label="薪資明細" />
      </nav>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
};

export default EmployeeDashboard;