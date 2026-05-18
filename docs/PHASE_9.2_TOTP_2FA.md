# Phase 9.2 — 雙因素認證（TOTP）工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 1.5–2 天（大票）
> **對應 Roadmap：** Phase 9.2
> **對應 SDD 議題：** § 2.2 認證流程強化
> **依賴：** Phase 7.5（Sentry user context）已上線
> **客戶決策：** D9-1 (a)

---

## 1. 目標

目前系統只有單因素「帳號 + 密碼」。雖然 Phase 7.4 已加 scrypt 雜湊與失敗鎖定，但 SuperAdmin 密碼一旦外洩，攻擊者可單點接管整個排班、薪資、員工資料系統。本工單導入 **TOTP（RFC 6238）** 二階段認證。

**已拍板決策（D9-1 a）：**

| 角色 | 2FA 策略 |
|------|----------|
| SuperAdmin | **強制啟用**（首次登入後跳 setup wizard，不可關閉、不可進 dashboard） |
| Admin | 自選 |
| Employee | 不啟用（不顯示入口） |

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| Firestore collections | 14 | 15（`totpSecrets`） |
| API actions | 50+ | +5 |
| 認證階段 | 1 | 2 |
| Vitest 總數 | 104 | ≥ 110 |
| 新增 npm 套件 | — | `otplib` / `qrcode` / `@types/qrcode` |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **改** — 新增 `TotpSecretDoc` / `TotpLoginChallenge` / `LoginResult` |
| `netlify/functions/utils/totp.ts` | **新增** — 純函數模組 |
| `netlify/functions/api.ts` | **改** — login 兩階段 + 5 個新 actions |
| `services/googleAppsScriptAPI.ts` | **改** — `apiLogin` 改回傳型別 + 5 個 client |
| `contexts/AuthContext.tsx` | **改** — `completeTotpLogin` + `needsTotpSetup` |
| `pages/LoginPage.tsx` | **改** — 加二階段畫面 |
| `components/TotpSetupModal.tsx` | **新增** — 4 步驟 wizard |
| `components/TotpDisableModal.tsx` | **新增** |
| `App.tsx` | **改** — SuperAdmin 強制守門 + Admin 自選入口 |
| `tests/totp.test.ts` | **新增** — ≥ 6 個 |
| `package.json` / `package-lock.json` | **改** — 新增 3 個套件 |

**不要動：**
- ❌ 既有 104 測試、`vite.config.ts`
- ❌ Phase 7.4 防暴力破解 helper（`checkLoginLockout` / `recordLoginFail`）— 直接重用
- ❌ Sentry user context — 第二階段全部通過後才呼叫 `applyUserToSentry`

---

## 3. 實作規格

### 3.1 套件安裝

```bash
npm i otplib qrcode
npm i -D @types/qrcode
```

### 3.2 `types.ts` 新增

```typescript
// TOTP 2FA（Phase 9.2）

export interface TotpSecretDoc {
    secret: string;                 // base32 secret（純後端）
    enabled: boolean;
    enabledAt?: string;
    recoveryCodes: string[];        // 10 個 scrypt hash（用過即移除）
    lastVerifiedAt?: string;
    setupAt?: string;
}

export interface TotpLoginChallenge {
    empId: string;
    expiresAt: string;              // 5 分鐘 TTL
    createdAt: string;
}

export type LoginResult =
    | { kind: 'success'; user: User; customToken: string }
    | { kind: 'requireTotp'; totpToken: string; expiresAt: string }
    | { kind: 'fail'; message?: string };
```

### 3.3 `netlify/functions/utils/totp.ts`（新檔）

```typescript
/**
 * TOTP 雙因素認證 — RFC 6238（30s / 6 digits / SHA-1）
 * Phase 9.2
 */
import { authenticator } from 'otplib';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

authenticator.options = {
    digits: 6,
    step: 30,
    window: 1,        // ±30 秒容忍時鐘漂移
    algorithm: 'sha1',
};

export const generateSecret = (): string => authenticator.generateSecret();

export const verifyTotp = (secret: string, code: string): boolean => {
    if (!secret || !code) return false;
    if (!/^\d{6}$/.test(code)) return false;
    try {
        return authenticator.verify({ token: code, secret });
    } catch {
        return false;
    }
};

export const buildOtpAuthUrl = (empId: string, secret: string, issuer = '嘉義青年實驗室'): string =>
    authenticator.keyuri(empId, issuer, secret);

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const generateRecoveryCodes = (n = 10): string[] => {
    const codes: string[] = [];
    for (let i = 0; i < n; i++) {
        const bytes = randomBytes(8);
        let code = '';
        for (let j = 0; j < 8; j++) {
            code += RECOVERY_ALPHABET[bytes[j] % RECOVERY_ALPHABET.length];
        }
        codes.push(code);
    }
    return codes;
};

export const hashRecoveryCode = (code: string): string => {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(code.toUpperCase(), salt, 64).toString('hex');
    return `${salt}:${hash}`;
};

export const verifyRecoveryCode = (code: string, stored: string): boolean => {
    if (!stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const hashBuf = Buffer.from(hash, 'hex');
    const testBuf = scryptSync(code.toUpperCase(), salt, 64);
    if (hashBuf.length !== testBuf.length) return false;
    return timingSafeEqual(hashBuf, testBuf);
};

export const findRecoveryCodeIndex = (code: string, hashes: string[]): number => {
    for (let i = 0; i < hashes.length; i++) {
        if (verifyRecoveryCode(code, hashes[i])) return i;
    }
    return -1;
};
```

### 3.4 登入流程序列圖

```
密碼正確 + totp.enabled = true
  → 後端 create totpChallenges/{token}（TTL 5 min）
  → 回 { kind: 'requireTotp', totpToken }

前端切換到「輸入 6 位數驗證碼」頁
  → 提交 verify-totp-login(totpToken, code)
  → 後端 consume challenge + verifyTotp
  → 通過 → 回 customToken
  → 前端 signInWithCustomToken + applyUserToSentry → dashboard
```

**重要：** `submit-totp-login` 失敗也呼叫 `recordLoginFail`（防 TOTP 暴力破解）。

### 3.5 5 個後端 actions

- **`setup-totp`**（已登入）：產 secret + return otpauthUrl；暫存 `enabled: false`
- **`verify-totp-setup`**：驗證 + 產 10 組 recovery codes（雜湊存）
- **`verify-totp-login`**（不需 Bearer，與 login 同層）：consume challenge + 驗證 TOTP 或 recovery code
- **`disable-totp`**：需當前 TOTP；**SuperAdmin 直接 403**
- **`regenerate-recovery-codes`**：需當前 TOTP
- **`get-totp-status`**：給前端判斷啟用狀態（不回 secret）

完整 actions 程式碼參考工單原稿（agent 已生成 ~250 行詳細範例）。

### 3.6 UI 元件

#### `TotpSetupModal.tsx`（4 步驟 wizard）

1. **intro**：「啟用 2FA」按鈕；`forced` mode 不可關
2. **scan**：用 `qrcode` render SVG QR；摺疊「手動輸入金鑰」備援
3. **verify**：輸入 6 位數 → `verify-totp-setup`
4. **recovery**：顯示 10 組明文 recovery codes，「複製」+「我已備份」

#### `TotpDisableModal.tsx`

輸入當前 TOTP → `disable-totp`。SuperAdmin 前端不顯示此按鈕（後端 403 雙保險）。

#### `LoginPage.tsx`

加 `step: 'password' | 'totp'` state；TOTP step 含「改用救援碼」toggle。

### 3.7 SuperAdmin 強制守門（`App.tsx`）

```tsx
const { user, needsTotpSetup } = useAuth();

if (user && user.role === UserRole.SuperAdmin && needsTotpSetup) {
    return <TotpSetupModal forced onClose={() => setNeedsTotpSetup(false)} />;
}
```

### 3.8 `tests/totp.test.ts`（≥ 6 個）

涵蓋：
- `generateSecret`：base32 字串、每次不同
- `verifyTotp`：當前 code 通過 / 錯誤失敗 / 非 6 位數失敗 / 超出 window 失敗
- `generateRecoveryCodes`：10 組、8 字元、唯一
- `hashRecoveryCode` / `verifyRecoveryCode`：hash + verify 正反向、大小寫不敏感
- `findRecoveryCodeIndex`：找到 / 找不到 / 用過後從陣列移除

完整測試碼參考工單原稿。

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | ≥ 110 全綠 |
| 3 | `npm run build` | 無 warning |
| 4 | `npm ls otplib qrcode` | 兩套件確實安裝 |

### 4.2 程式碼審查

- [ ] `totp.ts` 純函數
- [ ] `secret` / `recoveryCodes` 明文**從未**出現在 console / Sentry / auditLog
- [ ] auditLog 只記「啟用 2FA」「停用 2FA」等動作名
- [ ] `disable-totp` 對 SuperAdmin 回 403
- [ ] `verify-totp-login` 失敗呼叫 `recordLoginFail`
- [ ] `totpChallenges` 用後**立即刪除**
- [ ] `setup-totp` 對已啟用帳號回 400
- [ ] `signInWithCustomToken` + `applyUserToSentry` 只在二階段全通過後呼叫
- [ ] `TotpSetupModal` `forced=true` 不顯示 X / 不顯示「稍後再說」

### 4.3 e2e 煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | SuperAdmin 首次登入（未啟用） | 密碼通過 → 跳「啟用 2FA」modal，不可關 |
| 2 | 開始設定 → QR 顯示 → 手機掃描 → 輸入 6 位數 | 通過 → 顯示 10 組 recovery codes |
| 3 | 複製、按「我已備份」 | 進 dashboard |
| 4 | 登出再登入 | 密碼通過 → 切「輸入 6 位數」 |
| 5 | 輸入 App 當前 6 位數 → 通過 | 進 dashboard |
| 6 | 故意 `000000` × 5 | 跳「驗證碼錯誤」→ 連 5 次後鎖 15 分鐘 |
| 7 | 用 recovery code | 通過；alert「剩 N 組」（若 ≤ 3） |
| 8 | 同 recovery code 再用 | 失敗（已消費） |
| 9 | SuperAdmin 找「停用 2FA」按鈕 | **找不到**（後端 disable-totp 對 SuperAdmin 回 403） |
| 10 | Admin（無 2FA）→ 啟用 → 登出登入走 TOTP | 流程同上 |
| 11 | Admin 停用 → 再登入 | 不需 TOTP |
| 12 | Employee 登入 | 「我的功能」**不**顯示 2FA 按鈕 |
| 13 | Firestore Console 看 `totpSecrets/ADMIN` | secret base32；recoveryCodes 為 `salt:hash`；`enabled = true` |
| 14 | Sentry breadcrumb / auditLogs | 找不到 secret / recovery 明文 |
| 15 | `totpChallenges` | 用過即刪 |

---

## 5. Commit message 模板

```
feat(security): TOTP two-factor authentication (Phase 9.2)

- Add netlify/functions/utils/totp.ts pure helpers
  (generateSecret / verifyTotp / generateRecoveryCodes /
   hashRecoveryCode / verifyRecoveryCode / findRecoveryCodeIndex)
- Add TotpSecretDoc / TotpLoginChallenge / LoginResult to types.ts
- Refactor login flow into two-stage:
  - Stage 1: password → if 2FA enabled, return requireTotp challenge token
  - Stage 2: verify-totp-login (TOTP code OR recovery code) → customToken
- Add 5 API actions: setup / verify-setup / verify-login / disable
  (SuperAdmin forbidden — 403) / regenerate-recovery-codes
- TotpSetupModal.tsx: 4-step wizard (intro / QR scan / verify / recovery)
- TotpDisableModal.tsx: requires current TOTP
- AuthContext: completeTotpLogin + needsTotpSetup flag
- LoginPage: second step with recovery code toggle
- App.tsx: SuperAdmin forced setup gate (cannot dismiss)
- Add tests/totp.test.ts — ≥ 6 unit tests

Security:
- secrets and recovery code hashes NEVER logged
- Recovery codes scrypt-hashed (same as passwords)
- Failed TOTP triggers recordLoginFail (lockout still applies)
- totpChallenges one-time use, 5min TTL

D9-1 (a): SuperAdmin forced, Admin optional, Employee disabled
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 把 secret / recoveryCodes 明文寫進 console / Sentry / auditLog | **個資紅線** |
| 把 `otpauthUrl` 整段寫進 log（內含 secret） | 同上 |
| 自己實作 HOTP/TOTP 演算法（不用 otplib） | RFC 6238 細節易出錯 |
| 把 secret 雜湊存（取代明文 secret） | TOTP 計算需要原始 secret，不能 hash |
| 加 FIDO2/WebAuthn / SMS OTP / Email OTP | follow-up |
| 改 firestore.rules 開放 client 讀 `totpSecrets` | **嚴禁** |
| 用 localStorage 暫存 totpToken | 5 分鐘內僅一次用，記憶體 state 夠 |
| 對 Admin 強制啟用 | D9-1 (a) 明確：Admin = 自選 |
| 改既有 104 測試 / `vite.config.ts` | 嚴禁 |

---

## 7. 完工回報格式

```
Phase 9.2 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 110 | __ |
| build 警告 | 無 | __ |
| otplib / qrcode 安裝 | 是 | __ |
| 5 個 actions 上線 | 是 | __ |
| SuperAdmin 強制 setup | 不可關 | __ |
| Admin 自選 / Employee 無入口 | 是 | __ |
| secret / recovery 明文未洩漏 | 是 | __ |

新增測試：totp.test.ts ___ 個案例

手動煙霧測試（4.3）：- [ ] § 1–15 全勾

備註：
```

---

## 8. 後續可能 follow-up

- FIDO2 / WebAuthn（passkeys）
- 管理員強制撤銷某員工 2FA（雙人批准）
- TOTP 跨裝置 sync 提示
- 自動清理過期 totpChallenges（scheduled function）
- 2FA 啟用率儀表板（合規報告）
- 信任裝置 30 天免 TOTP
- TOTP secret 加密匯出備援
- Sentry 整合：異常登入嘗試分類
