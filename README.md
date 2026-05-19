# 嘉義市青年實驗室出勤管理系統

> Chiayi Youth Lab Clock System

員工出勤打卡、排班管理、請假申請、薪資計算等人事管理功能。
適用對象：嘉義市有事青年實驗室的專責人員（正職）與兼職人員（PT）。

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 樣式 | Tailwind CSS |
| 後端 | Netlify Functions (Serverless) |
| 資料庫 | Firebase Firestore |
| 認證 | Firebase Authentication (Custom Token) |
| 部署 | Netlify |

## 本機開發

**前置需求：** Node.js 18+

1. 安裝相依套件：
   ```bash
   npm install
   ```

2. 設定環境變數，建立 `.env` 檔案：
   ```
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=your-client-email
   FIREBASE_PRIVATE_KEY=your-private-key

   # 選用：Sentry 錯誤監控（Phase 7.5）
   VITE_SENTRY_DSN=https://<public_key>@<org>.ingest.sentry.io/<project_id>
   ```

### Netlify 環境變數 — `ALLOWED_ORIGINS`（Phase 9.1）

CORS 白名單。逗號分隔，未設則 fallback 為：
- `https://chiayiyouthlabclock.netlify.app`
- `http://localhost:5173`
- `http://localhost:8888`

自訂 domain 需在 Netlify 設定：
```
ALLOWED_ORIGINS=https://chiayiyouthlabclock.netlify.app,https://clock.example.org
```

Phase 9.1 同步加入 6 個安全 headers（HSTS、X-CTO、XFO、Referrer、Permissions、CSP-Report-Only）。CSP 採 Report-Only 兩週觀察期，觀察結束後切換為 enforce。

### Sentry 錯誤監控（選用）

Production 部署到 Netlify 時，於 Netlify Dashboard > Site settings > Environment variables 設定：

| 變數名 | 值 | 說明 |
|--------|-----|------|
| `VITE_SENTRY_DSN` | `https://...@sentry.io/...` | Sentry 專案 Settings > Client Keys (DSN) 取得 |

留空或不設則 Sentry 不會啟動。**個資原則：** 本系統送往 Sentry 的 user context 僅含 `id` (empId) 與 `role`，**絕不送姓名、email、電話**。Dev 模式（`npm run dev`）的事件會被 `beforeSend` 直接 drop，不會吃 Sentry 配額。

3. 啟動開發伺服器：
   ```bash
   npm run dev
   ```

## 文件

| 文件 | 說明 |
|------|------|
| [docs/SDD.md](docs/SDD.md) | 軟體設計文件 — 系統架構、功能模組、資料模型、API、已知問題 |
| [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) | 開發階段規劃 — 4 個階段共 20 項改善工作 |

## 部署

本系統部署於 Netlify，推送至 `main` 分支即自動部署。

Firebase 環境變數需在 Netlify Dashboard > Site settings > Environment variables 中設定。

## Firestore Rules 部署（Phase 9.4）

本專案 Firestore rules 採「**client 全 deny**」策略 — 所有資料讀寫必須走後端 API。
前端任何 `db.collection(...).get()` 都會被 Firebase 拒絕，僅後端 service account
（Firebase Admin SDK）能繞過 rules 操作資料。

### 本機測試 rules

```bash
# 需先安裝 Java 11+（macOS：brew install openjdk@17）
npm run firebase:rules:test
```

### 部署 rules 到 production

```bash
npx firebase-tools login     # 第一次需先登入
npm run firebase:rules:deploy

# 同時部署 indexes
npx firebase-tools deploy --only firestore:indexes
```

> ⚠️ **警告：任何前端程式碼直接讀寫 Firestore 都會被 deny。**
> 所有資料操作必須透過 `services/googleAppsScriptAPI.ts` 的 fetch 呼叫
> `/.netlify/functions/api`，由後端用 service account 操作 Firestore。

## 資安回報

如發現本系統有資安漏洞，請依 [SECURITY.md](./SECURITY.md) 所述方式回報至 `ahnchen@yuncidigital.com`，**請勿在 GitHub Issue 公開回報細節**。

我們承諾 48 小時內回覆，依嚴重度於 7–30 天內部署修補。

## 自動化資安檢查

| 機制 | 觸發 | 行為 |
|------|------|------|
| GitHub Actions `npm audit` | PR / push to main | high / critical CVE 阻擋 merge |
| Dependabot（npm） | 每週一 09:00 Asia/Taipei | 自動 PR minor/patch 升級 |
| Dependabot（github-actions） | 每週一 09:00 Asia/Taipei | 監視 CI actions 版本 |

本機可手動執行：

```bash
npm run audit:prod    # 與 CI 同步的 production-only 掃描（high+ 失敗）
npm run audit:report  # 產出全量 JSON 報告（不入 git）
```
