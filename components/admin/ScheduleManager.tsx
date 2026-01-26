
import React, { useState, useEffect, useCallback } from 'react';
import { apiGetMonthlySchedule, apiUpdateSchedule, apiGetAllEmployees } from '../../services/googleAppsScriptAPI';
import { ScheduleEvent, User } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

const ScheduleManager: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [employees, setEmployees] = useState<User[]>([]);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    const yearMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
    const data = await apiGetMonthlySchedule(yearMonth);
    setSchedule(data);
    setLoading(false);
  }, [currentDate]);

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
  }

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
      
      days.push(
        <div key={day} className={`p-2 min-h-[120px] border-r border-b ${bgColor} transition-all hover:shadow-inner ${event && event.status !== '休館' ? 'cursor-pointer' : ''}`} onClick={() => event && event.status !== '休館' && openEditModal(event)}>
          <div className="font-bold">{day}</div>
          {event && (
            <div className="text-xs mt-1 space-y-1">
              <p className={`font-semibold ${event.status === '休館' ? 'text-red-700' : 'text-green-700'}`}>{event.status}</p>
              {event.status === '營運' && (
                <>
                <p>專責A: {event.staffA || '未排'}</p>
                <p>專責B: {event.staffB || '未排'}</p>
                <p>兼職: {event.partTime.join(', ') || '無'}</p>
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
      <h1 className="text-3xl font-bold text-gray-800 mb-4">排班管理</h1>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon /></button>
        <h3 className="text-xl font-semibold">{currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月</h3>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon /></button>
      </div>
      <div className="grid grid-cols-7 border-t border-l text-center font-bold">
        {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} className="p-2 border-r border-b bg-gray-50">{d}</div>)}
      </div>
      {loading ? <div className="text-center py-10">Loading...</div> : <div className="grid grid-cols-7 border-l">{renderCalendar()}</div>}
      {isModalOpen && selectedEvent && <EditScheduleModal event={selectedEvent} employees={employees} onClose={() => setIsModalOpen(false)} onSave={handleUpdate} />}
    </div>
  );
};

const EditScheduleModal: React.FC<{event: ScheduleEvent, employees: User[], onClose: ()=>void, onSave:(event:ScheduleEvent)=>void}> = ({event, employees, onClose, onSave}) => {
    const [editedEvent, setEditedEvent] = useState(event);

    const fullTimeStaff = employees.filter(e => e.position === '專責人員');
    const partTimeStaff = employees.filter(e => e.position === '兼職人員');

    const handlePartTimeChange = (empName: string) => {
        setEditedEvent(prev => {
            const newPartTime = prev.partTime.includes(empName)
                ? prev.partTime.filter(name => name !== empName)
                : [...prev.partTime, empName];
            return {...prev, partTime: newPartTime};
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg">
                <h2 className="text-xl font-bold mb-4">編輯 {event.date} ({event.dayOfWeek}) 班表</h2>
                <div className="space-y-4">
                    <div>
                        <label className="block font-semibold">專責人員 A</label>
                        <select value={editedEvent.staffA} onChange={e => setEditedEvent({...editedEvent, staffA: e.target.value})} className="w-full p-2 border rounded">
                            <option value="">未選擇</option>
                            {fullTimeStaff.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                        </select>
                    </div>
                     <div>
                        <label className="block font-semibold">專責人員 B</label>
                        <select value={editedEvent.staffB} onChange={e => setEditedEvent({...editedEvent, staffB: e.target.value})} className="w-full p-2 border rounded">
                            <option value="">未選擇</option>
                            {fullTimeStaff.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block font-semibold">兼職人員</label>
                        <div className="grid grid-cols-2 gap-2 mt-2 max-h-40 overflow-y-auto">
                            {partTimeStaff.map(e => (
                                <label key={e.id} className="flex items-center space-x-2 p-2 rounded bg-gray-100">
                                    <input type="checkbox" checked={editedEvent.partTime.includes(e.name)} onChange={() => handlePartTimeChange(e.name)} />
                                    <span>{e.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
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
