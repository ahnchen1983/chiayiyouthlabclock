// FIX: Correctly import React and the useState hook.
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ClockIn from '../components/employee/ClockIn';
import MyScheduleCalendar from '../components/employee/MyScheduleCalendar';
import MyRecords from '../components/employee/MyRecords';
import LeaveRequestForm from '../components/employee/LeaveRequestForm';
import FullScheduleCalendar from '../components/employee/FullScheduleCalendar';
import MySalary from '../components/employee/MySalary';
import { ClockIcon, CalendarIcon, ListIcon, SendIcon, LogOutIcon, UsersIcon, DollarIcon } from '../components/icons';

type View = 'clock' | 'schedule' | 'records' | 'leave' | 'fullSchedule' | 'salary';

const EmployeeDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('clock');

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
      className={`flex flex-col items-center justify-center w-full py-2 space-y-1 transition-colors duration-200 ${currentView === view
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
          <img src="https://youthsoullab.chiayi.gov.tw/wp-content/uploads/2024/02/%E6%9C%89%E4%BA%8B%E9%9D%92%E5%B9%B4%E5%AF%A6%E9%A9%97%E5%AE%A4-LOGO-%E7%B6%A0%E8%89%B2.png" alt="Logo" className="w-10 h-10" />
          <h1 className="text-xl font-bold text-gray-800">員工後台</h1>
        </div>
        <div className="flex items-center space-x-4">
          <span className="hidden sm:block text-gray-700">歡迎, {user?.name}</span>
          <button onClick={logout} className="p-2 text-gray-600 transition-colors rounded-full hover:bg-red-100 hover:text-status-error">
            <LogOutIcon className="w-6 h-6" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {renderView()}
      </main>

      <nav className="flex bg-white border-t border-gray-200 shadow-t-lg">
        <NavItem view="clock" icon={<ClockIcon className="w-6 h-6" />} label="打卡" />
        <NavItem view="schedule" icon={<CalendarIcon className="w-6 h-6" />} label="我的班表" />
        <NavItem view="fullSchedule" icon={<UsersIcon className="w-6 h-6" />} label="總班表" />
        <NavItem view="records" icon={<ListIcon className="w-6 h-6" />} label="打卡紀錄" />
        <NavItem view="leave" icon={<SendIcon className="w-6 h-6" />} label="請假申請" />
        <NavItem view="salary" icon={<DollarIcon className="w-6 h-6" />} label="薪資明細" />
      </nav>
    </div>
  );
};

export default EmployeeDashboard;