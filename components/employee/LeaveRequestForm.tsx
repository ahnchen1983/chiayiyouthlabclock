
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiSubmitLeaveRequest, apiGetLeaveBalance } from '../../services/googleAppsScriptAPI';
import { LeaveType, LeaveRequest, LeaveBalance } from '../../types';

const LeaveRequestForm: React.FC = () => {
  const { user } = useAuth();
  const [leaveType, setLeaveType] = useState<LeaveType>(LeaveType.Personal);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: string, text: string } | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);

  useEffect(() => {
    apiGetLeaveBalance().then(setBalances).catch(() => {});
  }, []);

  const currentBalance = balances.find(b => b.leaveType === leaveType);
  const requestedHours = startDate && endDate
    ? Math.max(0, (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60))
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !startDate || !endDate || !reason) {
      setMessage({ type: 'error', text: '所有欄位皆為必填。' });
      return;
    }
    // Phase 3.4 日期驗證
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      setMessage({ type: 'error', text: '日期格式錯誤。' });
      return;
    }
    if (endMs <= startMs) {
      setMessage({ type: 'error', text: '結束時間必須晚於開始時間。' });
      return;
    }
    const todayMs = new Date(new Date().toISOString().slice(0, 10)).getTime();
    if (startMs < todayMs - 7 * 24 * 60 * 60 * 1000) {
      setMessage({ type: 'error', text: '請假開始時間不可早於 7 天前。' });
      return;
    }
    const hours = (endMs - startMs) / (1000 * 60 * 60);
    if (hours < 0.5) {
      setMessage({ type: 'error', text: '請假時數至少需 0.5 小時。' });
      return;
    }
    // Phase 4.1：前端餘額預檢
    if (currentBalance && leaveType !== LeaveType.Other && hours > currentBalance.remainingHours) {
      setMessage({ type: 'error', text: `${leaveType}剩餘 ${currentBalance.remainingHours} 小時，不足以申請 ${hours} 小時。` });
      return;
    }
    setSubmitting(true);
    setMessage(null);

    const newRequest: Omit<LeaveRequest, 'id' | 'requestDate' | 'status' | 'approver' | 'approvalDate' | 'hours' | 'name'> = {
        empId: user.id,
        leaveType,
        startDate,
        endDate,
        reason
    }

    try {
      const success = await apiSubmitLeaveRequest(newRequest);
      if (success) {
        setMessage({ type: 'success', text: '請假申請已成功送出！' });
        // Reset form
        setLeaveType(LeaveType.Personal);
        setStartDate('');
        setEndDate('');
        setReason('');
      } else {
        setMessage({ type: 'error', text: '送出失敗，請稍後再試。' });
      }
    } catch (error: any) {
        setMessage({ type: 'error', text: error?.message || '發生未知錯誤。' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-4 p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-center mb-6 text-gray-800">請假申請</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="leaveType" className="block text-sm font-medium text-gray-700">假別</label>
          <select
            id="leaveType"
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm rounded-md"
          >
            {Object.values(LeaveType).map(lt => <option key={lt} value={lt}>{lt}</option>)}
          </select>
          {currentBalance && leaveType !== LeaveType.Other && (
            <div className="mt-1 text-xs text-gray-500 space-y-0.5">
              <p>
                本年度{leaveType}剩餘 <span className="font-semibold text-brand-green-dark">{currentBalance.remainingHours}h</span>
                （配額 {currentBalance.quotaHours}h，已用 {currentBalance.usedHours}h）
                {requestedHours > 0 && (
                  <span className={`ml-2 ${requestedHours > currentBalance.remainingHours ? 'text-red-600' : 'text-gray-500'}`}>
                    本次申請 {requestedHours.toFixed(1)}h
                  </span>
                )}
              </p>
              {/* Phase 8.5：特休專屬結轉提示（沿用 Phase 8.1 annualLeaveDetail） */}
              {leaveType === LeaveType.Annual && currentBalance.annualLeaveDetail && (
                <>
                  <p className="text-gray-500">
                    今年新給 {currentBalance.annualLeaveDetail.newGrantedHours}h
                    {currentBalance.annualLeaveDetail.carriedFromPreviousYear > 0 && (
                      <>
                        ｜去年結轉 <span className="text-blue-600 font-medium">{currentBalance.annualLeaveDetail.carriedFromPreviousYear}h</span>
                        ，於 {currentBalance.annualLeaveDetail.carriedExpiresAt} 失效
                      </>
                    )}
                  </p>
                  {currentBalance.annualLeaveDetail.expiredHours > 0 && (
                    <p className="text-red-600 font-medium">
                      已失效 {currentBalance.annualLeaveDetail.expiredHours}h（超過 1 年保留期）
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400">
            ℹ️ 特休、事假、病假皆依剩餘餘額檢查；留停請至「留停申請」頁面提出。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">開始日期</label>
            <input
                type="datetime-local"
                id="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
            />
            </div>
            <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">結束日期</label>
            <input
                type="datetime-local"
                id="endDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
            />
            </div>
        </div>

        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-gray-700">事由</label>
          <textarea
            id="reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
          ></textarea>
        </div>

        {message && (
            <div className={`p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-status-success' : 'bg-red-100 text-status-error'}`}>
                {message.text}
            </div>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-green-dark hover:bg-brand-green-light focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400"
          >
            {submitting ? '送出中...' : '送出申請'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default LeaveRequestForm;
