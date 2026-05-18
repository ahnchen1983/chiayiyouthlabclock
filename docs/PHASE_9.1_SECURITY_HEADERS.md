# Phase 9.1 — Netlify 安全 Headers 工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 半天
> **對應 Roadmap：** Phase 9.1
> **對應 SDD 議題：** D9-2「Web 安全 Headers 缺失」
> **對應決策：** D9-2 (b) — CSP 先 **Report-Only 兩週**
> **依賴：** 無

---

## 1. 目標

`netlify.toml` 沒有 `[[headers]]` 段；`api.ts` 的 `ok()`/`fail()` 沒設 CORS headers。任何 origin 都能打我們的 functions、沒 HSTS、沒 X-Frame-Options、沒 CSP。

本工單目標：

1. `netlify.toml` 加 `[[headers]]` 套用 6 個安全 headers（HSTS / X-CTO / XFO / Referrer / Permissions / CSP-Report-Only）
2. `api.ts` 的 `ok()` / `fail()` / OPTIONS 加 CORS headers（白名單）
3. 新增 `netlify/functions/utils/cors.ts` 純函數
4. CSP violation report endpoint（簡化版，只 console.warn）
5. README 補 `ALLOWED_ORIGINS` 環境變數說明
6. Vitest 新增 ≥ 4 個測試

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| `netlify.toml` `[[headers]]` 段 | 0 | 1 |
| 安全 Headers 數量 | 0 | 6 |
| `ok()` / `fail()` 含 CORS | 否 | 是 |
| Vitest 總數 | 104 | ≥ 108 |
| CSP 模式 | 無 | Report-Only |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `netlify.toml` | **修改** — 加入 `[[headers]]` |
| `netlify/functions/utils/cors.ts` | **新增** — `getAllowedOrigin()` + `corsHeaders()` |
| `netlify/functions/api.ts` | **改** — `ok()` / `fail()` / OPTIONS / 加 CSP report 攔截 |
| `tests/cors.test.ts` | **新增** |
| `README.md` | 補 `ALLOWED_ORIGINS` 段 |

**不要動：** 既有 104 測試、`vite.config.ts`、`index.html`（CSP 走 HTTP header）、`sentryUser.ts`、任何元件 / 資料模型 / Firestore rules。

---

## 3. 實作規格

### 3.1 `netlify.toml`（追加 `[[headers]]` 段）

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(self), camera=(), microphone=(), payment=()"
    Content-Security-Policy-Report-Only = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io; font-src 'self' data:; frame-ancestors 'none'; report-uri /api/csp-report"
```

**說明：**
- `Permissions-Policy: geolocation=(self)` — 打卡頁需要定位
- `'unsafe-inline'` — Vite / Tailwind 產出含 inline，**先放寬**，兩週 follow-up 收緊（用 nonce/hash）
- `connect-src` 含 Firebase Auth / Firestore / Sentry 三族域名
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` 雙保險（舊瀏覽器看 XFO，CSP L2 看 frame-ancestors）

### 3.2 `netlify/functions/utils/cors.ts`（新檔）

```typescript
/**
 * CORS 白名單 — 純函數，無 I/O
 * Phase 9.1
 */

const DEFAULT_ALLOWED_ORIGINS = [
    'https://chiayiyouthlabclock.netlify.app',
    'http://localhost:5173',
    'http://localhost:8888',
];

export const parseAllowedOrigins = (envValue: string | undefined): string[] => {
    if (!envValue || !envValue.trim()) return DEFAULT_ALLOWED_ORIGINS;
    return envValue.split(',').map(s => s.trim()).filter(Boolean);
};

export const getAllowedOrigin = (
    requestOrigin: string | undefined,
    envValue: string | undefined = process.env.ALLOWED_ORIGINS,
): string | null => {
    if (!requestOrigin) return null;
    const list = parseAllowedOrigins(envValue);
    return list.includes(requestOrigin) ? requestOrigin : null;
};

/**
 * 不在白名單時，回傳的 headers「不含」Access-Control-Allow-Origin（讓瀏覽器擋）
 */
export const corsHeaders = (requestOrigin: string | undefined): Record<string, string> => {
    const allowed = getAllowedOrigin(requestOrigin);
    const base: Record<string, string> = {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Vary': 'Origin',
    };
    if (allowed) base['Access-Control-Allow-Origin'] = allowed;
    return base;
};
```

### 3.3 `api.ts` 改動

#### 3.3.1 `ok()` / `fail()`（第 151–161 行）

```typescript
import { corsHeaders } from './utils/cors';

const ok = (data: unknown, event?: { headers?: Record<string, string | undefined> }) => ({
    statusCode: 200,
    headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(event?.headers?.origin),
    },
    body: JSON.stringify(data),
});

const fail = (status: number, message: string, event?: { headers?: Record<string, string | undefined> }) => ({
    statusCode: status,
    headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(event?.headers?.origin),
    },
    body: JSON.stringify({ error: message }),
});
```

**全檔 search & replace**：找 `return ok(` / `return fail(`，補 `, event` 作為最後參數。Codex 用 ripgrep + IDE 全文取代，**不要重構任何 action 邏輯**。

#### 3.3.2 handler 開頭（第 287 行）

```typescript
export const handler: Handler = async (event) => {
    // CSP violation report（在 action 分派之前處理）
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (event.httpMethod === 'POST' && contentType.includes('application/csp-report')) {
        try {
            console.warn('[CSP Report]', event.body);
        } catch { /* swallow */ }
        return { statusCode: 204, headers: corsHeaders(event.headers.origin), body: '' };
    }

    // CORS Preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders(event.headers.origin), body: '' };
    }

    if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed', event);

    // ... 原本 body 解析與 action 分派維持不動
};
```

### 3.4 `tests/cors.test.ts`（新檔，≥ 4 個）

涵蓋：
- `parseAllowedOrigins` 空字串 / 逗號分隔解析
- `getAllowedOrigin` 命中 / 不命中 / localhost / undefined / 自訂環境變數
- `corsHeaders` 命中含 ACAO、不命中不含 ACAO

完整測試碼見工單原稿。

### 3.5 README.md 補段

```markdown
### Netlify 環境變數 — `ALLOWED_ORIGINS`（Phase 9.1）

CORS 白名單。逗號分隔，未設則 fallback 為：
- `https://chiayiyouthlabclock.netlify.app`
- `http://localhost:5173`
- `http://localhost:8888`

自訂 domain 需在 Netlify 設定：
`ALLOWED_ORIGINS=https://chiayiyouthlabclock.netlify.app,https://clock.example.org`
```

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | ≥ 108 全綠 |
| 3 | `npm run build` | 無 warning |

### 4.2 程式碼審查

- [ ] CSP 用 `Content-Security-Policy-Report-Only`（不是 `Content-Security-Policy`）
- [ ] `cors.ts` 純函數
- [ ] `ok()` / `fail()` 所有呼叫處都已補 `event`
- [ ] OPTIONS 回 204 + 完整 CORS
- [ ] CSP report 走 Content-Type 判斷，不走 action 機制

### 4.3 手動 curl 測試

| # | 命令 | 期望 |
|---|------|------|
| 1 | `curl -I https://<preview>/` | 6 個安全 headers 齊全 |
| 2 | `curl -X OPTIONS -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" .../api` | 204 + ACAO 命中 |
| 3 | `curl -X OPTIONS -H "Origin: https://evil.com" .../api -i` | 204 + **無** ACAO |
| 4 | 瀏覽器登入打卡 | 正常（Firebase + Sentry 連得到） |
| 5 | `curl -X POST -H "Content-Type: application/csp-report" -d '{"csp-report":{"violated-directive":"test"}}' .../api` | 204 + Netlify log 含 `[CSP Report]` |

---

## 5. Commit message 模板

```
feat(security): Netlify security headers + CORS allowlist (Phase 9.1)

- netlify.toml: add [[headers]] section (HSTS, X-CTO, XFO, Referrer,
  Permissions, CSP-Report-Only)
- netlify/functions/utils/cors.ts (new): pure helpers
  (parseAllowedOrigins / getAllowedOrigin / corsHeaders)
- netlify/functions/api.ts:
  - ok() / fail() now accept event, emit per-origin CORS headers
  - OPTIONS preflight returns 204 with full CORS
  - CSP violation reports intercepted via Content-Type, logged
- tests/cors.test.ts: 4+ unit tests (108 Vitest total)
- README: document ALLOWED_ORIGINS env var
- Resolves D9-2 (CSP Report-Only mode, 2-week observation)
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 把 CSP 設成 enforce | D9-2 (b) Report-Only |
| 拿掉 `'unsafe-inline'` | Vite/Tailwind 含 inline，會 break |
| 把 CSP violation 寫進 Firestore | 簡化版，避免 quota |
| 改 `vite.config.ts` / `index.html` | 不需 |
| 改既有 104 測試 | 嚴禁 |
| 重構 `api.ts` 任何 action | 只動 ok / fail / handler 開頭 |
| 把 CORS 白名單寫死 | 必須走環境變數 |
| 順便加 rate limiting | 9.x 後續 |

---

## 7. 完工回報格式

```
Phase 9.1 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 108 | __ |
| build 警告 | 無 | __ |
| [[headers]] 段 | 6 headers 齊全 | __ |
| CSP 模式 | Report-Only | __ |
| ok/fail 含 CORS | 是 | __ |

新增測試：cors.test.ts ___ 個案例

手動 curl 測試（4.3）：- [ ] § 1–5 全勾

備註：
- ALLOWED_ORIGINS 環境變數已在 Netlify 設定（生產）：__
- CSP report-only 兩週觀察起始日：__
```

---

## 8. 後續可能 follow-up

- **兩週後**：檢視 CSP violation log，移除誤擋來源後改 enforce
- Vite plugin 注入 nonce，移除 `'unsafe-inline'`
- CSP violation 寫進 Firestore + admin 後台檢視
- Functions 加 rate limiting
- 自訂 domain 上線時更新白名單 + HSTS preload 申請
