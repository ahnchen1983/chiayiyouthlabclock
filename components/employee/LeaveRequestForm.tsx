
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiSubmitLeaveRequest } from '../../services/googleAppsScriptAPI';
import { LeaveType, LeaveRequest } from '../../types';

const LeaveRequestForm: React.FC = () => {
  const { user } = useAuth();
  const [leaveType, setLeaveType] = useState<LeaveType>(LeaveType.Personal);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: string, text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !startDate || !endDate || !reason) {
      setMessage({ type: 'error', text: '所有欄位皆為必填。' });
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
    } catch (error) {
        setMessage({ type: 'error', text: '發生未知錯誤。' });
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
