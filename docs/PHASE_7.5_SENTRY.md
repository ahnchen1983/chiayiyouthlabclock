# Phase 7.5 — Sentry 錯誤監控工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 半天（含單元測試 + typecheck + build + 手動驗收）
> **對應 Roadmap：** Phase 7.5
> **對應 SDD 議題：** 補強觀測性（production 錯誤目前只進瀏覽器 console，無中央收集）
> **依賴：** 無（純前端整合 + 一個 npm 套件 + 三檔修改）
> **客戶決策：** D7 採 Sentry 雲端（免費 5K events/月）

---

## 1. 目標

`ErrorBoundary.componentDidCatch` 目前只把錯誤打進 `console.error`，production 環境完全看不到使用者端的錯誤。一旦員工打卡或排班出現 React render 例外，管理員無法主動發現，只能等使用者回報，故障平均偵測時間（MTTD）= ∞。

本工單目標：

1. 整合 `@sentry/react`，在 `index.tsx` 最早 init Sentry
2. `ErrorBoundary.componentDidCatch` 把 `error + errorInfo` 上報 Sentry
3. `AuthContext` 登入/登出時設置 / 清除 Sentry user context（**僅 empId + role，不送姓名、不送 email**）
4. `beforeSend` hook 過濾開發環境 + 抹掉可能殘留的密碼欄位
5. README 補環境變數設定段；本工單末段附 Netlify Dashboard 設定步驟
6. 為新行為新增 ≥ 3 個 Vitest 測試（mock `@sentry/react`）

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| Sentry 整合 | 無 | `@sentry/react` 已安裝並 init |
| ErrorBoundary 上報 | 僅 console.error | console.error + Sentry.captureException |
| 登入後 user context | 無 | `Sentry.setUser({ id, role })` |
| 個資外洩風險 | — | 姓名 / email **絕不**送 Sentry |
| Vitest 新增 | — | ≥ 3（67 → ≥ 70 全綠） |
| typecheck / build / 既有 67 測試 | 全綠 | 全綠（不可破壞） |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `package.json` | **新增** dependency `@sentry/react` |
| `index.tsx` | **修改** — 最頂端 init Sentry，從 `import.meta.env` 讀 DSN / MODE |
| `components/ErrorBoundary.tsx` | **修改** — `componentDidCatch` 加 `Sentry.captureException` |
| `contexts/AuthContext.tsx` | **修改** — `login` 成功後 `setUser`、`logout` 時 `setUser(null)` |
| `tests/sentry.test.ts` | **新增** — mock `@sentry/react`，驗證上報行為 |
| `README.md` | **修改** — 補「環境變數 — VITE_SENTRY_DSN」段 |

**不要動：**
- ❌ `vite.config.ts`（source map upload 是另一張 follow-up 票）
- ❌ `netlify/functions/api.ts`（後端錯誤監控本身不在這張範圍）
- ❌ 既有 67 個 Vitest 測試
- ❌ `types.ts`
- ❌ 任何 components/ 下的功能元件
- ❌ Sentry session replay 啟用（`replaysSessionSampleRate` 必須 0）

---

## 3. 實作規格

### 3.1 套件安裝

```bash
npm i @sentry/react
```

> 不要加 `@sentry/tracing`（v8+ 已併入主套件）。不要加 `@sentry/vite-plugin`（source map 是後續）。

### 3.2 `index.tsx` — Sentry init

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';

// Sentry 錯誤監控（Phase 7.5）
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,
        beforeSend(event, hint) {
            if (import.meta.env.MODE === 'development') return null;
            scrubPasswordFields(event);
            return event;
        },
    });
}

function scrubPasswordFields(event: Sentry.ErrorEvent): void {
    const SENSITIVE_KEYS = new Set([
        'password', 'newPassword', 'oldPassword', 'currentPassword', 'confirmPassword',
    ]);
    const walk = (obj: unknown): void => {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (SENSITIVE_KEYS.has(k) && typeof v === 'string') {
                (obj as Record<string, unknown>)[k] = '[Filtered]';
            } else if (typeof v === 'object') {
                walk(v);
            }
        }
    };
    walk(event.extra);
    walk(event.contexts);
    if (event.breadcrumbs) {
        for (const bc of event.breadcrumbs) walk(bc.data);
    }
    if (event.request) walk(event.request);
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**重點：**
- DSN 沒設時 **不 init**（lint / build 時不會炸）。開發機沒設 DSN 也能正常跑
- `beforeSend` 在 dev 直接回 `null`，本機不會送任何事件、不會吃 5K/月配額
- `scrubPasswordFields` 是**保險絲**：強制過濾 password 欄位

### 3.3 `components/ErrorBoundary.tsx` 改動

只在 `componentDidCatch` 加一行上報。**不要改其他邏輯**：

```tsx
import * as Sentry from '@sentry/react';

componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
    Sentry.captureException(error, {
        extra: {
            componentStack: info.componentStack,
        },
    });
}
```

### 3.4 `contexts/AuthContext.tsx` 改動

只在三處插入呼叫，不改 control flow：

```tsx
import * as Sentry from '@sentry/react';

// 在 useEffect 內 session 還原處
if (savedUser) {
    const parsed: User = JSON.parse(savedUser);
    setUser(parsed);
    Sentry.setUser({ id: parsed.empId, role: parsed.role });
}

// login 成功後
if (loggedInUser) {
    setUser(loggedInUser);
    sessionStorage.setItem('user', JSON.stringify(loggedInUser));
    Sentry.setUser({ id: loggedInUser.empId, role: loggedInUser.role });
    return loggedInUser;
}

// logout
Sentry.setUser(null);
```

**個資紅線：** `Sentry.setUser` payload 只能含 `id` 和 `role`。**禁止**傳 `name`、`email`、`phone`、`username`。

### 3.5 `tests/sentry.test.ts`（新檔）— ≥ 3 個測試

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react'; // 若無 RTL，改用 react-dom/test-utils

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    captureException: vi.fn(),
    setUser: vi.fn(),
}));

import * as Sentry from '@sentry/react';
import ErrorBoundary from '../components/ErrorBoundary';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

vi.mock('../services/googleAppsScriptAPI', () => ({
    apiLogin: vi.fn(async () => ({ empId: 'EMP001', role: '員工', name: '王小明' })),
    apiLogout: vi.fn(async () => {}),
    apiInitializeDatabase: vi.fn(async () => {}),
}));

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
});

describe('ErrorBoundary → Sentry', () => {
    it('componentDidCatch 會呼叫 Sentry.captureException', () => {
        const Boom: React.FC = () => { throw new Error('boom'); };
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>
        );
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [err, ctx] = (Sentry.captureException as any).mock.calls[0];
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('boom');
        expect(ctx.extra).toHaveProperty('componentStack');
        spy.mockRestore();
    });
});

describe('AuthContext → Sentry user context', () => {
    it('login 成功後 setUser 只送 id 與 role（不送 name）', async () => {
        const TriggerLogin: React.FC = () => {
            const { login } = useAuth();
            React.useEffect(() => { login('EMP001', 'pw').catch(() => {}); }, []);
            return null;
        };
        await act(async () => {
            render(
                <AuthProvider>
                    <TriggerLogin />
                </AuthProvider>
            );
            await new Promise(r => setTimeout(r, 0));
        });
        expect(Sentry.setUser).toHaveBeenCalled();
        const payload = (Sentry.setUser as any).mock.calls.at(-1)[0];
        expect(payload).toEqual({ id: 'EMP001', role: '員工' });
        expect(payload).not.toHaveProperty('name');
        expect(payload).not.toHaveProperty('email');
    });

    it('logout 會呼叫 Sentry.setUser(null)', async () => {
        const Trigger: React.FC = () => {
            const { login, logout } = useAuth();
            React.useEffect(() => {
                (async () => {
                    await login('EMP001', 'pw').catch(() => {});
                    logout();
                })();
            }, []);
            return null;
        };
        await act(async () => {
            render(<AuthProvider><Trigger /></AuthProvider>);
            await new Promise(r => setTimeout(r, 0));
        });
        const lastCall = (Sentry.setUser as any).mock.calls.at(-1);
        expect(lastCall[0]).toBeNull();
    });
});
```

> 如果專案目前沒裝 `@testing-library/react`，**不要新增**。改用 `react-dom/client` + 手動 `act` 渲染到 detached div 也可達到同樣效果。Codex 自行擇一，但測試案例數 ≥ 3。

### 3.6 環境變數 — `.env` 範本

開發者本機建立 `.env`（檔案不進 git），新增：

```
VITE_SENTRY_DSN=https://<public_key>@<org>.ingest.sentry.io/<project_id>
```

留空或不設 = Sentry 不會 init。

### 3.7 README.md 補段（接在現有「2. 設定環境變數」段之後）

```markdown
### Sentry 錯誤監控（選用）

Production 部署到 Netlify 時，於 Netlify Dashboard > Site settings > Environment variables 設定：

| 變數名 | 值 | 說明 |
|--------|-----|------|
| `VITE_SENTRY_DSN` | `https://...@sentry.io/...` | 在 Sentry 專案 Settings > Client Keys (DSN) 取得 |

留空或不設則 Sentry 不會啟動。個資原則：本系統送往 Sentry 的 user context 僅含 `empId` 與 `role`。
```

### 3.8 Netlify Dashboard 設定步驟（給上線者）

1. 登入 Sentry，建立專案（platform 選 `React`）
2. 複製 DSN
3. Netlify Dashboard > Site > Environment variables > Add
4. Key = `VITE_SENTRY_DSN`，Value = 上一步 DSN，Scope = `Builds`
5. Trigger 一次 redeploy
6. 部署完到 production，故意在 console 跑 `throw new Error('sentry-smoke-test')`，15 秒內 Sentry Issues 頁應出現該事件

---

## 4. 驗收條件

### 4.1 量化（CI 自動跑）

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 70 個測試全綠**（67 + 3 新增） |
| 3 | `npm run build` | 無 chunk size 警告；產物 size 增加 ≤ 100 KB（gzip 後 ≤ 35 KB） |

### 4.2 程式碼審查

- [ ] `package.json` 新增 `@sentry/react`，**未**新增 `@sentry/tracing`、`@sentry/vite-plugin`
- [ ] `index.tsx` 在 `createRoot` 前 init Sentry，且 DSN 缺時不 init
- [ ] `beforeSend` 對 `MODE === 'development'` 回 `null`
- [ ] `scrubPasswordFields` 至少蓋住 `extra` / `contexts` / `breadcrumbs[].data` / `request`
- [ ] `ErrorBoundary.componentDidCatch` 保留原本 `console.error` 不刪
- [ ] `AuthContext` 三處 setUser payload **不含 name / email**
- [ ] `vite.config.ts` 未被改動（`git diff vite.config.ts` 為空）

### 4.3 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | `.env` 不放 DSN，`npm run dev` | console 無 Sentry 訊息、登入登出正常 |
| 2 | `.env` 放真實 DSN，`npm run dev` | dev 模式 `beforeSend` 回 null，**不送事件**；console 應有 Sentry init log |
| 3 | `npm run build && npm run preview`，故意 throw | Sentry Dashboard > Issues 30 秒內出現，user 欄位顯示 `id: ADMIN, role: 最高管理者`，**不顯示姓名** |
| 4 | Sentry Issue detail 檢查 `extra.componentStack` | 有完整 React component stack |
| 5 | Sentry Issue detail 搜尋 `password` | 找不到任何明文（若有必為 `[Filtered]`） |
| 6 | 登出後在開發者工具跑 `Sentry.getCurrentScope().getUser()` | 回傳 undefined / null |

---

## 5. Commit message 模板

```
feat(observability): integrate Sentry error monitoring (Phase 7.5)

- Add @sentry/react dependency
- index.tsx: init Sentry before React renders
  - dsn from import.meta.env.VITE_SENTRY_DSN (skip init if absent)
  - environment from import.meta.env.MODE
  - tracesSampleRate: 0.1, replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0
  - beforeSend drops events in development & scrubs password fields
- ErrorBoundary.componentDidCatch reports via Sentry.captureException
  with componentStack as extra
- AuthContext sets Sentry user on login / session-restore / logout
  - payload only contains { id: empId, role } — name & email NEVER sent
- README: add Sentry env-var section + Netlify deployment note
- tests/sentry.test.ts: 3 unit tests with mocked @sentry/react
  (ErrorBoundary captureException, login setUser shape, logout clears)

70 Vitest tests all green. typecheck / build clean.
vite.config.ts intentionally untouched — source map upload is a
follow-up ticket (see § 8 in PHASE_7.5_SENTRY.md).
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 動 `vite.config.ts` 加 `sentryVitePlugin` | Source map upload 是 follow-up，這張只做執行期 |
| 把 `replaysSessionSampleRate` 開到 > 0 | 客戶未授權錄一般 session |
| `Sentry.setUser` payload 加 `username` / `email` / `name` | **個資紅線**，違反 D7 決策 |
| 改後端 `api.ts` 加 Sentry node SDK | 另一張票 |
| 改 ErrorBoundary 的 UI / fallback 樣式 | 不在範圍 |
| 改既有 67 個測試 | 必須保持綠 |
| 把 DSN 寫死進程式碼 | 必須走 env |
| 加 `@sentry/tracing` 套件 | v8+ 已併入主套件，多裝會衝突 |

---

## 7. 完工回報格式

```
Phase 7.5 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 70 | __ |
| build 警告 | 無 | __ |
| build size 增量 (gzip) | ≤ 35 KB | __ KB |
| vite.config.ts 改動 | 無 | __ |
| Sentry user payload | 僅 id + role | __ |

新增測試：tests/sentry.test.ts ___ 個案例

手動煙霧測試（4.3）：
- [ ] § 1–6 全勾

Netlify 環境變數 VITE_SENTRY_DSN 已通知部署者設定？ (Y/N) __

備註：
```

---

## 8. 後續可能 follow-up

- Source map upload（裝 `@sentry/vite-plugin`，build 時自動上傳）
- Performance monitoring（`tracesSampleRate` 提高 + `Sentry.startSpan`）
- Session Replay 全量錄（需評估個資合規）
- 後端 Sentry（`@sentry/node` 整合 `netlify/functions/api.ts`）
- Alert 規則（Sentry Dashboard 設「24 小時內同 Issue ≥ 5 次 → Slack」）
- Release tracking（CI 把 git SHA 當 release）
