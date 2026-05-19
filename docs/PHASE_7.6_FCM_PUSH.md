# Phase 7.6 — FCM Web Push 通知工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex 或 Claude
> **預估工期：** 1–1.5 天（含 service worker 設定 + 後端寫入 + 前端 UI + 測試）
> **對應 Roadmap：** Phase 7.6（Phase 7 最後一張）
> **對應 EXECUTION_PLAN：** B7 — 即時通知，取代 60s 輪詢
> **依存：** Phase 3.6 既有 `notifications` collection 與 `NotificationBell` 元件、9.4 Firestore Rules

---

## 1. 目標

目前 `NotificationBell` 透過 60 秒輪詢 `apiGetNotifications()` 抓未讀，造成：

- 通知延遲最多 60 秒
- 員工手機關掉瀏覽器分頁就完全收不到
- 每位活躍員工每分鐘打一次 Functions，浪費 invocation 配額

導入 **Firebase Cloud Messaging (FCM) Web Push** 解決：

1. 員工登入後可選擇「啟用即時通知」→ 授權 + 取 FCM token → 寫進 `fcmTokens/{empId}/{tokenId}`
2. `writeNotification` 同時寫 Firestore + 透過 FCM Admin SDK 推播給該 empId 全部 active tokens
3. Service worker 在背景顯示 OS 級通知，**前景**改用 in-app toast（避免重複）
4. `NotificationBell` 輪詢頻率由 60s 降為 **180s**（純 fallback），並在 FCM 啟用後改為按需 refresh

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 通知延遲 | ≤ 60 秒 | < 5 秒 |
| 輪詢頻率 | 60s 全員 | 180s（FCM 失敗時 fallback） |
| FCM Token 管理 | 無 | `fcmTokens` collection |
| Service worker | 無 | `public/firebase-messaging-sw.js` |
| Vitest 總數 | 175（含 7.2 工單估算） | ≥ 180 |
| 新增依賴 | — | **0**（firebase SDK 已含 `firebase/messaging`） |
| typecheck / build / 既有測試 | 全綠 | 全綠 |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **加** — `FcmTokenDoc` |
| `netlify/functions/utils/fcm.ts` | **新增** — 純函數：token 篩選、payload 組裝、failed token 清理規則 |
| `netlify/functions/api.ts` | **改** — `writeNotification` 同步推 FCM；加 2 個 actions（register / unregister token） |
| `services/firebaseConfig.ts` | **改** — 匯出 messaging instance（lazy load） |
| `services/fcmClient.ts` | **新增** — `enableFcm()` / `disableFcm()` 前端 helper |
| `public/firebase-messaging-sw.js` | **新增** — Service Worker（OS 通知） |
| `services/googleAppsScriptAPI.ts` | **改** — 加 register/unregister 兩個 client helpers |
| `components/NotificationBell.tsx` | **改** — 輪詢 60s → 180s；加「啟用即時通知」按鈕；前景收到 message → 立即 refresh + toast |
| `tests/fcm.test.ts` | **新增** — ≥ 5 個純函數測試 |

**不要動：**

- ❌ `vite.config.ts`
- ❌ `.github/workflows/ci.yml`（Codex PAT 無 workflow scope）
- ❌ Firestore rules（fcmTokens 走 Functions 寫入，client 仍 deny all — 沿用 9.4）
- ❌ 既有 `notifications` collection 結構（純加，不破壞）
- ❌ 既有 169+ 個 Vitest 測試
- ❌ 不安裝新套件（firebase 已含 `firebase/messaging`）
- ❌ 不做 mobile native push（Cordova / Capacitor / Expo） — 本工單只做 Web Push
- ❌ 不做通知模板系統 / 通知偏好設定（未來再切票）

---

## 3. 資料模型

### 3.1 `types.ts` 新增

```ts
// FCM Web Push token（Phase 7.6）
// 路徑：fcmTokens/{tokenId}
// 不放在 employees/{empId}/tokens 子集合，方便依 empId 反查 + 過期清理
export interface FcmTokenDoc {
    tokenId: string;          // Firestore doc id（建議用 FCM token 的 sha256 前 24 碼）
    empId: string;            // 持有者
    token: string;            // FCM 推播用 token（完整字串）
    userAgent?: string;       // 註冊時的 UA（除錯用）
    createdAt: string;        // ISO
    lastSeenAt: string;       // ISO，每次 refresh 更新
    failureCount?: number;    // 連續推播失敗次數；達 5 自動刪除
}
```

### 3.2 Firestore collection

`fcmTokens/{tokenId}`，欄位即 `FcmTokenDoc`。

**index：** 依 `empId` 查詢需要 single-field index（Firestore 自動處理）。

**Rules**：沿用 9.4 — client deny all，只透過 Functions 寫入。

---

## 4. 後端規格

### 4.1 純函數 helper（`netlify/functions/utils/fcm.ts`）

```ts
import type { FcmTokenDoc, NotificationType } from '../../../types';

const MAX_FAILURE_COUNT = 5;
const PRUNE_AFTER_DAYS = 60;        // 60 天未活動的 token 視為失效

/**
 * 從 FCM token 字串產生穩定 doc id（sha256 hex 前 24 碼）
 * 用 Web Crypto 不依賴 node:crypto，方便在前後端共用
 */
export const tokenIdFromToken = async (token: string): Promise<string> => {
    const buf = new TextEncoder().encode(token);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
        .slice(0, 12)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * 過濾出該 empId 仍 active 的 tokens（未超過失敗上限、未過期）
 */
export const filterActiveTokens = (
    tokens: FcmTokenDoc[],
    asOf: Date = new Date(),
): FcmTokenDoc[] => {
    const cutoff = asOf.getTime() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    return tokens.filter(t => {
        if ((t.failureCount ?? 0) >= MAX_FAILURE_COUNT) return false;
        const lastSeen = new Date(t.lastSeenAt || t.createdAt).getTime();
        if (Number.isNaN(lastSeen)) return false;
        if (lastSeen < cutoff) return false;
        return true;
    });
};

/**
 * 組 FCM 推播 payload（data-only，前端 service worker 自己組顯示）
 */
export const buildFcmPayload = (params: {
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    notificationId?: string;
}): { data: Record<string, string> } => {
    const { type, title, message, link, notificationId } = params;
    return {
        data: {
            type,
            title,
            message,
            ...(link ? { link } : {}),
            ...(notificationId ? { notificationId } : {}),
        },
    };
};

/**
 * 從一批 FCM send 結果中提出需刪除的 tokenIds（不可恢復的錯誤）
 */
export const tokensToDelete = (
    sendResults: Array<{ tokenId: string; error?: { code: string } }>,
): string[] => {
    const FATAL_CODES = new Set([
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered',
        'messaging/invalid-argument',
    ]);
    return sendResults
        .filter(r => r.error && FATAL_CODES.has(r.error.code))
        .map(r => r.tokenId);
};
```

### 4.2 `api.ts` `writeNotification` 擴充（核心）

**現況：** `writeNotification` 只寫 Firestore。

**目標：** 寫完 Firestore 後 fire-and-forget 推 FCM。**失敗不影響主流程**（通知還是會在下次 NotificationBell refresh 看到）。

```ts
const writeNotification = async (
    empId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
) => {
    // 1) 既有：寫 Firestore notifications/{autoId}
    const ref = await db.collection('notifications').add({
        empId, type, title, message,
        read: false,
        createdAt: new Date().toISOString(),
        ...(link ? { link } : {}),
    });
    // 2) 新增：推 FCM（async，失敗不擋）
    pushToEmpFcmTokens(empId, { type, title, message, link, notificationId: ref.id })
        .catch(err => console.error('[FCM] push failed:', err));
};

/**
 * 推送給某員工的所有 active FCM tokens；失敗的 token 累積 failureCount
 * 或直接刪除（依錯誤碼）
 */
const pushToEmpFcmTokens = async (
    empId: string,
    payload: { type: NotificationType; title: string; message: string; link?: string; notificationId: string },
): Promise<void> => {
    const snap = await db.collection('fcmTokens').where('empId', '==', empId).get();
    if (snap.empty) return;
    const allTokens = snap.docs.map(d => ({ ...(d.data() as FcmTokenDoc), tokenId: d.id }));
    const active = filterActiveTokens(allTokens);
    if (active.length === 0) return;

    // 用 firebase-admin messaging
    const messaging = adminMessaging();
    const fcmPayload = buildFcmPayload(payload);

    const results = await Promise.all(active.map(async t => {
        try {
            await messaging.send({
                token: t.token,
                ...fcmPayload,
            });
            // 成功 → 重置 failureCount + 更新 lastSeenAt
            await db.collection('fcmTokens').doc(t.tokenId).update({
                failureCount: 0,
                lastSeenAt: new Date().toISOString(),
            });
            return { tokenId: t.tokenId };
        } catch (err: any) {
            return { tokenId: t.tokenId, error: { code: err?.code || 'unknown' } };
        }
    }));

    // 致命錯誤直接刪除
    const toDelete = tokensToDelete(results);
    await Promise.all(toDelete.map(id => db.collection('fcmTokens').doc(id).delete()));

    // 非致命錯誤 → failureCount += 1
    const toIncrement = results.filter(r => r.error && !toDelete.includes(r.tokenId));
    await Promise.all(toIncrement.map(r =>
        db.collection('fcmTokens').doc(r.tokenId).update({
            failureCount: FieldValue.increment(1),
        }),
    ));
};
```

> **`adminMessaging()` helper：** 比照既有 `db` / `adminAuth`，從 `firebaseAdmin.ts` lazy 匯出（不啟動時間延遲）。

### 4.3 `api.ts` 新增 2 個 actions

#### `register-fcm-token`

```ts
case 'register-fcm-token': {
    const token = (data.token as string || '').trim();
    if (!token || token.length < 30) return fail(400, 'token 無效');
    const ua = (data.userAgent as string || '').slice(0, 200);
    const tokenId = await tokenIdFromToken(token);
    const now = new Date().toISOString();
    const doc: FcmTokenDoc = {
        tokenId, empId: uid, token,
        userAgent: ua, createdAt: now, lastSeenAt: now, failureCount: 0,
    };
    await db.collection('fcmTokens').doc(tokenId).set(doc, { merge: true });
    // 不寫 auditLog（員工自行設定，且每次 refresh 都會呼叫）
    return ok({ tokenId });
}
```

> **設計重點：** 用 `merge: true` 容忍同一 token 重複註冊；`tokenId` 是 sha256 derived，相同 token 永遠映射到相同 docId，所以註冊 = upsert。

#### `unregister-fcm-token`

```ts
case 'unregister-fcm-token': {
    const token = (data.token as string || '').trim();
    if (!token) return fail(400, 'token 必填');
    const tokenId = await tokenIdFromToken(token);
    const snap = await db.collection('fcmTokens').doc(tokenId).get();
    if (snap.exists && snap.data()?.empId === uid) {
        await snap.ref.delete();
    }
    // 即使不存在或不屬於本人，也回 ok，避免列舉攻擊
    return ok(true);
}
```

### 4.4 不需改動的部分

- `get-notifications` / `mark-notification-read` / `mark-all-notifications-read`：完全不動，FCM 只是「即時推送」，仍以 Firestore 為單一資料源
- 既有所有 `writeNotification(...)` 呼叫點：無須動（自動取得 FCM 推送能力）

---

## 5. 前端規格

### 5.1 `services/firebaseConfig.ts` — lazy 匯出 messaging

```ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const app = initializeApp({ /* 既有設定 */ });
export const auth = getAuth(app);

// Phase 7.6：lazy 載入 messaging（避免 SSR / 不支援環境炸開）
export const getMessagingClient = async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
    const { getMessaging, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return null;
    return getMessaging(app);
};
```

### 5.2 `public/firebase-messaging-sw.js`（新檔）

```js
// Phase 7.6 — Firebase Messaging Service Worker
// 必須放在 public/ 根目錄，Firebase Messaging 預設找這個路徑
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'SAME_AS_FRONTEND',
    projectId: 'SAME_AS_FRONTEND',
    messagingSenderId: 'SAME_AS_FRONTEND',
    appId: 'SAME_AS_FRONTEND',
});

const messaging = firebase.messaging();

// 背景訊息：顯示 OS 級通知
messaging.onBackgroundMessage((payload) => {
    const { title, message, link } = payload.data || {};
    self.registration.showNotification(title || '通知', {
        body: message,
        icon: '/icon-192.png',
        data: { link },
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification.data?.link || '/';
    event.waitUntil(clients.openWindow(link));
});
```

> **配置值同步：** SW 內的 firebase config 與前端要一致；建議 build step 把 config 注入此檔（簡化版可先手動同步，後續再切票自動化）。

### 5.3 `services/fcmClient.ts`（新檔）

```ts
import { getMessagingClient } from './firebaseConfig';
import { apiRegisterFcmToken, apiUnregisterFcmToken } from './googleAppsScriptAPI';

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY;

let cachedToken: string | null = null;

export const enableFcm = async (): Promise<{ token: string } | { error: string }> => {
    if (!('Notification' in window)) return { error: '此瀏覽器不支援通知' };
    if (!VAPID_KEY) return { error: '系統未設定 FCM VAPID key' };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { error: '使用者拒絕通知權限' };

    const messaging = await getMessagingClient();
    if (!messaging) return { error: '瀏覽器不支援 FCM' };

    const { getToken, onMessage } = await import('firebase/messaging');
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return { error: '無法取得 FCM token' };

    cachedToken = token;
    await apiRegisterFcmToken(token, navigator.userAgent);

    // 前景訊息：交給呼叫者處理（in-app toast）
    onMessage(messaging, (payload) => {
        const { title, message } = payload.data || {};
        // 用 CustomEvent 廣播，讓 NotificationBell 接收後 refresh
        window.dispatchEvent(new CustomEvent('fcm-foreground-message', { detail: { title, message } }));
    });

    return { token };
};

export const disableFcm = async (): Promise<void> => {
    if (!cachedToken) return;
    await apiUnregisterFcmToken(cachedToken).catch(() => {});
    cachedToken = null;
};

export const getFcmEnabled = (): boolean => cachedToken !== null;
```

### 5.4 `components/NotificationBell.tsx` 修改

#### 5.4.1 輪詢頻率調低

```ts
const POLL_INTERVAL_MS = 180_000; // 60s → 180s（FCM 啟用後做 fallback）
```

#### 5.4.2 加「啟用即時通知」按鈕

在 dropdown 頂部加一行：

```tsx
{!fcmEnabled && (
    <button
        onClick={handleEnableFcm}
        className="w-full text-xs py-2 bg-blue-50 text-blue-700 hover:bg-blue-100"
    >
        🔔 啟用即時通知
    </button>
)}
```

`handleEnableFcm` 呼叫 `enableFcm()`，成功後 `setFcmEnabled(true)`，失敗 alert。

#### 5.4.3 前景訊息 listener

```ts
useEffect(() => {
    const onFcm = () => {
        // 立即 refresh，不等下一輪 poll
        loadNotifications();
    };
    window.addEventListener('fcm-foreground-message', onFcm);
    return () => window.removeEventListener('fcm-foreground-message', onFcm);
}, []);
```

#### 5.4.4 logout / 切換帳號時 disable

在 `AuthContext.logout` 加 `await disableFcm().catch(() => {})`（**比照 7.5 Sentry setUser(null) 的模式**）。

---

## 6. 測試規格（`tests/fcm.test.ts`，≥ 5 個）

```typescript
import { describe, it, expect } from 'vitest';
import {
    filterActiveTokens,
    buildFcmPayload,
    tokensToDelete,
} from '../netlify/functions/utils/fcm';
import type { FcmTokenDoc } from '../types';

const mk = (over: Partial<FcmTokenDoc>): FcmTokenDoc => ({
    tokenId: 't1', empId: 'E001', token: 'aaa',
    createdAt: '2026-04-01T00:00:00Z',
    lastSeenAt: '2026-05-01T00:00:00Z',
    failureCount: 0,
    ...over,
});

describe('filterActiveTokens', () => {
    const NOW = new Date('2026-05-20T00:00:00Z');

    it('正常 token 通過', () => {
        expect(filterActiveTokens([mk({})], NOW)).toHaveLength(1);
    });

    it('failureCount ≥ 5 被過濾', () => {
        const r = filterActiveTokens([
            mk({ tokenId: 't1', failureCount: 5 }),
            mk({ tokenId: 't2', failureCount: 4 }),
        ], NOW);
        expect(r.map(t => t.tokenId)).toEqual(['t2']);
    });

    it('超過 60 天未活動被過濾', () => {
        const r = filterActiveTokens([
            mk({ tokenId: 'old', lastSeenAt: '2026-01-01T00:00:00Z' }),  // > 60d
            mk({ tokenId: 'new', lastSeenAt: '2026-05-15T00:00:00Z' }),  // < 60d
        ], NOW);
        expect(r.map(t => t.tokenId)).toEqual(['new']);
    });

    it('lastSeenAt 無效 → 被過濾', () => {
        const r = filterActiveTokens([mk({ lastSeenAt: 'garbage' })], NOW);
        expect(r).toHaveLength(0);
    });
});

describe('buildFcmPayload', () => {
    it('組基本 payload', () => {
        const p = buildFcmPayload({
            type: 'leave-approved',
            title: '請假已核准',
            message: '5/20 特休',
        });
        expect(p.data).toEqual({
            type: 'leave-approved',
            title: '請假已核准',
            message: '5/20 特休',
        });
    });

    it('帶 link 與 notificationId', () => {
        const p = buildFcmPayload({
            type: 'shift-swap-approved',
            title: '換班核可',
            message: '...',
            link: '/admin/swaps',
            notificationId: 'abc',
        });
        expect(p.data.link).toBe('/admin/swaps');
        expect(p.data.notificationId).toBe('abc');
    });
});

describe('tokensToDelete', () => {
    it('致命錯誤碼挑出來刪', () => {
        const r = tokensToDelete([
            { tokenId: 't1' },
            { tokenId: 't2', error: { code: 'messaging/registration-token-not-registered' } },
            { tokenId: 't3', error: { code: 'messaging/server-unavailable' } },
            { tokenId: 't4', error: { code: 'messaging/invalid-registration-token' } },
        ]);
        expect(r.sort()).toEqual(['t2', 't4']);
    });

    it('沒錯誤 → 空陣列', () => {
        expect(tokensToDelete([{ tokenId: 't1' }, { tokenId: 't2' }])).toEqual([]);
    });
});
```

---

## 7. 環境變數

部署前需設定：

| 變數名 | 來源 | 用途 |
|--------|------|------|
| `VITE_FCM_VAPID_KEY` | Firebase Console > Project Settings > Cloud Messaging > Web Push certificates | 前端取 token 用 |
| `FIREBASE_CONFIG_API_KEY` (build 時注入 SW) | Firebase Console | service worker 內配置 |

寫入 `.env` + Netlify Dashboard。沒設定時 `enableFcm()` 回 `{ error: '...' }`，按鈕顯示為灰色「未設定」。

---

## 8. 驗收條件

### 8.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 180 個全綠**（175 + ≥ 5） |
| 3 | `npm run build` | 無新增 warning；產物增量 < 50 KB（gzip） |

### 8.2 程式碼審查

- [ ] `fcm.ts` 為純函數（無 firebase / I/O）
- [ ] `writeNotification` 推送失敗時**不**影響 Firestore 寫入回傳
- [ ] `register-fcm-token` 用 `merge: true`（upsert）
- [ ] `unregister-fcm-token` 不洩漏「不存在」資訊（防列舉）
- [ ] FCM token 不寫進 console / Sentry / auditLog（個資紅線）
- [ ] Service Worker 在前景**不**重複顯示通知
- [ ] 輪詢間隔從 60s 調為 180s
- [ ] logout 時呼叫 `disableFcm()`

### 8.3 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 部署後設好 `VITE_FCM_VAPID_KEY`，重新登入 | bell 下拉看到「🔔 啟用即時通知」 |
| 2 | 點按鈕，瀏覽器跳通知權限 → 允許 | `fcmTokens/{tokenId}` 出現新文件 |
| 3 | 另一管理員核准一筆請假 | < 5 秒收到 OS 級通知 |
| 4 | 通知在背景跳出 → 點擊 | 開新分頁到 link（或 /） |
| 5 | 通知在前景到 → 不重複跳 OS 通知；bell 自動 +1 | ✅ |
| 6 | 登出 | `fcmTokens` 對應文件被刪 |
| 7 | 拒絕通知權限後再點按鈕 | alert「使用者拒絕通知權限」 |
| 8 | 沒設定 VAPID key 時 | 按鈕灰、提示「系統未設定 FCM VAPID key」 |

---

## 9. Commit message 模板

```text
feat(notify): FCM web push for instant notifications (Phase 7.6)

- Add FcmTokenDoc type and fcmTokens collection contract
- Add fcm.ts pure helpers:
  - tokenIdFromToken (sha256 → 24-hex)
  - filterActiveTokens (60d stale + 5-failure prune)
  - buildFcmPayload (data-only)
  - tokensToDelete (fatal-code classifier)
- api.ts: writeNotification fans out to FCM (fire-and-forget);
  add register-fcm-token / unregister-fcm-token actions
- public/firebase-messaging-sw.js: background notification handler
- services/firebaseConfig.ts: lazy getMessagingClient()
- services/fcmClient.ts: enableFcm / disableFcm; foreground messages
  dispatched as CustomEvent('fcm-foreground-message')
- NotificationBell: poll 60s → 180s (fallback); add 「啟用即時通知」
  button + foreground listener for immediate refresh
- AuthContext.logout: disableFcm to clean up token
- Add tests/fcm.test.ts — ≥ 5 cases covering token filtering,
  payload building, fatal-code classification
- No new dependencies; firebase already bundles messaging
- Tokens never logged to console / Sentry / auditLog (個資紅線)

Closes Phase 7.6
```

---

## 10. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 動 `.github/workflows/ci.yml` | PAT 缺 workflow scope 會卡 push |
| 動 `vite.config.ts` | 不需 |
| 動既有 169+ 個測試 | 嚴禁 |
| 動 Firestore Rules | 9.4 已固定 deny all，fcmTokens 也走 Functions |
| 把 FCM token 寫進 auditLog / Sentry / console.error 完整字串 | 個資紅線 — token 本身可識別裝置 |
| 改既有 `writeNotification` 的回傳值 | 既有 await call 太多處，break-change 風險高 |
| FCM 推送失敗時 `throw` | 必須吞錯誤，否則影響 Firestore 寫入 |
| 把 FCM token 帶在 query string | 必須 POST body |
| 做通知偏好 / 模板系統 | 後續再切票 |
| 做 mobile native push | 本工單只做 Web Push |
| 「順便」重構 NotificationBell 樣式 | 只加按鈕與 listener |
| 推送 payload 帶 PII（員工姓名、薪資數字） | 通知標題與訊息只放「事件 + 連結」 |

---

## 11. 完工回報格式

```md
Phase 7.6 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 180 | __ |
| build 警告 | 無新增 | __ |
| build 增量 (gzip) | < 50 KB | __ KB |
| writeNotification 同步推 FCM | 是 | __ |
| 2 個新 actions | register / unregister | __ |
| poll 60s → 180s | 是 | __ |
| token 不進 log | 是 | __ |

新增測試：___ 個案例

手動煙霧測試（§ 8.3）：
- [ ] § 1–8 全勾（需 production VAPID key 才能完整跑）

備註：
- VAPID key 未設定者 § 1–7 全部跳過；§ 8 仍可驗
```

---

## 12. 後續可能 follow-up

- Service worker 自動同步 firebase config（build step 注入）
- 通知偏好設定（員工選哪些事件要 push）
- 通知模板（i18n、富文字）
- 後端 Sentry breadcrumb 加 FCM send result
- Topic 訂閱（Admin 群、SuperAdmin 群）
- 把輪詢完全移除（只剩 FCM + 手動 refresh）
- Mobile native push（Capacitor / Expo 整合）
- 通知統計儀表板（送出 / 抵達率 / 點擊率）
