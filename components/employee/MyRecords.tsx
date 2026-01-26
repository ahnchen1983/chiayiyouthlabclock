
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiGetClockRecords } from '../../services/googleAppsScriptAPI';
import { ClockRecord } from '../../types';

const MyRecords: React.FC = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<ClockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

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

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">我的打卡紀錄</h2>
      <div className="mb-4">
        <label htmlFor="month-select" className="mr-2 font-semibold">選擇月份:</label>
        <input
          type="month"
          id="month-select"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="p-2 border rounded-md"
        />
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
            ) : records.length > 0 ? (
              records.map(record => (
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
