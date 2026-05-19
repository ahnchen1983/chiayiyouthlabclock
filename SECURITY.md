# 資安政策 (Security Policy)

> 嘉義青年實驗室打卡系統 — Phase 9.3

感謝您協助提升本系統的安全性。本文件說明本專案的漏洞回報窗口、處理流程與承諾。

## 支援版本

| 版本 | 支援狀態 |
|------|---------|
| `main` 最新 | ✅ 持續修補 |
| v2.x | ✅ 持續修補 |
| v1.x | ⚠️ 僅嚴重漏洞修補 |
| v0.x | ❌ 不再支援 |

## 漏洞回報窗口

**請勿在 GitHub Issue / Discussions / PR 公開回報任何漏洞細節**。

請以電子郵件聯繫：

- **Email**：`ahnchen@yuncidigital.com`
- **信件主旨**：`[SECURITY] <漏洞簡述>`

建議內容（至少包含）：

- 漏洞類型（SQLi、XSS、IDOR、CSRF、Auth bypass、…）
- 受影響端點 / 元件 / 程式行
- 重現步驟（最小可重現範例）
- 影響範圍（讀取、修改、刪除、提權？）
- CVSS 3.1 分數（可選）

歡迎附 PoC，但**請勿對 production 系統進行破壞性測試**（DoS、大量寫入、資料毀損）。

如能加密，PGP 公鑰將於本檔後續更新提供。

## 我們的承諾

| 階段 | 時限 |
|------|------|
| 初步回覆 | 48 小時內 |
| 漏洞驗證 | 7 天內 |
| 嚴重漏洞（Critical / High）修補 | 7 天內 |
| 中低漏洞（Medium / Low）修補 | 30 天內 |
| 通知回報者修補完成 | 修補後 24 小時 |

如修補需要更長時間，會主動通知並說明原因。

## 嚴重度標準 (CVSS 3.1)

| 嚴重度 | CVSS 範圍 | 範例 |
|--------|----------|------|
| Critical | 9.0–10.0 | 未驗證 RCE、所有員工資料外洩 |
| High | 7.0–8.9 | 越權讀取他人薪資、Auth bypass |
| Medium | 4.0–6.9 | 越權讀取個人資料、XSS 需互動 |
| Low | 0.1–3.9 | 資訊揭露、技術細節暴露 |

## 範圍

**在範圍內：**
- 本 repo `main` 分支的應用程式碼
- Netlify Functions (`netlify/functions/api.ts`)
- Firestore Security Rules
- 本系統使用的 npm 套件供應鏈

**不在範圍內：**
- 第三方服務本身（Firebase、Netlify、Sentry）— 請直接向供應商回報
- 客戶端瀏覽器 / 作業系統漏洞
- 社交工程 / 釣魚（請聯繫客戶 IT）
- 物理存取攻擊

## 致謝榜

感謝以下安全研究員協助提升本系統安全性：

| 日期 | 研究員 | 漏洞類型 | 嚴重度 |
|------|--------|---------|--------|
| _（期待您成為第一位）_ | | | |

## 自動化檢測

本專案已建立以下自動化機制：

| 機制 | 觸發 | 行為 |
|------|------|------|
| GitHub Actions `npm audit` | PR / push to main | high / critical CVE 阻擋 merge |
| Dependabot（npm） | 每週一 09:00 Asia/Taipei | 自動 PR minor/patch 升級 |
| Dependabot（github-actions） | 每週一 09:00 Asia/Taipei | 監視 CI actions 版本 |
| Sentry 錯誤監控 | Production runtime error | 即時告警 |
| Firestore Security Rules | 每次資料存取 | 後端強制權限檢查 |

詳見 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 與 [`.github/dependabot.yml`](.github/dependabot.yml)。

## 已知供應鏈風險追蹤

2026-05-19 執行 `npm audit --omit=dev`，目前回報 8 個 low severity vulnerabilities，來源集中於 `firebase-admin` 依賴的 Google Cloud 套件鏈（`@tootallnate/once` / `http-proxy-agent` / `teeny-request` / `retry-request` / `google-gax` / `@google-cloud/firestore` / `@google-cloud/storage`）。

目前判斷：

- 無 high / critical CVE，不觸發 CI 阻擋條件
- `npm audit fix --force` 會降到 `firebase-admin@10.3.0`，屬破壞性變更，暫不採用
- 持續由 Dependabot 與後續手動 audit 追蹤，待上游 patch / minor 版本釋出後再升級

## 法律聲明

- 我們**不提供**漏洞獎金（無 Bug Bounty 預算）
- 在我們驗證並修補前，請**勿公開揭露**漏洞細節
- 善意研究者依本政策回報的行為，我們**不會**追究法律責任
- 若超出本政策範圍（如惡意攻擊、勒索、資料外洩），保留法律追訴權

---

最後更新：2026-05-19 (Phase 9.3)
