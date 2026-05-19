import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    apiSubmitLeaveOfAbsenceRequest,
    apiGetMyLeaveOfAbsenceRequests,
    apiGetEmployee,
} from '../../services/googleAppsScriptAPI';
import { Employee, LeaveOfAbsenceRequest } from '../../types';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const map: Record<string, string> = {
        '待審核': 'bg-yellow-100 text-yellow-800',
        '核准': 'bg-green-100 text-green-800',
        '駁回': 'bg-red-100 text-red-800',
    };
    return <span className={`px-2 py-1 rounded text-xs font-medium ${map[status] || 'bg-gray-100'}`}>{status}</span>;
};

const LeaveOfAbsenceRequestForm: React.FC = () => {
    const { user } = useAuth();
    const [emp, setEmp] = useState<Employee | null>(null);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');
    const [contactInfo, setContactInfo] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [history, setHistory] = useState<LeaveOfAbsenceRequest[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const detail = await apiGetEmployee(user.id);
                setEmp(detail);
            } catch (e) {
                console.error(e);
            }
        })();
    }, [user]);

    useEffect(() => {
        (async () => {
            setLoadingHistory(true);
            try {
                const list = await apiGetMyLeaveOfAbsenceRequests();
                setHistory(list);
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingHistory(false);
            }
        })();
    }, [reloadKey]);

    const hasPending = useMemo(() => history.some(h => h.status === '待審核'), [history]);
    const onLeaveOfAbsence = emp?.status === '留停' && !emp?.leaveOfAbsenceEnd;
    const submitDisabled = submitting || hasPending || onLeaveOfAbsence;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        if (!startDate || reason.trim().length < 5) {
            setMessage({ type: 'error', text: '起始日為必填、事由至少 5 字。' });
            return;
        }
        if (endDate && endDate < startDate) {
            setMessage({ type: 'error', text: '結束日不可早於起始日。' });
            return;
        }
        setSubmitting(true);
        try {
            await apiSubmitLeaveOfAbsenceRequest({
                startDate,
                endDate: endDate || undefined,
                reason: reason.trim(),
                contactInfo: contactInfo.trim() || undefined,
            });
            setMessage({ type: 'success', text: '留停申請已送出，請等待主管審核。' });
            setStartDate('');
            setEndDate('');
            setReason('');
            setContactInfo('');
            setReloadKey(k => k + 1);
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || '送出失敗' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-gray-800">留停申請</h2>
                <p className="text-sm text-gray-500 mt-1">
                    送出後由管理者審核。核准會將狀態改為「留停」，並影響特休年資計算（留停期間不累積）。
                </p>
            </div>

            {/* 目前狀態 */}
            <div className="bg-white rounded-2xl shadow p-5">
                <h3 className="text-sm font-semibold text-gray-500 mb-2">目前狀態</h3>
                {onLeaveOfAbsence ? (
                    <p className="text-orange-600 font-medium">
                        🛌 留停中（起 {emp?.leaveOfAbsenceStart || '—'}{emp?.leaveOfAbsenceEnd ? ` ~ ${emp.leaveOfAbsenceEnd}` : '；無預定結束日'}）
                    </p>
                ) : emp ? (
                    <p className="text-gray-700">{emp.status} — 可申請留停</p>
                ) : (
                    <p className="text-gray-400 text-sm">載入中…</p>
                )}
                {hasPending && (
                    <p className="mt-2 text-xs text-yellow-700">⚠️ 您已有待審核的留停申請，請等待主管處理。</p>
                )}
            </div>

            {/* 申請表單 */}
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-500">申請表單</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">留停起始日 <span className="text-red-500">*</span></label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            disabled={onLeaveOfAbsence || hasPending}
                            className="w-full p-2 border rounded-md disabled:bg-gray-100"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">預計結束日（空 = 仍在留停）</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                            disabled={onLeaveOfAbsence || hasPending}
                            className="w-full p-2 border rounded-md disabled:bg-gray-100"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-xs text-gray-600 mb-1">留停事由 <span className="text-red-500">*</span>（至少 5 字）</label>
                    <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        disabled={onLeaveOfAbsence || hasPending}
                        rows={3}
                        className="w-full p-2 border rounded-md disabled:bg-gray-100"
                        placeholder="例：育嬰留職停薪、長期病假、進修…"
                    />
                </div>
                <div>
                    <label className="block text-xs text-gray-600 mb-1">留停期間聯絡方式（可選）</label>
                    <input
                        type="text"
                        value={contactInfo}
                        onChange={e => setContactInfo(e.target.value)}
                        disabled={onLeaveOfAbsence || hasPending}
                        className="w-full p-2 border rounded-md disabled:bg-gray-100"
                        placeholder="電話、Email、緊急聯絡人…"
                    />
                </div>
                {message && (
                    <div className={`p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                        {message.text}
                    </div>
                )}
                <button
                    type="submit"
                    disabled={submitDisabled}
                    className="w-full py-2 bg-brand-green-dark text-white rounded-md hover:bg-brand-green-light disabled:bg-gray-400 transition-colors"
                >
                    {submitting ? '送出中…' : '送出留停申請'}
                </button>
            </form>

            {/* 歷史紀錄 */}
            <div className="bg-white rounded-2xl shadow p-5">
                <h3 className="text-sm font-semibold text-gray-500 mb-3">我的留停申請紀錄</h3>
                {loadingHistory ? (
                    <p className="text-gray-400 text-sm">載入中…</p>
                ) : history.length === 0 ? (
                    <p className="text-gray-400 text-sm">尚無申請紀錄</p>
                ) : (
                    <ul className="space-y-3">
                        {history.map(r => (
                            <li key={r.id} className="border-b last:border-b-0 pb-2">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-gray-800">
                                        {r.startDate}{r.endDate ? ` ~ ${r.endDate}` : ' 起'}
                                    </span>
                                    <StatusBadge status={r.status} />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">事由：{r.reason}</p>
                                {r.contactInfo && (
                                    <p className="text-xs text-gray-400">聯絡方式：{r.contactInfo}</p>
                                )}
                                <p className="text-xs text-gray-400 mt-1">
                                    送出：{(r.requestDate || '').slice(0, 16).replace('T', ' ')}
                                    {r.approver ? ` ｜ 審核：${r.approver}` : ''}
                                </p>
                                {r.status === '駁回' && r.rejectReason && (
                                    <p className="text-xs text-red-600 mt-1">駁回理由：{r.rejectReason}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default LeaveOfAbsenceRequestForm;
