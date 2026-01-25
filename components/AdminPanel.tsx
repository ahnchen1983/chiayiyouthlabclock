
import React, { useState } from 'react';
import { Shift, User, AttendanceRecord } from '../types';
import {
  Users,
  Plus,
  Sparkles,
  Trash2,
  Calendar as CalendarIcon,
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
  UserCheck
} from 'lucide-react';
import { SHIFT_TYPES } from '../constants';
import { getGeminiScheduleAdvice, suggestWeeklySchedule } from '../services/geminiService';

interface AdminPanelProps {
  shifts: Shift[];
  users: User[];
  attendance: AttendanceRecord[];
  onUpdateShifts: (shifts: Shift[]) => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ shifts, users, attendance, onUpdateShifts }) => {
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleGenerateAiAdvice = async () => {
    setIsAiThinking(true);
    const advice = await getGeminiScheduleAdvice(shifts, users);
    setAiInsight(advice);
    setIsAiThinking(false);
  };

  const handleSmartSchedule = async () => {
    setIsAiThinking(true);
    try {
      const weekStart = new Date().toISOString().split('T')[0];
      const newShifts = await suggestWeeklySchedule(users, weekStart);

      const formattedShifts: Shift[] = newShifts.map((s: any, idx: number) => ({
        ...s,
        id: `gen-${idx}-${Date.now()}`,
        userId: users.find(u => u.name === s.userName)?.id || 'unknown'
      }));

      onUpdateShifts(formattedShifts);
      setAiInsight("AI 已為下週生成平衡的排班表！");
    } catch (err) {
      console.error(err);
      setAiInsight("產生智慧排班表時發生錯誤。請重試。");
    } finally {
      setIsAiThinking(false);
    }
  };

  const deleteShift = (id: string) => {
    onUpdateShifts(shifts.filter(s => s.id !== id));
  };

  return (
    <div className="space-y-8">
      {/* AI Controls */}
      <section className="bg-gradient-to-r from-indigo-600 to-violet-600 p-8 rounded-3xl text-white shadow-xl shadow-indigo-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-6 h-6 text-indigo-200" />
              <h3 className="text-2xl font-bold">智慧排班系統</h3>
            </div>
            <p className="text-indigo-100 max-w-xl">
              使用 Gemini AI 根據「有事青年實驗室」營運規則（週一二休館、專責/兼職人力配比）自動生成排班表。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleGenerateAiAdvice}
              disabled={isAiThinking}
              className="flex items-center space-x-2 bg-white text-indigo-600 px-6 py-3 rounded-xl font-bold hover:bg-indigo-50 transition active:scale-95 disabled:opacity-50"
            >
              {isAiThinking ? <LoaderIcon /> : <FileText className="w-5 h-5" />}
              <span>取得 AI 建議</span>
            </button>
            <button
              onClick={handleSmartSchedule}
              disabled={isAiThinking}
              className="flex items-center space-x-2 bg-indigo-500/30 backdrop-blur-sm text-white px-6 py-3 rounded-xl font-bold border border-white/30 hover:bg-indigo-500/40 transition active:scale-95 disabled:opacity-50"
            >
              <Sparkles className="w-5 h-5" />
              <span>自動排班</span>
            </button>
          </div>
        </div>

        {aiInsight && (
          <div className="mt-6 p-4 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 animate-in slide-in-from-top duration-300">
            <div className="flex items-start space-x-3">
              <Sparkles className="w-5 h-5 text-amber-300 shrink-0 mt-1" />
              <div className="text-sm whitespace-pre-line text-indigo-50 leading-relaxed">
                {aiInsight}
              </div>
            </div>
            <button
              onClick={() => setAiInsight(null)}
              className="mt-3 text-xs text-indigo-300 hover:text-white underline"
            >
              清除建議
            </button>
          </div>
        )}
      </section>

      {/* Main Admin Tabs (Management Grid) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Active Roster */}
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-slate-800">排班管理</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜尋員工..."
                  className="pl-10 pr-4 py-2 bg-slate-50 border-0 rounded-xl text-sm w-full md:w-64 focus:ring-2 focus:ring-indigo-500"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-4 text-left">員工姓名</th>
                    <th className="px-6 py-4 text-left">日期</th>
                    <th className="px-6 py-4 text-left">班別</th>
                    <th className="px-6 py-4 text-left">時段</th>
                    <th className="px-6 py-4 text-left">員工類型</th>
                    <th className="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {shifts
                    .filter(s => s.userName.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((shift) => (
                      <tr key={shift.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                              {shift.userName.split(' ').map(n => n[0]).join('')}
                            </div>
                            <span className="font-semibold text-slate-700">{shift.userName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-sm">{shift.date}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700`}>
                            {shift.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-sm font-medium">
                          {shift.startTime} - {shift.endTime}
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-sm">
                          {/* Fallback to EmployeeType.PART_TIME if user not found, strictly for UI safety */}
                          {users.find(u => u.name === shift.userName)?.employeeType || 'Part-Time'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => deleteShift(shift.id)}
                            className="p-2 text-slate-300 hover:text-rose-500 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {shifts.length === 0 && (
                <div className="p-12 text-center text-slate-400">
                  <CalendarIcon className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>未找到有效的排班記錄。</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar: Stats & Team Status */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-slate-800">團隊狀態</h3>
              <Users className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="space-y-4">
              {users.map(user => {
                const isClockedIn = attendance.some(a => a.userId === user.id && a.date === new Date().toISOString().split('T')[0] && !a.clockOut);
                return (
                  <div key={user.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold">
                          {user.name.charAt(0)}
                        </div>
                        <div className={`absolute -bottom-1 -right-1 w-4 h-4 border-2 border-white rounded-full ${isClockedIn ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-700">{user.name}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">
                          {user.role === 'ADMIN' ? '管理員' : '互助人員'} • {user.employeeType}
                        </p>
                      </div>
                    </div>
                    {isClockedIn && (
                      <span className="text-[10px] font-bold text-green-600 bg-green-100 px-2 py-1 rounded">工作中</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-indigo-900 text-white p-8 rounded-3xl shadow-xl shadow-indigo-100 relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-xl font-bold mb-2">每週摘要</h3>
              <p className="text-indigo-300 text-sm mb-6">本期綜合表現。</p>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1 font-bold">
                    <span>覆蓋率目標</span>
                    <span>85%</span>
                  </div>
                  <div className="w-full h-2 bg-indigo-950 rounded-full overflow-hidden">
                    <div className="w-[85%] h-full bg-indigo-400"></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="bg-indigo-800 p-4 rounded-2xl">
                    <p className="text-[10px] text-indigo-300 font-bold uppercase">總工時</p>
                    <p className="text-xl font-bold">1,248</p>
                  </div>
                  <div className="bg-indigo-800 p-4 rounded-2xl">
                    <p className="text-[10px] text-indigo-300 font-bold uppercase">加班率</p>
                    <p className="text-xl font-bold">4.2%</p>
                  </div>
                </div>
              </div>
            </div>
            {/* Background decoration */}
            <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-indigo-500/20 rounded-full"></div>
            <div className="absolute top-4 -right-4 w-24 h-24 bg-indigo-500/10 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const LoaderIcon = () => <Loader2 className="w-5 h-5 animate-spin" />;
import { Loader2 } from 'lucide-react';

export default AdminPanel;
