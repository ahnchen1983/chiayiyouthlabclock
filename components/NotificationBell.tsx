import React, { useEffect, useState, useRef } from 'react';
import { apiGetNotifications, apiMarkNotificationRead, apiMarkAllNotificationsRead } from '../services/googleAppsScriptAPI';
import { enableFcm, getFcmEnabled } from '../services/fcmClient';
import { Notification } from '../types';

const BellIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
);

const NotificationBell: React.FC = () => {
    const [list, setList] = useState<Notification[]>([]);
    const [open, setOpen] = useState(false);
    const [fcmEnabled, setFcmEnabled] = useState(getFcmEnabled());
    const [fcmBusy, setFcmBusy] = useState(false);
    const [toast, setToast] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const fcmConfigured = Boolean(import.meta.env.VITE_FCM_VAPID_KEY);

    const load = async () => {
        try {
            const data = await apiGetNotifications();
            setList(data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        load();
        const t = setInterval(load, 180000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ title?: string; message?: string }>).detail;
            setToast(detail?.title || '收到新通知');
            load();
            window.setTimeout(() => setToast(''), 4000);
        };
        window.addEventListener('fcm-foreground-message', handler);
        return () => window.removeEventListener('fcm-foreground-message', handler);
    }, []);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const unread = list.filter(n => !n.read).length;

    const handleMarkAll = async () => {
        await apiMarkAllNotificationsRead();
        await load();
    };

    const handleClick = async (n: Notification) => {
        if (!n.read) {
            await apiMarkNotificationRead(n.id);
            setList(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
        }
    };

    const handleEnableFcm = async () => {
        setFcmBusy(true);
        const result = await enableFcm();
        setFcmBusy(false);
        if ('error' in result) {
            alert(result.error);
            return;
        }
        setFcmEnabled(true);
        setToast('即時通知已啟用');
        window.setTimeout(() => setToast(''), 4000);
    };

    return (
        <div className="relative" ref={ref}>
            {toast && (
                <div className="fixed right-4 top-16 z-50 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
                    {toast}
                </div>
            )}
            <button
                onClick={() => setOpen(o => !o)}
                className="relative p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-full"
                title="通知"
            >
                <BellIcon className="w-6 h-6" />
                {unread > 0 && (
                    <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-500 rounded-full">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border z-50 max-h-96 overflow-y-auto">
                    <div className="p-3 border-b flex items-center justify-between">
                        <h3 className="font-bold text-gray-800">通知</h3>
                        {unread > 0 && (
                            <button onClick={handleMarkAll} className="text-xs text-blue-600 hover:underline">全部標為已讀</button>
                        )}
                    </div>
                    {!fcmEnabled && (
                        <button
                            onClick={handleEnableFcm}
                            disabled={fcmBusy || !fcmConfigured}
                            className="w-full border-b bg-blue-50 py-2 text-xs text-blue-700 hover:bg-blue-100 disabled:bg-gray-50 disabled:text-gray-400"
                            title={fcmConfigured ? '啟用即時通知' : '系統未設定 FCM VAPID key'}
                        >
                            {fcmBusy ? '啟用中...' : fcmConfigured ? '🔔 啟用即時通知' : '🔔 即時通知未設定'}
                        </button>
                    )}
                    {list.length === 0 ? (
                        <p className="p-6 text-center text-sm text-gray-500">沒有通知</p>
                    ) : (
                        <ul>
                            {list.map(n => (
                                <li
                                    key={n.id}
                                    onClick={() => handleClick(n)}
                                    className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${n.read ? '' : 'bg-blue-50'}`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="font-medium text-sm text-gray-800">{n.title}</p>
                                        {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0"></span>}
                                    </div>
                                    <p className="text-xs text-gray-600 mt-1">{n.message}</p>
                                    <p className="text-xs text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString('zh-TW')}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
