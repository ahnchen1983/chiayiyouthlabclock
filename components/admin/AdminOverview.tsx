import { formatHours } from '../../utils/format';
import { taipeiDate } from '../../utils/attendance';

import React, { useState, useEffect } from 'react';
import { apiGetDashboardStats, apiGetAllPartTimeHours } from '../../services/googleAppsScriptAPI';
import { UsersIcon, ClockIcon, CheckSquareIcon, ListIcon, LeafIcon } from '../icons';
import { DashboardStats, TodayAttendanceComparison, PendingItem, PartTimeHourInfo } from '../../types';

const StatCard: React.FC<{
    icon: React.ReactNode;
    tone: 'mint' | 'sand' | 'lilac' | 'blue';
    title: string;
    value: React.ReactNode;
    foot: string;
}> = ({ icon, tone, title, value, foot }) => (
    <article className="yl-stat">
        <span className={`yl-stat-icon ${tone}`} aria-hidden="true">{icon}</span>
        <small>{title}</small>
        <strong>{value}</strong>
        <span className="yl-stat-foot">{foot}</span>
    </article>
);

const AttendanceStatusBadge: React.FC<{ status: TodayAttendanceComparison['status'] }> = ({ status }) => {
    const tone = status === '已到' || status === '休假'
        ? ''
        : status === '未排班'
            ? 'muted'
            : status === '遲到' || status === '早退'
                ? 'warn'
                : 'bad';
    return <span className={tone ? `yl-badge ${tone}` : 'yl-badge'}>{status}</span>;
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
    const iconMap: Record<PendingItem['type'], { tone: string; icon: React.ReactNode }> = {
        '請假審核': { tone: 'lilac', icon: <CheckSquareIcon /> },
        '時數警示': { tone: 'sand', icon: <ClockIcon /> },
        '缺勤異常': { tone: 'mint', icon: <UsersIcon /> },
    };
    const { tone, icon } = iconMap[type];
    return <span className={`yl-stat-icon ${tone}`} style={{ position: 'static', width: 32, height: 32 }}>{icon}</span>;
};

// 兼職時數進度條
const HoursProgressBar: React.FC<{ info: PartTimeHourInfo }> = ({ info }) => {
    const percentage = (info.scheduledHours / 80) * 100;
    const workedPercentage = (info.workedHours / 80) * 100;
    const isWarning = info.status === '接近上限';

    return (
        <div style={{ marginBottom: 14 }}>
            <div className="yl-section-top" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>{info.name}</strong>
                <span className="yl-stat-foot" style={{ border: 0, margin: 0, padding: 0 }}>
                    {formatHours(info.workedHours)} / {info.scheduledHours.toFixed(1)} 小時
                    {isWarning ? ' · 接近上限' : ''}
                </span>
            </div>
            <div className={isWarning ? 'yl-meter warn' : 'yl-meter'} aria-hidden="true">
                <span style={{ width: `${Math.min(percentage, 100)}%` }} />
                <span style={{ width: `${Math.min(workedPercentage, 100)}%` }} />
            </div>
            <div className="yl-stat-foot">剩餘可排 {info.remainingHours.toFixed(1)} 小時 · 上限 80 小時</div>
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
            const currentMonth = taipeiDate().slice(0, 7);
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
        return <div className="yl-card" style={{ textAlign: 'center', color: '#798781' }}>讀取工作台…</div>;
    }

    if (!stats) {
        return <div className="yl-card" style={{ textAlign: 'center', color: '#798781' }}>無法載入儀表板資訊。</div>;
    }

    const today = new Date();
    const formattedDate = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} (${['日', '一', '二', '三', '四', '五', '六'][today.getDay()]})`;

    // 過濾有排班的員工
    const scheduledEmployees = stats.todayAttendance.filter(e => e.status !== '未排班');

    const eyebrow = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(today).toUpperCase();

    return (
        <div className="yl-workbench">
            <div className="yl-page-heading">
                <div>
                    <div className="yl-eyebrow">{eyebrow}</div>
                    <h1>團隊的今天，從這裡看。</h1>
                    <p>數字來自目前的出勤與待辦。薪資仍只核對、不給付。{formattedDate}</p>
                </div>
            </div>
            <div className="yl-summary">
                <StatCard tone="blue" icon={<UsersIcon />} title="今日出勤" value={<><span>{stats.todayClockedIn}</span><em> / {stats.todayScheduled}</em></>} foot="已到 / 應到" />
                <StatCard tone="mint" icon={<ClockIcon />} title="本月總工時" value={<><span>{formatHours(stats.monthlyTotalHours)}</span><em> 小時</em></>} foot="實際彙總，不是試算薪資" />
                <StatCard tone="sand" icon={<CheckSquareIcon />} title="待審核請假" value={<><span>{stats.pendingLeaves}</span><em> 件</em></>} foot="尚未簽核" />
                <StatCard tone="lilac" icon={<ListIcon />} title="時數警示" value={<><span>{stats.hourWarnings}</span><em> 人</em></>} foot="接近每月上限" />
            </div>
            <section className="yl-welcome">
                <div>
                    <div className="yl-eyebrow">TODAY ON THE FLOOR</div>
                    <h2>先看誰在，再處理待辦。</h2>
                    <p>下方是今日排班與實際打卡。沒有排班的人不算進應到。</p>
                </div>
                <div className="yl-welcome-mark" aria-hidden="true"><LeafIcon /></div>
            </section>
            <div className="yl-split">
                <section className="yl-card">
                    <div className="yl-section-top"><h2>今日排班與出勤</h2></div>
                    {scheduledEmployees.length > 0 ? (
                        <div className="yl-table-wrap">
                            <table className="yl-table">
                                <thead>
                                    <tr>
                                        <th>員工</th>
                                        <th>職位</th>
                                        <th>排班</th>
                                        <th>上班</th>
                                        <th>下班</th>
                                        <th>狀態</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scheduledEmployees.map(emp => (
                                        <tr key={emp.empId}>
                                            <td>{emp.name}</td>
                                            <td><span className="yl-badge neutral">{emp.position}</span></td>
                                            <td>{emp.scheduledShift || '—'}</td>
                                            <td>{emp.clockInTime || '—'}</td>
                                            <td>{emp.clockOutTime || '—'}</td>
                                            <td><AttendanceStatusBadge status={emp.status} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p style={{ color: '#798781' }}>今日休館，無排班人員</p>
                    )}
                </section>
                <section className="yl-card">
                    <div className="yl-section-top">
                        <h2>待處理</h2>
                        {stats.pendingItems.length > 0 && <span className="yl-badge bad">{stats.pendingItems.length}</span>}
                    </div>
                    {stats.pendingItems.length > 0 ? stats.pendingItems.map(item => (
                        <div className="yl-request" key={item.id}>
                            <PendingTypeIcon type={item.type} />
                            <div>
                                <strong>{item.title}</strong>
                                <p>{item.type} · {item.description}</p>
                            </div>
                            <PriorityBadge priority={item.priority} />
                        </div>
                    )) : <p style={{ color: '#798781' }}>目前沒有待處理事項</p>}
                </section>
            </div>
            <section className="yl-card">
                <div className="yl-section-top">
                    <h2>本月兼職時數</h2>
                    <span className="yl-stat-foot" style={{ border: 0, margin: 0, padding: 0 }}>每人每月上限 80 小時</span>
                </div>
                <div className="yl-summary">
                    {partTimeHours.map(info => (
                        <HoursProgressBar key={info.empId} info={info} />
                    ))}
                </div>
            </section>
        </div>
    );
};

export default AdminOverview;
