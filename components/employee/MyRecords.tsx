
import React, { useMemo, useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiGetClockRecords } from '../../services/googleAppsScriptAPI';
import { openAttendancePrintView } from '../../services/attendancePrint';
import { ClockRecord } from '../../types';

const MyRecords: React.FC = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<ClockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    const fetchRecords = async () => {
      if (user) {
        setLoading(true);
        const data = await apiGetClockRecords(user.id, month);
        setRecords(data);
        setLoading(false);
      }
    };
    fetchRecords();
  }, [user, month]);

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date) || (a.clockInTime || '').localeCompare(b.clockInTime || '');
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [records, sortOrder]);

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">我的打卡紀錄</h2>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <label htmlFor="month-select" className="mr-2 font-semibold">選擇月份:</label>
          <input
            type="month"
            id="month-select"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="p-2 border rounded-md"
          />
        </div>
        <button
          onClick={() => {
            if (sortedRecords.length === 0) {
              alert('本月無打卡紀錄可列印');
              return;
            }
            openAttendancePrintView(sortedRecords, {
              empName: user?.name || '',
              month,
              isAdminView: false,
            });
          }}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
        >
          📥 列印出勤紀錄
        </button>
        <button
          onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
        >
          日期：{sortOrder === 'desc' ? '新到舊' : '舊到新'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-2 px-4 border-b">日期</th>
              <th className="py-2 px-4 border-b">上班打卡</th>
              <th className="py-2 px-4 border-b">下班打卡</th>
              <th className="py-2 px-4 border-b">實際工時</th>
              <th className="py-2 px-4 border-b">狀態</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-4">
                    <div className="flex justify-center items-center">
                        <div className="w-6 h-6 border-4 border-brand-green-dark border-t-transparent rounded-full animate-spin"></div>
                    </div>
                </td>
              </tr>
            ) : sortedRecords.length > 0 ? (
              sortedRecords.map(record => (
                <tr key={record.id} className="text-center hover:bg-gray-50">
                  <td className="py-2 px-4 border-b">{record.date}</td>
                  <td className="py-2 px-4 border-b">{record.clockInTime}</td>
                  <td className="py-2 px-4 border-b">{record.clockOutTime || '-'}</td>
                  <td className="py-2 px-4 border-b">{record.workHours?.toFixed(2) || '-'}</td>
                  <td className="py-2 px-4 border-b">{record.status}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="text-center py-4 text-gray-500">本月無打卡紀錄</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MyRecords;
