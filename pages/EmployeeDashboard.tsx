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
import { CalendarIcon, CheckSquareIcon, ClockIcon, DollarIcon, LeafIcon } from '../components/icons';

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

const EmployeeHome: React.FC<{ name: string; onOpen: (view: View) => void }> = ({ name, onOpen }) => {
  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安';
  const eyebrow = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now).toUpperCase();
  const who = name.trim() || '同事';
  return (
    <section className="yl-workbench">
      <div className="yl-page-heading">
        <div>
          <div className="yl-eyebrow">{eyebrow}</div>
          <h1>{hello}，{who}。</h1>
          <p>把出勤、假勤與班表放在一起。薪資明細只供查看，這裡不發薪。</p>
        </div>
        <button type="button" className="yl-primary" onClick={() => onOpen('leave')}>前往請假</button>
      </div>
      <div className="yl-summary">
        <button type="button" className="yl-stat is-label" onClick={() => onOpen('clock')}>
          <span className="yl-stat-icon mint" aria-hidden="true"><ClockIcon /></span>
          <small>出勤</small>
          <strong>今日打卡</strong>
          <span className="yl-stat-foot">紀錄、異常與補打卡</span>
        </button>
        <button type="button" className="yl-stat is-label" onClick={() => onOpen('leave')}>
          <span className="yl-stat-icon sand" aria-hidden="true"><CheckSquareIcon /></span>
          <small>假勤</small>
          <strong>請假與簽核</strong>
          <span className="yl-stat-foot">留停、補休與加班</span>
        </button>
        <button type="button" className="yl-stat is-label" onClick={() => onOpen('schedule')}>
          <span className="yl-stat-icon blue" aria-hidden="true"><CalendarIcon /></span>
          <small>班表</small>
          <strong>我的安排</strong>
          <span className="yl-stat-foot">總班表、換班與認領</span>
        </button>
        <button type="button" className="yl-stat is-label" onClick={() => onOpen('salary')}>
          <span className="yl-stat-icon lilac" aria-hidden="true"><DollarIcon /></span>
          <small>薪資</small>
          <strong>明細查看</strong>
          <span className="yl-stat-foot">只讀，不是給付</span>
        </button>
      </div>
      <section className="yl-welcome">
        <div>
          <div className="yl-eyebrow">A LITTLE SPACE</div>
          <h2>工作有節奏，班表看得到。</h2>
          <p>休息與班次都在班表裡。正式薪資仍不在這個工作台計算。</p>
          <button type="button" onClick={() => onOpen('schedule')}>看看班表</button>
        </div>
        <div className="yl-welcome-mark" aria-hidden="true"><LeafIcon /></div>
      </section>
    </section>
  );
};

const EmployeeDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('clock');
  const [showChangePassword, setShowChangePassword] = useState(false);

  const renderView = () => {
    switch (currentView) {
      case 'home': return <EmployeeHome name={user?.name ?? ''} onOpen={setCurrentView} />;
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
        workbench={currentView === 'home'}
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
