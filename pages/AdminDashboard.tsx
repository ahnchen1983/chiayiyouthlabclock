
import React, { useState, lazy, Suspense } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';

// Phase 7.3 — 子 view 改為 React.lazy，由 Suspense 切割成獨立 chunk
const AdminOverview        = lazy(() => import('../components/admin/AdminOverview'));
const ScheduleManager      = lazy(() => import('../components/admin/ScheduleManager'));
const AttendanceLog        = lazy(() => import('../components/admin/AttendanceLog'));
const LeaveApprovalQueue   = lazy(() => import('../components/admin/LeaveApprovalQueue'));
const EmployeeManager      = lazy(() => import('../components/admin/EmployeeManager'));
const MonthlyReport        = lazy(() => import('../components/admin/MonthlyReport'));
const ScheduleComparison   = lazy(() => import('../components/admin/ScheduleComparison'));
const SalaryCalculation    = lazy(() => import('../components/admin/SalaryCalculation'));
const AuditLogViewer       = lazy(() => import('../components/admin/AuditLogViewer'));
const SystemSettings       = lazy(() => import('../components/admin/SystemSettings'));
const MakeupApprovalQueue  = lazy(() => import('../components/admin/MakeupApprovalQueue'));
const OpenShiftManager     = lazy(() => import('../components/admin/OpenShiftManager'));
const LeaveOfAbsenceApprovalQueue = lazy(() => import('../components/admin/LeaveOfAbsenceApprovalQueue'));
const ShiftSwapApprovalQueue = lazy(() => import('../components/admin/ShiftSwapApprovalQueue'));
const ClockIn              = lazy(() => import('../components/employee/ClockIn'));
const LeaveRequestForm     = lazy(() => import('../components/employee/LeaveRequestForm'));
const MyRecords            = lazy(() => import('../components/employee/MyRecords'));
const MySalary             = lazy(() => import('../components/employee/MySalary'));
const ClockMakeupForm      = lazy(() => import('../components/employee/ClockMakeupForm'));
const MyLeaveBalance       = lazy(() => import('../components/employee/MyLeaveBalance'));
const OpenShiftPicker      = lazy(() => import('../components/employee/OpenShiftPicker'));
const LeaveOfAbsenceRequestForm = lazy(() => import('../components/employee/LeaveOfAbsenceRequestForm'));

// 頭部常駐元件、控制元件、icon — 保留 static import
import ChangePasswordModal from '../components/ChangePasswordModal';
import NotificationBell from '../components/NotificationBell';
import { DashboardIcon, CalendarIcon, ListIcon, CheckSquareIcon, UsersIcon, LogOutIcon, DollarIcon, ClockIcon, SendIcon } from '../components/icons';

// View 切換時的 Suspense fallback — 強制保留高度避免主區塊跳動
const ViewLoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center py-20 text-gray-400">
    <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
    <span className="text-sm">載入中…</span>
  </div>
);

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

type AdminView = 'overview' | 'schedule' | 'attendance' | 'leave' | 'employees' | 'monthlyReport' | 'comparison' | 'salary' | 'auditLog' | 'systemSettings' | 'makeupApproval' | 'openShifts' | 'loaApproval' | 'shiftSwapApproval' | 'myClock' | 'myLeave' | 'myRecords' | 'mySalary' | 'myMakeup' | 'myLeaveBalance' | 'myOpenShifts' | 'myLeaveOfAbsence';

const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<AdminView>('overview');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const renderView = () => {
    switch (currentView) {
      case 'overview': return <AdminOverview />;
      case 'schedule': return <ScheduleManager />;
      case 'attendance': return <AttendanceLog />;
      case 'leave': return <LeaveApprovalQueue />;
      case 'employees': return <EmployeeManager />;
      case 'monthlyReport': return <MonthlyReport />;
      case 'comparison': return <ScheduleComparison />;
      case 'salary': return <SalaryCalculation />;
      case 'auditLog': return <AuditLogViewer />;
      case 'systemSettings': return <SystemSettings />;
      case 'makeupApproval': return <MakeupApprovalQueue />;
      case 'openShifts': return <OpenShiftManager />;
      case 'loaApproval': return <LeaveOfAbsenceApprovalQueue />;
      case 'shiftSwapApproval': return <ShiftSwapApprovalQueue />;
      case 'myClock': return <ClockIn />;
      case 'myLeave': return <LeaveRequestForm />;
      case 'myRecords': return <MyRecords />;
      case 'mySalary': return <MySalary />;
      case 'myMakeup': return <ClockMakeupForm />;
      case 'myLeaveOfAbsence': return <LeaveOfAbsenceRequestForm />;
      case 'myLeaveBalance': return <MyLeaveBalance />;
      case 'myOpenShifts': return <OpenShiftPicker />;
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
        onClick={() => { setCurrentView(view); setSidebarOpen(false); }}
        className={`flex items-center p-3 text-base font-normal rounded-lg transition-all duration-200 w-full ${currentView === view
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
      {/* 行動版背景遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`fixed md:static z-40 inset-y-0 left-0 w-64 bg-white shadow-xl flex flex-col transform transition-transform md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="flex items-center justify-center p-4 border-b">
          <div className="w-12 h-12 rounded-full bg-brand-green-dark flex items-center justify-center text-white font-bold text-xl">青</div>
          <h1 className="ml-3 text-xl font-bold text-gray-800">管理者後台</h1>
        </div>
        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-2">
            <NavItem view="overview" icon={<DashboardIcon className="w-6 h-6" />} label="總覽儀表板" />
            <NavItem view="schedule" icon={<CalendarIcon className="w-6 h-6" />} label="排班管理" />
            <NavItem view="comparison" icon={<CompareIcon className="w-6 h-6" />} label="排班對照表" />
            <NavItem view="attendance" icon={<ListIcon className="w-6 h-6" />} label="出勤紀錄" />
            <NavItem view="leave" icon={<CheckSquareIcon className="w-6 h-6" />} label="請假審核" />
            <NavItem view="shiftSwapApproval" icon={<CalendarIcon className="w-6 h-6" />} label="換班審核" />
            <NavItem view="loaApproval" icon={<CheckSquareIcon className="w-6 h-6" />} label="留停審核" />
            <NavItem view="makeupApproval" icon={<CheckSquareIcon className="w-6 h-6" />} label="補打卡審核" />
            <NavItem view="openShifts" icon={<CalendarIcon className="w-6 h-6" />} label="開放排班" />
            <NavItem view="employees" icon={<UsersIcon className="w-6 h-6" />} label="員工管理" />
            <NavItem view="monthlyReport" icon={<ListIcon className="w-6 h-6" />} label="月結報表" />
            {user?.role === UserRole.SuperAdmin && (
              <>
                <NavItem view="salary" icon={<DollarIcon className="w-6 h-6" />} label="薪資計算" />
                <NavItem view="auditLog" icon={<ListIcon className="w-6 h-6" />} label="系統日誌" />
                <NavItem view="systemSettings" icon={<KeyIcon className="w-6 h-6" />} label="系統設定" />
              </>
            )}
          </ul>

          {/* 我的功能區 */}
          <div className="mt-6 pt-4 border-t">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2 px-3">我的功能</p>
            <ul className="space-y-2">
              <NavItem view="myClock" icon={<ClockIcon className="w-6 h-6" />} label="我的打卡" />
              <NavItem view="myRecords" icon={<ListIcon className="w-6 h-6" />} label="我的出勤紀錄" />
              <NavItem view="myLeave" icon={<SendIcon className="w-6 h-6" />} label="我的請假" />
              <NavItem view="myLeaveOfAbsence" icon={<SendIcon className="w-6 h-6" />} label="留停申請" />
              <NavItem view="myMakeup" icon={<SendIcon className="w-6 h-6" />} label="補打卡申請" />
              <NavItem view="myLeaveBalance" icon={<CheckSquareIcon className="w-6 h-6" />} label="假別餘額" />
              <NavItem view="myOpenShifts" icon={<CalendarIcon className="w-6 h-6" />} label="認領班次" />
              <NavItem view="mySalary" icon={<DollarIcon className="w-6 h-6" />} label="我的薪資" />
            </ul>
          </div>
        </nav>
        <div className="p-4 border-t">
          <div className="flex items-center mb-4">
            <div className="w-10 h-10 rounded-full bg-brand-green flex items-center justify-center text-white font-bold">
              {user?.name.charAt(0)}
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-700">{user?.name}</p>
              <p className="text-xs text-gray-500">{user?.role === UserRole.SuperAdmin ? '最高管理者' : '系統管理員'}</p>
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
        <header className="flex items-center justify-between px-4 md:px-6 py-3 bg-white border-b">
          <button
            className="md:hidden p-2 rounded hover:bg-gray-100"
            onClick={() => setSidebarOpen(true)}
            aria-label="開啟選單"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex-1" />
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-6">
          <Suspense fallback={<ViewLoadingFallback />}>
            {renderView()}
          </Suspense>
        </main>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
};

export default AdminDashboard;
