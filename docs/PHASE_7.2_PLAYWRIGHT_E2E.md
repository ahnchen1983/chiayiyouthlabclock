# Phase 7.2 — Playwright e2e 測試工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Codex（整合規劃）
> **負責實作：** Claude 或 Codex
> **預估工期：** 0.5–1 天
> **對應 Roadmap：** Phase 7.2
> **依存：** Phase 7.4 CI、Phase 9.2 TOTP、Phase 6.1 換班、Phase 6.4 員工偏好

---

## 1. 目標

目前 repo 已有 181 個 Vitest 單元測試，但缺少瀏覽器層級的主流程驗證。每次 Dashboard navigation、Auth flow、表單欄位、API client wrapper、lazy chunk 載入或 Tailwind class 變動，都只能靠手動煙霧測試抓。

本工單目標是建立一套**穩定、可在本機與 CI 跑的 Playwright e2e 基礎**，先鎖住最關鍵的 5 條流程：

1. 登入成功後進入員工後台
2. 員工打卡：上班 → 下班
3. 員工請假申請送出
4. Admin 排班管理可開啟編輯 modal，並看到員工偏好提示
5. 員工換班頁可載入並呈現待處理/歷史列表

### 設計決策

- **使用 Playwright route mock Netlify Functions API**，不打真後端、不需要 Firebase service account。
- 新增 `VITE_E2E=true` 測試模式，僅在 e2e 環境讓 `apiLogin()` 跳過 Firebase `signInWithCustomToken()`。
- Dashboard 類流程以 `sessionStorage.user` 預置登入身份，避免每個 spec 重跑登入。
- 不把 e2e 納入預設 `npm test`；新增獨立指令 `npm run test:e2e`。
- CI 先不改 `.github/workflows/ci.yml`，避免再次碰到 PAT `workflow` scope 卡點。workflow 整合列 follow-up。

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `package.json` | **改** — 加 Playwright devDependency 與 e2e scripts |
| `package-lock.json` | **改** — 安裝依賴後更新 |
| `playwright.config.ts` | **新增** — webServer、projects、trace/screenshot 設定 |
| `services/googleAppsScriptAPI.ts` | **改** — 加 e2e-only auth bypass |
| `tests/e2e/helpers/apiMock.ts` | **新增** — Netlify Functions route mock |
| `tests/e2e/helpers/session.ts` | **新增** — 預置 employee/admin session |
| `tests/e2e/login.spec.ts` | **新增** — 登入流程 |
| `tests/e2e/employee-clock.spec.ts` | **新增** — 打卡流程 |
| `tests/e2e/employee-leave.spec.ts` | **新增** — 請假流程 |
| `tests/e2e/admin-schedule.spec.ts` | **新增** — 排班 modal + 偏好提示 |
| `tests/e2e/shift-swap.spec.ts` | **新增** — 換班頁 smoke |
| `docs/PROGRESS_SNAPSHOT_2026-05-19.md` | **改** — 7.2 工單狀態 |
| `docs/CHANGELOG.md` | **改** — 記錄 e2e harness 與 scripts |

**不要動：**

- ❌ `.github/workflows/ci.yml`（PAT workflow scope 已知會卡；本票先不碰）
- ❌ Firestore rules / Firebase project 設定
- ❌ 真實 `.env` 或任何 Firebase 私鑰
- ❌ production auth 邏輯；`VITE_E2E` 只能影響 e2e mode
- ❌ 既有 181 個 Vitest 測試
- ❌ 不新增真後端 seed/migration script

---

## 3. 安裝與 scripts

### 3.1 安裝套件

```bash
npm install -D @playwright/test
npx playwright install chromium
```

> CI 若未來要跑 e2e，再在 workflow 補 `npx playwright install --with-deps chromium`。

### 3.2 `package.json` scripts

新增：

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed"
  }
}
```

預設 `npm test` 維持 Vitest，不要混入 Playwright。

---

## 4. Playwright 設定

新增 `playwright.config.ts`：

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : [['list'], ['html']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'VITE_E2E=true npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

先只跑 Chromium，避免把初版 e2e 變慢；跨瀏覽器可列後續。

---

## 5. E2E-only Auth Bypass

### 5.1 為什麼需要

`apiLogin()` 目前會呼叫 Firebase `signInWithCustomToken()`。Playwright route 可以 mock `/.netlify/functions/api`，但不能憑空讓 Firebase SDK 接受假 token。若 e2e 直接打真 Firebase，會引入真帳密、網路與專案狀態，測試容易飄。

### 5.2 實作規格

在 `services/googleAppsScriptAPI.ts` 加：

```ts
const isE2E = import.meta.env.VITE_E2E === 'true';
```

調整 `apiLogin()`：

```ts
// kind === 'success'
if (!isE2E) {
  await signInWithCustomToken(auth, result.customToken);
}
return { kind: 'success', user: result.user, customToken: result.customToken };
```

調整 `apiVerifyTotpLogin()` 同理：只有 `!isE2E` 才呼叫 `signInWithCustomToken()`。

調整 `apiLogout()`：

```ts
export const apiLogout = async (): Promise<void> => {
  if (!isE2E) await signOut(auth);
};
```

**重要：** 只允許 `VITE_E2E=true` 影響 Firebase SDK sign-in/out，不可改 `AuthContext` 的 sessionStorage、role 判斷、TOTP guard 行為。

---

## 6. E2E Helper 規格

### 6.1 `tests/e2e/helpers/session.ts`

提供：

```ts
import type { Page } from '@playwright/test';

export const employeeUser = {
  id: 'EMP001',
  name: '測試員工',
  role: '員工',
  position: '兼職人員',
};

export const adminUser = {
  id: 'ADMIN',
  name: '測試管理員',
  role: '最高管理者',
  position: '專責人員',
};

export const seedSession = async (page: Page, user: typeof employeeUser | typeof adminUser) => {
  await page.addInitScript(value => {
    window.sessionStorage.setItem('user', JSON.stringify(value));
  }, user);
};
```

角色字串要用 `types.ts` enum 值（中文），不要硬寫英文 role。

### 6.2 `tests/e2e/helpers/apiMock.ts`

提供 `mockApi(page)`，攔截所有 `**/.netlify/functions/api` POST：

```ts
await page.route('**/.netlify/functions/api', async route => {
  const body = route.request().postDataJSON() as { action?: string; [key: string]: unknown };
  switch (body.action) {
    case 'initialize-database':
      return route.fulfill({ json: true });
    case 'login':
      return route.fulfill({ json: { kind: 'success', user: employeeUser, customToken: 'e2e-token' } });
    case 'get-totp-status':
      return route.fulfill({ json: { enabled: true } });
    // ...
    default:
      return route.fulfill({ status: 500, json: { error: `Unhandled mock action: ${body.action}` } });
  }
});
```

**要求：** default 必須 500，避免測試漏 mock 卻假綠。

至少 mock 這些 actions：

| action | 回傳 |
|--------|------|
| `initialize-database` | `true` |
| `login` | employee success |
| `get-totp-status` | `{ enabled: true }` |
| `get-today-clock-status` | 依內部狀態回 `{}` / `{ clockInTime }` / `{ clockInTime, clockOutTime }` |
| `clock-in` | `true` 並更新 mock 狀態 |
| `clock-out` | `true` 並更新 mock 狀態 |
| `get-leave-balance` | 事假/病假/特休餘額 |
| `submit-leave-request` | `true` |
| `get-monthly-schedule` | 至少 1 天 schedule，含 1 個 shift |
| `check-schedule-conflicts` | `[]` |
| `get-all-employees` | employee/admin/user list |
| `get-all-staff-preferences` | EMP001 週六 blocked + specific preferred |
| `list-shift-swap-requests` | mine 模式回 1 筆待確認或歷史資料 |

---

## 7. Spec 規格

### 7.1 `login.spec.ts`

目標：登入表單能送出並進員工後台。

流程：

1. `mockApi(page)`
2. `page.goto('/')`
3. 填帳號 `EMP001`、密碼 `test-password`
4. 點 `登入`
5. assert 看見 `員工後台`
6. assert 看見 nav `打卡`

建議 selector：

```ts
await page.getByPlaceholder('帳號').fill('EMP001');
await page.getByPlaceholder('密碼').fill('test-password');
await page.getByRole('button', { name: '登入' }).click();
await expect(page.getByText('員工後台')).toBeVisible();
```

### 7.2 `employee-clock.spec.ts`

目標：員工能完成上班與下班打卡，狀態跟著 API mock 更新。

流程：

1. `seedSession(page, employeeUser)`
2. `mockApi(page)`
3. `page.goto('/')`
4. assert 看見 `即時打卡`
5. 點 `上班打卡`，assert `上班打卡成功`
6. assert 上班時間顯示 `09:00`
7. 點 `下班打卡`，assert `下班打卡成功`
8. assert 下班時間顯示 `18:00`

### 7.3 `employee-leave.spec.ts`

目標：請假表單能讀餘額並送出。

流程：

1. seed employee session
2. 點底部 nav `請假申請`
3. 等 `本年度事假剩餘` 文案出現
4. 填開始/結束 datetime-local（例如明天 09:00–13:00）
5. 填事由 `E2E 測試請假`
6. 點 `送出申請`
7. assert `請假申請已成功送出`

注意：日期不可寫死為過去日期。用 helper 產生「明天」。

### 7.4 `admin-schedule.spec.ts`

目標：Admin 排班 modal 正常開啟，員工偏好提示出現，但不阻擋儲存。

流程：

1. seed admin session
2. `mockApi(page, { user: adminUser })`
3. `page.goto('/')`
4. 點 sidebar `排班管理`
5. 點月曆中 mock schedule 的日期格
6. assert modal 標題 `編輯 YYYY-MM-DD`
7. 選擇 EMP001（或 mock 初始已排 EMP001）
8. assert 看見 `偏好不上班` 或 `偏好上班`
9. 點 `儲存`
10. assert mock 收到 `update-schedule`，modal 關閉

Mock schedule 建議日期要同時命中偏好：

- date: 下一個週六，EMP001 `blockedWeekdays: [6]` → 顯示 `偏好不上班`
- 另可回傳 `preferredDates: [date]` 測 `偏好上班`，但一個 smoke case 即可。

### 7.5 `shift-swap.spec.ts`

目標：員工換班頁可載入本人申請列表。

流程：

1. seed employee session
2. 點底部 nav `換班`
3. mock `list-shift-swap-requests` 回 1 筆
4. assert 看見 `換班` 頁標題或申請日期
5. assert 看見狀態文案（例如 `待對方確認` / `awaiting-peer` 對應的 UI 文案）

若現有 `ShiftSwapPage` UI 不方便穩定選取，允許本票加少量 `aria-label` 或文字標題，但不要大改 UI。

---

## 8. 驗收條件

依序跑：

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

預期：

| 項目 | 目標 |
|------|------|
| typecheck | 0 錯誤 |
| Vitest | 181 tests 全綠 |
| build | pass，無新增 chunk warning |
| Playwright | 5 specs 全綠 |
| e2e screenshots/videos | 只有 failure 才產出 |
| `.github/workflows/ci.yml` | 不修改 |

### 手動 smoke（選做）

```bash
npm run test:e2e:headed
```

確認瀏覽器中能看到登入、員工後台、Admin 排班 modal。

---

## 9. 禁止越界

本票只做 e2e harness 與 5 條 smoke specs。

- ❌ 不改真 Firebase auth / token 驗證流程
- ❌ 不把 e2e mock 帶進 production build 行為
- ❌ 不寫真資料到 Firebase / Firestore
- ❌ 不啟動 Netlify Functions 或 Firebase Emulator 作為必要依賴
- ❌ 不新增 `.env`、不讀私鑰、不提交任何測試帳密
- ❌ 不改 CI workflow（除非 user 明確說 PAT workflow scope 已解）
- ❌ 不為了測試大改現有 UI
- ❌ 不把 e2e 測試塞進 `npm test`

---

## 10. Claude / Codex 執行指令

```text
請從 main 拉最新（git pull origin main），實作 Phase 7.2。

工單：docs/PHASE_7.2_PLAYWRIGHT_E2E.md

重點：
- 新增 Playwright e2e harness，不碰真 Firebase/Firestore
- 加 VITE_E2E=true auth bypass，只跳過 Firebase signIn/signOut，不改 production auth
- 用 Playwright route mock /.netlify/functions/api，未 mock action 必須 500
- 完成 5 條 specs：login / clock / leave / admin schedule / shift swap
- 不改 .github/workflows/ci.yml
- 不提交 .env 或任何私鑰/真帳密

完工請回報：
- branch / commit hash
- changed files
- npm run typecheck 結果
- npm test 結果
- npm run build 結果
- npm run test:e2e 結果
- 是否有任何 skipped/flaky 測試
```

---

## 11. 完工回報格式

```markdown
✅ Phase 7.2 完成 — `<commit>`

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | 0 |
| Vitest | 181 全綠 | ___ |
| build | pass | ___ |
| Playwright specs | 5 全綠 | ___ |
| 真 Firebase/Firestore | 不使用 | ✅ |
| CI workflow | 不修改 | ✅ |

新增 e2e：
- login.spec.ts
- employee-clock.spec.ts
- employee-leave.spec.ts
- admin-schedule.spec.ts
- shift-swap.spec.ts

備註：
- ___
```
