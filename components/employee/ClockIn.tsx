
import React, { useState, useEffect, useCallback } from 'react';
import useClock from '../../hooks/useClock';
import { useAuth } from '../../contexts/AuthContext';
import { apiGetTodayClockStatus, apiClockIn, apiClockOut, apiValidateGPS } from '../../services/googleAppsScriptAPI';
import { ClockStatus } from '../../types';
import { WifiIcon, MapPinIcon } from '../icons';
import { calculateDistance } from '../../utils/geolocation';

type VerificationMethod = 'IP' | 'GPS';

const ClockIn: React.FC = () => {
    const time = useClock();
    const { user } = useAuth();
    const [clockStatus, setClockStatus] = useState<ClockStatus>({});
    const [loading, setLoading] = useState(true);
    const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>('IP');
    const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
    const [isProcessing, setIsProcessing] = useState(false);

    const fetchClockStatus = useCallback(async () => {
        if (user) {
            setLoading(true);
            const status = await apiGetTodayClockStatus(user.id);
            setClockStatus(status);
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchClockStatus();
    }, [fetchClockStatus]);

    const handleClockIn = async () => {
        if (!user) return;
        setIsProcessing(true);
        setStatusMessage({ type: 'info', text: '驗證中...' });

        let verificationData = '127.0.0.1'; // Mock IP
        let isValid = true;

        if (verificationMethod === 'GPS') {
            try {
                const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
                });
                const { latitude, longitude } = position.coords;
                verificationData = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
                const validationResult = await apiValidateGPS(latitude, longitude);
                isValid = validationResult.isValid;
                setStatusMessage({ 
                    type: isValid ? 'success' : 'error', 
                    text: isValid ? `GPS驗證成功` : `驗證失敗: 距離場館 ${validationResult.distance?.toFixed(0)} 公尺` 
                });
            } catch (error) {
                setStatusMessage({ type: 'error', text: '無法取得GPS位置，請確認已授權。' });
                setIsProcessing(false);
                return;
            }
        } else {
             setStatusMessage({ type: 'success', text: 'IP驗證成功 (模擬)' });
        }

        if (isValid) {
            const success = await apiClockIn(user.id, user.name, verificationMethod, verificationData);
            if(success) {
                setStatusMessage({ type: 'success', text: '上班打卡成功！' });
                await fetchClockStatus();
            } else {
                setStatusMessage({ type: 'error', text: '打卡失敗，請稍後再試。' });
            }
        }
        setIsProcessing(false);
    };

    const handleClockOut = async () => {
        if (!user) return;
        setIsProcessing(true);
        setStatusMessage({ type: 'info', text: '驗證中...' });

        let verificationData = '127.0.0.1'; // Mock IP
        let isValid = true;
        
        // You might want to re-validate on clock-out as well
        if (verificationMethod === 'GPS') {
             try {
                const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
                });
                const { latitude, longitude } = position.coords;
                verificationData = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
                const validationResult = await apiValidateGPS(latitude, longitude);
                isValid = validationResult.isValid;
                 setStatusMessage({ 
                    type: isValid ? 'success' : 'error', 
                    text: isValid ? `GPS驗證成功` : `驗證失敗: 距離場館 ${validationResult.distance?.toFixed(0)} 公尺` 
                });
            } catch (error) {
                setStatusMessage({ type: 'error', text: '無法取得GPS位置' });
                setIsProcessing(false);
                return;
            }
        } else {
            setStatusMessage({ type: 'success', text: 'IP驗證成功 (模擬)' });
        }


        if(isValid) {
            const success = await apiClockOut(user.id);
            if (success) {
                setStatusMessage({ type: 'success', text: '下班打卡成功！' });
                await fetchClockStatus();
            } else {
                 setStatusMessage({ type: 'error', text: '打卡失敗，請稍後再試。' });
            }
        }
        setIsProcessing(false);
    };

    const getStatusColor = () => {
        if (statusMessage.type === 'success') return 'text-status-success';
        if (statusMessage.type === 'error') return 'text-status-error';
        if (statusMessage.type === 'info') return 'text-gray-600';
        return 'text-gray-500';
    };

    return (
        <div className="max-w-md mx-auto mt-4">
            <div className="p-6 bg-white rounded-2xl shadow-lg">
                <div className="text-center">
                    <h2 className="text-2xl font-semibold text-gray-700">即時打卡</h2>
                    <p className="text-5xl font-bold text-gray-900 mt-2">{time.toLocaleTimeString('en-GB')}</p>
                    <p className="text-gray-500">{time.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
                </div>

                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                    <h3 className="font-semibold text-gray-800">今日打卡狀態</h3>
                    {loading ? <p className="text-center text-gray-500">讀取中...</p> : (
                        <div className="grid grid-cols-2 gap-4 mt-2 text-center">
                            <div>
                                <p className="text-sm text-gray-500">上班</p>
                                <p className="text-lg font-semibold text-brand-green-dark">{clockStatus.clockInTime || '--:--'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">下班</p>
                                <p className="text-lg font-semibold text-status-error">{clockStatus.clockOutTime || '--:--'}</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-6">
                    <h3 className="font-semibold text-center text-gray-800 mb-3">選擇驗證方式</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <button onClick={() => setVerificationMethod('IP')} className={`flex items-center justify-center p-4 border-2 rounded-lg transition-all ${verificationMethod === 'IP' ? 'bg-green-100 border-brand-green-dark' : 'bg-gray-100 border-gray-200'}`}>
                            <WifiIcon className="w-6 h-6 mr-2 text-brand-green-dark" />
                            <span className="font-medium">IP 驗證</span>
                        </button>
                        <button onClick={() => setVerificationMethod('GPS')} className={`flex items-center justify-center p-4 border-2 rounded-lg transition-all ${verificationMethod === 'GPS' ? 'bg-green-100 border-brand-green-dark' : 'bg-gray-100 border-gray-200'}`}>
                            <MapPinIcon className="w-6 h-6 mr-2 text-brand-green-dark" />
                            <span className="font-medium">GPS 定位</span>
                        </button>
                    </div>
                </div>
                
                <div className="mt-4 text-center h-6">
                    {statusMessage.text && <p className={`text-sm ${getStatusColor()}`}>{statusMessage.text}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                    <button onClick={handleClockIn} disabled={!!clockStatus.clockInTime || isProcessing} className="w-full py-3 text-lg font-bold text-white rounded-lg bg-brand-green-dark hover:bg-brand-green-light disabled:bg-gray-400 transition-colors">
                        上班打卡
                    </button>
                    <button onClick={handleClockOut} disabled={!clockStatus.clockInTime || !!clockStatus.clockOutTime || isProcessing} className="w-full py-3 text-lg font-bold text-white bg-status-error hover:bg-red-700 disabled:bg-gray-400 transition-colors">
                        下班打卡
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClockIn;
