import React, { useEffect, useState } from 'react';
import { apiGetMakeupRequests, apiApproveMakeupRequest } from '../../services/googleAppsScriptAPI';
import { ClockMakeupRequest } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const map: Record<string, string> = {
        '待審核': 'bg-yellow-100 text-yellow-800',
        '核准': 'bg-green-100 text-green-800',
        '駁回': 'bg-red-100 text-red-800',
    };
    return <span className={`px-2 py-1 rounded text-xs ${map[status] || 'bg-gray-100'}`}>{status}</span>;
};

const MakeupApprovalQueue: React.FC = () => {
    const { user } = useAuth();
    const [list, setList] = useState<ClockMakeupRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'pending' | 'all'>('pending');
    const [reloadKey, setReloadKey] = useState(0);
    const [rejecting, setRejecting] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await apiGetMakeupRequests();
                setList(data.sort((a, b) => (b.requestDate || '').localeCompare(a.requestDate || '')));
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        })();
    }, [reloadKey]);

    const handleApprove = async (id: string) => {
        if (!confirm('確定核准這筆補打卡申請？將自動寫入打卡紀錄。')) return;
        try {
            await apiApproveMakeupRequest(id, '核准', user?.name || 'Admin');
            setReloadKey(k => k + 1);
        } catch (e: any) {
            alert(e.message || '操作失敗');
        }
    };

    const handleReject = async (id: string) => {
        if (rejectReason.length < 2) {
            alert('請填寫駁回理由');
            return;
        }
        try {
            await apiApproveMakeupRequest(id, '駁回', user?.name || 'Admin', rejectReason);
            setRejecting(null);
            setRejectReason('');
            setReloadKey(k => k + 1);
        } catch (e: any) {
            alert(e.message || '操作失敗');
        }
    };

    const visible = filter === 'pending' ? list.filter(r => r.status === '待審核') : list;

    return (
        <div className="p-6 bg-white rounded-lg shadow-lg">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-800">補打卡審核</h1>
                <div className="flex gap-2">
                    <button onClick={() => setFilter('pending')} className={`px-3 py-1 rounded ${filter === 'pending' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>待審核</button>
                    <button onClick={() => setFilter('all')} className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>全部</button>
                </div>
            </div>

            {loading ? (
                <p className="text-gray-500">載入中…</p>
            ) : visible.length === 0 ? (
                <p className="text-gray-500 text-center py-8">{filter === 'pending' ? '目前沒有待審核的申請' : '尚無申請'}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="py-2 px-3 text-left">申請人</th>
                                <th className="py-2 px-3 text-left">補打卡日</th>
                                <th className="py-2 px-3 text-left">類型</th>
                                <th className="py-2 px-3 text-left">時間</th>
                                <th className="py-2 px-3 text-left">理由</th>
                                <th className="py-2 px-3 text-center">狀態</th>
                                <th className="py-2 px-3 text-center">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(r => (
                                <React.Fragment key={r.id}>
                                    <tr className="border-b hover:bg-gray-50">
                                        <td className="py-2 px-3"><div>{r.name}</div><div className="text-xs text-gray-400">{r.empId}</div></td>
                                        <td className="py-2 px-3">{r.date}</td>
                                        <td className="py-2 px-3">{r.type}</td>
                                        <td className="py-2 px-3">{r.requestedClockIn || '-'} / {r.requestedClockOut || '-'}</td>
                                        <td className="py-2 px-3 max-w-xs truncate" title={r.reason}>{r.reason}</td>
                                        <td className="py-2 px-3 text-center">
                                            <StatusBadge status={r.status} />
                                            {r.rejectReason && <p className="text-xs text-red-600 mt-1">{r.rejectReason}</p>}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            {r.status === '待審核' ? (
                                                <div className="flex gap-1 justify-center">
                                                    <button onClick={() => handleApprove(r.id)} className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600">核准</button>
                                                    <button onClick={() => { setRejecting(r.id); setRejectReason(''); }} className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600">駁回</button>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">{r.approver}</span>
                                            )}
                                        </td>
                                    </tr>
                                    {rejecting === r.id && (
                                        <tr className="bg-red-50">
                                            <td colSpan={7} className="py-2 px-3">
                                                <div className="flex gap-2 items-center">
                                                    <input
                                                        type="text"
                                                        value={rejectReason}
                                                        onChange={e => setRejectReason(e.target.value)}
                                                        placeholder="駁回理由（必填）"
                                                        className="flex-1 p-1 border rounded text-sm"
                                                    />
                                                    <button onClick={() => handleReject(r.id)} className="px-2 py-1 bg-red-500 text-white text-xs rounded">確認駁回</button>
                                                    <button onClick={() => setRejecting(null)} className="px-2 py-1 bg-gray-200 text-xs rounded">取消</button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default MakeupApprovalQueue;
