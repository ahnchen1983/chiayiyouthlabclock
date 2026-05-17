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
