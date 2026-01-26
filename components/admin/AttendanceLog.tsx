
import React, { useState, useEffect } from 'react';
import { apiGetAllClockRecords, apiGetAllEmployees } from '../../services/googleAppsScriptAPI';
import { ClockRecord, User } from '../../types';

const AttendanceLog: React.FC = () => {
    const [records, setRecords] = useState<ClockRecord[]>([]);
    const [filteredRecords, setFilteredRecords] = useState<ClockRecord[]>([]);
    const [employees, setEmployees] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [selectedEmployee, setSelectedEmployee] = useState<string>('all');

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
        if (selectedEmployee === 'all') {
            setFilteredRecords(records);
        } else {
            setFilteredRecords(records.filter(r => r.empId === selectedEmployee));
        }
    }, [selectedEmployee, records]);
    
    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">出勤紀錄</h1>

            <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                <div>
                    <label htmlFor="month-select" className="mr-2 font-semibold text-gray-700">月份:</label>
                    <input
                        type="month"
                        id="month-select"
                        value={month}
                        onChange={(e) => {
                            setMonth(e.target.value)
                            setSelectedEmployee('all')
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
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="py-2 px-4 border-b text-left">員工</th>
                            <th className="py-2 px-4 border-b text-left">日期</th>
                            <th className="py-2 px-4 border-b">上班</th>
                            <th className="py-2 px-4 border-b">下班</th>
                            <th className="py-2 px-4 border-b">工時</th>
                            <th className="py-2 px-4 border-b">狀態</th>
                            <th className="py-2 px-4 border-b">驗證方式</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} className="text-center py-10">讀取中...</td></tr>
                        ) : filteredRecords.length > 0 ? (
                            filteredRecords.map(record => (
                                <tr key={record.id} className="hover:bg-gray-50">
                                    <td className="py-2 px-4 border-b">{record.name}</td>
                                    <td className="py-2 px-4 border-b">{record.date}</td>
                                    <td className="py-2 px-4 border-b text-center">{record.clockInTime}</td>
                                    <td className="py-2 px-4 border-b text-center">{record.clockOutTime || '-'}</td>
                                    <td className="py-2 px-4 border-b text-center">{record.workHours?.toFixed(2) || '-'}</td>
                                    <td className="py-2 px-4 border-b text-center">{record.status}</td>
                                    <td className="py-2 px-4 border-b text-center">{record.verificationMethod}</td>
                                </tr>
                            ))
                        ) : (
                            <tr><td colSpan={7} className="text-center py-10 text-gray-500">無紀錄</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AttendanceLog;
