import React, { useEffect, useState } from 'react';
import { apiSubmitMakeupRequest, apiGetEmployeeMakeupRequests } from '../../services/googleAppsScriptAPI';
import { ClockMakeupRequest } from '../../types';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const map: Record<string, string> = {
        '待審核': 'bg-yellow-100 text-yellow-800',
        '核准': 'bg-green-100 text-green-800',
        '駁回': 'bg-red-100 text-red-800',
    };
    return <span className={`px-2 py-1 rounded text-xs ${map[status] || 'bg-gray-100'}`}>{status}</span>;
};

const ClockMakeupForm: React.FC = () => {
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [type, setType] = useState<'上班' | '下班' | '上下班'>('上班');
    const [clockIn, setClockIn] = useState('');
    const [clockOut, setClockOut] = useState('');
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [history, setHistory] = useState<ClockMakeupRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const list = await apiGetEmployeeMakeupRequests();
                setHistory(list.sort((a, b) => (b.requestDate || '').localeCompare(a.requestDate || '')));
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        })();
    }, [reloadKey]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (reason.length < 5) {
            alert('請填寫詳細理由（至少 5 字）');
            return;
        }
        if ((type === '上班' || type === '上下班') && !clockIn) {
            alert('請填寫上班時間');
            return;
        }
        if ((type === '下班' || type === '上下班') && !clockOut) {
            alert('請填寫下班時間');
            return;
        }
        setSubmitting(true);
        try {
            await apiSubmitMakeupRequest({
                date,
                type,
                requestedClockIn: type !== '下班' ? clockIn : undefined,
                requestedClockOut: type !== '上班' ? clockOut : undefined,
                reason,
            });
            alert('申請已送出，請待管理者審核');
            setReason('');
            setClockIn('');
            setClockOut('');
            setReloadKey(k => k + 1);
        } catch (e: any) {
            alert(e.message || '送出失敗');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-lg space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">補打卡申請</h1>

            <form onSubmit={handleSubmit} className="space-y-4 border rounded p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">補打卡日期</label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full p-2 border rounded" max={new Date().toISOString().slice(0, 10)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">補打卡類型</label>
                        <select value={type} onChange={e => setType(e.target.value as any)} className="w-full p-2 border rounded">
                            <option value="上班">補上班</option>
                            <option value="下班">補下班</option>
                            <option value="上下班">補上下班</option>
                        </select>
                    </div>
                    {(type === '上班' || type === '上下班') && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">上班時間</label>
                            <input type="time" value={clockIn} onChange={e => setClockIn(e.target.value)} className="w-full p-2 border rounded" />
                        </div>
                    )}
                    {(type === '下班' || type === '上下班') && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">下班時間</label>
                            <input type="time" value={clockOut} onChange={e => setClockOut(e.target.value)} className="w-full p-2 border rounded" />
                        </div>
                    )}
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">申請理由</label>
                    <textarea value={reason} onChange={e => setReason(e.target.value)} required rows={3} className="w-full p-2 border rounded" placeholder="請說明忘記打卡的原因（至少 5 字）" />
                </div>
                <button type="submit" disabled={submitting} className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
                    {submitting ? '送出中…' : '送出申請'}
                </button>
            </form>

            <div>
                <h2 className="text-lg font-bold mb-3">我的申請紀錄</h2>
                {loading ? (
                    <p className="text-gray-500">載入中…</p>
                ) : history.length === 0 ? (
                    <p className="text-gray-500">尚無申請紀錄</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="py-2 px-3 text-left">申請時間</th>
                                    <th className="py-2 px-3 text-left">補打卡日期</th>
                                    <th className="py-2 px-3 text-left">類型</th>
                                    <th className="py-2 px-3 text-left">時間</th>
                                    <th className="py-2 px-3 text-left">理由</th>
                                    <th className="py-2 px-3 text-center">狀態</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(h => (
                                    <tr key={h.id} className="border-b">
                                        <td className="py-2 px-3 text-gray-500">{h.requestDate?.slice(0, 16).replace('T', ' ')}</td>
                                        <td className="py-2 px-3">{h.date}</td>
                                        <td className="py-2 px-3">{h.type}</td>
                                        <td className="py-2 px-3">{h.requestedClockIn || '-'} / {h.requestedClockOut || '-'}</td>
                                        <td className="py-2 px-3 max-w-xs truncate" title={h.reason}>{h.reason}</td>
                                        <td className="py-2 px-3 text-center">
                                            <StatusBadge status={h.status} />
                                            {h.rejectReason && <p className="text-xs text-red-600 mt-1">{h.rejectReason}</p>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ClockMakeupForm;
