# 進度收整快照 — 2026-05-19

> **用途：** 在 Phase 9 資安強化批 4 張收尾後，整理目前累計進度與待辦清單。
> 不取代 SDD / Roadmap / CHANGELOG，只是「截至今日的一頁式對外摘要」。

---

## 1. 進度總覽

| Phase | 名稱 | 狀態 | 子項 | 對應 commit / 文件 |
|-------|------|------|------|--------------------|
| **1** | 基礎修正 | ✅ 完成 | 5/5 | v1.1 |
| **2** | 權限與安全（第一輪） | ✅ 完成 | 4/4 | v1.2 |
| **3** | 功能完善（客戶第一輪 6 項） | ✅ 完成 | 6/6 | v1.5 |
| **4** | 進階功能 | ✅ 完成 | 4/4 | v1.6 |
| **5** | 排班模型重構（v2.0 核心） | ✅ 完成 | 7/7（5.7 取消） | v2.0 |
| **6** | 排班協作 | 🟡 進行中 | **3/4** | 6.1 / 6.2 / 6.3 ✅ ／ 6.4 待 |
| **7** | 系統健全化（技術債） | 🟡 進行中 | **5/7** | 7.1 / 7.3 / 7.4 / 7.5 / 7.7 ✅ ／ 7.2 / 7.6 待 |
| **8** | HR 細節補強 | ✅ 完成 | **5/5** | 8.1 / 8.2 / 8.3 / 8.4 / 8.5 全綠 |
| **9** | 資安強化 | ✅ 完成 | **4/4** | 9.1 / 9.2 / 9.3 / 9.4 全綠 |

**已完成：** Phase 1–5 + Phase 8 + Phase 9 + 部分 6/7（共 **43 個子項**）
**剩餘規劃中：** 3 個子項（Phase 6×1 / Phase 7×2）
**已列追蹤：** 9.3 First-Run audit triage 已完成，剩低風險依賴鏈升級追蹤

---

## 2. Phase 9 資安強化批完成內容（2026-05-18 ~ 19）

| # | Phase | Commit | 重點 |
|---|-------|--------|------|
| 1 | **9.1 Netlify 安全 Headers + CORS** | `c630014` | CSP / HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy + Functions CORS allowlist |
| 2 | **9.3 Dependency Audit + CI gate** | `ba31dd0` | Dependabot 設定 + SECURITY.md + npm audit 進 CI workflow（high/critical fail，moderate/low warn） |
| 3 | **9.4 Firestore Rules** | `a015550` | 全 collection client-side **deny all**；所有讀寫只能走 Netlify Functions（後端帶 service account） |
| 4 | **9.2 TOTP 2FA** | `623e724` | 完整 TOTP 流程：QR 設定、6 碼驗證、10 組 recovery codes 雜湊儲存、SuperAdmin 強制啟用、reset by SuperAdmin |

**安全性紅線守住：**
- ✅ TOTP secret / recoveryCodes 明文絕不進 console / Sentry / auditLog
- ✅ SuperAdmin 不可 disable 自己（後端 403 守門）
- ✅ Firestore rules 無 `if request.auth != null` 例外，純後端代寫
- ✅ Sentry user payload 僅 `id + role`，不含姓名 / email / phone

---

## 3. 測試與品質指標

| Metric | 起點（v2.0 收尾） | 目前 | 變化 |
|--------|------------------|------|------|
| Vitest 測試案例 | 67 | **169** | +102 |
| 測試檔案數 | 1 | **12** | +11 |
| GitHub Actions CI | tsc + test + build | 加 npm audit gate | — |
| TypeScript 錯誤 | 0 | 0 | — |
| Bundle entry (raw) | 386 KB | 220 KB 左右 | -43% |
| Bundle entry (gzip) | 103 KB | 67 KB 左右 | -35% |
| Vendor 拆分 | 1 chunk | 3（react / firebase / app） | +2 |
| 已知 npm vulnerabilities | 未掃 | **8 low** | First-Run 已 triage，無 high / critical |

### 測試檔案盤點

| 檔案 | 涵蓋功能 |
|------|---------|
| `tests/calculations.test.ts` | 密碼 / 遲到判定 / 特休 / 假別餘額 / 薪資 / 排班 normalize / 兩頭班 / 覆蓋率 / **LOA 凍結** |
| `tests/csvMasking.test.ts` | 姓名 / empId / IP / GPS 脫敏 |
| `tests/monthLock.test.ts` | 月結鎖定邊界（鎖定月最後一天 / 解鎖 / 跨月） |
| `tests/sentry.test.ts` | applyUserToSentry + scrubPasswordFields + ErrorBoundary 上報 |
| `tests/attendancePrint.test.ts` | 列印 HTML 純函數 + XSS escape |
| `tests/cors.test.ts` | 9.1 CORS allowlist |
| `tests/firestore-rules.test.ts` | 9.4 規則 deny all |
| `tests/totp.test.ts` | 9.2 TOTP code 生成 / 驗證 / recovery codes |
| `tests/monthlyReport.test.ts` | 8.4 月結報表：請假分布 / 打卡異常 / 工時排名 / 摘要 |
| `tests/selfServiceRequests.test.ts` | 8.5 留停自助申請驗證 / 狀態判斷 |
| `tests/scheduleVersion.test.ts` | 6.2 排班版本快照 / 差異比對 |
| `tests/shiftSwap.test.ts` | 6.1 換班申請驗證 / 執行交換 |

---

## 4. 已上工單但尚未實作（規劃中）

工單檔案都在 `docs/PHASE_*.md`，給後續 Codex 或自己接手。

### Phase 6 剩 1 張

| 編號 | 名稱 | 工單檔 | 預估工期 |
|------|------|--------|---------|
| 6.4 | 員工偏好班次設定 | 工單尚未撰寫 | — |

### Phase 7 剩 2 張

| 編號 | 名稱 | 狀態 |
|------|------|------|
| 7.2 | Playwright e2e 測試 | 工單尚未撰寫 |
| 7.6 | FCM Push 通知（取代 60s 輪詢） | 工單尚未撰寫 |

### Phase 9 follow-up

- 9.3 **First-Run npm audit triage 已完成** — `npm audit --omit=dev` 回報 8 個 low severity vulnerabilities，來源集中於 `firebase-admin` 的 Google Cloud 依賴鏈：
  1. 目前無 high / critical CVE，不會觸發 CI 阻擋條件
  2. `npm audit fix --force` 會降到 `firebase-admin@10.3.0`，屬破壞性變更，不建議直接執行
  3. 已於 `SECURITY.md` 加 acknowledged risk，後續等上游 patch / minor 版本再評估升級

---

## 5. 待用戶本機驗收的手動煙霧測試

A 批與 Phase 9 批的 § 4.3 / § 4.4 手動測試均需瀏覽器/實際操作，沙箱跑不了：

| Phase | 測試重點 | 對應文件 |
|-------|---------|---------|
| 6.3 | 結算鎖定 + 4 個 modify action 應跳 423 | `PHASE_6.3_MONTH_LOCK.md` § 4.3 |
| 7.5 | Sentry production 上報需設 `VITE_SENTRY_DSN` 才驗得到 | `PHASE_7.5_SENTRY.md` § 4.3 |
| 8.2 | 留停期間餘額凍結要看員工 dashboard | `PHASE_8.2_LEAVE_OF_ABSENCE.md` § 4.4 |
| 8.3 | A4 切頁 / `<script>` 標籤 escape 驗證 | `PHASE_8.3_ATTENDANCE_PDF.md` § 4.3 |
| 9.1 | curl response header 檢查 / 跨域請求測試 | `PHASE_9.1_SECURITY_HEADERS.md` § 4.3 |
| 9.2 | 完整 TOTP 註冊 → 驗證 → recovery → reset 流程 | `PHASE_9.2_TOTP_2FA.md` § 4.3 |
| 9.4 | Firestore Console 直接讀寫應被擋 | `PHASE_9.4_FIRESTORE_RULES.md` § 4.3 |

整合性煙霧測試清單也在 `docs/A_BATCH_SMOKE_TEST.md`。

---

## 6. 部署待辦（人工執行）

| 項目 | 動作 |
|------|------|
| **9.4 Firestore Rules 部署** | `firebase deploy --only firestore:rules`（rules 已寫好在 repo，但要人工部署到 Firebase） |
| **9.1 Netlify Headers** | `netlify.toml` 推上去後自動生效，但需於 Netlify Dashboard 確認 |
| **9.2 TOTP for SuperAdmin** | 第一次部署後 ADMIN 帳號需主動到「個人設定」啟用 2FA |
| **7.5 Sentry DSN** | Netlify Dashboard > Environment variables 加 `VITE_SENTRY_DSN` |
| **CI workflow.yml push 卡住** | 本機 PAT 缺 `workflow` scope，需更新 PAT 或改用 SSH remote |

---

## 7. 建議下一步

### 短線（半天內可結）

- **CI 推送解卡**：更新 PAT 加 `workflow` scope，把累積的 `.github/workflows/ci.yml` 變更 push 上去
- **6.4 員工偏好班次設定工單**：尚未撰寫，適合先切清楚規格

### 長線（需先寫工單）

- 7.2 Playwright e2e
- 7.6 FCM Push 通知
- 6.4 員工偏好

---

## 8. 文件入口一覽

| 文件 | 角色 |
|------|------|
| `SDD.md` (v2.0) | 系統設計權威來源 |
| `SDD_v2_PROPOSAL.md` | v2.0 起源與決策紀錄（Phase 5 已實作完成註記） |
| `DEVELOPMENT_ROADMAP.md` | Phase 1–9 全部規劃 + 進度標記 |
| `CHANGELOG.md` | 完整版本變更紀錄（v1.0 ~ v2.0） |
| `VERIFICATION_MANUAL.md` | 100+ 個手動驗證測試案例 |
| `EXECUTION_PLAN.md` | B 批 12 張票執行計畫 + 客戶決策表 |
| `A_BATCH_SMOKE_TEST.md` | A 批工單整合性手動測試清單 |
| `PROGRESS_SNAPSHOT_2026-05-19.md` | **本檔** — 一頁式進度摘要 |
| `PHASE_*.md` | 14 張工單檔（已實作 / 待實作） |

---

## 9. 健康度評估

| 維度 | 狀態 | 備註 |
|------|------|------|
| 功能完整度 | 🟢 良好 | 客戶第一輪 + 第二輪需求全處理 + v2.0 重構；Phase 8 全完成 |
| 測試覆蓋 | 🟢 良好 | 169 個單元測試，純函數覆蓋紮實 |
| 觀測性 | 🟡 中等 | Sentry 已接但需設 DSN；後端錯誤監控待補 |
| 安全 | 🟢 良好 | Phase 9 全 4 張完成，含 TOTP / Rules / Headers |
| CI/CD | 🟢 良好 | GitHub Actions typecheck + test + build + audit |
| 文件 | 🟢 良好 | SDD / Roadmap / CHANGELOG / 14 張工單齊備 |
| 部署 | 🟡 中等 | 多項待 push（PAT 卡住） + 需手動部署 Firestore Rules |
| e2e 測試 | 🔴 缺 | 7.2 未實作，目前全靠手動煙霧測試 |
