import React, { useEffect, useState } from 'react';
import { apiGetMonthlyReport } from '../../services/googleAppsScriptAPI';
import { LeaveType, MonthlyReportData } from '../../types';
import { CalendarIcon, ListIcon } from '../icons';

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

const round1 = (value: number): number => Math.round(value * 10) / 10;

const exportReportCSV = (report: MonthlyReportData) => {
    const locked = report.lock && !report.lock.unlockedAt
        ? `已鎖定（${report.lock.lockedByName} ${report.lock.lockedAt.slice(0, 10)}）`
        : report.lock?.unlockedAt
            ? `曾解鎖（${report.lock.unlockedByName || ''}）`
            : '未鎖定';
    const lines: string[] = [];
    lines.push(`"# 月結報表 ${report.yearMonth}"`);
    lines.push(`"# 匯出時間: ${new Date().toLocaleString('zh-TW')}"`);
    lines.push(`"# 鎖定狀態: ${locked}"`);
    lines.push('');
    lines.push('"== 摘要 =="');
    lines.push(`"員工數","${report.summary.totalEmployees}"`);
    lines.push(`"總工作天數","${report.summary.totalWorkDays}"`);
    lines.push(`"總工時","${report.summary.totalWorkHours}"`);
    lines.push(`"加班總時數","${report.summary.totalOvertimeHours}"`);
    lines.push(`"請假總時數","${report.summary.totalLeaveHours}"`);
    lines.push(`"平均工時/人","${report.summary.avgWorkHoursPerEmployee}"`);
    lines.push('');
    lines.push('"== 請假分布 =="');
    (Object.keys(report.leaveDistribution) as LeaveType[]).forEach(k => {
        lines.push(`"${k}","${report.leaveDistribution[k]}"`);
    });
    lines.push('');
    lines.push('"== 打卡異常 =="');
    lines.push(`"遲到","${report.clockAnomalies.lateCount}"`);
    lines.push(`"早退","${report.clockAnomalies.earlyLeaveCount}"`);
    lines.push(`"漏打卡","${report.clockAnomalies.missingClockOutCount}"`);
    lines.push(`"手動編輯","${report.clockAnomalies.manuallyEditedCount}"`);
    lines.push(`"補打卡","${report.clockAnomalies.makeupCount}"`);
    lines.push('');
    lines.push('"== PT 時數狀況 =="');
    lines.push('"員工編號","姓名","月時數","上限","使用率","狀態"');
    report.partTimeStatus.forEach(pt => {
        lines.push(`"${pt.empId}","${pt.name}","${pt.monthHours}","${pt.limit}","${pt.usagePercent}%","${pt.overLimit ? '超限' : '正常'}"`);
    });
    lines.push('');
    lines.push('"== 員工工時排名 =="');
    lines.push('"排名","員工編號","姓名","總工時","加班時數","工作天數"');
    report.employeeRanking.forEach((e, i) => {
        lines.push(`"${i + 1}","${e.empId}","${e.name}","${e.totalHours}","${e.overtimeHours}","${e.workDays}"`);
    });

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `月結報表_${report.yearMonth}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const StatCard: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
    <div className={`p-4 rounded-xl border ${tone}`}>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-bold mt-1 text-gray-800">{value}</p>
    </div>
);

const LeaveBar: React.FC<{ label: string; hours: number; max: number; color: string }> = ({ label, hours, max, color }) => {
    const widthPct = max > 0 ? Math.min((hours / max) * 100, 100) : 0;
    return (
        <div>
            <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">{label}</span>
                <span className="text-gray-500">{hours} 小時</span>
            </div>
            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${widthPct}%` }} />
            </div>
        </div>
    );
};

const MonthlyReport: React.FC = () => {
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [report, setReport] = useState<MonthlyReportData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchReport = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await apiGetMonthlyReport(month);
                setReport(data);
            } catch (e: any) {
                setError(e?.message || '月結報表讀取失敗');
                setReport(null);
            } finally {
                setLoading(false);
            }
        };
        fetchReport();
    }, [month]);

    const isLocked = !!report?.lock && !report.lock.unlockedAt;
    const maxLeave = report ? Math.max(...(Object.values(report.leaveDistribution) as number[]), 0) : 0;

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <ListIcon className="w-7 h-7 text-blue-500" />
                    月結報表
                </h1>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2">
                        <CalendarIcon className="w-5 h-5 text-gray-400" />
                        <input
                            type="month"
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                            className="p-2 border rounded-md"
                        />
                    </div>
                    {isLocked && (
                        <span className="flex items-center gap-1 px-3 py-2 bg-amber-100 text-amber-800 rounded-md text-sm font-medium">
                            🔒 已鎖定（{report!.lock!.lockedByName} ‧ {report!.lock!.lockedAt.slice(0, 10)}）
                        </span>
                    )}
                    {!isLocked && report?.lock?.unlockedAt && (
                        <span className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-600 rounded-md text-sm">
                            🔓 曾解鎖（{report.lock.unlockedByName}）
                        </span>
                    )}
                    <button
                        onClick={() => {
                            if (!report) {
                                alert('沒有可匯出的月結報表');
                                return;
                            }
                            exportReportCSV(report);
                        }}
                        disabled={!report || loading}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        匯出 CSV
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="py-20 flex justify-center">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : report ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                        <StatCard label="員工數" value={`${report.summary.totalEmployees}`} tone="bg-blue-50 border-blue-100" />
                        <StatCard label="工作天" value={`${report.summary.totalWorkDays}`} tone="bg-emerald-50 border-emerald-100" />
                        <StatCard label="總工時" value={`${report.summary.totalWorkHours}h`} tone="bg-indigo-50 border-indigo-100" />
                        <StatCard label="加班" value={`${report.summary.totalOvertimeHours}h`} tone="bg-purple-50 border-purple-100" />
                        <StatCard label="請假" value={`${report.summary.totalLeaveHours}h`} tone="bg-orange-50 border-orange-100" />
                        <StatCard label="平均工時" value={`${report.summary.avgWorkHoursPerEmployee}h`} tone="bg-slate-50 border-slate-100" />
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <section className="border border-gray-100 rounded-xl p-5">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4">請假分布</h2>
                            <div className="space-y-4">
                                <LeaveBar label="特休" hours={report.leaveDistribution[LeaveType.Annual]} max={maxLeave} color="bg-blue-500" />
                                <LeaveBar label="病假" hours={report.leaveDistribution[LeaveType.Sick]} max={maxLeave} color="bg-amber-500" />
                                <LeaveBar label="事假" hours={report.leaveDistribution[LeaveType.Personal]} max={maxLeave} color="bg-rose-500" />
                                <LeaveBar label="其他" hours={report.leaveDistribution[LeaveType.Other]} max={maxLeave} color="bg-gray-500" />
                            </div>
                        </section>

                        <section className="border border-gray-100 rounded-xl p-5">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4">打卡異常</h2>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <StatCard label="遲到" value={`${report.clockAnomalies.lateCount}`} tone="bg-red-50 border-red-100" />
                                <StatCard label="早退" value={`${report.clockAnomalies.earlyLeaveCount}`} tone="bg-orange-50 border-orange-100" />
                                <StatCard label="漏打卡" value={`${report.clockAnomalies.missingClockOutCount}`} tone="bg-yellow-50 border-yellow-100" />
                                <StatCard label="手動編輯" value={`${report.clockAnomalies.manuallyEditedCount}`} tone="bg-violet-50 border-violet-100" />
                                <StatCard label="補打卡" value={`${report.clockAnomalies.makeupCount}`} tone="bg-cyan-50 border-cyan-100" />
                            </div>
                        </section>
                    </div>

                    <section className="border border-gray-100 rounded-xl p-5 overflow-x-auto">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">PT 時數狀況</h2>
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">姓名</th>
                                    <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">月時數</th>
                                    <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">上限</th>
                                    <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">使用率</th>
                                    <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">警示</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.partTimeStatus.length > 0 ? report.partTimeStatus.map(pt => (
                                    <tr key={pt.empId} className="hover:bg-gray-50">
                                        <td className="py-3 px-4 border-b">
                                            <p className="text-sm font-medium text-gray-800">{pt.name}</p>
                                            <p className="text-xs text-gray-400">{pt.empId}</p>
                                        </td>
                                        <td className="py-3 px-4 border-b text-right text-sm text-gray-700">{pt.monthHours}h</td>
                                        <td className="py-3 px-4 border-b text-right text-sm text-gray-700">{pt.limit}h</td>
                                        <td className="py-3 px-4 border-b min-w-48">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full ${pt.overLimit ? 'bg-red-500' : pt.usagePercent >= 80 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                                        style={{ width: `${Math.min(pt.usagePercent, 100)}%` }}
                                                    />
                                                </div>
                                                <span className={`text-xs w-12 text-right ${pt.overLimit ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                                                    {round1(pt.usagePercent)}%
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 border-b text-center">
                                            {pt.overLimit && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">超限</span>}
                                            {!pt.overLimit && pt.usagePercent >= 80 && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">接近上限</span>}
                                            {!pt.overLimit && pt.usagePercent < 80 && <span className="text-xs text-gray-400">正常</span>}
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={5} className="text-center py-8 text-gray-500">本月無兼職人員時數資料</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </section>

                    <section className="border border-gray-100 rounded-xl p-5 overflow-x-auto">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">員工工時排名</h2>
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">排名</th>
                                    <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">員工</th>
                                    <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">工時</th>
                                    <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">加班</th>
                                    <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">工作天</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.employeeRanking.length > 0 ? report.employeeRanking.map((employee, index) => (
                                    <tr key={employee.empId} className="hover:bg-gray-50">
                                        <td className="py-3 px-4 border-b text-center text-sm font-bold text-gray-700">{index + 1}</td>
                                        <td className="py-3 px-4 border-b">
                                            <p className="text-sm font-medium text-gray-800">{employee.name}</p>
                                            <p className="text-xs text-gray-400">{employee.empId}</p>
                                        </td>
                                        <td className="py-3 px-4 border-b text-right text-sm text-gray-700">{employee.totalHours}h</td>
                                        <td className="py-3 px-4 border-b text-right text-sm text-purple-600">{employee.overtimeHours}h</td>
                                        <td className="py-3 px-4 border-b text-right text-sm text-gray-700">{employee.workDays}</td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={5} className="text-center py-8 text-gray-500">本月無工時資料</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </section>
                </div>
            ) : (
                <div className="py-20 text-center text-gray-500">本月無報表資料</div>
            )}
        </div>
    );
};

export default MonthlyReport;
