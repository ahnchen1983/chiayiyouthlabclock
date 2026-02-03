
import React, { useState, useEffect } from 'react';
import { apiGetAllClockRecords, apiGetAllEmployees } from '../../services/googleAppsScriptAPI';
import { ClockRecord, User } from '../../types';
import { ClockIcon } from '../icons';

// 下載 icon
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

// 狀態標籤
const StatusBadge: React.FC<{ status: '正常' | '遲到' | '早退' }> = ({ status }) => {
    const colorMap: Record<string, string> = {
        '正常': 'bg-green-100 text-green-800',
        '遲到': 'bg-yellow-100 text-yellow-800',
        '早退': 'bg-orange-100 text-orange-800',
    };
    return (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorMap[status]}`}>
            {status}
        </span>
    );
};

// 驗證方式標籤
const VerificationBadge: React.FC<{ method: 'IP' | 'GPS' }> = ({ method }) => {
    const color = method === 'IP' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700';
    return (
        <span className={`px-2 py-0.5 rounded text-xs ${color}`}>
            {method}
        </span>
    );
};

// 匯出 Excel 函數
const exportToExcel = (records: ClockRecord[], month: string) => {
    // 建立 CSV 內容
    const headers = ['員工編號', '姓名', '日期', '上班時間', '下班時間', '工時', '狀態', '驗證方式'];
    const csvContent = [
        headers.join(','),
        ...records.map(record => [
            record.empId,
            record.name,
            record.date,
            record.clockInTime || '',
            record.clockOutTime || '',
            record.workHours?.toFixed(2) || '',
            record.status,
            record.verificationMethod
        ].map(field => `"${field}"`).join(','))
    ].join('\n');

    // 加入 BOM 以支援中文
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `出勤紀錄_${month}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const AttendanceLog: React.FC = () => {
    const [records, setRecords] = useState<ClockRecord[]>([]);
    const [filteredRecords, setFilteredRecords] = useState<ClockRecord[]>([]);
    const [employees, setEmployees] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<'all' | '正常' | '遲到' | '早退'>('all');

    useEffect(() => {
        const fetchInitialData = async () => {
            setLoading(true);
            const [allRecords, allEmployees] = await Promise.all([
                apiGetAllClockRecords(month),
                apiGetAllEmployees()
            ]);
            setRecords(allRecords);
            setFilteredRecords(allRecords);
            setEmployees(allEmployees);
            setLoading(false);
        };
        fetchInitialData();
    }, [month]);

    useEffect(() => {
        let result = records;

        // 員工篩選
        if (selectedEmployee !== 'all') {
            result = result.filter(r => r.empId === selectedEmployee);
        }

        // 狀態篩選
        if (selectedStatus !== 'all') {
            result = result.filter(r => r.status === selectedStatus);
        }

        setFilteredRecords(result);
    }, [selectedEmployee, selectedStatus, records]);

    // 計算統計
    const stats = {
        total: filteredRecords.length,
        normal: filteredRecords.filter(r => r.status === '正常').length,
        late: filteredRecords.filter(r => r.status === '遲到').length,
        early: filteredRecords.filter(r => r.status === '早退').length,
        totalHours: filteredRecords.reduce((sum, r) => sum + (r.workHours || 0), 0),
    };

    const handleExport = () => {
        if (filteredRecords.length === 0) {
            alert('沒有可匯出的紀錄');
            return;
        }
        exportToExcel(filteredRecords, month);
    };

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            {/* 標題 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <ClockIcon className="w-7 h-7 text-green-500" />
                    出勤紀錄
                </h1>
                <button
                    onClick={handleExport}
                    className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
                >
                    <DownloadIcon className="w-5 h-5" />
                    匯出 Excel
                </button>
            </div>

            {/* 統計卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                    <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
                    <p className="text-sm text-gray-500">總筆數</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg text-center">
                    <p className="text-2xl font-bold text-green-600">{stats.normal}</p>
                    <p className="text-sm text-gray-500">正常</p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg text-center">
                    <p className="text-2xl font-bold text-yellow-600">{stats.late}</p>
                    <p className="text-sm text-gray-500">遲到</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg text-center">
                    <p className="text-2xl font-bold text-orange-600">{stats.early}</p>
                    <p className="text-sm text-gray-500">早退</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg text-center">
                    <p className="text-2xl font-bold text-blue-600">{stats.totalHours.toFixed(1)}</p>
                    <p className="text-sm text-gray-500">總工時</p>
                </div>
            </div>

            {/* 篩選區 */}
            <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                <div>
                    <label htmlFor="month-select" className="mr-2 font-semibold text-gray-700">月份:</label>
                    <input
                        type="month"
                        id="month-select"
                        value={month}
                        onChange={(e) => {
                            setMonth(e.target.value);
                            setSelectedEmployee('all');
                            setSelectedStatus('all');
                        }}
                        className="p-2 border rounded-md"
                    />
                </div>
                <div>
                    <label htmlFor="employee-select" className="mr-2 font-semibold text-gray-700">員工:</label>
                    <select
                        id="employee-select"
                        value={selectedEmployee}
                        onChange={(e) => setSelectedEmployee(e.target.value)}
                        className="p-2 border rounded-md"
                    >
                        <option value="all">所有員工</option>
                        {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="status-select" className="mr-2 font-semibold text-gray-700">狀態:</label>
                    <select
                        id="status-select"
                        value={selectedStatus}
                        onChange={(e) => setSelectedStatus(e.target.value as typeof selectedStatus)}
                        className="p-2 border rounded-md"
                    >
                        <option value="all">全部狀態</option>
                        <option value="正常">正常</option>
                        <option value="遲到">遲到</option>
                        <option value="早退">早退</option>
                    </select>
                </div>

                {/* 快速篩選按鈕 */}
                <div className="flex gap-2 ml-auto">
                    <button
                        onClick={() => setSelectedStatus('all')}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedStatus === 'all'
                                ? 'bg-gray-800 text-white'
                                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                        }`}
                    >
                        全部
                    </button>
                    <button
                        onClick={() => setSelectedStatus('正常')}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedStatus === '正常'
                                ? 'bg-green-500 text-white'
                                : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                    >
                        正常
                    </button>
                    <button
                        onClick={() => setSelectedStatus('遲到')}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedStatus === '遲到'
                                ? 'bg-yellow-500 text-white'
                                : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                        }`}
                    >
                        遲到
                    </button>
                    <button
                        onClick={() => setSelectedStatus('早退')}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedStatus === '早退'
                                ? 'bg-orange-500 text-white'
                                : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        }`}
                    >
                        早退
                    </button>
                </div>
            </div>

            {/* 表格 */}
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">員工</th>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">日期</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">上班</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">下班</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">工時</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">狀態</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">驗證方式</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="text-center py-10">
                                    <div className="flex justify-center">
                                        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                </td>
                            </tr>
                        ) : filteredRecords.length > 0 ? (
                            filteredRecords.map(record => (
                                <tr key={record.id} className="hover:bg-gray-50">
                                    <td className="py-3 px-4 border-b">
                                        <div>
                                            <p className="text-sm font-medium text-gray-800">{record.name}</p>
                                            <p className="text-xs text-gray-400">{record.empId}</p>
                                        </div>
                                    </td>
                                    <td className="py-3 px-4 border-b text-sm text-gray-600">{record.date}</td>
                                    <td className="py-3 px-4 border-b text-center text-sm text-gray-600">
                                        {record.clockInTime || '-'}
                                    </td>
                                    <td className="py-3 px-4 border-b text-center text-sm text-gray-600">
                                        {record.clockOutTime || '-'}
                                    </td>
                                    <td className="py-3 px-4 border-b text-center text-sm font-medium text-gray-800">
                                        {record.workHours?.toFixed(2) || '-'}
                                    </td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <StatusBadge status={record.status} />
                                    </td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <VerificationBadge method={record.verificationMethod} />
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={7} className="text-center py-10 text-gray-500">
                                    無符合條件的紀錄
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 底部統計 */}
            <div className="mt-4 flex justify-between items-center text-sm text-gray-500">
                <span>
                    顯示 {filteredRecords.length} 筆紀錄
                    {(selectedEmployee !== 'all' || selectedStatus !== 'all') && ` (全部 ${records.length} 筆)`}
                </span>
                <span>
                    {month} 總工時: {stats.totalHours.toFixed(1)} 小時
                </span>
            </div>
        </div>
    );
};

export default AttendanceLog;
