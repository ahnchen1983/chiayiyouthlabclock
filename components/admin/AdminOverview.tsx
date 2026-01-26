
import React, { useState, useEffect } from 'react';
import { apiGetDashboardStats } from '../../services/googleAppsScriptAPI';
import { UsersIcon, ClockIcon, CheckSquareIcon, ListIcon } from '../icons';
import PartTimeMonitor from './PartTimeMonitor';

interface DashboardStats {
    todayClockedIn: number;
    monthlyTotalHours: number;
    pendingLeaves: number;
    hourWarnings: number;
}

const StatCard: React.FC<{ icon: React.ReactNode; title: string; value: string | number; color: string; }> = ({ icon, title, value, color }) => (
    <div className="bg-white p-6 rounded-lg shadow-md flex items-center space-x-4">
        <div className={`p-3 rounded-full ${color}`}>
            {icon}
        </div>
        <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className="text-2xl font-bold text-gray-800">{value}</p>
        </div>
    </div>
);


const AdminOverview: React.FC = () => {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            const data = await apiGetDashboardStats();
            setStats(data);
            setLoading(false);
        };
        fetchStats();
    }, []);

    if (loading) {
        return <div className="flex justify-center items-center h-full"><div className="w-12 h-12 border-4 border-brand-blue-dark border-t-transparent rounded-full animate-spin"></div></div>;
    }

    if (!stats) {
        return <div className="text-center text-gray-600">無法載入儀表板資訊。</div>;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-800">總覽儀表板</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard icon={<UsersIcon className="w-6 h-6 text-white"/>} title="今日已打卡人數" value={stats.todayClockedIn} color="bg-blue-500" />
                <StatCard icon={<ClockIcon className="w-6 h-6 text-white"/>} title="本月總工時" value={`${stats.monthlyTotalHours.toFixed(1)} 小時`} color="bg-green-500" />
                <StatCard icon={<CheckSquareIcon className="w-6 h-6 text-white"/>} title="待審核請假" value={stats.pendingLeaves} color="bg-yellow-500" />
                <StatCard icon={<ListIcon className="w-6 h-6 text-white"/>} title="時數警示人數" value={stats.hourWarnings} color="bg-red-500" />
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-bold text-gray-800 mb-4">兼職時數監控</h2>
                <PartTimeMonitor />
            </div>
        </div>
    );
};

export default AdminOverview;
