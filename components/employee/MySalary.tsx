
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiGetEmployeeSalary } from '../../services/googleAppsScriptAPI';
import { SalaryDetail } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
};

const MySalary: React.FC = () => {
    const { user } = useAuth();
    const [salary, setSalary] = useState<SalaryDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

    useEffect(() => {
        const fetchSalary = async () => {
            if (user) {
                setLoading(true);
                const data = await apiGetEmployeeSalary(user.id, month);
                setSalary(data);
                setLoading(false);
            }
        };
        fetchSalary();
    }, [user, month]);

    const handlePrevMonth = () => {
        const [y, m] = month.split('-').map(Number);
        const d = new Date(y, m - 2, 1);
        setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    };

    const handleNextMonth = () => {
        const [y, m] = month.split('-').map(Number);
        const d = new Date(y, m, 1);
        setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <div className="w-10 h-10 border-4 border-brand-green-dark border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto">
            {/* 月份切換 */}
            <div className="flex items-center justify-between mb-6">
                <button onClick={handlePrevMonth} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
                    <ChevronLeftIcon className="w-6 h-6 text-gray-600" />
                </button>
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-800">薪資明細</h2>
                    <p className="text-gray-500 mt-1">{month.replace('-', ' 年 ')} 月</p>
                </div>
                <button onClick={handleNextMonth} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
                    <ChevronRightIcon className="w-6 h-6 text-gray-600" />
                </button>
            </div>

            {!salary ? (
                <div className="text-center py-20 text-gray-500 bg-white rounded-2xl shadow">
                    <p className="text-xl">📄</p>
                    <p className="mt-2">本月尚無薪資資料</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* 實發薪資大卡 */}
                    <div className="bg-gradient-to-br from-green-600 to-emerald-500 rounded-2xl p-6 text-white shadow-lg">
                        <p className="text-sm opacity-80">實發薪資</p>
                        <p className="text-4xl font-bold mt-2">{formatCurrency(salary.netSalary)}</p>
                        <div className="flex justify-between mt-4 text-sm opacity-80">
                            <span>應發 {formatCurrency(salary.grossSalary)}</span>
                            <span>扣除 -{formatCurrency(salary.totalDeductions)}</span>
                        </div>
                    </div>

                    {/* 出勤統計 */}
                    <div className="bg-white rounded-2xl shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-500 mb-4">📊 出勤統計</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-blue-50 rounded-xl p-3 text-center">
                                <p className="text-2xl font-bold text-blue-700">{salary.totalWorkDays}</p>
                                <p className="text-xs text-gray-500 mt-1">出勤天數</p>
                            </div>
                            <div className="bg-blue-50 rounded-xl p-3 text-center">
                                <p className="text-2xl font-bold text-blue-700">{salary.totalWorkHours}</p>
                                <p className="text-xs text-gray-500 mt-1">總工時 (小時)</p>
                            </div>
                            <div className="bg-orange-50 rounded-xl p-3 text-center">
                                <p className="text-2xl font-bold text-orange-600">{salary.totalLeaveHours}</p>
                                <p className="text-xs text-gray-500 mt-1">請假時數</p>
                            </div>
                            <div className="bg-purple-50 rounded-xl p-3 text-center">
                                <p className="text-2xl font-bold text-purple-600">{salary.overtimeHours}</p>
                                <p className="text-xs text-gray-500 mt-1">加班時數</p>
                            </div>
                        </div>
                        {salary.leaveDetails.length > 0 && (
                            <div className="mt-3 border-t pt-3">
                                <p className="text-xs text-gray-500 mb-2">請假明細：</p>
                                <div className="flex flex-wrap gap-1">
                                    {salary.leaveDetails.map((ld, i) => (
                                        <span key={i} className="inline-block bg-orange-50 text-orange-700 rounded-full px-3 py-1 text-xs font-medium">
                                            {ld.type} {ld.hours}h
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 薪資項目 */}
                    <div className="bg-white rounded-2xl shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-500 mb-4">💰 薪資項目</h3>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-gray-700">{salary.position === '專責人員' ? '月薪' : '時薪計算'}</p>
                                    {salary.position === '兼職人員' && (
                                        <p className="text-xs text-gray-400">{salary.totalWorkHours - salary.overtimeHours}h × 時薪</p>
                                    )}
                                </div>
                                <span className="font-semibold text-gray-800">{formatCurrency(salary.baseSalary)}</span>
                            </div>
                            {salary.overtimePay > 0 && (
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="text-gray-700">加班費</p>
                                        <p className="text-xs text-gray-400">{salary.overtimeHours}h × 1.34 倍</p>
                                    </div>
                                    <span className="font-semibold text-gray-800">+{formatCurrency(salary.overtimePay)}</span>
                                </div>
                            )}
                            <div className="border-t pt-3 flex justify-between items-center">
                                <span className="font-bold text-green-700">應發薪資</span>
                                <span className="font-bold text-green-700 text-lg">{formatCurrency(salary.grossSalary)}</span>
                            </div>
                        </div>
                    </div>

                    {/* 扣除項目 */}
                    <div className="bg-white rounded-2xl shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-500 mb-4">📋 法定扣除項目</h3>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-gray-700">勞保自付額</p>
                                    <p className="text-xs text-gray-400">費率 2.3%（含就業保險）</p>
                                </div>
                                <span className="font-semibold text-red-600">-{formatCurrency(salary.laborInsurance)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-gray-700">健保自付額</p>
                                    <p className="text-xs text-gray-400">費率 2.11%</p>
                                </div>
                                <span className="font-semibold text-red-600">-{formatCurrency(salary.healthInsurance)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-gray-700">勞退自提</p>
                                    <p className="text-xs text-gray-400">自願提繳 6%</p>
                                </div>
                                <span className="font-semibold text-red-600">-{formatCurrency(salary.laborPensionSelf)}</span>
                            </div>
                            {salary.leaveDeduction > 0 && (
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="text-gray-700">請假扣薪</p>
                                        <p className="text-xs text-gray-400">事假全扣 / 病假半扣</p>
                                    </div>
                                    <span className="font-semibold text-red-600">-{formatCurrency(salary.leaveDeduction)}</span>
                                </div>
                            )}
                            <div className="border-t pt-3 flex justify-between items-center">
                                <span className="font-bold text-red-700">扣除合計</span>
                                <span className="font-bold text-red-700 text-lg">-{formatCurrency(salary.totalDeductions)}</span>
                            </div>
                        </div>
                    </div>

                    {/* 法規說明 */}
                    <div className="bg-gray-50 rounded-2xl p-4 text-xs text-gray-500">
                        <p className="font-semibold mb-2">⚖️ 依據台灣勞動基準法：</p>
                        <ul className="list-disc list-inside space-y-1">
                            <li>勞保費率約 11.5%，勞工自付 20%（約 2.3%）</li>
                            <li>健保費率約 5.17%，被保險人自付 30%（約 2.11%）</li>
                            <li>勞退自提 0~6%，此處以 6% 計算</li>
                            <li>加班費: 前 2 小時 × 1.34 倍，第 3 小時起 × 1.67 倍</li>
                            <li>事假不給薪、病假半薪、特休照給薪</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MySalary;
