import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiGetMonthlySchedule, apiUpdateSchedule, apiGetAllEmployees, apiApplyTemplate, apiCheckScheduleConflicts, ScheduleConflict } from '../../services/googleAppsScriptAPI';
import { ScheduleEvent, StaffShift, StaffRole, User } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

// ===== 時段視覺化 helpers =====
const toMin = (hhmm: string): number => {
  if (!hhmm || !hhmm.includes(':')) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const ROLE_COLOR: Record<StaffRole, string> = {
  staffA: 'bg-blue-500',
  staffB: 'bg-emerald-500',
  partTime: 'bg-orange-500',
};

const ROLE_COLOR_LIGHT: Record<StaffRole, string> = {
  staffA: 'bg-blue-200 text-blue-900',
  staffB: 'bg-emerald-200 text-emerald-900',
  partTime: 'bg-orange-200 text-orange-900',
};

// ==========================================================
// v2.0 排班管理 — 每員工獨立時段，支援兩頭班（同人 ≤ 2 段）
// 5.3 將會做時間軸視覺化，目前為「班次列表」可用版
// ==========================================================

const ROLE_LABEL: Record<StaffRole, string> = {
  staffA: '專責 A',
  staffB: '專責 B',
  partTime: '兼職',
};

const ScheduleManager: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([]);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [employees, setEmployees] = useState<User[]>([]);
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  const yearMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    const [data, cf] = await Promise.all([
      apiGetMonthlySchedule(yearMonth),
      apiCheckScheduleConflicts(yearMonth).catch(() => []),
    ]);
    setSchedule(data);
    setConflicts(cf);
    setLoading(false);
  }, [yearMonth]);

  const conflictsByDate = React.useMemo(() => {
    const map = new Map<string, ScheduleConflict[]>();
    conflicts.forEach(c => {
      if (!map.has(c.date)) map.set(c.date, []);
      map.get(c.date)!.push(c);
    });
    return map;
  }, [conflicts]);

  useEffect(() => {
    fetchSchedule();
    apiGetAllEmployees().then(setEmployees);
  }, [fetchSchedule]);

  const changeMonth = (offset: number) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + offset);
      return newDate;
    });
  };

  const openEditModal = (event: ScheduleEvent) => {
    setSelectedEvent(event);
    setIsModalOpen(true);
  };

  const handleUpdate = async (updatedEvent: ScheduleEvent) => {
    if (!selectedEvent) return;
    try {
      await apiUpdateSchedule(updatedEvent);
      setIsModalOpen(false);
      setSelectedEvent(null);
      await fetchSchedule();
    } catch (e: any) {
      alert(e?.message || '更新失敗');
    }
  };

  const handleApplyTemplate = async () => {
    if (!confirm(`確定要將預設模板套用到 ${currentDate.getFullYear()} 年 ${currentDate.getMonth() + 1} 月嗎？\n\n這會覆蓋該月份所有已編輯的逐日班表（人員會被清空）。`)) return;
    setApplyingTemplate(true);
    try {
      await apiApplyTemplate(yearMonth);
      await fetchSchedule();
    } catch (e) {
      alert('套用模板失敗');
    }
    setApplyingTemplate(false);
  };

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`pad-${i}`} className="border-r border-b"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const event = schedule.find(e => e.date === dateStr);
      let bgColor = 'bg-white';
      if (event) {
        if (event.status === '休館') bgColor = 'bg-bg-closed';
        else if (['三', '四'].includes(event.dayOfWeek)) bgColor = 'bg-bg-wed-thu';
        else if (['五', '六', '日'].includes(event.dayOfWeek)) bgColor = 'bg-bg-fri-sun';
      }

      const dateConflicts = conflictsByDate.get(dateStr) || [];

      // 顯示用：把 shifts 依角色聚合
      const groupedByRole = (event?.shifts || []).reduce<Record<StaffRole, StaffShift[]>>((acc, s) => {
        if (!acc[s.role]) acc[s.role] = [];
        acc[s.role].push(s);
        return acc;
      }, { staffA: [], staffB: [], partTime: [] });

      days.push(
        <div key={day} className={`relative p-2 min-h-[120px] border-r border-b ${bgColor} transition-all hover:shadow-inner cursor-pointer`} onClick={() => event && openEditModal(event)}>
          <div className="flex items-center justify-between">
            <div className="font-bold">{day}</div>
            {dateConflicts.length > 0 && (
              <span title={dateConflicts.map(c => c.message).join('\n')} className="text-red-600 text-sm">⚠️</span>
            )}
          </div>
          {event && (
            <div className="text-xs mt-1 space-y-0.5">
              <p className={`font-semibold ${event.status === '休館' ? 'text-red-700' : event.status === '休館(值班)' ? 'text-orange-600' : 'text-green-700'}`}>{event.status}</p>
              {(event.status === '營運' || event.status === '休館(值班)') && (
                <>
                  {event.openingHours && <p className="text-gray-500">{event.openingHours}</p>}
                  {(['staffA', 'staffB', 'partTime'] as StaffRole[]).map(role => {
                    const list = groupedByRole[role];
                    if (list.length === 0 && role !== 'staffA' && role !== 'staffB') return null;
                    const label = role === 'staffA' ? 'A' : role === 'staffB' ? 'B' : 'PT';
                    if (list.length === 0) return <p key={role}>{label}: 未排</p>;
                    return (
                      <p key={role}>
                        {label}: {list.map(s => `${s.name}${list.length > 1 || s.from !== event.openingHours?.split('-')[0] ? `(${s.from}-${s.to})` : ''}`).join(', ')}
                      </p>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      );
    }
    return days;
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-gray-800">排班管理</h1>
        <button
          onClick={handleApplyTemplate}
          disabled={applyingTemplate}
          className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          {applyingTemplate ? '套用中...' : '套用預設模板到本月'}
        </button>
      </div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon /></button>
        <h3 className="text-xl font-semibold">{currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月</h3>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon /></button>
      </div>

      {conflicts.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
          <p className="text-sm font-semibold text-yellow-800 mb-2">⚠️ 本月發現 {conflicts.length} 筆排班衝突</p>
          <ul className="text-xs text-yellow-700 space-y-0.5 max-h-32 overflow-y-auto">
            {conflicts.slice(0, 10).map((c, i) => (
              <li key={i}>
                <span className={`inline-block w-16 px-1.5 py-0.5 rounded text-[10px] mr-2 ${c.type === 'duplicate' ? 'bg-orange-200 text-orange-800' : 'bg-red-200 text-red-800'}`}>
                  {c.type === 'duplicate' ? '重複排班' : '人力不足'}
                </span>
                {c.message}
              </li>
            ))}
            {conflicts.length > 10 && (
              <li className="text-gray-500">…還有 {conflicts.length - 10} 筆</li>
            )}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-7 border-t border-l text-center font-bold">
        {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} className="p-2 border-r border-b bg-gray-50">{d}</div>)}
      </div>
      {loading ? <div className="text-center py-10">載入中...</div> : <div className="grid grid-cols-7 border-l">{renderCalendar()}</div>}
      {isModalOpen && selectedEvent && (
        <EditScheduleModal event={selectedEvent} employees={employees} onClose={() => setIsModalOpen(false)} onSave={handleUpdate} />
      )}
    </div>
  );
};

// ==========================================================
// EditScheduleModal — v2.0「班次列表」編輯器
// ==========================================================

const EditScheduleModal: React.FC<{
  event: ScheduleEvent;
  employees: User[];
  onClose: () => void;
  onSave: (event: ScheduleEvent) => void;
}> = ({ event, employees, onClose, onSave }) => {
  const [editedEvent, setEditedEvent] = useState<ScheduleEvent>({
    ...event,
    shifts: event.shifts || [],
    openingHours: event.openingHours || '08:30-17:30',
    requiredHeadcount: event.requiredHeadcount ?? 2,
  });

  const [openStart, openEnd] = (editedEvent.openingHours || '').split('-');

  const handleStatusChange = (status: '營運' | '休館' | '休館(值班)') => {
    setEditedEvent({ ...editedEvent, status });
  };

  const handleOpeningChange = (type: 'start' | 'end', value: string) => {
    const [s, e] = (editedEvent.openingHours || '08:30-17:30').split('-');
    const next = type === 'start' ? `${value}-${e}` : `${s}-${value}`;
    setEditedEvent({ ...editedEvent, openingHours: next });
  };

  const handleAddShift = () => {
    const [from, to] = (editedEvent.openingHours || '08:30-17:30').split('-');
    setEditedEvent({
      ...editedEvent,
      shifts: [...editedEvent.shifts, { empId: '', name: '', role: 'staffA', from, to }],
    });
  };

  const handleRemoveShift = (idx: number) => {
    setEditedEvent({
      ...editedEvent,
      shifts: editedEvent.shifts.filter((_, i) => i !== idx),
    });
  };

  const updateShift = (idx: number, patch: Partial<StaffShift>) => {
    setEditedEvent({
      ...editedEvent,
      shifts: editedEvent.shifts.map((s, i) => {
        if (i !== idx) return s;
        const merged = { ...s, ...patch };
        // 員工選擇時同步 empId + name
        if (patch.empId !== undefined) {
          const emp = employees.find(e => e.id === patch.empId);
          merged.name = emp?.name || '';
          // 兼職員工預設 partTime，正職預設 staffA
          if (emp) merged.role = emp.position === '兼職人員' ? 'partTime' : merged.role || 'staffA';
        }
        return merged;
      }),
    });
  };

  // 兩頭班檢查
  const shiftCountByEmp: Record<string, number> = {};
  editedEvent.shifts.forEach(s => {
    const key = s.empId || `n:${s.name}`;
    shiftCountByEmp[key] = (shiftCountByEmp[key] || 0) + 1;
  });
  const overTwoEmps = Object.entries(shiftCountByEmp)
    .filter(([, n]) => n > 2)
    .map(([k]) => k.replace(/^n:/, ''));

  // 應到 vs 實際（決策 3：僅警示）— v2 改為每 30 分鐘區段檢核
  const coverageGaps = useMemo(() => {
    const opening = editedEvent.openingHours || '';
    const [s, e] = opening.split('-');
    if (!opening.includes('-')) return [];
    const oStart = toMin(s), oEnd = toMin(e);
    if (oEnd <= oStart) return [];
    const required = editedEvent.requiredHeadcount ?? 0;
    if (required === 0) return [];
    const gaps: { from: string; to: string; covered: number; short: number }[] = [];
    let cur: typeof gaps[0] | null = null;
    for (let t = oStart; t < oEnd; t += 30) {
      const tTo = Math.min(t + 30, oEnd);
      const mid = (t + tTo) / 2;
      const set = new Set<string>();
      for (const sh of editedEvent.shifts) {
        if (toMin(sh.from) <= mid && mid < toMin(sh.to)) set.add(sh.empId || `n:${sh.name}`);
      }
      const short = Math.max(0, required - set.size);
      const fromStr = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      const toStr = `${String(Math.floor(tTo / 60)).padStart(2, '0')}:${String(tTo % 60).padStart(2, '0')}`;
      if (short > 0) {
        if (cur && cur.short === short && cur.to === fromStr) cur.to = toStr;
        else { if (cur) gaps.push(cur); cur = { from: fromStr, to: toStr, covered: set.size, short }; }
      } else if (cur) { gaps.push(cur); cur = null; }
    }
    if (cur) gaps.push(cur);
    return gaps;
  }, [editedEvent.shifts, editedEvent.openingHours, editedEvent.requiredHeadcount]);

  const showShifts = editedEvent.status === '營運' || editedEvent.status === '休館(值班)';

  const handleSave = () => {
    if (overTwoEmps.length > 0) {
      alert(`下列員工同日班次超過 2 段（兩頭班上限）：\n${overTwoEmps.join(', ')}`);
      return;
    }
    // 空員工檢查（避免 empId="" 寫入）
    const emptyEmp = editedEvent.shifts.findIndex(s => !s.empId);
    if (emptyEmp >= 0) {
      if (!confirm(`第 ${emptyEmp + 1} 筆班次未選擇員工，確定繼續儲存嗎？（會被忽略）`)) return;
    }
    // 移除無員工的 shift
    const cleaned = {
      ...editedEvent,
      shifts: editedEvent.shifts.filter(s => s.empId),
    };
    onSave(cleaned);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">編輯 {event.date} ({event.dayOfWeek}) 班表</h2>

        {/* 營運狀態 */}
        <div className="mb-4">
          <label className="block font-semibold mb-2">營運狀態</label>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['營運', '休館(值班)', '休館'] as const).map(s => (
              <label key={s} className="flex items-center space-x-2">
                <input type="radio" checked={editedEvent.status === s} onChange={() => handleStatusChange(s)} />
                <span>{s === '休館' ? '休館(全休)' : s}</span>
              </label>
            ))}
          </div>
          {editedEvent.status === '休館(值班)' && (
            <p className="text-xs text-gray-500 mt-1">不對外開放，但可安排正職值班，兼職亦可排（決策 1）</p>
          )}
        </div>

        {showShifts && (
          <>
            {/* 時間軸視覺化（Phase 5.3） */}
            <ScheduleTimeline event={editedEvent} />

            {/* 營業時段 + 應到人數 */}
            <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold mb-2 text-sm">場館營業時段（顯示用）</label>
                <div className="flex items-center space-x-2 text-sm">
                  <input type="time" value={openStart || '08:30'} onChange={e => handleOpeningChange('start', e.target.value)} className="p-2 border rounded" />
                  <span>至</span>
                  <input type="time" value={openEnd || '17:30'} onChange={e => handleOpeningChange('end', e.target.value)} className="p-2 border rounded" />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-2 text-sm">應到人數（警示用，不阻擋儲存）</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={editedEvent.requiredHeadcount ?? 0}
                  onChange={e => setEditedEvent({ ...editedEvent, requiredHeadcount: Number(e.target.value) })}
                  className="p-2 border rounded w-24 text-sm"
                />
              </div>
            </div>

            {/* 班次列表 */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="font-semibold">班次列表（{editedEvent.shifts.length} 筆）</label>
                <button onClick={handleAddShift} className="text-sm px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">
                  ＋ 新增班次
                </button>
              </div>

              {editedEvent.shifts.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center bg-gray-50 rounded">尚未排班，點上方新增班次</p>
              ) : (
                <div className="space-y-2">
                  {editedEvent.shifts.map((s, idx) => {
                    const empCountInShifts = shiftCountByEmp[s.empId || `n:${s.name}`] || 0;
                    const over = empCountInShifts > 2;
                    return (
                      <div key={idx} className={`flex flex-wrap items-center gap-2 p-2 rounded border ${over ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                        <select
                          value={s.empId}
                          onChange={e => updateShift(idx, { empId: e.target.value })}
                          className="p-1 border rounded text-sm min-w-[120px]"
                        >
                          <option value="">選擇員工…</option>
                          {employees.map(e => (
                            <option key={e.id} value={e.id}>{e.name}（{e.position}）</option>
                          ))}
                        </select>
                        <select
                          value={s.role}
                          onChange={e => updateShift(idx, { role: e.target.value as StaffRole })}
                          className="p-1 border rounded text-sm"
                        >
                          {(['staffA', 'staffB', 'partTime'] as StaffRole[]).map(r => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={s.from}
                          onChange={e => updateShift(idx, { from: e.target.value })}
                          className="p-1 border rounded text-sm"
                        />
                        <span className="text-xs">至</span>
                        <input
                          type="time"
                          value={s.to}
                          onChange={e => updateShift(idx, { to: e.target.value })}
                          className="p-1 border rounded text-sm"
                        />
                        <button onClick={() => handleRemoveShift(idx)} className="ml-auto text-red-500 hover:text-red-700 text-sm">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 警示 */}
              {overTwoEmps.length > 0 && (
                <p className="mt-2 text-xs text-red-600">
                  ⚠️ {overTwoEmps.join(', ')} 同日超過 2 段（兩頭班上限）
                </p>
              )}
              {coverageGaps.length > 0 && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                  <p className="text-xs font-semibold text-yellow-800 mb-1">⚠️ 應到人數不足時段（僅警示，不阻擋儲存）</p>
                  <ul className="text-xs text-yellow-700 space-y-0.5">
                    {coverageGaps.map((g, i) => (
                      <li key={i}>{g.from}-{g.to}：覆蓋 {g.covered}/{editedEvent.requiredHeadcount} 人，缺 {g.short} 人</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end mt-6 space-x-3">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300">取消</button>
          <button onClick={handleSave} className="px-4 py-2 rounded bg-brand-blue-dark text-white hover:bg-blue-700">儲存</button>
        </div>
      </div>
    </div>
  );
};

// ==========================================================
// ScheduleTimeline — 時間軸視覺化 + 覆蓋率條（Phase 5.3 + 5.2）
// ==========================================================

const ScheduleTimeline: React.FC<{ event: ScheduleEvent }> = ({ event }) => {
  const opening = event.openingHours || '';
  const [oStartStr, oEndStr] = opening.split('-');
  const oStart = toMin(oStartStr);
  const oEnd = toMin(oEndStr);

  // 30 分鐘 slot 覆蓋率
  const slots = useMemo(() => {
    if (!opening.includes('-') || oEnd <= oStart) return [];
    const required = event.requiredHeadcount ?? 0;
    const out: { from: number; to: number; covered: number; required: number; short: number }[] = [];
    for (let t = oStart; t < oEnd; t += 30) {
      const tFrom = t;
      const tTo = Math.min(t + 30, oEnd);
      const mid = (tFrom + tTo) / 2;
      const empSet = new Set<string>();
      for (const s of event.shifts) {
        const sf = toMin(s.from), st = toMin(s.to);
        if (sf <= mid && mid < st) empSet.add(s.empId || `n:${s.name}`);
      }
      out.push({
        from: tFrom, to: tTo,
        covered: empSet.size, required,
        short: Math.max(0, required - empSet.size),
      });
    }
    return out;
  }, [event.shifts, event.openingHours, event.requiredHeadcount, oStart, oEnd]);

  // 每員工一行渲染（同人多段在同一行）
  const empRows = useMemo(() => {
    const map = new Map<string, { name: string; role: StaffRole; shifts: StaffShift[] }>();
    event.shifts.forEach(s => {
      const key = s.empId || `n:${s.name}`;
      if (!map.has(key)) map.set(key, { name: s.name || '(未指派)', role: s.role, shifts: [] });
      map.get(key)!.shifts.push(s);
    });
    return Array.from(map.values());
  }, [event.shifts]);

  if (!opening.includes('-') || oEnd <= oStart) {
    return (
      <div className="mb-4 p-3 bg-gray-50 rounded text-xs text-gray-400 text-center">
        請先設定場館營業時段以顯示時間軸
      </div>
    );
  }

  const totalMin = oEnd - oStart;
  // 整點刻度
  const hourTicks: number[] = [];
  const startHour = Math.ceil(oStart / 60);
  const endHour = Math.floor(oEnd / 60);
  for (let h = startHour; h <= endHour; h++) hourTicks.push(h * 60);

  const pctLeft = (min: number) => `${((min - oStart) / totalMin) * 100}%`;
  const pctWidth = (from: number, to: number) => `${((to - from) / totalMin) * 100}%`;

  const maxCovered = Math.max(1, ...slots.map(s => s.covered), event.requiredHeadcount ?? 1);

  return (
    <div className="mb-4 border rounded-lg p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-700">時間軸視覺化</h4>
        <div className="flex gap-2 text-[10px]">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-blue-500" />專責A</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-500" />專責B</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-orange-500" />兼職</span>
        </div>
      </div>

      {/* 小時刻度 */}
      <div className="relative h-5 mb-1 text-[10px] text-gray-500">
        {hourTicks.map(t => (
          <div key={t} className="absolute -translate-x-1/2" style={{ left: pctLeft(t) }}>
            <div className="border-l border-gray-300 h-2" />
            <div>{Math.floor(t / 60)}:00</div>
          </div>
        ))}
      </div>

      {/* 員工列 */}
      <div className="space-y-1 mb-2">
        {empRows.length === 0 ? (
          <div className="h-7 flex items-center justify-center text-xs text-gray-400">尚無排班</div>
        ) : empRows.map((row, idx) => (
          <div key={idx} className="relative h-7 bg-white rounded border border-gray-200">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-gray-700 z-10 pointer-events-none">
              {row.name}
            </span>
            {row.shifts.map((s, si) => {
              const sf = toMin(s.from), st = toMin(s.to);
              return (
                <div
                  key={si}
                  className={`absolute top-1 bottom-1 ${ROLE_COLOR[s.role]} rounded text-[10px] text-white px-1 flex items-center justify-end overflow-hidden`}
                  style={{ left: pctLeft(sf), width: pctWidth(sf, st) }}
                  title={`${row.name} ${s.from}-${s.to}`}
                >
                  {s.from}-{s.to}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 覆蓋率條 */}
      {(event.requiredHeadcount ?? 0) > 0 && slots.length > 0 && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
            <span>覆蓋人數（每 30 分鐘）</span>
            <span>應到 {event.requiredHeadcount} 人</span>
          </div>
          <div className="relative h-6 flex bg-white rounded border border-gray-200 overflow-hidden">
            {slots.map((s, i) => {
              const bg = s.short > 0
                ? 'bg-red-300'
                : s.covered === s.required
                  ? 'bg-green-300'
                  : 'bg-green-500';
              const opacity = Math.min(1, s.covered / maxCovered);
              return (
                <div
                  key={i}
                  className={`${bg} border-r border-white last:border-r-0 flex items-center justify-center text-[10px]`}
                  style={{ width: pctWidth(s.from, s.to), opacity: 0.4 + opacity * 0.6 }}
                  title={`${String(Math.floor(s.from / 60)).padStart(2, '0')}:${String(s.from % 60).padStart(2, '0')}-${String(Math.floor(s.to / 60)).padStart(2, '0')}:${String(s.to % 60).padStart(2, '0')} 覆蓋 ${s.covered}/${s.required}`}
                >
                  {s.covered}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleManager;
