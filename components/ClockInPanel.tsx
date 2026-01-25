
import React, { useState, useEffect } from 'react';
import { User, NetworkInfo, AttendanceRecord } from '../types';
import { Wifi, WifiOff, MapPin, Loader2, CheckCircle, Fingerprint } from 'lucide-react';
import { COMPANY_WIFI_NAME } from '../constants';

interface ClockInPanelProps {
  currentUser: User;
  networkStatus: NetworkInfo;
  onClockIn: (record: AttendanceRecord) => void;
  currentAttendance?: AttendanceRecord;
}

const ClockInPanel: React.FC<ClockInPanelProps> = ({ currentUser, networkStatus, onClockIn, currentAttendance }) => {
  const [time, setTime] = useState(new Date().toLocaleTimeString());
  const [isVerifying, setIsVerifying] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleAction = async () => {
    if (!networkStatus.isInternal) {
      alert("打卡失敗：您必須連接至公司內部 WiFi 網路才能進行考勤打卡。");
      return;
    }

    setIsVerifying(true);
    // Simulate biometric or server validation
    await new Promise(resolve => setTimeout(resolve, 1500));

    const record: AttendanceRecord = {
      id: Math.random().toString(36).substr(2, 9),
      userId: currentUser.id,
      date: new Date().toISOString().split('T')[0],
      clockIn: currentAttendance ? currentAttendance.clockIn : new Date().toTimeString().slice(0, 5),
      clockOut: currentAttendance ? new Date().toTimeString().slice(0, 5) : null,
      networkVerified: true,
      locationVerified: true,
    };

    onClockIn(record);
    setIsVerifying(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 text-center space-y-6">
        <div className="space-y-2">
          <h3 className="text-4xl font-extrabold text-slate-800 tracking-tight">{time}</h3>
          <p className="text-slate-500 font-medium">{new Date().toDateString()}</p>
        </div>

        <div className="relative group">
          <button
            onClick={handleAction}
            disabled={isVerifying || (currentAttendance?.clockIn && currentAttendance?.clockOut)}
            className={`
              w-48 h-48 rounded-full flex flex-col items-center justify-center space-y-3 transition-all duration-300
              ${success ? 'bg-emerald-500 text-white' :
                networkStatus.isInternal
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-200 active:scale-95'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'}
            `}
          >
            {isVerifying ? (
              <Loader2 className="w-16 h-16 animate-spin" />
            ) : success ? (
              <CheckCircle className="w-16 h-16" />
            ) : (
              <>
                <Fingerprint className="w-16 h-16" />
                <span className="font-bold text-lg">
                  {currentAttendance ? (currentAttendance.clockOut ? '已完成' : '下班打卡') : '上班打卡'}
                </span>
              </>
            )}
          </button>

          {networkStatus.isInternal && !currentAttendance?.clockOut && (
            <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full border-4 border-white animate-ping"></div>
          )}
        </div>

        <div className="space-y-4">
          <div className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${networkStatus.isInternal ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
            <div className="flex items-center space-x-3">
              {networkStatus.isInternal ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
              <div className="text-left">
                <p className="text-sm font-bold">{networkStatus.isInternal ? '網路已驗證' : '未知網路'}</p>
                <p className="text-xs opacity-80">{networkStatus.isInternal ? `已連接：${COMPANY_WIFI_NAME}` : '請切換至辦公室 WiFi'}</p>
              </div>
            </div>
            <div className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${networkStatus.isInternal ? 'bg-emerald-200' : 'bg-rose-200'}`}>
              {networkStatus.isInternal ? '安全' : '受阻'}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="flex items-center space-x-3 text-slate-600">
              <MapPin className="w-5 h-5" />
              <div className="text-left">
                <p className="text-sm font-bold">辦公室地理圍欄</p>
                <p className="text-xs">位置：總部辦公室 - A區</p>
              </div>
            </div>
            <div className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-200 text-slate-500">
              已驗證
            </div>
          </div>
        </div>
      </div>

      <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
        <h4 className="font-bold text-indigo-900 mb-2">今日摘要</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-white p-3 rounded-xl border border-indigo-100">
            <span className="text-slate-500 block">上班打卡</span>
            <span className="font-bold text-lg text-indigo-600">{currentAttendance?.clockIn || '--:--'}</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-indigo-100">
            <span className="text-slate-500 block">下班打卡</span>
            <span className="font-bold text-lg text-indigo-600">{currentAttendance?.clockOut || '--:--'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClockInPanel;
