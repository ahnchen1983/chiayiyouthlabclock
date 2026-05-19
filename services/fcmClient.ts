import { getMessagingClient } from './firebaseConfig';
import { apiRegisterFcmToken, apiUnregisterFcmToken } from './googleAppsScriptAPI';

const FCM_TOKEN_KEY = 'fcmToken';
const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY;

const setCachedToken = (token: string | null) => {
    if (token) window.localStorage.setItem(FCM_TOKEN_KEY, token);
    else window.localStorage.removeItem(FCM_TOKEN_KEY);
};

const getCachedToken = () => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(FCM_TOKEN_KEY);
};

export const enableFcm = async (): Promise<{ token: string } | { error: string }> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
        return { error: '此瀏覽器不支援通知' };
    }
    if (!VAPID_KEY) return { error: '系統未設定 FCM VAPID key' };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { error: '使用者拒絕通知權限' };

    const messaging = await getMessagingClient();
    if (!messaging) return { error: '瀏覽器不支援 FCM' };

    const { getToken, onMessage } = await import('firebase/messaging');
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return { error: '無法取得 FCM token' };

    await apiRegisterFcmToken(token, navigator.userAgent);
    setCachedToken(token);

    onMessage(messaging, payload => {
        const { title, message } = payload.data || {};
        window.dispatchEvent(new CustomEvent('fcm-foreground-message', { detail: { title, message } }));
    });

    return { token };
};

export const disableFcm = async (): Promise<void> => {
    const token = getCachedToken();
    if (!token) return;
    await apiUnregisterFcmToken(token).catch(() => {});
    setCachedToken(null);
};

export const getFcmEnabled = (): boolean => getCachedToken() !== null;
