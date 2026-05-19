# 部署檢查清單 — Phase 1–9 完工後人工部署 SOP

> **狀態：** Phase 1–9 已實作完成（46/46 子項），剩下 6 項人工部署步驟
> **建立日期：** 2026-05-20
> **目標讀者：** 系統管理員、SuperAdmin、運維人員
> **預估耗時：** 全部跑完約 2–3 小時（首次設定）

---

## 🗺️ 部署順序總覽

**建議按順序執行**，前項是後項的前提：

| # | 項目 | 預估耗時 | 風險 | 前置依賴 |
|---|------|---------|------|---------|
| 0 | CI workflow PAT 解卡 | 10 分 | 低 | — |
| 1 | Firestore Rules 部署 | 15 分 | **高**（如錯會擋掉所有 API） | Firebase CLI 已裝 |
| 2 | Sentry 整合 | 20 分 | 低 | Sentry 帳號 |
| 3 | FCM Web Push 整合 | 30 分 | 中（service worker 在不同瀏覽器行為不同） | Firebase Console 存取權 |
| 4 | TOTP 強制啟用（SuperAdmin） | 10 分 | **高**（沒存好 recovery codes 會鎖死自己） | 1 完成、要有 Authenticator app |
| 5 | 手動煙霧測試 | 60–90 分 | 低 | 1–4 都完成 |

---

## 0️⃣ CI workflow.yml push 解卡

### 問題

本機 git push 卡在：

```
! [remote rejected] main -> main
(refusing to allow a Personal Access Token to create or update workflow
 `.github/workflows/ci.yml` without `workflow` scope)
```

原因：你目前用的 Personal Access Token（PAT）只有 `repo` scope，沒有 `workflow` scope，無法推任何含 `.github/workflows/*` 變動的 commit。

### 解法 A：更新 PAT（推薦）

1. 開 https://github.com/settings/tokens
2. 找到目前使用中的 token
3. 點 **Regenerate token**（或編輯現有 token）
4. 額外勾選 **`workflow`** scope
5. 點 **Update token** / **Regenerate token**，**立刻複製新 token**（離開頁面就看不到）
6. 本機更新 macOS Keychain：
   ```bash
   # 清掉舊的 GitHub 認證
   printf "protocol=https\nhost=github.com\n\n" | git credential-osxkeychain erase

   # 下次 push 會跳出輸入帳密：
   # username = 你的 GitHub username
   # password = 上面複製的新 PAT
   cd ~/Documents/GitHub/chiayiyouthlabclock
   git push origin main
   ```

### 解法 B：改用 SSH（一勞永逸）

```bash
# 1. 確認 ~/.ssh/id_rsa.pub 或 id_ed25519.pub 已加到 GitHub
#    路徑：https://github.com/settings/keys
cat ~/.ssh/id_ed25519.pub
# （沒 key 就先跑 ssh-keygen -t ed25519 -C "你的 email"）

# 2. 換 remote
cd ~/Documents/GitHub/chiayiyouthlabclock
git remote set-url origin git@github.com:ahnchen1983/chiayiyouthlabclock.git

# 3. 驗證
git push origin main
```

### ✅ 驗收

push 不再被 GitHub 拒絕。任何含 `.github/workflows/ci.yml` 變動的 commit 都能順利上去。

---

## 1️⃣ Firestore Rules 部署

### 為什麼重要

Phase 9.4 在 repo 內已寫好 `firestore.rules`（全 collection client-side **deny all**），但 **這個檔案不會自動部署到 Firebase**。沒部署 = 規則還是預設的「test mode」或舊規則 → 攻擊者可繞過 Functions 直接讀寫資料庫。

### 前置作業

```bash
# 確認有 Node 18+
node --version

# 安裝 Firebase CLI（一次性）
npm install -g firebase-tools

# 登入 Firebase（用建立專案的 Google 帳號）
firebase login
```

### 步驟

```bash
cd ~/Documents/GitHub/chiayiyouthlabclock

# 1. 確認 firebase.json 與 .firebaserc 已存在（repo 應已含）
ls firebase.json .firebaserc

# 沒有的話初始化（只跑一次）：
# firebase init firestore
# - 選現有專案 (chiayiyouthlab-xxx)
# - rules file 路徑用 firestore.rules
# - indexes 用 firestore.indexes.json

# 2. 先 dry-run 看 diff（強烈建議）
firebase deploy --only firestore:rules --dry-run

# 3. 真正部署
firebase deploy --only firestore:rules

# 預期輸出：
# ✔  cloud.firestore: rules file firestore.rules compiled successfully
# ✔  firestore: released rules firestore.rules to cloud.firestore
# ✔  Deploy complete!
```

### ✅ 驗收（這個一定要做）

開 Firebase Console > Firestore Database > Rules tab，確認：

1. 顯示的 rules 內容跟 repo 內 `firestore.rules` 一致
2. 部署時間是剛剛
3. 跑 **Rules Playground**（Console 內建）：
   - Simulation type: `get`
   - Path: `/employees/ADMIN`
   - **Unauthenticated**: 應拒絕 ❌
   - **Authenticated as any user**: 也應拒絕 ❌
   - 兩者皆拒 = rules 正確生效

### 🚨 失敗回滾

如果部署完發現系統登入也壞了（理論上不會，因為前端走 Functions 不直接讀 Firestore），可以：

```bash
# 1. 先看 Console 內 rules history，找上一版的時間
# 2. 把 firestore.rules 改回上一版內容
# 3. 重新 deploy
firebase deploy --only firestore:rules
```

---

## 2️⃣ Sentry 整合

### 為什麼重要

Phase 7.5 已接好 Sentry SDK，但**沒設 DSN 就完全不會上報**。production 出包時你會晚於使用者發現。

### 步驟

#### 2.1 建立 Sentry 專案

1. 開 https://sentry.io/ 註冊（個人帳號免費，5,000 events/月）
2. 點右上 **Create Project**
3. Platform 選 **React**
4. 專案名稱：`chiayiyouthlabclock`
5. 建立後會看到 DSN，類似：
   ```
   https://abc123def456@o123456.ingest.sentry.io/7890123
   ```
6. 複製這串 DSN

#### 2.2 設定 Netlify 環境變數

1. 開 https://app.netlify.com/ → 點你的 site
2. **Site settings** → **Environment variables** → **Add a variable**
3. 設定：
   - Key: `VITE_SENTRY_DSN`
   - Value: 上一步複製的 DSN
   - Scopes: **All scopes**（或至少 Builds + Functions + Runtime）
4. **Save**

#### 2.3 觸發 redeploy

```bash
# 任何 commit 都會觸發 Netlify 自動 build
# 最簡單：推一個無實質變動的 commit
cd ~/Documents/GitHub/chiayiyouthlabclock
git commit --allow-empty -m "chore: trigger redeploy for Sentry DSN"
git push origin main
```

或在 Netlify Dashboard → **Deploys** → **Trigger deploy** → **Deploy site**

### ✅ 驗收

#### 自動驗收

1. Netlify build 完後，開 production URL
2. F12 開 DevTools Console
3. 應**沒看到** "Sentry init" 的錯誤訊息

#### 人工驗收（建議跑）

1. 在 production 環境 F12 Console 跑：
   ```js
   throw new Error('sentry-smoke-test-' + Date.now())
   ```
2. 等 10–30 秒
3. 開 Sentry Dashboard → 你的專案 → **Issues**
4. 應該看到剛剛的 `sentry-smoke-test-xxx` 事件
5. 點進去看 **User** 欄位：
   - 若已登入：應顯示 `id: ADMIN, role: 最高管理者`
   - **不應**顯示姓名、email、phone（個資紅線）

### 🔧 故障排除

| 狀況 | 解法 |
|------|------|
| 完全沒事件上報 | 檢查 Netlify env var 是否真的存在；確認 site 有重新 build |
| Dev 環境也送事件了 | 不應該。檢查 `index.tsx` 的 `beforeSend` 是否在 dev mode 回 null |
| User 顯示了姓名 | 立刻檢查 `services/sentryUser.ts`，確認 `applyUserToSentry` payload 只送 `{ id, role }` |

---

## 3️⃣ FCM Web Push 整合

### 為什麼重要

Phase 7.6 已接好 FCM SDK + service worker，但**沒設 VAPID key 前端按鈕會灰掉**。員工收不到即時通知，只能靠 60s 輪詢（fallback）。

### 步驟

#### 3.1 在 Firebase Console 取得 VAPID Key

1. 開 https://console.firebase.google.com/
2. 選你的專案
3. 左下角 **⚙️ Project Settings**
4. 切到 **Cloud Messaging** tab
5. **Web Push certificates** 區塊：
   - 若沒 key：點 **Generate key pair**
   - 若已有：複製顯示的 key（一長串 BASE64URL 字串，約 88 字元）

#### 3.2 同步前端 firebase config 到 Service Worker

⚠️ **重要前置步驟**：service worker 需要硬編碼 firebase config（不能用 `import.meta.env`）。

1. 取得前端目前用的 firebase config：
   ```bash
   cat services/firebaseConfig.ts | head -30
   # 找到 apiKey / projectId / messagingSenderId / appId 四個值
   ```
2. 編輯 `public/firebase-messaging-sw.js`，把 `SAME_AS_FRONTEND` 換成實際值：
   ```js
   firebase.initializeApp({
       apiKey: 'AIzaSy...',          // ← 從 firebaseConfig.ts 複製
       projectId: 'chiayiyouthlab-xxx',
       messagingSenderId: '123456...',
       appId: '1:123:web:abc...',
   });
   ```
3. commit + push：
   ```bash
   git add public/firebase-messaging-sw.js
   git commit -m "chore(fcm): sync service worker firebase config"
   git push origin main
   ```

#### 3.3 設定 Netlify 環境變數

1. Netlify Dashboard → **Site settings** → **Environment variables**
2. **Add a variable**：
   - Key: `VITE_FCM_VAPID_KEY`
   - Value: 3.1 複製的 VAPID key
   - Scopes: All scopes
3. **Save**

#### 3.4 觸發 redeploy

```bash
git commit --allow-empty -m "chore: trigger redeploy for FCM VAPID key"
git push origin main
```

### ✅ 驗收

按 `PHASE_7.6_FCM_PUSH.md` § 8.3 跑：

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 部署完登入 production | NotificationBell 下拉看到「🔔 啟用即時通知」按鈕 |
| 2 | 點按鈕 → 瀏覽器跳通知權限 → 允許 | Firebase Console > Firestore > `fcmTokens` 出現新文件 |
| 3 | 用另一個 admin 帳號核准一筆請假 | 5 秒內收到 OS 級通知（電腦右下角 / 手機通知中心） |
| 4 | 通知在背景跳出 → 點擊 | 開新分頁到對應位置 |
| 5 | 在前景時收到 → bell 自動 +1，**不重複跳 OS 通知** | ✅ |
| 6 | 登出 | `fcmTokens` 對應文件被刪 |

### 🔧 故障排除

| 狀況 | 解法 |
|------|------|
| 按鈕灰、提示「系統未設定 FCM VAPID key」 | Netlify env var 沒設或沒 redeploy |
| 點按鈕沒反應 | F12 看 console；通常是 service worker 註冊失敗（瀏覽器禁止 / HTTPS 問題） |
| `firebase-messaging-sw.js` 404 | 確認 `public/` 內檔案有跟著 build 進 dist；Netlify 應自動處理 |
| token 存進去但收不到推播 | 檢查 service worker firebase config 是否跟前端一致（最常見出包點） |
| Safari / iOS 收不到 | iOS 16.4+ 才支援 Web Push，且需 PWA 模式加到主畫面 |

### ⚠️ 已知限制

- **iOS Safari**：必須 16.4+ 且加到主畫面，才支援 Web Push
- **macOS Safari**：相對寬鬆，但仍需 user gesture 才能要權限
- **Chrome / Firefox / Edge**：原生支援，最穩定

---

## 4️⃣ TOTP 強制啟用（SuperAdmin）

### 為什麼重要

Phase 9.2 已實作 TOTP 2FA，但 ADMIN 帳號預設**未啟用**。沒啟用 = 帳密外洩就完蛋。

### 🚨 重要警告：先做這 3 件事再點啟用

1. **準備 Authenticator app**：手機裝 Google Authenticator / Microsoft Authenticator / Authy 其中一個
2. **準備好存放 recovery codes 的安全位置**：1Password / Bitwarden / 印出來鎖抽屜
3. **不要在公司唯一一台筆電上做**：手機弄丟 + recovery codes 沒存 = 永久鎖死，需要去 Firebase Console 手動改 Firestore `totpSecrets/ADMIN` 文件才能救

### 步驟

#### 4.1 登入並進入設定

1. 開 production URL
2. 用 `ADMIN` 帳號登入（預設密碼 `admin1234`，如果還沒改強烈建議先改！）
3. 進入「個人設定」或「修改密碼」相關頁面
4. 找到 **「啟用兩階段驗證 (2FA)」** 區塊

#### 4.2 設定流程

1. 點 **啟用 2FA**
2. 系統顯示 QR Code
3. 用 Authenticator app 掃描 QR Code（會自動加入「嘉義青年實驗室」帳號）
4. App 會開始每 30 秒產生一組 6 位數驗證碼
5. 在系統頁面輸入當下 6 位數
6. 提交後顯示 **10 組 recovery codes**（每組約 8 位數）
7. **這是唯一一次顯示**！立刻：
   - 複製到 1Password / Bitwarden
   - 或截圖存到加密硬碟
   - 或印出來鎖進保險箱
8. 確認儲存後再點「我已妥善保存」

#### 4.3 驗證流程可用

1. **登出** ADMIN
2. **重新登入**：輸入帳密
3. 系統應跳出「請輸入 2FA 驗證碼」畫面
4. 開 Authenticator app 看當下 6 位數，輸入
5. 應成功登入

#### 4.4 測試 recovery code

1. 再登出
2. 重新登入到 2FA 畫面
3. 點 **「使用 recovery code」**
4. 輸入剛剛存的 10 組之中**任一組**
5. 應成功登入
6. **該組 recovery code 用完即廢**（系統會自動移除）

### ✅ 驗收

- [ ] Authenticator app 顯示「嘉義青年實驗室 (ADMIN)」
- [ ] 登出再登入需要 2FA 才能進
- [ ] 10 組 recovery codes 已存到安全位置
- [ ] 用一組 recovery code 成功登入過（驗證真的能用）
- [ ] Firebase Console > Firestore > `totpSecrets/ADMIN` 文件存在且 `enabled: true`

### 🚨 救急流程：手機掉了 + recovery codes 也沒存

唯一解法（破壞性）：

```
1. 找一台已登入的其他 SuperAdmin 帳號（如有）
2. 進「員工管理」找 ADMIN → 點「重設 2FA」
3. 該功能會清掉 totpSecrets/ADMIN 文件，2FA 變回未啟用
4. ADMIN 帳號可用密碼直接登入，再重做 4.1 流程
```

如果**只有一個** SuperAdmin 帳號被鎖：
1. Firebase Console > Firestore > 找 `totpSecrets/ADMIN`
2. **刪除整份文件**
3. 回系統用密碼登入
4. 重做 2FA 啟用流程

---

## 5️⃣ 手動煙霧測試（7 個 Phase）

### 為什麼重要

單元測試（190 個）+ e2e（5 個）覆蓋了純函數與主流程，但下列項目**必須瀏覽器手動跑**：

- 需要實際 OAuth / 第三方服務的（Sentry 上報、FCM 推播）
- 需要 multi-user 同步觀察的（換班雙方確認）
- A4 列印 / PDF 切頁這類視覺驗證

### 完整清單

按優先序：

| # | Phase | 重點 | 文件 | 預估時間 |
|---|-------|------|------|---------|
| 1 | **9.1** Headers | curl 檢查 response header | `PHASE_9.1_SECURITY_HEADERS.md` § 4.3 | 10 分 |
| 2 | **9.4** Firestore Rules | Console Rules Playground | `PHASE_9.4_FIRESTORE_RULES.md` § 4.3 | 10 分 |
| 3 | **9.2** TOTP | 註冊 → 登入 → recovery → reset | `PHASE_9.2_TOTP_2FA.md` § 4.3 | 15 分 |
| 4 | **6.3** 月結鎖定 | 鎖定後 4 個 modify action 應跳 423 | `PHASE_6.3_MONTH_LOCK.md` § 4.3 | 20 分 |
| 5 | **8.2** 留停凍結 | 員工 dashboard 看餘額是否正確凍結 | `PHASE_8.2_LEAVE_OF_ABSENCE.md` § 4.4 | 15 分 |
| 6 | **8.3** 出勤 PDF | A4 切頁 + `<script>` escape | `PHASE_8.3_ATTENDANCE_PDF.md` § 4.3 | 15 分 |
| 7 | **7.5** Sentry | production throw 後 5 秒內出現 | `PHASE_7.5_SENTRY.md` § 4.3 | 10 分 |
| 8 | **7.6** FCM | 跨裝置推播延遲 < 5 秒 | `PHASE_7.6_FCM_PUSH.md` § 8.3 | 20 分 |

### 怎麼跑

1. 開 production URL
2. 兩個瀏覽器分頁（或一台筆電 + 一支手機）並行
3. 依次打開每個工單檔，照 § 4.3 / § 8.3 步驟一條條跑
4. 卡關時打開 F12 DevTools Console 看錯誤訊息

### 整合性煙霧測試清單（額外參考）

- `docs/A_BATCH_SMOKE_TEST.md` — A 批工單的端到端流程

### ✅ 驗收

把每個 § 4.3 / § 8.3 的勾選清單跑完，全勾 = 通過。失敗的：

- 寫進 issue / TODO
- 標記是 production 環境問題還是 code bug
- 嚴重的就 rollback、修完再 redeploy

---

## 📊 全部完工後的最終狀態

跑完上面 0–5 後，你應該能宣告：

- ✅ Phase 1–9 全 46 個子項實作完成
- ✅ Firestore Rules 已部署（防 client 繞過）
- ✅ Sentry 正在收集 production 錯誤
- ✅ FCM 正在即時推播通知（取代輪詢）
- ✅ SuperAdmin 帳號有 2FA 保護
- ✅ CI 守門（typecheck + 190 tests + 5 e2e + npm audit）
- ✅ 文件齊備（SDD / Roadmap / CHANGELOG / 14 張工單 / 本檔）

---

## 🔄 之後例行運維

| 頻率 | 動作 |
|------|------|
| 每週 | 看 Sentry Issues 有沒有新錯誤；看 GitHub Dependabot PRs |
| 每月 | 月底前 SuperAdmin 跑「結算並鎖定」（Phase 6.3）|
| 每季 | 跑 `npm audit --omit=dev` 看新 CVE；考慮升 firebase major version |
| 每半年 | 重生 TOTP recovery codes（如有用掉）；review Firebase Console 內 `fcmTokens` 數量是否合理 |
| 年度 | 系統健康度全面 review；規劃下一階段（v3.0 多店 / mobile app / 進階報表 etc.） |

---

## 📞 緊急聯絡 / 救急資訊

| 狀況 | 動作 |
|------|------|
| Netlify build 掛 | Netlify Dashboard 點上一個成功的 deploy → **Publish deploy** |
| Firestore Rules 部署完登入掛了 | 回上面 § 1 「失敗回滾」 |
| ADMIN 帳號被 2FA 鎖死 | 回上面 § 4「救急流程」 |
| Sentry 配額用爆 | 升 Sentry plan，或暫時拉低 `tracesSampleRate` 到 0.01 |
| FCM 推播全部失敗 | 暫時忽略（Firestore 通知還在），下次 deploy 再修；輪詢 fallback 會接手 |
