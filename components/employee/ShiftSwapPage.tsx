import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    apiCancelShiftSwap,
    apiGetAllEmployees,
    apiGetEmployeeSchedule,
    apiListShiftSwapRequests,
    apiPeerRespondShiftSwap,
    apiSubmitShiftSwap,
} from '../../services/googleAppsScriptAPI';
import { ScheduleEvent, ShiftSwapRequest, User } from '../../types';

const statusLabel: Record<ShiftSwapRequest['status'], string> = {
    'awaiting-peer': '等對方確認',
    'awaiting-admin': '等管理員核可',
    approved: '已生效',
    'rejected-by-peer': '對方拒絕',
    'rejected-by-admin': '管理員駁回',
    cancelled: '已取消',
};

const statusClass: Record<ShiftSwapRequest['status'], string> = {
    'awaiting-peer': 'bg-yellow-100 text-yellow-800',
    'awaiting-admin': 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    'rejected-by-peer': 'bg-red-100 text-red-800',
    'rejected-by-admin': 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
};

const shiftOptions = (events: ScheduleEvent[], empId?: string) => events.flatMap(event =>
    (event.shifts || [])
        .map((shift, index) => ({ event, shift, index }))
        .filter(item => !empId || item.shift.empId === empId)
);

const ShiftSwapPage: React.FC = () => {
    const { user } = useAuth();
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [mySchedule, setMySchedule] = useState<ScheduleEvent[]>([]);
    const [allSchedule, setAllSchedule] = useState<Record<string, ScheduleEvent[]>>({});
    const [employees, setEmployees] = useState<User[]>([]);
    const [requests, setRequests] = useState<ShiftSwapRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [fromKey, setFromKey] = useState('');
    const [toEmpId, setToEmpId] = useState('');
    const [toKey, setToKey] = useState('');
    const [reason, setReason] = useState('');
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const load = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const [mine, empList, reqs] = await Promise.all([
                apiGetEmployeeSchedule(user.id, month),
                apiGetAllEmployees(),
                apiListShiftSwapRequests('mine'),
            ]);
            setMySchedule(mine);
            setEmployees(empList.filter(e => e.id !== user.id));
            setRequests(reqs);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, month]);

    useEffect(() => {
        const fetchTargetSchedule = async () => {
            if (!toEmpId || allSchedule[toEmpId]) return;
            const data = await apiGetEmployeeSchedule(toEmpId, month);
            setAllSchedule(prev => ({ ...prev, [toEmpId]: data }));
        };
        fetchTargetSchedule().catch(() => {});
    }, [toEmpId, month, allSchedule]);

    const myOptions = useMemo(() => shiftOptions(mySchedule, user?.id), [mySchedule, user]);
    const peerOptions = useMemo(() => shiftOptions(allSchedule[toEmpId] || [], toEmpId), [allSchedule, toEmpId]);

    const parseKey = (key: string) => {
        const [date, index] = key.split('#');
        return { date, index: Number(index) };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!fromKey || !toEmpId || !toKey || reason.trim().length < 5) {
            alert('請完整選擇雙方班次並填寫至少 5 字原因');
            return;
        }
        const from = parseKey(fromKey);
        const to = parseKey(toKey);
        setSubmitting(true);
        try {
            await apiSubmitShiftSwap({
                fromDate: from.date,
                fromShiftIndex: from.index,
                toEmpId,
                toDate: to.date,
                toShiftIndex: to.index,
                reason: reason.trim(),
            });
            setFromKey('');
            setToEmpId('');
            setToKey('');
            setReason('');
            await load();
            alert('換班申請已送出');
        } catch (err: any) {
            alert(err?.message || '送出失敗');
        } finally {
            setSubmitting(false);
        }
    };

    const respond = async (requestId: string, agree: boolean) => {
        try {
            await apiPeerRespondShiftSwap(requestId, agree, agree ? undefined : rejectReason);
            setRejectingId(null);
            setRejectReason('');
            await load();
        } catch (err: any) {
            alert(err?.message || '操作失敗');
        }
    };

    const cancel = async (requestId: string) => {
        if (!window.confirm('確定取消這筆換班申請？')) return;
        try {
            await apiCancelShiftSwap(requestId);
            await load();
        } catch (err: any) {
            alert(err?.message || '取消失敗');
        }
    };

    const waitingForMe = requests.filter(r => r.toEmpId === user?.id && r.status === 'awaiting-peer');
    const mine = requests.filter(r => r.fromEmpId === user?.id);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <section className="bg-white rounded-lg shadow-md p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                    <h2 className="text-2xl font-bold text-gray-800">換班申請</h2>
                    <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="p-2 border rounded-md" />
                </div>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">我的班次</label>
                        <select value={fromKey} onChange={e => setFromKey(e.target.value)} className="w-full p-2 border rounded-md">
                            <option value="">選擇要換出的班次</option>
                            {myOptions.map(({ event, shift, index }) => (
                                <option key={`${event.date}#${index}`} value={`${event.date}#${index}`}>
                                    {event.date} {shift.from}-{shift.to}（{shift.role}）
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">對方員工</label>
                        <select value={toEmpId} onChange={e => { setToEmpId(e.target.value); setToKey(''); }} className="w-full p-2 border rounded-md">
                            <option value="">選擇對方</option>
                            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}（{emp.position}）</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">對方班次</label>
                        <select value={toKey} onChange={e => setToKey(e.target.value)} disabled={!toEmpId} className="w-full p-2 border rounded-md disabled:bg-gray-100">
                            <option value="">選擇對方班次</option>
                            {peerOptions.map(({ event, shift, index }) => (
                                <option key={`${event.date}#${index}`} value={`${event.date}#${index}`}>
                                    {event.date} {shift.from}-{shift.to}（{shift.role}）
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">原因</label>
                        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="w-full p-2 border rounded-md" />
                    </div>
                    <div className="lg:col-span-2">
                        <button disabled={submitting} className="w-full sm:w-auto px-5 py-2 bg-brand-green-dark text-white rounded-md hover:bg-brand-green-light disabled:opacity-50">
                            {submitting ? '送出中...' : '送出換班申請'}
                        </button>
                    </div>
                </form>
            </section>

            <section className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4">待我確認</h3>
                {loading ? <p className="text-gray-500">載入中...</p> : waitingForMe.length === 0 ? <p className="text-gray-500">目前沒有待確認的換班申請</p> : (
                    <div className="space-y-3">
                        {waitingForMe.map(req => (
                            <div key={req.id} className="p-4 border rounded-lg bg-yellow-50">
                                <p className="font-semibold">{req.fromName} 想與你換班</p>
                                <p className="text-sm text-gray-600">{req.fromDate} #{req.fromShiftIndex + 1} ⇄ {req.toDate} #{req.toShiftIndex + 1}</p>
                                <p className="text-sm bg-white rounded p-2 mt-2">{req.reason}</p>
                                {rejectingId === req.id ? (
                                    <div className="flex gap-2 mt-3">
                                        <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="拒絕理由" className="flex-1 p-2 border rounded text-sm" />
                                        <button onClick={() => respond(req.id, false)} className="px-3 py-1 bg-red-500 text-white rounded text-sm">確認拒絕</button>
                                        <button onClick={() => setRejectingId(null)} className="px-3 py-1 bg-gray-200 rounded text-sm">取消</button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2 justify-end mt-3">
                                        <button onClick={() => respond(req.id, true)} className="px-3 py-1 bg-green-600 text-white rounded text-sm">同意</button>
                                        <button onClick={() => { setRejectingId(req.id); setRejectReason(''); }} className="px-3 py-1 bg-red-500 text-white rounded text-sm">拒絕</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4">我發起的</h3>
                {mine.length === 0 ? <p className="text-gray-500">尚無換班申請</p> : (
                    <div className="space-y-3">
                        {mine.map(req => (
                            <div key={req.id} className="p-4 border rounded-lg">
                                <div className="flex flex-wrap justify-between gap-2">
                                    <div>
                                        <p className="font-semibold">{req.fromDate} ⇄ {req.toName} {req.toDate}</p>
                                        <p className="text-sm text-gray-500">{new Date(req.createdAt).toLocaleString()}</p>
                                    </div>
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass[req.status]}`}>{statusLabel[req.status]}</span>
                                </div>
                                {(req.peerRejectReason || req.adminRejectReason) && (
                                    <p className="text-sm text-red-600 mt-2">原因：{req.peerRejectReason || req.adminRejectReason}</p>
                                )}
                                {(req.status === 'awaiting-peer' || req.status === 'awaiting-admin') && (
                                    <div className="text-right mt-3">
                                        <button onClick={() => cancel(req.id)} className="px-3 py-1 bg-gray-200 rounded text-sm">取消申請</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export default ShiftSwapPage;
