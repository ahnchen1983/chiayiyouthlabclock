
import React, { useState, useEffect } from 'react';
import { apiGetAllClockRecords, apiGetAllEmployees, apiUpdateClockRecord } from '../../services/googleAppsScriptAPI';
import { openAttendancePrintView } from '../../services/attendancePrint';
import { ClockRecord, ClockRecordStatus, User } from '../../types';
import { ClockIcon } from '../icons';
import { maskName, maskEmpId, maskVerificationData } from '../../netlify/functions/utils/csvMasking';

// 編輯 icon
const PencilIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
);

// 編輯 Modal — Phase 3.2 客戶 #2
interface EditModalProps {
    record: ClockRecord;
    onClose: () => void;
    onSaved: () => void;
}

const EditClockModal: React.FC<EditModalProps> = ({ record, onClose, onSaved }) => {
    const [clockInTime, setClockInTime] = useState(record.clockInTime || '');
    const [clockOutTime, setClockOutTime] = useState(record.clockOutTime || '');
    const [status, setStatus] = useState<ClockRecordStatus>(record.status);
    const [note, setNote] = useState(record.note || '');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await apiUpdateClockRecord(record.id, {
                clockInTime: clockInTime || undefined,
                clockOutTime: clockOutTime || undefined,
                status,
                note,
            });
            onSaved();
            onClose();
        } catch (e: any) {
            alert(e.message || '修改失敗');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
                <h3 className="text-lg font-bold mb-4">修改打卡紀錄</h3>
                <p className="text-sm text-gray-600 mb-4">{record.name}（{record.empId}）— {record.date}</p>
                <div className="space-y-3">
                    <div>
                        <label className="text-sm font-medium text-gray-700">上班時間</label>
                        <input type="time" value={clockInTime} onChange={e => setClockInTime(e.target.value)} className="w-full p-2 border rounded mt-1" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">下班時間</label>
                        <input type="time" value={clockOutTime} onChange={e => setClockOutTime(e.target.value)} className="w-full p-2 border rounded mt-1" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">狀態</label>
                        <select value={status} onChange={e => setStatus(e.target.value as ClockRecordStatus)} className="w-full p-2 border rounded mt-1">
                            <option value="正常">正常</option>
                            <option value="遲到">遲到</option>
                            <option value="早退">早退</option>
                            <option value="遲到+早退">遲到+早退</option>
                            <option value="異常">異常</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">備註</label>
                        <textarea value={note} onChange={e => setNote(e.target.value)} className="w-full p-2 border rounded mt-1" rows={2} placeholder="修改原因" />
                    </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200">取消</button>
                    <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">{saving ? '儲存中…' : '儲存'}</button>
                </div>
            </div>
        </div>
    );
};

// 下載 icon
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

// 狀態標籤
const StatusBadge: React.FC<{ status: ClockRecordStatus }> = ({ status }) => {
    const colorMap: Record<string, string> = {
        '正常': 'bg-green-100 text-green-800',
        '遲到': 'bg-yellow-100 text-yellow-800',
        '早退': 'bg-orange-100 text-orange-800',
        '遲到+早退': 'bg-red-100 text-red-800',
        '異常': 'bg-red-100 text-red-800',
    };
    return (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorMap[status] || 'bg-gray-100 text-gray-800'}`}>
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

// 匯出 Excel 函數（Phase 7.7：加入 masked 參數、驗證資料欄、CSV 警語）
const exportToExcel = (records: ClockRecord[], month: string, masked: boolean) => {
    // 建立 CSV 內容（v7.7：新增「驗證資料」欄，IP/GPS 可被脫敏遮罩）
    const headers = ['員工編號', '姓名', '日期', '上班時間', '下班時間', '工時', '狀態', '驗證方式', '驗證資料'];
    const dataRows = records.map(record => {
        const empId = masked ? maskEmpId(record.empId) : record.empId;
        const name = masked ? maskName(record.name) : record.name;
        const vData = masked
            ? maskVerificationData(record.verificationMethod, record.verificationData || '')
            : (record.verificationData || '');
        return [
            empId,
            name,
            record.date,
            record.clockInTime || '',
            record.clockOutTime || '',
            record.workHours?.toFixed(2) || '',
            record.status,
            record.verificationMethod,
            vData,
        ].map(field => `"${field}"`).join(',');
    });

    const csvContent = [
        headers.join(','),
        ...dataRows,
        // 警語列（CSV 末尾）
        '',
        `"# 匯出時間: ${new Date().toLocaleString('zh-TW')}"`,
        `"# 模式: ${masked ? '脫敏匯出' : '完整匯出（含個資）'}"`,
        '"# 本檔可能含敏感個資，請依個資法妥善處理；不得另行傳遞至非經授權之第三方。"',
    ].join('\n');

    // 加入 BOM 以支援中文
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `出勤紀錄_${month}${masked ? '_脫敏' : ''}.csv`);
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
    const [selectedStatus, setSelectedStatus] = useState<'all' | ClockRecordStatus>('all');
    const [editing, setEditing] = useState<ClockRecord | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

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
    }, [month, reloadKey]);

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

    const handleMaskedExport = () => {
        if (filteredRecords.length === 0) {
            alert('沒有可匯出的紀錄');
            return;
        }
        exportToExcel(filteredRecords, month, true);
    };

    const handleFullExport = () => {
        if (filteredRecords.length === 0) {
            alert('沒有可匯出的紀錄');
            return;
        }
        const confirmed = window.confirm(
            '即將匯出「完整」CSV，含未遮罩的員工姓名、員工編號、IP 或 GPS 等個資。\n\n' +
            '請確認檔案會妥善保管，並僅供授權人員使用。\n\n要繼續匯出嗎？'
        );
        if (!confirmed) return;
        exportToExcel(filteredRecords, month, false);
    };

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            {/* 標題 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <ClockIcon className="w-7 h-7 text-green-500" />
                    出勤紀錄
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleMaskedExport}
                        title="員工編號、姓名、IP/GPS 將被遮罩"
                        className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        脫敏匯出 CSV
                    </button>
                    <button
                        onClick={handleFullExport}
                        title="含未遮罩個資，需二次確認"
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        完整匯出（含個資）
                    </button>
                    <button
                        onClick={() => {
                            if (filteredRecords.length === 0) {
                                alert('無符合條件的紀錄可列印');
                                return;
                            }
                            openAttendancePrintView(filteredRecords, {
                                month,
                                isAdminView: true,
                            });
                        }}
                        title="列印目前篩選結果（依員工分組）"
                        className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                    >
                        <DownloadIcon className="w-5 h-5" />
                        列印出勤紀錄
                    </button>
                </div>
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
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={8} className="text-center py-10">
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
                                        {record.manuallyEdited && (
                                            <span className="ml-1 text-xs text-amber-600" title="已被手動修改">✏️</span>
                                        )}
                                    </td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <button
                                            onClick={() => setEditing(record)}
                                            className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 text-sm"
                                            title="修改打卡"
                                        >
                                            <PencilIcon className="w-4 h-4" />編輯
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={8} className="text-center py-10 text-gray-500">
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

            {editing && (
                <EditClockModal
                    record={editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => setReloadKey(k => k + 1)}
                />
            )}
        </div>
    );
};

export default AttendanceLog;
