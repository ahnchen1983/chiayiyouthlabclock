
import React, { useState, useEffect } from 'react';
import { apiGetScheduleAttendanceComparison, ScheduleAttendanceComparison } from '../../services/googleAppsScriptAPI';
import { CalendarIcon } from '../icons';

// 圖示
const ChevronLeftIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
);

const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
);

// 出勤狀態標籤
const AttendanceStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const colorMap: Record<string, string> = {
        '正常': 'bg-green-100 text-green-800',
        '遲到': 'bg-yellow-100 text-yellow-800',
        '早退': 'bg-orange-100 text-orange-800',
        '缺勤': 'bg-red-100 text-red-800',
        '休假': 'bg-blue-100 text-blue-800',
        '-': 'bg-gray-100 text-gray-400',
    };
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorMap[status] || 'bg-gray-100 text-gray-500'}`}>
            {status}
        </span>
    );
};

// 日期卡片
interface DayCardProps {
    data: ScheduleAttendanceComparison;
    isSelected: boolean;
    onClick: () => void;
}

const DayCard: React.FC<DayCardProps> = ({ data, isSelected, onClick }) => {
    const day = parseInt(data.date.split('-')[2]);
    const isClosed = data.status === '休館';
    const scheduledCount = data.employees.filter(e => e.scheduled).length;
    const attendedCount = data.employees.filter(e => e.scheduled && e.clockInTime).length;
    const hasIssue = data.employees.some(e => e.attendanceStatus === '缺勤' || e.attendanceStatus === '遲到');

    return (
        <button
            onClick={onClick}
            className={`p-2 rounded-lg border-2 transition-all text-left w-full ${
                isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : isClosed
                    ? 'border-gray-200 bg-gray-100'
                    : hasIssue
                    ? 'border-red-200 bg-red-50 hover:border-red-300'
                    : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
        >
            <div className="flex items-center justify-between">
                <span className={`text-lg font-bold ${isClosed ? 'text-gray-400' : 'text-gray-800'}`}>
                    {day}
                </span>
                <span className="text-xs text-gray-400">{data.dayOfWeek}</span>
            </div>
            {isClosed ? (
                <p className="text-xs text-gray-400 mt-1">休館</p>
            ) : (
                <div className="mt-1">
                    <p className="text-xs text-gray-500">
                        出勤: <span className={attendedCount === scheduledCount ? 'text-green-600' : 'text-red-600'}>
                            {attendedCount}/{scheduledCount}
                        </span>
                    </p>
                </div>
            )}
        </button>
    );
};

const ScheduleComparison: React.FC = () => {
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [data, setData] = useState<ScheduleAttendanceComparison[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const result = await apiGetScheduleAttendanceComparison(month);
            setData(result);
            // 選擇第一個營運日
            const firstOperatingDay = result.find(d => d.status === '營運');
            setSelectedDate(firstOperatingDay?.date || null);
            setLoading(false);
        };
        fetchData();
    }, [month]);

    const handlePrevMonth = () => {
        const [year, m] = month.split('-').map(Number);
        const prev = new Date(year, m - 2, 1);
        setMonth(prev.toISOString().slice(0, 7));
    };

    const handleNextMonth = () => {
        const [year, m] = month.split('-').map(Number);
        const next = new Date(year, m, 1);
        setMonth(next.toISOString().slice(0, 7));
    };

    const selectedDayData = data.find(d => d.date === selectedDate);

    // 統計
    const stats = {
        totalDays: data.filter(d => d.status === '營運').length,
        normalDays: data.filter(d =>
            d.status === '營運' &&
            !d.employees.some(e => e.scheduled && (e.attendanceStatus === '缺勤' || e.attendanceStatus === '遲到'))
        ).length,
        issueDays: data.filter(d =>
            d.status === '營運' &&
            d.employees.some(e => e.scheduled && (e.attendanceStatus === '缺勤' || e.attendanceStatus === '遲到'))
        ).length,
    };

    // 將日期按週分組
    const weeks: ScheduleAttendanceComparison[][] = [];
    if (data.length > 0) {
        const firstDay = new Date(data[0].date).getDay();
        let currentWeek: ScheduleAttendanceComparison[] = Array(firstDay).fill(null);

        data.forEach(day => {
            currentWeek.push(day);
            if (currentWeek.length === 7) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
        });

        if (currentWeek.length > 0) {
            weeks.push(currentWeek);
        }
    }

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            {/* 標題 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <CalendarIcon className="w-7 h-7 text-purple-500" />
                    排班 vs 實際出勤對照表
                </h1>
            </div>

            {/* 月份選擇和統計 */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <button
                        onClick={handlePrevMonth}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
                    </button>
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="p-2 border rounded-md text-lg font-semibold"
                    />
                    <button
                        onClick={handleNextMonth}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        <ChevronRightIcon className="w-5 h-5 text-gray-600" />
                    </button>
                </div>

                <div className="flex gap-4">
                    <div className="text-center px-4 py-2 bg-gray-50 rounded-lg">
                        <p className="text-xl font-bold text-gray-800">{stats.totalDays}</p>
                        <p className="text-xs text-gray-500">營運天數</p>
                    </div>
                    <div className="text-center px-4 py-2 bg-green-50 rounded-lg">
                        <p className="text-xl font-bold text-green-600">{stats.normalDays}</p>
                        <p className="text-xs text-gray-500">正常出勤</p>
                    </div>
                    <div className="text-center px-4 py-2 bg-red-50 rounded-lg">
                        <p className="text-xl font-bold text-red-600">{stats.issueDays}</p>
                        <p className="text-xs text-gray-500">出勤異常</p>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* 月曆視圖 */}
                    <div className="lg:col-span-1">
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="grid grid-cols-7 gap-1 mb-2">
                                {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                                    <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">
                                        {d}
                                    </div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7 gap-1">
                                {weeks.flat().map((day, idx) => (
                                    day ? (
                                        <DayCard
                                            key={day.date}
                                            data={day}
                                            isSelected={selectedDate === day.date}
                                            onClick={() => setSelectedDate(day.date)}
                                        />
                                    ) : (
                                        <div key={`empty-${idx}`} className="p-2" />
                                    )
                                ))}
                            </div>

                            {/* 圖例 */}
                            <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 bg-gray-100 border border-gray-200 rounded" />
                                    <span>休館</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 bg-white border border-gray-200 rounded" />
                                    <span>正常</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 bg-red-50 border border-red-200 rounded" />
                                    <span>有異常</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 詳細資料 */}
                    <div className="lg:col-span-2">
                        {selectedDayData ? (
                            <div className="border rounded-lg overflow-hidden">
                                <div className={`p-4 ${selectedDayData.status === '休館' ? 'bg-gray-100' : 'bg-purple-50'}`}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-800">
                                                {selectedDayData.date} ({selectedDayData.dayOfWeek})
                                            </h3>
                                            <p className="text-sm text-gray-500">
                                                {selectedDayData.status === '休館' ? '休館日' : `營運時間`}
                                            </p>
                                        </div>
                                        {selectedDayData.status === '營運' && (
                                            <div className="text-right">
                                                <p className="text-sm text-gray-500">出勤率</p>
                                                <p className="text-xl font-bold text-purple-600">
                                                    {selectedDayData.employees.filter(e => e.scheduled).length > 0
                                                        ? Math.round(
                                                            (selectedDayData.employees.filter(e => e.scheduled && e.clockInTime).length /
                                                            selectedDayData.employees.filter(e => e.scheduled).length) * 100
                                                          )
                                                        : 0}%
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {selectedDayData.status === '營運' ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                            <thead className="bg-gray-100">
                                                <tr>
                                                    <th className="py-3 px-4 text-left text-sm font-semibold text-gray-600">員工</th>
                                                    <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">排班</th>
                                                    <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">班別</th>
                                                    <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">上班</th>
                                                    <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">下班</th>
                                                    <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">工時</th>
                                                    <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">狀態</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedDayData.employees
                                                    .filter(e => e.scheduled)
                                                    .map(emp => (
                                                        <tr key={emp.empId} className="border-b hover:bg-gray-50">
                                                            <td className="py-3 px-4">
                                                                <div>
                                                                    <p className="text-sm font-medium text-gray-800">{emp.name}</p>
                                                                    <p className={`text-xs ${emp.position === '專責人員' ? 'text-purple-500' : 'text-teal-500'}`}>
                                                                        {emp.position}
                                                                    </p>
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-4 text-center">
                                                                {emp.scheduled ? (
                                                                    <span className="text-green-500">✓</span>
                                                                ) : (
                                                                    <span className="text-gray-300">-</span>
                                                                )}
                                                            </td>
                                                            <td className="py-3 px-4 text-center text-sm text-gray-600">
                                                                {emp.scheduledShift || '-'}
                                                            </td>
                                                            <td className="py-3 px-4 text-center text-sm text-gray-600">
                                                                {emp.clockInTime || '-'}
                                                            </td>
                                                            <td className="py-3 px-4 text-center text-sm text-gray-600">
                                                                {emp.clockOutTime || '-'}
                                                            </td>
                                                            <td className="py-3 px-4 text-center text-sm font-medium text-gray-800">
                                                                {emp.workHours?.toFixed(1) || '-'}
                                                            </td>
                                                            <td className="py-3 px-4 text-center">
                                                                <AttendanceStatusBadge status={emp.attendanceStatus} />
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="p-8 text-center text-gray-500">
                                        休館日，無排班資料
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="border rounded-lg p-8 text-center text-gray-500">
                                請選擇日期查看詳細資料
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScheduleComparison;
