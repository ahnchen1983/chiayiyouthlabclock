import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    apiListOpenShifts,
    apiClaimOpenShift,
    apiReleaseOpenShift,
} from '../../services/googleAppsScriptAPI';
import { OpenShift } from '../../types';

const OpenShiftPicker: React.FC = () => {
    const { user } = useAuth();
    const [shifts, setShifts] = useState<OpenShift[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
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

    const handleClaim = async (id: string) => {
        setBusyId(id);
        setMessage(null);
        try {
            await apiClaimOpenShift(id);
            setMessage({ type: 'success', text: '已成功認領此班次！' });
            await reload();
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || '認領失敗' });
        } finally {
            setBusyId(null);
        }
    };

    const handleRelease = async (id: string) => {
        if (!confirm('確定釋出此班次？釋出後其他人可以認領。')) return;
        setBusyId(id);
        setMessage(null);
        try {
            await apiReleaseOpenShift(id);
            setMessage({ type: 'success', text: '已釋出班次。' });
            await reload();
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.message || '釋出失敗' });
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-4">
            <div>
                <h2 className="text-2xl font-bold text-gray-800">開放排班</h2>
                <p className="text-sm text-gray-500 mt-1">點選下方班次主動認領，額滿後自動關閉</p>
            </div>

            {message && (
                <div className={`text-sm p-3 rounded ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            {loading ? (
                <div className="text-center py-10 text-gray-500">載入中…</div>
            ) : shifts.length === 0 ? (
                <div className="text-center py-10 text-gray-500 bg-white rounded-lg shadow">
                    目前無開放排班
                </div>
            ) : (
                <div className="space-y-3">
                    {shifts.map(s => {
                        const taken = s.takenBy || [];
                        const claimed = user ? taken.includes(user.id) : false;
                        const full = taken.length >= s.requiredCount;
                        return (
                            <div key={s.id} className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-800">{s.date}</span>
                                        <span className="text-sm text-gray-500">{s.shiftTime}</span>
                                        <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                                            {taken.length}/{s.requiredCount} 人
                                        </span>
                                    </div>
                                    {(s.takenNames?.length || 0) > 0 && (
                                        <p className="text-xs text-gray-500 mt-1">已認領：{(s.takenNames || []).join('、')}</p>
                                    )}
                                    {s.note && <p className="text-xs text-gray-400 mt-1">{s.note}</p>}
                                </div>
                                <div>
                                    {claimed ? (
                                        <button
                                            disabled={busyId === s.id}
                                            onClick={() => handleRelease(s.id)}
                                            className="px-4 py-2 text-sm border border-red-500 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                                        >
                                            {busyId === s.id ? '處理中…' : '釋出'}
                                        </button>
                                    ) : full ? (
                                        <span className="px-4 py-2 text-sm text-gray-400">已額滿</span>
                                    ) : (
                                        <button
                                            disabled={busyId === s.id}
                                            onClick={() => handleClaim(s.id)}
                                            className="px-4 py-2 text-sm bg-brand-green-dark text-white rounded hover:bg-brand-green-light disabled:bg-gray-400"
                                        >
                                            {busyId === s.id ? '處理中…' : '認領'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default OpenShiftPicker;
