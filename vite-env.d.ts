/// <reference types="vite/client" />

// Phase 7.5：宣告 Sentry 用到的 env 變數型別
interface ImportMetaEnv {
    readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
