
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AdminOverview from '../components/admin/AdminOverview';
import ScheduleManager from '../components/admin/ScheduleManager';
import AttendanceLog from '../components/admin/AttendanceLog';
import LeaveApprovalQueue from '../components/admin/LeaveApprovalQueue';
import EmployeeManager from '../components/admin/EmployeeManager';
import ScheduleComparison from '../components/admin/ScheduleComparison';
import SalaryCalculation from '../components/admin/SalaryCalculation';
import ChangePasswordModal from '../components/ChangePasswordModal';
import { DashboardIcon, CalendarIcon, ListIcon, CheckSquareIcon, UsersIcon, LogOutIcon, DollarIcon } from '../components/icons';

// 鑰匙圖示
const KeyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
  </svg>
);

// 對照表圖示
const CompareIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
);

type AdminView = 'overview' | 'schedule' | 'attendance' | 'leave' | 'employees' | 'comparison' | 'salary';

const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<AdminView>('overview');
  const [showChangePassword, setShowChangePassword] = useState(false);

  const renderView = () => {
    switch (currentView) {
      case 'overview': return <AdminOverview />;
      case 'schedule': return <ScheduleManager />;
      case 'attendance': return <AttendanceLog />;
      case 'leave': return <LeaveApprovalQueue />;
      case 'employees': return <EmployeeManager />;
      case 'comparison': return <ScheduleComparison />;
      case 'salary': return <SalaryCalculation />;
      default: return <AdminOverview />;
    }
  };

  const NavItem: React.FC<{
    view: AdminView;
    icon: React.ReactNode;
    label: string;
  }> = ({ view, icon, label }) => (
    <li>
      <button
        onClick={() => setCurrentView(view)}
        className={`flex items-center p-3 text-base font-normal rounded-lg transition-all duration-200 ${currentView === view
          ? 'bg-brand-blue-dark text-white shadow-md'
          : 'text-gray-700 hover:bg-gray-200'
          }`}
      >
        {icon}
        <span className="ml-3">{label}</span>
      </button>
    </li>
  );

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-64 bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-center p-4 border-b">
          <img src="https://youthsoullab.chiayi.gov.tw/wp-content/uploads/2024/02/%E6%9C%89%E4%BA%8B%E9%9D%92%E5%B9%B4%E5%AF%A6%E9%A9%97%E5%AE%A4-LOGO-%E7_B6_A0%E8%89%B2.png" alt="Logo" className="w-12 h-12" />
          <h1 className="ml-3 text-xl font-bold text-gray-800">管理者後台</h1>
        </div>
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            <NavItem view="overview" icon={<DashboardIcon className="w-6 h-6" />} label="總覽儀表板" />
            <NavItem view="schedule" icon={<CalendarIcon className="w-6 h-6" />} label="排班管理" />
            <NavItem view="comparison" icon={<CompareIcon className="w-6 h-6" />} label="排班對照表" />
            <NavItem view="attendance" icon={<ListIcon className="w-6 h-6" />} label="出勤紀錄" />
            <NavItem view="leave" icon={<CheckSquareIcon className="w-6 h-6" />} label="請假審核" />
            <NavItem view="employees" icon={<UsersIcon className="w-6 h-6" />} label="員工管理" />
            <NavItem view="salary" icon={<DollarIcon className="w-6 h-6" />} label="薪資計算" />
          </ul>
        </nav>
        <div className="p-4 border-t">
          <div className="flex items-center mb-4">
            <div className="w-10 h-10 rounded-full bg-brand-green flex items-center justify-center text-white font-bold">
              {user?.name.charAt(0)}
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-700">{user?.name}</p>
              <p className="text-xs text-gray-500">系統管理員</p>
            </div>
          </div>
          <button
            onClick={() => setShowChangePassword(true)}
            className="flex items-center w-full p-2 mb-2 text-sm text-gray-600 rounded hover:bg-gray-200 transition-colors"
          >
            <KeyIcon className="w-5 h-5 mr-3" />
            修改密碼
          </button>
          <button
            onClick={logout}
            className="flex items-center w-full p-2 text-sm text-red-600 rounded hover:bg-red-50 transition-colors"
          >
            <LogOutIcon className="w-5 h-5 mr-3" />
            登出
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-6">
          {renderView()}
        </main>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
};

export default AdminDashboard;
