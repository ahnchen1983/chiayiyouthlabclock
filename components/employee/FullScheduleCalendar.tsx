
import React, { useState, useEffect, useCallback } from 'react';
import { apiGetMonthlySchedule, apiGetAllLeaveRequests } from '../../services/googleAppsScriptAPI';
import { ScheduleEvent, LeaveRequest, LeaveStatus } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

const FullScheduleCalendar: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([]);
  const [allLeaveRequests, setAllLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    const yearMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
    const [scheduleData, leaveData] = await Promise.all([
        apiGetMonthlySchedule(yearMonth),
        apiGetAllLeaveRequests()
    ]);
    setSchedule(scheduleData);
    setAllLeaveRequests(leaveData);
    setLoading(false);
  }, [currentDate]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const changeMonth = (offset: number) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + offset);
      return newDate;
    });
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

      const leavesForDay = allLeaveRequests.filter(req => 
        req.status === LeaveStatus.Approved &&
        dateStr >= req.startDate.slice(0, 10) &&
        dateStr <= req.endDate.slice(0, 10)
      );

      let bgColor = 'bg-white';
      if(event) {
        if(event.status === '休館') bgColor = 'bg-bg-closed';
        else if (['三', '四'].includes(event.dayOfWeek)) bgColor = 'bg-bg-wed-thu';
        else if (['五', '六', '日'].includes(event.dayOfWeek)) bgColor = 'bg-bg-fri-sun';
      }
      
      days.push(
        <div key={day} className={`p-2 min-h-[120px] border-r border-b ${bgColor}`}>
          <div className="font-bold">{day}</div>
          {event && (
            <div className="text-xs mt-1 space-y-1">
              <p className={`font-semibold ${event.status === '休館' ? 'text-red-700' : 'text-green-700'}`}>{event.status}</p>
              {event.status === '營運' && (
                <>
                <p>專責A: <span className="font-medium">{event.staffA || '未排'}</span></p>
                <p>專責B: <span className="font-medium">{event.staffB || '未排'}</span></p>
                <p>兼職: <span className="font-medium">{event.partTime.join(', ') || '無'}</span></p>
                </>
              )}
            </div>
          )}
           {leavesForDay.length > 0 && (
            <div className="text-xs mt-2 pt-1 border-t border-gray-300">
                <p className="font-bold text-yellow-800">請假:</p>
                <p className="font-medium text-yellow-800">{leavesForDay.map(l => l.name).join(', ')}</p>
            </div>
           )}
        </div>
      );
    }
    return days;
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">總班表</h2>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon /></button>
        <h3 className="text-xl font-semibold">{currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月</h3>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon /></button>
      </div>
      <div className="grid grid-cols-7 border-t border-l text-center font-bold">
        {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} className="p-2 border-r border-b bg-gray-50">{d}</div>)}
      </div>
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-4 border-brand-green-dark border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : <div className="grid grid-cols-7 border-l">{renderCalendar()}</div>}
       <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <div className="flex items-center"><div className="w-4 h-4 bg-bg-closed mr-2"></div>休館日</div>
        <div className="flex items-center"><div className="w-4 h-4 bg-bg-wed-thu mr-2"></div>週三四班</div>
        <div className="flex items-center"><div className="w-4 h-4 bg-bg-fri-sun mr-2"></div>週五六日班</div>
      </div>
    </div>
  );
};

export default FullScheduleCalendar;
