import React, { useEffect, useState } from 'react';
import { apiAdminApproveShiftSwap, apiListShiftSwapRequests } from '../../services/googleAppsScriptAPI';
import { ShiftSwapRequest } from '../../types';

const statusLabel: Record<ShiftSwapRequest['status'], string> = {
    'awaiting-peer': '等對方確認',
    'awaiting-admin': '待管理員核可',
    approved: '已生效',
    'rejected-by-peer': '對方拒絕',
    'rejected-by-admin': '管理員駁回',
    cancelled: '已取消',
};

const ShiftSwapApprovalQueue: React.FC = () => {
    const [list, setList] = useState<ShiftSwapRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'pending' | 'all'>('pending');
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            setList(await apiListShiftSwapRequests(filter === 'pending' ? 'admin-pending' : 'admin-all'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter]);

    const approve = async (requestId: string) => {
        if (!window.confirm('確定核准這筆換班申請？核准後班表會立即交換。')) return;
        try {
            await apiAdminApproveShiftSwap(requestId, true);
            await load();
        } catch (e: any) {
            alert(e?.message || '核准失敗');
        }
    };

    const reject = async (requestId: string) => {
        if (rejectReason.trim().length < 2) {
            alert('請填寫至少 2 字駁回理由');
            return;
        }
        try {
            await apiAdminApproveShiftSwap(requestId, false, rejectReason.trim());
            setRejectingId(null);
            setRejectReason('');
            await load();
        } catch (e: any) {
            alert(e?.message || '駁回失敗');
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-lg">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-800">換班審核</h1>
                <div className="flex gap-2">
                    <button onClick={() => setFilter('pending')} className={`px-3 py-1 rounded ${filter === 'pending' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>待核可</button>
                    <button onClick={() => setFilter('all')} className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>全部</button>
                </div>
            </div>

            {loading ? (
                <p className="text-gray-500">載入中...</p>
            ) : list.length === 0 ? (
                <p className="text-center text-gray-500 py-8">{filter === 'pending' ? '目前沒有待核可的換班申請' : '尚無換班申請'}</p>
            ) : (
                <div className="space-y-4">
                    {list.map(req => (
                        <div key={req.id} className="p-4 border rounded-lg bg-gray-50">
                            <div className="flex flex-wrap justify-between gap-3">
                                <div>
                                    <p className="font-bold text-lg">{req.fromName} ⇄ {req.toName}</p>
                                    <p className="text-sm text-gray-600">
                                        {req.fromDate} 第 {req.fromShiftIndex + 1} 班 ⇄ {req.toDate} 第 {req.toShiftIndex + 1} 班
                                    </p>
                                    <p className="text-xs text-gray-500">申請時間：{new Date(req.createdAt).toLocaleString()}</p>
                                    {req.peerResponseAt && <p className="text-xs text-gray-500">對方同意：{new Date(req.peerResponseAt).toLocaleString()}</p>}
                                </div>
                                <span className="px-3 py-1 text-sm rounded-full bg-blue-100 text-blue-800 h-fit">{statusLabel[req.status]}</span>
                            </div>
                            <p className="mt-3 text-sm bg-white p-2 rounded border">{req.reason}</p>
                            {(req.peerRejectReason || req.adminRejectReason) && (
                                <p className="mt-2 text-sm text-red-600">駁回原因：{req.peerRejectReason || req.adminRejectReason}</p>
                            )}
                            {req.status === 'awaiting-admin' && rejectingId !== req.id && (
                                <div className="flex justify-end gap-2 mt-4">
                                    <button onClick={() => approve(req.id)} className="px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700">核准</button>
                                    <button onClick={() => { setRejectingId(req.id); setRejectReason(''); }} className="px-4 py-2 text-sm text-white bg-red-500 rounded hover:bg-red-600">駁回</button>
                                </div>
                            )}
                            {rejectingId === req.id && (
                                <div className="flex gap-2 mt-4 p-3 bg-red-50 rounded">
                                    <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="駁回理由（必填）" className="flex-1 p-2 border rounded text-sm" />
                                    <button onClick={() => reject(req.id)} className="px-3 py-1 bg-red-500 text-white rounded text-sm">確認駁回</button>
                                    <button onClick={() => setRejectingId(null)} className="px-3 py-1 bg-gray-200 rounded text-sm">取消</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ShiftSwapApprovalQueue;
