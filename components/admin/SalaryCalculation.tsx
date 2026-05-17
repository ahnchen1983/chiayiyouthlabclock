
import React, { useState, useEffect } from 'react';
import {
    apiGetAllSalaryDetails,
    apiGetMonthLock, apiLockMonth, apiUnlockMonth,
} from '../../services/googleAppsScriptAPI';
import { openPayslipPrintView } from '../../services/payslipPrint';
import { SalaryDetail, MonthLock, UserRole } from '../../types';
import { DollarIcon, ChevronRightIcon } from '../icons';
import { maskName, maskEmpId } from '../../netlify/functions/utils/csvMasking';
import { useAuth } from '../../contexts/AuthContext';

// 下載 icon
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
};

// 展開的薪資明細 Modal
const SalaryDetailModal: React.FC<{ salary: SalaryDetail; onClose: () => void }> = ({ salary, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                {/* 標題 */}
                <div className="bg-gradient-to-r from-green-600 to-emerald-500 text-white p-6 rounded-t-2xl">
                    <h3 className="text-xl font-bold">{salary.name} 的薪資明細</h3>
                    <p className="text-green-100 text-sm mt-1">{salary.yearMonth} | {salary.position}</p>
                </div>

                <div className="p-6 space-y-6">
                    {/* 出勤統計 */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">📊 出勤統計</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-blue-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">出勤天數</p>
                                <p className="text-lg font-bold text-blue-700">{salary.totalWorkDays} 天</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">總工時</p>
                                <p className="text-lg font-bold text-blue-700">{salary.totalWorkHours} 小時</p>
                            </div>
                            <div className="bg-orange-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">請假時數</p>
                                <p className="text-lg font-bold text-orange-600">{salary.totalLeaveHours} 小時</p>
                            </div>
                            <div className="bg-purple-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">加班時數</p>
                                <p className="text-lg font-bold text-purple-600">{salary.overtimeHours} 小時</p>
                            </div>
                        </div>
                        {salary.leaveDetails.length > 0 && (
                            <div className="mt-2 text-xs text-gray-500">
                                請假明細：{salary.leaveDetails.map((ld, i) => (
                                    <span key={i} className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 mt-1">
                                        {ld.type} {ld.hours}h
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 薪資項目 */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">💰 薪資項目</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between py-2 border-b border-gray-100">
                                <span className="text-gray-600">{salary.position === '專責人員' ? '月薪' : `時薪計算 (${salary.totalWorkHours - salary.overtimeHours}h)`}</span>
                                <span className="font-semibold text-gray-800">{formatCurrency(salary.baseSalary)}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b border-gray-100">
                                <span className="text-gray-600">加班費 ({salary.overtimeHours}h × 1.34倍)</span>
                                <span className="font-semibold text-gray-800">{formatCurrency(salary.overtimePay)}</span>
                            </div>
                            <div className="flex justify-between py-2 bg-green-50 rounded px-2">
                                <span className="font-bold text-green-700">應發薪資</span>
                                <span className="font-bold text-green-700">{formatCurrency(salary.grossSalary)}</span>
                            </div>
                        </div>
                    </div>

                    {/* 扣除項目 */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">📋 法定扣除項目</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between py-2 border-b border-gray-100">
                                <span className="text-gray-600">勞保自付額 (2.3%)</span>
                                <span className="font-semibold text-red-600">-{formatCurrency(salary.laborInsurance)}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b border-gray-100">
                                <span className="text-gray-600">健保自付額 (2.11%)</span>
                                <span className="font-semibold text-red-600">-{formatCurrency(salary.healthInsurance)}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b border-gray-100">
                                <span className="text-gray-600">勞退自提 (6%)</span>
                                <span className="font-semibold text-red-600">-{formatCurrency(salary.laborPensionSelf)}</span>
                            </div>
                            {salary.leaveDeduction > 0 && (
                                <div className="flex justify-between py-2 border-b border-gray-100">
                                    <span className="text-gray-600">請假扣薪</span>
                                    <span className="font-semibold text-red-600">-{formatCurrency(salary.leaveDeduction)}</span>
                                </div>
                            )}
                            <div className="flex justify-between py-2 bg-red-50 rounded px-2">
                                <span className="font-bold text-red-700">扣除合計</span>
                                <span className="font-bold text-red-700">-{formatCurrency(salary.totalDeductions)}</span>
                            </div>
                        </div>
                    </div>

                    {/* 實發薪資 */}
                    <div className="bg-gradient-to-r from-emerald-500 to-green-600 rounded-xl p-4 text-white text-center">
                        <p className="text-sm opacity-80">實發薪資</p>
                        <p className="text-3xl font-bold mt-1">{formatCurrency(salary.netSalary)}</p>
                    </div>

                    {/* 法規說明 */}
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
                        <p className="font-semibold mb-1">⚖️ 依據台灣勞基法規定：</p>
                        <ul className="list-disc list-inside space-y-0.5">
                            <li>勞保費率: 員工自付 20%（費率約 11.5%，自付比例約 2.3%）</li>
                            <li>健保費率: 員工自付 30%（費率約 5.17%，自付比例約 2.11%）</li>
                            <li>勞退自提: 依勞工退休金條例，員工可自願提繳 0~6%</li>
                            <li>加班費: 前 2 小時按 1.34 倍、第 3 小時起按 1.67 倍計算</li>
                            <li>事假扣全薪、病假扣半薪、特休不扣薪</li>
                        </ul>
                    </div>
                </div>

                <div className="p-4 border-t flex gap-2">
                    <button
                        onClick={() => openPayslipPrintView(salary)}
                        className="flex-1 py-3 bg-brand-green-dark hover:bg-brand-green-light text-white rounded-lg font-semibold transition-colors"
                    >
                        📄 下載薪資條
                    </button>
                    <button onClick={onClose} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 font-semibold transition-colors">
                        關閉
                    </button>
                </div>
            </div>
        </div>
    );
};

// 匯出 CSV（Phase 7.7：加入 masked 參數、CSV 警語；薪資數字「不」脫敏，因會計月結用）
const exportSalaryCSV = (salaries: SalaryDetail[], month: string, masked: boolean) => {
    const headers = ['員工編號', '姓名', '職位', '出勤天數', '總工時', '請假時數', '加班時數', '底薪', '加班費', '應發薪資', '勞保', '健保', '勞退', '請假扣薪', '扣除合計', '實發薪資'];
    const csvContent = [
        headers.join(','),
        ...salaries.map(s => [
            masked ? maskEmpId(s.empId) : s.empId,
            masked ? maskName(s.name) : s.name,
            s.position, s.totalWorkDays, s.totalWorkHours, s.totalLeaveHours, s.overtimeHours,
            s.baseSalary, s.overtimePay, s.grossSalary, s.laborInsurance, s.healthInsurance, s.laborPensionSelf,
            s.leaveDeduction, s.totalDeductions, s.netSalary
        ].map(f => `"${f}"`).join(',')),
        // 警語列（CSV 末尾）
        '',
        `"# 匯出時間: ${new Date().toLocaleString('zh-TW')}"`,
        `"# 模式: ${masked ? '脫敏匯出（員工編號、姓名遮罩；薪資數字保留）' : '完整匯出（含個資）'}"`,
        '"# 薪資為極敏感資料，請依個資法妥善處理；不得另行傳遞至非經授權之第三方。"',
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `薪資明細_${month}${masked ? '_脫敏' : ''}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};


const SalaryCalculation: React.FC = () => {
    const { user } = useAuth();
    const isSuperAdmin = user?.role === UserRole.SuperAdmin;

    const [salaries, setSalaries] = useState<SalaryDetail[]>([]);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [selectedSalary, setSelectedSalary] = useState<SalaryDetail | null>(null);
    const [monthLock, setMonthLock] = useState<MonthLock | null>(null);
    const [lockBusy, setLockBusy] = useState(false);
    const isLocked = !!monthLock && !monthLock.unlockedAt;

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const [data, lock] = await Promise.all([
                apiGetAllSalaryDetails(month),
                apiGetMonthLock(month).catch(() => null),
            ]);
            setSalaries(data);
            setMonthLock(lock);
            setLoading(false);
        };
        fetchData();
    }, [month]);

    const handleLock = async () => {
        const totalGrossNow = salaries.reduce((s, x) => s + x.grossSalary, 0);
        const confirmed = window.confirm(
            `確定要結算並鎖定 ${month}?\n\n` +
            `員工數: ${salaries.length}\n應發總額: ${formatCurrency(totalGrossNow)}\n\n` +
            `鎖定後，本月排班、打卡編輯、請假審核、補打卡審核都會被擋下。\n` +
            `如需修改需 SuperAdmin 手動解鎖（會留稽核紀錄）。`
        );
        if (!confirmed) return;
        setLockBusy(true);
        try {
            const lock = await apiLockMonth(month);
            setMonthLock(lock);
            alert(`已鎖定 ${month}`);
        } catch (e: any) {
            alert(`鎖定失敗：${e?.message || e}`);
        } finally {
            setLockBusy(false);
        }
    };

    const handleUnlock = async () => {
        const reason = window.prompt(
            `確定要解鎖 ${month}?\n\n解鎖會留下稽核紀錄。請填寫解鎖理由（至少 5 字）：`
        );
        if (reason === null) return;
        if (reason.trim().length < 5) {
            alert('理由至少 5 字');
            return;
        }
        setLockBusy(true);
        try {
            await apiUnlockMonth(month, reason.trim());
            const fresh = await apiGetMonthLock(month);
            setMonthLock(fresh);
            alert(`已解鎖 ${month}`);
        } catch (e: any) {
            alert(`解鎖失敗：${e?.message || e}`);
        } finally {
            setLockBusy(false);
        }
    };

    const totalGross = salaries.reduce((sum, s) => sum + s.grossSalary, 0);
    const totalNet = salaries.reduce((sum, s) => sum + s.netSalary, 0);
    const totalDeductions = salaries.reduce((sum, s) => sum + s.totalDeductions, 0);
    const totalWorkHours = salaries.reduce((sum, s) => sum + s.totalWorkHours, 0);

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            {/* 標題 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <DollarIcon className="w-7 h-7 text-green-500" />
                    薪資計算
                </h1>
                <div className="flex items-center gap-3">
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="p-2 border rounded-md"
                    />
                    <button
                        onClick={() => {
                            if (salaries.length === 0) {
                                alert('沒有可匯出的薪資資料');
                                return;
                            }
                            exportSalaryCSV(salaries, month, true);
                        }}
                        title="員工編號、姓名遮罩；薪資數字保留供會計使用"
                        className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        脫敏匯出 CSV
                    </button>
                    <button
                        onClick={() => {
                            if (salaries.length === 0) {
                                alert('沒有可匯出的薪資資料');
                                return;
                            }
                            const confirmed = window.confirm(
                                '即將匯出「完整」薪資 CSV，含未遮罩的員工姓名與編號，且薪資為極敏感資料。\n\n' +
                                '請確認檔案會妥善保管，並僅供授權人員使用。\n\n要繼續匯出嗎？'
                            );
                            if (!confirmed) return;
                            exportSalaryCSV(salaries, month, false);
                        }}
                        title="含未遮罩個資，需二次確認"
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        完整匯出（含個資）
                    </button>

                    {/* Phase 6.3：月結鎖定狀態與操作 */}
                    {isLocked && (
                        <span className="flex items-center gap-1 px-3 py-2 bg-amber-100 text-amber-800 rounded-md text-sm font-medium">
                            🔒 已鎖定（{monthLock!.lockedByName} ‧ {monthLock!.lockedAt.slice(0, 10)}）
                        </span>
                    )}
                    {!isLocked && monthLock?.unlockedAt && (
                        <span className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-600 rounded-md text-sm">
                            🔓 曾解鎖（{monthLock.unlockedByName}）
                        </span>
                    )}
                    {isSuperAdmin && !isLocked && salaries.length > 0 && (
                        <button
                            onClick={handleLock}
                            disabled={lockBusy}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                            🔐 結算並鎖定
                        </button>
                    )}
                    {isSuperAdmin && isLocked && (
                        <button
                            onClick={handleUnlock}
                            disabled={lockBusy}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
                        >
                            🔓 解鎖
                        </button>
                    )}
                </div>
            </div>

            {/* 統計卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-xl border border-green-100">
                    <p className="text-sm text-gray-500">應發總額</p>
                    <p className="text-xl font-bold text-green-700">{formatCurrency(totalGross)}</p>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-100">
                    <p className="text-sm text-gray-500">實發總額</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(totalNet)}</p>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-pink-50 p-4 rounded-xl border border-red-100">
                    <p className="text-sm text-gray-500">扣除總額</p>
                    <p className="text-xl font-bold text-red-600">{formatCurrency(totalDeductions)}</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 p-4 rounded-xl border border-purple-100">
                    <p className="text-sm text-gray-500">總工時</p>
                    <p className="text-xl font-bold text-purple-700">{totalWorkHours.toFixed(1)} 小時</p>
                </div>
            </div>

            {/* 薪資表格 */}
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">員工</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">職位</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">出勤天數</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">總工時</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">請假時數</th>
                            <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">應發薪資</th>
                            <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">扣除合計</th>
                            <th className="py-3 px-4 border-b text-right text-sm font-semibold text-gray-600">實發薪資</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">明細</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={9} className="text-center py-10">
                                    <div className="flex justify-center">
                                        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                </td>
                            </tr>
                        ) : salaries.length > 0 ? (
                            salaries.map(salary => (
                                <tr key={salary.empId} className="hover:bg-gray-50 transition-colors">
                                    <td className="py-3 px-4 border-b">
                                        <p className="text-sm font-medium text-gray-800">{salary.name}</p>
                                        <p className="text-xs text-gray-400">{salary.empId}</p>
                                    </td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${salary.position === '專責人員' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                                            }`}>
                                            {salary.position}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 border-b text-center text-sm text-gray-600">{salary.totalWorkDays}</td>
                                    <td className="py-3 px-4 border-b text-center text-sm text-gray-600">{salary.totalWorkHours}h</td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <span className={`text-sm ${salary.totalLeaveHours > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                                            {salary.totalLeaveHours}h
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 border-b text-right text-sm font-medium text-gray-800">{formatCurrency(salary.grossSalary)}</td>
                                    <td className="py-3 px-4 border-b text-right text-sm text-red-600">-{formatCurrency(salary.totalDeductions)}</td>
                                    <td className="py-3 px-4 border-b text-right text-sm font-bold text-green-700">{formatCurrency(salary.netSalary)}</td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <button
                                            onClick={() => setSelectedSalary(salary)}
                                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                            title="查看明細"
                                        >
                                            <ChevronRightIcon className="w-5 h-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={9} className="text-center py-10 text-gray-500">
                                    本月無薪資資料
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 底部統計 */}
            <div className="mt-4 flex justify-between items-center text-sm text-gray-500">
                <span>共 {salaries.length} 位員工</span>
                <span>{month} 薪資總支出: {formatCurrency(totalGross)}</span>
            </div>

            {/* Modal */}
            {selectedSalary && (
                <SalaryDetailModal salary={selectedSalary} onClose={() => setSelectedSalary(null)} />
            )}
        </div>
    );
};

export default SalaryCalculation;
