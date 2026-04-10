import React, { useEffect, useState } from 'react';
import { apiGetLeaveBalance } from '../../services/googleAppsScriptAPI';
import { LeaveBalance } from '../../types';

const MyLeaveBalance: React.FC = () => {
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await apiGetLeaveBalance();
                setBalances(data);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) {
        return <div className="text-center py-10 text-gray-500">載入中…</div>;
    }

    return (
        <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold text-center mb-2 text-gray-800">假別餘額</h2>
            <p className="text-center text-sm text-gray-500 mb-6">本年度可用時數（依勞基法計算）</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {balances.map(b => {
                    const pct = b.quotaHours > 0 ? Math.min(100, (b.usedHours / b.quotaHours) * 100) : 0;
                    const isOther = b.leaveType === '其他';
                    return (
                        <div key={b.leaveType} className="bg-white rounded-2xl shadow p-5">
                            <div className="flex justify-between items-baseline">
                                <h3 className="text-lg font-bold text-gray-800">{b.leaveType}</h3>
                                {!isOther && (
                                    <span className="text-xs text-gray-400">配額 {b.quotaHours}h</span>
                                )}
                            </div>
                            <div className="mt-3">
                                <p className="text-3xl font-bold text-brand-green-dark">
                                    {isOther ? '不限' : `${b.remainingHours}h`}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">已使用 {b.usedHours}h</p>
                            </div>
                            {!isOther && (
                                <div className="mt-3 w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                    <div
                                        className={`h-full transition-all ${pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            )}
                            {b.note && (
                                <p className="text-xs text-gray-400 mt-2">{b.note}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default MyLeaveBalance;
