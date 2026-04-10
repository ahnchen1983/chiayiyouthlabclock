import React, { useEffect, useState } from 'react';
import {
    apiCreateOpenShift,
    apiListOpenShifts,
    apiDeleteOpenShift,
} from '../../services/googleAppsScriptAPI';
import { OpenShift } from '../../types';

const OpenShiftManager: React.FC = () => {
    const [shifts, setShifts] = useState<OpenShift[]>([]);
    const [loading, setLoading] = useState(true);
    const [date, setDate] = useState('');
    const [shiftTime, setShiftTime] = useState('08:30-17:30');
    const [requiredCount, setRequiredCount] = useState(1);
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

    const reload = async () => {
        setLoading(true);
        try {
            const list = await apiListOpenShifts(false);
            setShifts(list);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!date || !shiftTime || !requiredCount) {
            setMessage({ type: 'error', text: '請完整填寫日期、時段、人數。' });
            return;
        }
        setSubmitting(true);
        setMessage(null);
        try {
            await apiCreateOpenShift({ date, shiftTime, requiredCount, note });
            setMessage({ type: 'success', text: '已建立開放排班。' });
            setDate(''); setNote(''); setRequiredCount(1);
            await reload();
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || '建立失敗' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (shiftId: string) => {
        if (!confirm('確定刪除此開放排班？')) return;
        try {
            await apiDeleteOpenShift(shiftId);
            await reload();
        } catch (err: any) {
            alert(err?.message || '刪除失敗');
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">開放排班管理</h2>

            {/* 建立表單 */}
            <form onSubmit={handleCreate} className="bg-white rounded-lg shadow p-5 space-y-4">
                <h3 className="font-semibold text-gray-700">新增開放排班</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">日期</label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">時段</label>
                        <input type="text" placeholder="08:30-17:30" value={shiftTime} onChange={e => setShiftTime(e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">需要人數</label>
                        <input type="number" min={1} max={10} value={requiredCount} onChange={e => setRequiredCount(Number(e.target.value))} className="w-full border rounded px-2 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">備註（選填）</label>
                        <input type="text" value={note} onChange={e => setNote(e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
                    </div>
                </div>
                {message && (
                    <div className={`text-sm p-2 rounded ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>
                )}
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-brand-green-dark text-white rounded text-sm font-medium disabled:bg-gray-400">
                    {submitting ? '建立中…' : '建立'}
                </button>
            </form>

            {/* 清單 */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <h3 className="font-semibold text-gray-700 p-4 border-b">所有開放排班</h3>
                {loading ? (
                    <div className="p-6 text-center text-gray-500">載入中…</div>
                ) : shifts.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">尚無開放排班</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr>
                                <th className="px-3 py-2 text-left">日期</th>
                                <th className="px-3 py-2 text-left">時段</th>
                                <th className="px-3 py-2 text-left">需求/已認領</th>
                                <th className="px-3 py-2 text-left">認領人員</th>
                                <th className="px-3 py-2 text-left">狀態</th>
                                <th className="px-3 py-2 text-left">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shifts.map(s => (
                                <tr key={s.id} className="border-t">
                                    <td className="px-3 py-2">{s.date}</td>
                                    <td className="px-3 py-2">{s.shiftTime}</td>
                                    <td className="px-3 py-2">{(s.takenBy?.length || 0)}/{s.requiredCount}</td>
                                    <td className="px-3 py-2">{(s.takenNames || []).join('、') || '-'}</td>
                                    <td className="px-3 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${s.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                                            {s.status === 'open' ? '開放中' : '已額滿'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:underline text-xs">刪除</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default OpenShiftManager;
