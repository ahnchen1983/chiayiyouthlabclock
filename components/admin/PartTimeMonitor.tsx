
import React, { useState, useEffect } from 'react';
import { apiGetAllPartTimeHours } from '../../services/googleAppsScriptAPI';
import { PartTimeHourInfo } from '../../types';

const PartTimeMonitor: React.FC = () => {
    const [partTimeHours, setPartTimeHours] = useState<PartTimeHourInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

    useEffect(() => {
        const fetchHours = async () => {
            setLoading(true);
            const data = await apiGetAllPartTimeHours(month);
            setPartTimeHours(data);
            setLoading(false);
        };
        fetchHours();
    }, [month]);

    return (
        <div>
            <div className="mb-4">
                <label htmlFor="monitor-month-select" className="mr-2 font-semibold text-sm text-gray-600">選擇月份:</label>
                <input
                    type="month"
                    id="monitor-month-select"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="p-1 border rounded-md text-sm"
                />
            </div>
             <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="py-2 px-3 border-b text-left text-sm font-semibold text-gray-600">姓名</th>
                            <th className="py-2 px-3 border-b text-right text-sm font-semibold text-gray-600">已排班時數</th>
                            <th className="py-2 px-3 border-b text-right text-sm font-semibold text-gray-600">已出勤時數</th>
                            <th className="py-2 px-3 border-b text-right text-sm font-semibold text-gray-600">剩餘可排</th>
                            <th className="py-2 px-3 border-b text-center text-sm font-semibold text-gray-600">狀態</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} className="text-center py-6">讀取中...</td></tr>
                        ) : partTimeHours.length > 0 ? (
                            partTimeHours.map(pt => (
                                <tr key={pt.empId} className="hover:bg-gray-50">
                                    <td className="py-2 px-3 border-b">{pt.name}</td>
                                    <td className="py-2 px-3 border-b text-right">{pt.scheduledHours.toFixed(1)}</td>
                                    <td className="py-2 px-3 border-b text-right">{pt.workedHours.toFixed(1)}</td>
                                    <td className="py-2 px-3 border-b text-right font-medium">{pt.remainingHours.toFixed(1)}</td>
                                    <td className="py-2 px-3 border-b text-center">
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${pt.status === '接近上限' ? 'bg-yellow-200 text-yellow-800' : 'bg-green-200 text-green-800'}`}>
                                            {pt.status}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        ) : (
                             <tr><td colSpan={5} className="text-center py-6 text-gray-500">無兼職人員資料</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PartTimeMonitor;
