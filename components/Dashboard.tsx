
import React from 'react';
import { Shift, AttendanceRecord } from '../types';
import { Calendar, Clock, MapPin, CheckCircle2, AlertCircle } from 'lucide-react';
import { SHIFT_TYPES } from '../constants';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DashboardProps {
  shifts: Shift[];
  attendance: AttendanceRecord[];
}

const Dashboard: React.FC<DashboardProps> = ({ shifts, attendance }) => {
  const upcomingShifts = shifts
    .filter(s => new Date(s.date) >= new Date())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const chartData = [
    { name: '週一', hours: 8 },
    { name: '週二', hours: 7.5 },
    { name: '週三', hours: 8 },
    { name: '週四', hours: 0 },
    { name: '週五', hours: 8.5 },
    { name: '週六', hours: 4 },
    { name: '週日', hours: 0 },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Summary Cards */}
      <div className="lg:col-span-2 space-y-8">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">每週工時</p>
              <h3 className="text-2xl font-bold text-slate-800">32.0h</h3>
            </div>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">出勤天數</p>
              <h3 className="text-2xl font-bold text-slate-800">4/5</h3>
            </div>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">下次排班</p>
              <h3 className="text-2xl font-bold text-slate-800">In 2h</h3>
            </div>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
              <Calendar className="w-5 h-5" />
            </div>
          </div>
        </section>

        {/* Weekly Chart */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 mb-6">活動概覽</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="hours" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Recent Activity */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 mb-4">最近出勤記錄</h3>
          <div className="space-y-4">
            {attendance.slice(0, 3).map((record) => (
              <div key={record.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
                <div className="flex items-center space-x-4">
                  <div className={`p-2 rounded-full ${record.networkVerified ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    {record.networkVerified ? <MapPin className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">{record.date}</p>
                    <p className="text-xs text-slate-400">已透過公司 WiFi 驗證</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-800">{record.clockIn} - {record.clockOut || '--:--'}</p>
                  <p className="text-xs text-emerald-500 font-medium">有效打卡</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Upcoming Shifts Sidebar */}
      <div className="space-y-6">
        <div className="bg-indigo-600 text-white p-6 rounded-2xl shadow-lg shadow-indigo-100">
          <h3 className="text-lg font-bold mb-4">即將到來的排班</h3>
          <div className="space-y-4">
            {upcomingShifts.map((shift) => (
              <div key={shift.id} className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                <div className="flex justify-between items-start mb-2">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700`}>
                    {shift.type}
                  </span>
                  <span className="text-xs font-medium text-indigo-100">{shift.date}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-indigo-200" />
                  <span className="text-sm font-bold">{shift.startTime} - {shift.endTime}</span>
                </div>
              </div>
            ))}
            {upcomingShifts.length === 0 && (
              <p className="text-sm text-indigo-100 italic">本週尚無排班。</p>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-slate-800 font-bold mb-3">公告欄</h3>
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 text-sm text-amber-800">
            <strong>系統維護：</strong> 公司 WiFi 將於本週日凌晨 02:00 至 04:00 進行更新維護。
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
