
import React, { useState, useEffect, useCallback } from 'react';
import { apiGetMonthlySchedule, apiUpdateSchedule, apiGetAllEmployees, apiApplyTemplate, apiCheckScheduleConflicts, ScheduleConflict } from '../../services/googleAppsScriptAPI';
import { ScheduleEvent, User } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

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

  // 衝突 by date map
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
    const fetchEmployees = async () => {
      const allEmps = await apiGetAllEmployees();
      setEmployees(allEmps);
    };
    fetchEmployees();
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
      await apiUpdateSchedule(updatedEvent);
      setIsModalOpen(false);
      setSelectedEvent(null);
      await fetchSchedule();
  };

  const handleApplyTemplate = async () => {
    if (!confirm(`確定要將預設模板套用到 ${currentDate.getFullYear()} 年 ${currentDate.getMonth() + 1} 月嗎？\n\n這會覆蓋該月份所有已編輯的逐日班表。`)) return;
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
      if(event) {
        if(event.status === '休館') bgColor = 'bg-bg-closed';
        else if (['三', '四'].includes(event.dayOfWeek)) bgColor = 'bg-bg-wed-thu';
        else if (['五', '六', '日'].includes(event.dayOfWeek)) bgColor = 'bg-bg-fri-sun';
      }

      const dateConflicts = conflictsByDate.get(dateStr) || [];
      days.push(
        <div key={day} className={`relative p-2 min-h-[120px] border-r border-b ${bgColor} transition-all hover:shadow-inner cursor-pointer`} onClick={() => event && openEditModal(event)}>
          <div className="flex items-center justify-between">
            <div className="font-bold">{day}</div>
            {dateConflicts.length > 0 && (
              <span
                title={dateConflicts.map(c => c.message).join('\n')}
                className="text-red-600 text-sm"
              >⚠️</span>
            )}
          </div>
          {event && (
            <div className="text-xs mt-1 space-y-1">
              <p className={`font-semibold ${event.status === '休館' ? 'text-red-700' : event.status === '休館(值班)' ? 'text-orange-600' : 'text-green-700'}`}>{event.status}</p>
              {(event.status === '營運' || event.status === '休館(值班)') && (
                <>
                <p className="text-gray-500">{event.shiftTime || '未設定時段'}</p>
                <p>專責A: {event.staffA || '未排'}</p>
                <p>專責B: {event.staffB || '未排'}</p>
                {(event.status === '營運' || event.status === '休館(值班)') && (
                  <p>兼職: {event.partTime.length > 0 ? event.partTime.join(', ') : '無'}</p>
                )}
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

      {/* 排班衝突警示（Phase 5.8） */}
      {conflicts.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
          <p className="text-sm font-semibold text-yellow-800 mb-2">
            ⚠️ 本月發現 {conflicts.length} 筆排班衝突
          </p>
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
      {isModalOpen && selectedEvent && <EditScheduleModal event={selectedEvent} employees={employees} onClose={() => setIsModalOpen(false)} onSave={handleUpdate} />}
    </div>
  );
};

const EditScheduleModal: React.FC<{event: ScheduleEvent, employees: User[], onClose: ()=>void, onSave:(event:ScheduleEvent)=>void}> = ({event, employees, onClose, onSave}) => {
    const [editedEvent, setEditedEvent] = useState(event);

    const fullTimeStaff = employees.filter(e => e.position === '專責人員');
    const partTimeStaff = employees.filter(e => e.position === '兼職人員');

    // 解析 shiftTime 為開始/結束時間
    const [shiftStart, shiftEnd] = (editedEvent.shiftTime || '').split('-');

    const handleShiftTimeChange = (type: 'start' | 'end', value: string) => {
        const current = (editedEvent.shiftTime || '08:30-17:30').split('-');
        if (type === 'start') current[0] = value;
        else current[1] = value;
        setEditedEvent({...editedEvent, shiftTime: `${current[0]}-${current[1]}`});
    };

    // 計算班別時數
    const calcHours = () => {
        if (!shiftStart || !shiftEnd) return 0;
        const [sh, sm] = shiftStart.split(':').map(Number);
        const [eh, em] = shiftEnd.split(':').map(Number);
        return Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 10) / 10;
    };

    const handlePartTimeChange = (empName: string) => {
        setEditedEvent(prev => {
            const newPartTime = prev.partTime.includes(empName)
                ? prev.partTime.filter(name => name !== empName)
                : [...prev.partTime, empName];
            return {...prev, partTime: newPartTime};
        });
    };

    const handleStatusChange = (status: '營運' | '休館' | '休館(值班)') => {
        setEditedEvent({...editedEvent, status});
    };

    const showStaffFields = editedEvent.status === '營運' || editedEvent.status === '休館(值班)';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-bold mb-4">編輯 {event.date} ({event.dayOfWeek}) 班表</h2>
                <div className="space-y-4">
                    {/* 營運狀態切換 */}
                    <div>
                        <label className="block font-semibold mb-2">營運狀態</label>
                        <div className="flex flex-wrap gap-4">
                            <label className="flex items-center space-x-2">
                                <input type="radio" checked={editedEvent.status === '營運'} onChange={() => handleStatusChange('營運')} />
                                <span>營運</span>
                            </label>
                            <label className="flex items-center space-x-2">
                                <input type="radio" checked={editedEvent.status === '休館(值班)'} onChange={() => handleStatusChange('休館(值班)')} />
                                <span>休館(值班)</span>
                            </label>
                            <label className="flex items-center space-x-2">
                                <input type="radio" checked={editedEvent.status === '休館'} onChange={() => handleStatusChange('休館')} />
                                <span>休館(全休)</span>
                            </label>
                        </div>
                        {editedEvent.status === '休館(值班)' && (
                            <p className="text-xs text-gray-500 mt-1">不對外開放，但正職人員需到班值班</p>
                        )}
                    </div>

                    {showStaffFields && (
                        <>
                            {/* 上班時段 */}
                            <div>
                                <label className="block font-semibold mb-2">上班時段</label>
                                <div className="flex items-center space-x-2">
                                    <input type="time" value={shiftStart || '08:30'} onChange={e => handleShiftTimeChange('start', e.target.value)} className="p-2 border rounded" />
                                    <span>至</span>
                                    <input type="time" value={shiftEnd || '17:30'} onChange={e => handleShiftTimeChange('end', e.target.value)} className="p-2 border rounded" />
                                    <span className="text-sm text-gray-500">({calcHours()} 小時)</span>
                                </div>
                            </div>

                            {/* 專責人員 A */}
                            <div>
                                <label className="block font-semibold">專責人員 A</label>
                                <select value={editedEvent.staffA} onChange={e => setEditedEvent({...editedEvent, staffA: e.target.value})} className="w-full p-2 border rounded">
                                    <option value="">未選擇</option>
                                    {fullTimeStaff.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                                </select>
                            </div>

                            {/* 專責人員 B */}
                            <div>
                                <label className="block font-semibold">專責人員 B</label>
                                <select value={editedEvent.staffB} onChange={e => setEditedEvent({...editedEvent, staffB: e.target.value})} className="w-full p-2 border rounded">
                                    <option value="">未選擇</option>
                                    {fullTimeStaff.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                                </select>
                            </div>

                            {/* 兼職人員 */}
                            <div>
                                <label className="block font-semibold">兼職人員</label>
                                <div className="grid grid-cols-2 gap-2 mt-2 max-h-40 overflow-y-auto">
                                    {partTimeStaff.map(e => (
                                        <label key={e.id} className="flex items-center space-x-2 p-2 rounded bg-gray-100">
                                            <input type="checkbox" checked={editedEvent.partTime.includes(e.name)} onChange={() => handlePartTimeChange(e.name)} />
                                            <span>{e.name}</span>
                                        </label>
                                    ))}
                                    {partTimeStaff.length === 0 && <p className="text-gray-400 col-span-2">尚無兼職人員</p>}
                                </div>
                            </div>

                            {/* 排班摘要 */}
                            <div className="bg-blue-50 p-3 rounded text-sm">
                                <p>排班人數：{[editedEvent.staffA, editedEvent.staffB].filter(Boolean).length} 名專責 + {editedEvent.partTime.length} 名兼職</p>
                                <p>預估兼職時數：{editedEvent.partTime.length} 人 x {calcHours()} 小時 = {editedEvent.partTime.length * calcHours()} 小時</p>
                            </div>
                        </>
                    )}
                </div>
                <div className="flex justify-end mt-6 space-x-4">
                    <button onClick={onClose} className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300">取消</button>
                    <button onClick={() => onSave(editedEvent)} className="px-4 py-2 rounded bg-brand-blue-dark text-white hover:bg-blue-700">儲存</button>
                </div>
            </div>
        </div>
    )
}

export default ScheduleManager;
