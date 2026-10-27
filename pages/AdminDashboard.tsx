import HistoricalPayrollCorrection from '../components/admin/HistoricalPayrollCorrection';
import PayrollReconciliation from '../components/admin/PayrollReconciliation';
import PayrollItemExecution from '../components/admin/PayrollItemExecution';
import PayrollAdjustments from '../components/admin/PayrollAdjustments';
import PayrollPaymentAllocation from '../components/admin/PayrollPaymentAllocation';
import PayrollItemTreatment from '../components/admin/PayrollItemTreatment';
import WorktimeDeclaration from '../components/admin/WorktimeDeclaration';
import AttendancePolicyDeclaration from '../components/admin/AttendancePolicyDeclaration';
import PayrollPaymentEvidence from '../components/admin/PayrollPaymentEvidence';
import PayrollDifference from '../components/admin/PayrollDifference';
import PayrollMasterTimeline from '../components/PayrollMasterTimeline';
import DayTypeDesignationPanel from '../components/DayTypeDesignationPanel';
import PayrollPolicyVersions from '../components/admin/PayrollPolicyVersions';
import InsuranceTimeline from '../components/admin/InsuranceTimeline';
import PayrollItems from '../components/admin/PayrollItems';
import CompWorkflow from '../components/CompWorkflow';
import OvertimeWorkflow from '../components/OvertimeWorkflow';

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
const AttendanceCaseCenter = lazy(() => import('../components/AttendanceCaseCenter'));
const ClockIn              = lazy(() => import('../components/employee/ClockIn'));
const LeaveRequestForm     = lazy(() => import('../components/employee/LeaveRequestForm'));
const MyRecords            = lazy(() => import('../components/employee/MyRecords'));
const MySalary             = lazy(() => import('../components/employee/MySalary'));
const ClockMakeupForm      = lazy(() => import('../components/employee/ClockMakeupForm'));
const MyLeaveBalance       = lazy(() => import('../components/employee/MyLeaveBalance'));
const MyPreferences        = lazy(() => import('../components/employee/MyPreferences'));
const OpenShiftPicker      = lazy(() => import('../components/employee/OpenShiftPicker'));
const LeaveOfAbsenceRequestForm = lazy(() => import('../components/employee/LeaveOfAbsenceRequestForm'));

// 頭部常駐元件與殼層 — 保留 static import
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

type AdminView = 'historicalPayrollCorrection' | 'payrollReconciliation' | 'payrollItemExecution' | 'payrollAdjustments' | 'master' | 'dayTypes' | 'payrollPolicy' | 'insurance' | 'payrollItems' | 'payrollDifference' | 'historicalDifference' | 'payrollPaymentAllocation' | 'payrollItemTreatment' | 'worktimeDeclaration' | 'attendancePolicy' | 'payrollPayments' | 'comp' | 'overtime' | 'cases' | 'overview' | 'schedule' | 'attendance' | 'leave' | 'employees' | 'monthlyReport' | 'comparison' | 'salary' | 'auditLog' | 'systemSettings' | 'makeupApproval' | 'openShifts' | 'loaApproval' | 'shiftSwapApproval' | 'myClock' | 'myLeave' | 'myRecords' | 'mySalary' | 'myMakeup' | 'myLeaveBalance' | 'myPreferences' | 'myOpenShifts' | 'myLeaveOfAbsence';

const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  // 一進入介面即為自己的打卡頁（管理功能仍在側邊選單）
  const [currentView, setCurrentView] = useState<AdminView>('myClock');
  const [showChangePassword, setShowChangePassword] = useState(false);

  const renderView = () => {
    switch (currentView) {
      case 'master': return <PayrollMasterTimeline />;
      case 'payrollPolicy': return <PayrollPolicyVersions />;
      case 'insurance': return <InsuranceTimeline />;
      case 'payrollItemExecution': return <PayrollItemExecution />;
      case 'historicalPayrollCorrection': return <HistoricalPayrollCorrection />;
      case 'payrollReconciliation': return <PayrollReconciliation />;
      case 'payrollAdjustments': return <PayrollAdjustments />;
      case 'payrollItemTreatment': return <PayrollItemTreatment />;
      case 'payrollItems': return <PayrollItems />;
      case 'payrollDifference': return <PayrollDifference />;
      case 'historicalDifference': return <PayrollDifference historical />;
      case 'worktimeDeclaration': return <WorktimeDeclaration />;
      case 'attendancePolicy': return <AttendancePolicyDeclaration />;
      case 'payrollPaymentAllocation': return <PayrollPaymentAllocation />;
      case 'payrollPayments': return <PayrollPaymentEvidence />;
      case 'dayTypes': return <div className="p-4 max-w-5xl mx-auto"><DayTypeDesignationPanel mode="admin" /></div>;
      case 'comp': return <CompWorkflow />;
      case 'overtime': return <OvertimeWorkflow />;
      case 'cases': return <AttendanceCaseCenter />;
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
      case 'myPreferences': return <MyPreferences />;
      case 'myOpenShifts': return <OpenShiftPicker />;
      default: return <AdminOverview />;
    }
  };

  const isSuper = user?.role === UserRole.SuperAdmin;
  const link = (view: AdminView, label: string): ShellLink<AdminView> => ({ view, label });
  const groups: ShellGroup<AdminView>[] = [
    {
      id: 'home',
      label: '工作台',
      icon: 'home',
      links: [link('overview', '總覽儀表板'), link('monthlyReport', '月結報表')],
    },
    {
      id: 'attendance',
      label: '出勤打卡',
      icon: 'clock',
      links: [
        link('myClock', '我的打卡'),
        link('myRecords', '我的出勤紀錄'),
        link('myMakeup', '補打卡申請'),
        link('attendance', '出勤紀錄'),
        link('cases', '異常待辦'),
        link('makeupApproval', '補打卡審核'),
      ],
    },
    {
      id: 'leave',
      label: '請假與簽核',
      icon: 'leave',
      links: [
        link('myLeave', '請假/外勤申請'),
        link('leave', '請假/外勤審核'),
        link('myLeaveOfAbsence', '留停申請'),
        link('loaApproval', '留停審核'),
        link('shiftSwapApproval', '換班審核'),
        link('myLeaveBalance', '假別餘額'),
        link('comp', '補休帳本'),
        link('overtime', '加班申請'),
      ],
    },
    {
      id: 'schedule',
      label: '班表',
      icon: 'calendar',
      links: [
        link('schedule', '排班管理'),
        link('comparison', '排班對照表'),
        link('openShifts', '開放排班'),
        link('myOpenShifts', '認領班次'),
        link('myPreferences', '偏好設定'),
      ],
    },
    {
      id: 'salary',
      label: '薪資明細',
      icon: 'salary',
      links: [link('mySalary', '我的薪資')],
    },
    {
      id: 'people',
      label: '人員',
      icon: 'people',
      links: [link('employees', '員工管理')],
    },
  ];
  const advancedLinks: ShellLink<AdminView>[] = [
    link('master', '薪資有效期主檔'),
    link('dayTypes', '例假／休息日核定'),
    link('payrollPolicy', '計薪政策版本'),
    link('insurance', '投保資料'),
    ...(isSuper ? [
      link('payrollItemExecution', '薪資項目計算'),
      link('payrollAdjustments', '薪資調整'),
      link('payrollReconciliation', '月薪資對帳'),
      link('historicalPayrollCorrection', '歷史薪率修正'),
      link('payrollItemTreatment', '薪資項目處理'),
      link('worktimeDeclaration', '工時制度聲明'),
      link('attendancePolicy', '出勤判定政策'),
      link('payrollPaymentAllocation', '給付金額分配'),
      link('payrollPayments', '給付證據核對'),
      link('historicalDifference', '歷史薪資差額'),
      link('payrollDifference', '薪資差額核對'),
      link('payrollItems', '其他薪資項目'),
      link('salary', '薪資計算'),
      link('auditLog', '系統日誌'),
      link('systemSettings', '系統設定'),
    ] : []),
  ];

  return (
    <>
      <NavShell
        contextTitle="管理者後台"
        workspaceTitle="嘉義市青年實驗室"
        workspaceHint="管理工作區"
        userName={user?.name ?? ''}
        roleLabel={isSuper ? '最高管理者' : '系統管理員'}
        groups={groups}
        advancedLinks={advancedLinks}
        currentView={currentView}
        onNavigate={setCurrentView}
        onLogout={logout}
        onChangePassword={() => setShowChangePassword(true)}
        toolbar={<NotificationBell />}
        workbench={currentView === 'overview'}
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

export default AdminDashboard;
