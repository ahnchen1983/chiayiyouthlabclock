import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    apiGetLeaveOfAbsenceRequests,
    apiApproveLeaveOfAbsenceRequest,
} from '../../services/googleAppsScriptAPI';
import { LeaveOfAbsenceRequest } from '../../types';

type Filter = '全部' | '待審核' | '核准' | '駁回';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const map: Record<string, string> = {
        '待審核': 'bg-yellow-100 text-yellow-800',
        '核准': 'bg-green-100 text-green-800',
        '駁回': 'bg-red-100 text-red-800',
    };
    return <span className={`px-2 py-1 rounded text-xs font-medium ${map[status] || 'bg-gray-100'}`}>{status}</span>;
};

const LeaveOfAbsenceApprovalQueue: React.FC = () => {
    const { user } = useAuth();
    const [requests, setRequests] = useState<LeaveOfAbsenceRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<Filter>('待審核');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const list = await apiGetLeaveOfAbsenceRequests();
                setRequests(list);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        })();
    }, [reloadKey]);

    const filtered = useMemo(() => {
        if (filter === '全部') return requests;
        return requests.filter(r => r.status === filter);
    }, [requests, filter]);

    const handleApprove = async (req: LeaveOfAbsenceRequest) => {
        const ok = window.confirm(
            `確定核准 ${req.name} 的留停申請？\n\n` +
            `期間：${req.startDate}${req.endDate ? ` ~ ${req.endDate}` : ' 起（無預定結束日）'}\n\n` +
            `⚠️ 核准後會把員工狀態改為「留停」，並影響特休年資計算（留停期間不累積）。`
        );
        if (!ok) return;
        setBusyId(req.id);
        try {
            await apiApproveLeaveOfAbsenceRequest(req.id, '核准', user?.name || '');
            setReloadKey(k => k + 1);
        } catch (err: any) {
            alert(err?.message || '核准失敗');
        } finally {
            setBusyId(null);
        }
    };

    const handleStartReject = (req: LeaveOfAbsenceRequest) => {
        setRejectingId(req.id);
        setRejectReason('');
    };

    const handleConfirmReject = async (req: LeaveOfAbsenceRequest) => {
        if (rejectReason.trim().length < 2) {
            alert('駁回理由至少 2 字');
            return;
        }
        setBusyId(req.id);
        try {
            await apiApproveLeaveOfAbsenceRequest(req.id, '駁回', user?.name || '', rejectReason.trim());
            setRejectingId(null);
            setRejectReason('');
            setReloadKey(k => k + 1);
        } catch (err: any) {
            alert(err?.message || '駁回失敗');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-800">留停審核</h2>
                <select
                    value={filter}
                    onChange={e => setFilter(e.target.value as Filter)}
                    className="p-2 border rounded-md text-sm"
                >
                    <option value="全部">全部</option>
                    <option value="待審核">待審核</option>
                    <option value="核准">已核准</option>
                    <option value="駁回">已駁回</option>
                </select>
            </div>

            {loading ? (
                <p className="text-center py-10 text-gray-500">載入中…</p>
            ) : filtered.length === 0 ? (
                <div className="text-center py-10 text-gray-500 bg-white rounded-lg shadow">
                    {filter === '待審核' ? '目前無待審核的留停申請' : '無符合條件的紀錄'}
                </div>
            ) : (
                <ul className="space-y-3">
                    {filtered.map(req => (
                        <li key={req.id} className="bg-white rounded-lg shadow p-4">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-800">{req.name}</span>
                                        <span className="text-xs text-gray-400">({req.empId})</span>
                                        <StatusBadge status={req.status} />
                                    </div>
                                    <p className="text-sm text-gray-700 mt-1">
                                        期間：{req.startDate}{req.endDate ? ` ~ ${req.endDate}` : ' 起（無預定結束日）'}
                                    </p>
                                    <p className="text-sm text-gray-600 mt-1">事由：{req.reason}</p>
                                    {req.contactInfo && (
                                        <p className="text-xs text-gray-500 mt-1">聯絡方式：{req.contactInfo}</p>
                                    )}
                                    <p className="text-xs text-gray-400 mt-1">
                                        送出：{(req.requestDate || '').slice(0, 16).replace('T', ' ')}
                                        {req.approver ? ` ｜ 審核：${req.approver}` : ''}
                                    </p>
                                    {req.status === '駁回' && req.rejectReason && (
                                        <p className="text-xs text-red-600 mt-1">駁回理由：{req.rejectReason}</p>
                                    )}
                                </div>
                            </div>

                            {req.status === '待審核' && rejectingId !== req.id && (
                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={() => handleApprove(req)}
                                        disabled={busyId === req.id}
                                        className="px-3 py-1.5 bg-green-500 text-white text-sm rounded hover:bg-green-600 disabled:bg-gray-400"
                                    >
                                        核准
                                    </button>
                                    <button
                                        onClick={() => handleStartReject(req)}
                                        disabled={busyId === req.id}
                                        className="px-3 py-1.5 bg-red-500 text-white text-sm rounded hover:bg-red-600 disabled:bg-gray-400"
                                    >
                                        駁回
                                    </button>
                                </div>
                            )}

                            {req.status === '待審核' && rejectingId === req.id && (
                                <div className="mt-3 space-y-2 p-3 bg-red-50 rounded">
                                    <label className="block text-xs font-medium text-red-700">駁回理由（至少 2 字）</label>
                                    <input
                                        type="text"
                                        value={rejectReason}
                                        onChange={e => setRejectReason(e.target.value)}
                                        className="w-full p-2 border border-red-300 rounded text-sm"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleConfirmReject(req)}
                                            disabled={busyId === req.id}
                                            className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:bg-gray-400"
                                        >
                                            確定駁回
                                        </button>
                                        <button
                                            onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                                        >
                                            取消
                                        </button>
                                    </div>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default LeaveOfAbsenceApprovalQueue;
