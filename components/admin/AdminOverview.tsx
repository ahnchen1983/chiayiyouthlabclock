
import React, { useState, useEffect } from 'react';
import { apiGetDashboardStats, apiGetAllPartTimeHours } from '../../services/googleAppsScriptAPI';
import { UsersIcon, ClockIcon, CheckSquareIcon, ListIcon } from '../icons';
import { DashboardStats, TodayAttendanceComparison, PendingItem, PartTimeHourInfo } from '../../types';

// 統計卡片
const StatCard: React.FC<{
    icon: React.ReactNode;
    title: string;
    value: string | number;
    subValue?: string;
    color: string;
}> = ({ icon, title, value, subValue, color }) => (
    <div className="bg-white p-5 rounded-lg shadow-md flex items-center space-x-4">
        <div className={`p-3 rounded-full ${color}`}>
            {icon}
        </div>
        <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className="text-2xl font-bold text-gray-800">{value}</p>
            {subValue && <p className="text-xs text-gray-400">{subValue}</p>}
        </div>
    </div>
);

// 出勤狀態標籤
const AttendanceStatusBadge: React.FC<{ status: TodayAttendanceComparison['status'] }> = ({ status }) => {
    const colorMap: Record<TodayAttendanceComparison['status'], string> = {
        '已到': 'bg-green-100 text-green-800',
        '未到': 'bg-red-100 text-red-800',
        '遲到': 'bg-yellow-100 text-yellow-800',
        '早退': 'bg-orange-100 text-orange-800',
        '休假': 'bg-blue-100 text-blue-800',
        '未排班': 'bg-gray-100 text-gray-500',
    };
    return (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorMap[status]}`}>
            {status}
        </span>
    );
};

// 待處理事項優先級標籤
const PriorityBadge: React.FC<{ priority: PendingItem['priority'] }> = ({ priority }) => {
    const colorMap: Record<PendingItem['priority'], string> = {
        high: 'bg-red-500',
        medium: 'bg-yellow-500',
        low: 'bg-gray-400',
    };
    return <span className={`w-2 h-2 rounded-full ${colorMap[priority]}`} />;
};

// 待處理事項類型圖示
const PendingTypeIcon: React.FC<{ type: PendingItem['type'] }> = ({ type }) => {
    const iconMap: Record<PendingItem['type'], { bg: string; icon: React.ReactNode }> = {
        '請假審核': { bg: 'bg-blue-100 text-blue-600', icon: <CheckSquareIcon className="w-4 h-4" /> },
        '時數警示': { bg: 'bg-yellow-100 text-yellow-600', icon: <ClockIcon className="w-4 h-4" /> },
        '缺勤異常': { bg: 'bg-red-100 text-red-600', icon: <UsersIcon className="w-4 h-4" /> },
    };
    const { bg, icon } = iconMap[type];
    return <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>;
};

// 兼職時數進度條
const HoursProgressBar: React.FC<{ info: PartTimeHourInfo }> = ({ info }) => {
    const percentage = (info.scheduledHours / 80) * 100;
    const workedPercentage = (info.workedHours / 80) * 100;
    const isWarning = info.status === '接近上限';

    return (
        <div className="mb-3 last:mb-0">
            <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-700">{info.name}</span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                        {info.workedHours.toFixed(1)} / {info.scheduledHours.toFixed(1)} 小時
                    </span>
                    {isWarning && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                            接近上限
                        </span>
                    )}
                </div>
            </div>
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full relative">
                    {/* 已排班（背景） */}
                    <div
                        className={`absolute h-full rounded-full ${isWarning ? 'bg-red-200' : 'bg-blue-200'}`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                    {/* 已出勤（前景） */}
                    <div
                        className={`absolute h-full rounded-full ${isWarning ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(workedPercentage, 100)}%` }}
                    />
                </div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>剩餘可排: {info.remainingHours.toFixed(1)} 小時</span>
                <span>上限 80 小時</span>
            </div>
        </div>
    );
};

const AdminOverview: React.FC = () => {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [partTimeHours, setPartTimeHours] = useState<PartTimeHourInfo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const currentMonth = new Date().toISOString().slice(0, 7);
            const [dashboardData, hoursData] = await Promise.all([
                apiGetDashboardStats(),
                apiGetAllPartTimeHours(currentMonth)
            ]);
            setStats(dashboardData);
            setPartTimeHours(hoursData);
            setLoading(false);
        };
        fetchData();
    }, []);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full">
                <div className="w-12 h-12 border-4 border-brand-blue-dark border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!stats) {
        return <div className="text-center text-gray-600">無法載入儀表板資訊。</div>;
    }

    const today = new Date();
    const formattedDate = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} (${['日', '一', '二', '三', '四', '五', '六'][today.getDay()]})`;

    // 過濾有排班的員工
    const scheduledEmployees = stats.todayAttendance.filter(e => e.status !== '未排班');

    return (
        <div className="space-y-6">
            {/* 標題區 */}
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">總覽儀表板</h1>
                <span className="text-gray-500">{formattedDate}</span>
            </div>

            {/* 統計卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={<UsersIcon className="w-6 h-6 text-white" />}
                    title="今日出勤"
                    value={`${stats.todayClockedIn} / ${stats.todayScheduled}`}
                    subValue="已到 / 應到"
                    color="bg-blue-500"
                />
                <StatCard
                    icon={<ClockIcon className="w-6 h-6 text-white" />}
                    title="本月總工時"
                    value={`${stats.monthlyTotalHours.toFixed(1)}`}
                    subValue="小時"
                    color="bg-green-500"
                />
                <StatCard
                    icon={<CheckSquareIcon className="w-6 h-6 text-white" />}
                    title="待審核請假"
                    value={stats.pendingLeaves}
                    subValue="件"
                    color="bg-yellow-500"
                />
                <StatCard
                    icon={<ListIcon className="w-6 h-6 text-white" />}
                    title="時數警示"
                    value={stats.hourWarnings}
                    subValue="人接近上限"
                    color="bg-red-500"
                />
            </div>

            {/* 主內容區 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 今日排班 vs 實際出勤 */}
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <UsersIcon className="w-5 h-5 text-blue-500" />
                        今日排班 vs 實際出勤
                    </h2>
                    {scheduledEmployees.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="py-3 px-4 text-left text-sm font-semibold text-gray-600">員工</th>
                                        <th className="py-3 px-4 text-left text-sm font-semibold text-gray-600">職位</th>
                                        <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">排班時段</th>
                                        <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">上班打卡</th>
                                        <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">下班打卡</th>
                                        <th className="py-3 px-4 text-center text-sm font-semibold text-gray-600">狀態</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scheduledEmployees.map(emp => (
                                        <tr key={emp.empId} className="border-b border-gray-100 hover:bg-gray-50">
                                            <td className="py-3 px-4 text-sm font-medium text-gray-800">{emp.name}</td>
                                            <td className="py-3 px-4 text-sm text-gray-600">
                                                <span className={`px-2 py-0.5 rounded text-xs ${emp.position === '專責人員' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>
                                                    {emp.position}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-center text-gray-600">{emp.scheduledShift || '-'}</td>
                                            <td className="py-3 px-4 text-sm text-center text-gray-600">{emp.clockInTime || '-'}</td>
                                            <td className="py-3 px-4 text-sm text-center text-gray-600">{emp.clockOutTime || '-'}</td>
                                            <td className="py-3 px-4 text-center">
                                                <AttendanceStatusBadge status={emp.status} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            今日休館，無排班人員
                        </div>
                    )}
                </div>

                {/* 待處理事項 */}
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <CheckSquareIcon className="w-5 h-5 text-yellow-500" />
                        待處理事項
                        {stats.pendingItems.length > 0 && (
                            <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                                {stats.pendingItems.length}
                            </span>
                        )}
                    </h2>
                    {stats.pendingItems.length > 0 ? (
                        <div className="space-y-3 max-h-80 overflow-y-auto">
                            {stats.pendingItems.map(item => (
                                <div
                                    key={item.id}
                                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                                >
                                    <PendingTypeIcon type={item.type} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <PriorityBadge priority={item.priority} />
                                            <span className="text-xs text-gray-400">{item.type}</span>
                                        </div>
                                        <p className="text-sm font-medium text-gray-800 truncate">{item.title}</p>
                                        <p className="text-xs text-gray-500">{item.description}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            目前沒有待處理事項
                        </div>
                    )}
                </div>
            </div>

            {/* 兼職時數進度 */}
            <div className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ClockIcon className="w-5 h-5 text-green-500" />
                    本月兼職時數進度
                    <span className="ml-2 text-sm font-normal text-gray-500">
                        （每人每月上限 80 小時）
                    </span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {partTimeHours.map(info => (
                        <HoursProgressBar key={info.empId} info={info} />
                    ))}
                </div>
                <div className="mt-4 flex items-center gap-6 text-xs text-gray-500">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-500 rounded" />
                        <span>已出勤</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-200 rounded" />
                        <span>已排班</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-red-500 rounded" />
                        <span>接近上限</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminOverview;
