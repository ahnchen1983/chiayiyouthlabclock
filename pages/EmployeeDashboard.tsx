import PayrollMasterTimeline from '../components/PayrollMasterTimeline';
import CompWorkflow from '../components/CompWorkflow';
import OvertimeWorkflow from '../components/OvertimeWorkflow';
// FIX: Correctly import React and the useState hook.
import React, { useState, lazy, Suspense } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Phase 7.3 — 子 view 改為 React.lazy，由 Suspense 切割成獨立 chunk
const AttendanceCaseCenter = lazy(() => import('../components/AttendanceCaseCenter'));
const ClockIn              = lazy(() => import('../components/employee/ClockIn'));
const MyScheduleCalendar   = lazy(() => import('../components/employee/MyScheduleCalendar'));
const FullScheduleCalendar = lazy(() => import('../components/employee/FullScheduleCalendar'));
const MyRecords            = lazy(() => import('../components/employee/MyRecords'));
const LeaveRequestForm     = lazy(() => import('../components/employee/LeaveRequestForm'));
const MySalary             = lazy(() => import('../components/employee/MySalary'));
const ClockMakeupForm      = lazy(() => import('../components/employee/ClockMakeupForm'));
const MyLeaveBalance       = lazy(() => import('../components/employee/MyLeaveBalance'));
const MyPreferences        = lazy(() => import('../components/employee/MyPreferences'));
const OpenShiftPicker      = lazy(() => import('../components/employee/OpenShiftPicker'));
const LeaveOfAbsenceRequestForm = lazy(() => import('../components/employee/LeaveOfAbsenceRequestForm'));
const ShiftSwapPage        = lazy(() => import('../components/employee/ShiftSwapPage'));

// 頭部常駐元件、控制元件、icon — 保留 static import
import ChangePasswordModal from '../components/ChangePasswordModal';
import NotificationBell from '../components/NotificationBell';
import { NavShell, type ShellGroup, type ShellLink } from '../components/shell/NavShell';

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

type View = 'home' | 'master' | 'comp' | 'overtime' | 'cases' | 'clock' | 'schedule' | 'records' | 'leave' | 'fullSchedule' | 'salary' | 'makeup' | 'leaveBalance' | 'preferences' | 'openShifts' | 'leaveOfAbsence' | 'shiftSwap';

const EmployeeHome: React.FC<{ onOpen: (view: View) => void }> = ({ onOpen }) => (
  <section className="yl-home">
    <p className="yl-home-kicker">WORKSPACE</p>
    <h1>今天的工作，從這裡開始</h1>
    <p>出勤、請假、班表與薪資明細分成旁邊的主要項目。這一頁只負責帶路，不計算薪資，也不執行給付。</p>
    <div className="yl-home-grid">
      <button type="button" className="yl-home-card" onClick={() => onOpen('clock')}>
        <strong>去打卡</strong>
        <span>上班、休息與今日出勤</span>
      </button>
      <button type="button" className="yl-home-card" onClick={() => onOpen('leave')}>
        <strong>去請假</strong>
        <span>請假、留停、補休與加班</span>
      </button>
      <button type="button" className="yl-home-card" onClick={() => onOpen('schedule')}>
        <strong>看班表</strong>
        <span>我的班表、總班表與換班</span>
      </button>
      <button type="button" className="yl-home-card" onClick={() => onOpen('salary')}>
        <strong>看薪資明細</strong>
        <span>只讀明細，不是發薪</span>
      </button>
    </div>
  </section>
);

const EmployeeDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('clock');
  const [showChangePassword, setShowChangePassword] = useState(false);

  const renderView = () => {
    switch (currentView) {
      case 'home': return <EmployeeHome onOpen={setCurrentView} />;
      case 'master': return <PayrollMasterTimeline />;
      case 'comp': return <CompWorkflow />;
      case 'overtime': return <OvertimeWorkflow />;
      case 'cases': return <AttendanceCaseCenter />;
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
      case 'preferences':
        return <MyPreferences />;
      case 'openShifts':
        return <OpenShiftPicker />;
      case 'leaveOfAbsence':
        return <LeaveOfAbsenceRequestForm />;
      case 'shiftSwap':
        return <ShiftSwapPage />;
      default:
        return <ClockIn />;
    }
  };

  const link = (view: View, label: string): ShellLink<View> => ({ view, label });
  const groups: ShellGroup<View>[] = [
    { id: 'home', label: '工作台', icon: 'home', links: [link('home', '工作台')] },
    {
      id: 'attendance',
      label: '出勤打卡',
      icon: 'clock',
      links: [
        link('clock', '打卡'),
        link('records', '打卡紀錄'),
        link('cases', '異常待辦'),
        link('makeup', '補打卡'),
      ],
    },
    {
      id: 'leave',
      label: '請假與簽核',
      icon: 'leave',
      links: [
        link('leave', '請假/外勤'),
        link('leaveOfAbsence', '留停申請'),
        link('leaveBalance', '假別餘額'),
        link('comp', '補休帳本'),
        link('overtime', '加班申請'),
      ],
    },
    {
      id: 'schedule',
      label: '班表',
      icon: 'calendar',
      links: [
        link('schedule', '我的班表'),
        link('fullSchedule', '總班表'),
        link('openShifts', '認領班次'),
        link('shiftSwap', '換班'),
        link('preferences', '偏好設定'),
      ],
    },
    { id: 'salary', label: '薪資明細', icon: 'salary', links: [link('salary', '薪資明細')] },
  ];

  return (
    <>
      <NavShell
        contextTitle="員工後台"
        workspaceTitle="嘉義市青年實驗室"
        workspaceHint="員工工作區"
        userName={user?.name ?? ''}
        roleLabel="員工"
        groups={groups}
        advancedLinks={[link('master', '薪資有效期主檔')]}
        currentView={currentView}
        onNavigate={setCurrentView}
        onLogout={logout}
        onChangePassword={() => setShowChangePassword(true)}
        toolbar={<NotificationBell />}
      >
        <Suspense fallback={<ViewLoadingFallback />}>
          {renderView()}
        </Suspense>
      </NavShell>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </>
  );
};

export default EmployeeDashboard;
