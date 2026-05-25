
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { scrubPasswordFields } from './services/sentryUser';

// ==================== Sentry 錯誤監控（Phase 7.5）====================
//
// DSN 未設定時不 init（dev / build 無 DSN 仍可正常跑）。
// dev 環境一律 drop 事件不送 Sentry，避免吃 5K/月配額。
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,
        beforeSend(event) {
            if (import.meta.env.MODE === 'development') return null;
            scrubPasswordFields(event);
            return event;
        },
    });
}

const isDynamicImportFailure = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(message);
};

const currentEntrySrc = (): string => {
    const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
    return entry?.src ?? 'unknown-entry';
};

const reloadOnceForFreshChunks = (error: unknown): void => {
    if (!isDynamicImportFailure(error)) return;

    const key = `chunk-reload-attempted:${currentEntrySrc()}`;
    if (sessionStorage.getItem(key) === '1') return;

    sessionStorage.setItem(key, '1');
    window.location.reload();
};

window.addEventListener('error', (event) => reloadOnceForFreshChunks(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reloadOnceForFreshChunks(event.reason));

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
