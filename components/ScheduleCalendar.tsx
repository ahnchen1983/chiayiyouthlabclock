import React, { useState } from 'react';
import { Shift } from '../types';
import { ChevronLeft, ChevronRight, User as UserIcon, Clock } from 'lucide-react';

interface ScheduleCalendarProps {
    shifts: Shift[];
}

const ScheduleCalendar: React.FC<ScheduleCalendarProps> = ({ shifts }) => {
    const [currentDate, setCurrentDate] = useState(new Date());

    const getDaysInMonth = (date: Date) => {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    };

    const getFirstDayOfMonth = (date: Date) => {
        // 0 = Sunday, 1 = Monday, etc.
        // We want Monday to be first column if we follow ISO, but usually Sunday is first.
        // Let's stick to standard Sunday start for simplicity or Monday start? 
        // Taiwanese calendars often start on Sunday. Let's use Sunday start.
        return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    };

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };

    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);

    // Create array for grid
    const days = [];
    // Add empty slots for days before start of month
    for (let i = 0; i < firstDay; i++) {
        days.push(null);
    }
    // Add actual days
    for (let i = 1; i <= daysInMonth; i++) {
        days.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), i));
    }

    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekDaysZh = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

    const getShiftsForDate = (date: Date) => {
        const dateString = date.toISOString().split('T')[0];
        return shifts.filter(s => s.date === dateString).sort((a, b) => a.startTime.localeCompare(b.startTime));
    };

    return (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden h-full flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
                </h2>
                <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
                    <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-50 rounded-md text-slate-600 transition">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button onClick={handleNextMonth} className="p-2 hover:bg-slate-50 rounded-md text-slate-600 transition">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="flex-1 flex flex-col overflow-auto">
                {/* Week Headers */}
                <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
                    {weekDaysZh.map((day, idx) => (
                        <div key={day} className={`py-3 text-center text-xs font-bold uppercase tracking-wider ${idx === 0 || idx === 6 ? 'text-rose-500' : 'text-slate-500'}`}>
                            {day}
                        </div>
                    ))}
                </div>

                {/* Days */}
                <div className="grid grid-cols-7 auto-rows-fr flex-1 bg-slate-50 gap-px border-b border-l border-slate-100">
                    {days.map((date, idx) => {
                        if (!date) return <div key={`empty-${idx}`} className="bg-white min-h-[120px]"></div>;

                        const dayShifts = getShiftsForDate(date);
                        const isToday = new Date().toDateString() === date.toDateString();
                        const isClosed = date.getDay() === 1 || date.getDay() === 2; // Mon/Tue Closed

                        return (
                            <div
                                key={date.toISOString()}
                                className={`
                  bg-white min-h-[120px] p-2 transition hover:bg-slate-50/80
                  ${isToday ? 'bg-indigo-50/30' : ''}
                  ${isClosed ? 'bg-slate-50/50' : ''}
                `}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <span className={`
                    text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'text-slate-700'}
                  `}>
                                        {date.getDate()}
                                    </span>
                                    {isClosed && <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-bold">休館</span>}
                                </div>

                                <div className="space-y-1.5">
                                    {dayShifts.map(shift => (
                                        <div
                                            key={shift.id}
                                            className="text-xs p-1.5 rounded-lg border border-slate-100 bg-white shadow-sm flex flex-col gap-0.5 group hover:border-indigo-200 hover:shadow-md transition cursor-default"
                                        >
                                            <div className="flex items-center gap-1 font-bold text-slate-700">
                                                <div className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[8px]">
                                                    {shift.userName.charAt(0)}
                                                </div>
                                                <span className="truncate">{shift.userName}</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                                <Clock className="w-3 h-3" />
                                                <span>{shift.startTime}-{shift.endTime}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {dayShifts.length === 0 && !isClosed && (
                                        <div className="h-full flex items-center justify-center opacity-0 hover:opacity-100 transition">
                                            {/* Placeholder for easier adding in future? */}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default ScheduleCalendar;
