
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiGetEmployeeSchedule, apiGetEmployeeLeaveRequests } from '../../services/googleAppsScriptAPI';
import { ScheduleEvent, LeaveRequest, LeaveStatus } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

const MyScheduleCalendar: React.FC = () => {
  const { user } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch_data = async () => {
      if (user) {
        setLoading(true);
        const yearMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
        const [scheduleData, leaveData] = await Promise.all([
          apiGetEmployeeSchedule(user.id, yearMonth),
          apiGetEmployeeLeaveRequests(user.id)
        ]);
        setSchedule(scheduleData);
        setLeaveRequests(leaveData);
        setLoading(false);
      }
    };
    fetch_data();
  }, [user, currentDate]);

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
    // Pad start
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`pad-start-${i}`} className="border-r border-b p-2"></div>);
    }
    
    // Fill days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const event = schedule.find(e => e.date === dateStr);
      
      const isOnLeave = leaveRequests.some(req => 
        req.status === LeaveStatus.Approved && 
        dateStr >= req.startDate.slice(0, 10) && 
        dateStr <= req.endDate.slice(0, 10)
      );

      let bgColor = 'bg-white';
      if(isOnLeave) bgColor = 'bg-yellow-100';
      else if(event?.status === '休館') bgColor = 'bg-bg-closed';
      else if (['三', '四'].includes(event?.dayOfWeek ?? '')) bgColor = 'bg-bg-wed-thu';
      else if (['五', '六', '日'].includes(event?.dayOfWeek ?? '')) bgColor = 'bg-bg-fri-sun';

      days.push(
        <div key={day} className={`border-r border-b p-2 min-h-[100px] ${bgColor}`}>
          <div className="font-bold">{day}</div>
          {isOnLeave && (
            <div className="text-xs mt-1">
                <span className="px-2 py-1 font-semibold text-yellow-800 bg-alert-yellow rounded-full">請假</span>
            </div>
          )}
          {event && !isOnLeave && (
            <div className="text-xs mt-1">
              <p className={`font-semibold ${event.status === '休館' ? 'text-red-700' : 'text-green-700'}`}>{event.status}</p>
              {event.status === '營運' && <p className="text-gray-600">{event.shiftTime}</p>}
            </div>
          )}
        </div>
      );
    }

    // Pad end
    const totalCells = days.length;
    const remainingCells = 7 - (totalCells % 7);
    if(remainingCells < 7) {
        for (let i = 0; i < remainingCells; i++) {
            days.push(<div key={`pad-end-${i}`} className="border-r border-b p-2"></div>);
        }
    }

    return days;
  };

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">我的班表</h2>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon /></button>
        <h3 className="text-xl font-semibold">{currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月</h3>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon /></button>
      </div>
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-4 border-brand-green-dark border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="grid grid-cols-7 border-t border-l">
          {weekdays.map(day => <div key={day} className="text-center font-bold p-2 border-r border-b bg-gray-50">{day}</div>)}
          {renderCalendar()}
        </div>
      )}
       <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <div className="flex items-center"><div className="w-4 h-4 bg-bg-closed mr-2"></div>休館日</div>
        <div className="flex items-center"><div className="w-4 h-4 bg-bg-wed-thu mr-2"></div>週三四班</div>
        <div className="flex items-center"><div className="w-4 h-4 bg-bg-fri-sun mr-2"></div>週五六日班</div>
        <div className="flex items-center"><div className="w-4 h-4 bg-alert-yellow mr-2"></div>請假日</div>
      </div>
    </div>
  );
};

export default MyScheduleCalendar;
