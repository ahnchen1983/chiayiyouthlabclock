# 進度收整快照 — 2026-05-19（2026-05-25 現況補正）

> **用途：** 將原 2026-05-19 進度快照修正到目前 repo / 部署決策的實際狀態。
> 最新功能與流程核對請優先讀 [CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md](./CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md)。

---

## 1. 進度總覽

| Phase | 名稱 | 狀態 | 子項 |
|-------|------|------|------|
| **1** | 基礎修正 | ✅ 完成 | 5/5 |
| **2** | 權限與安全（第一輪） | ✅ 完成 | 4/4 |
| **3** | 功能完善（客戶第一輪） | ✅ 完成 | 6/6 |
| **4** | 進階功能 | ✅ 完成 | 4/4 |
| **5** | 排班模型重構（v2.0 核心） | ✅ 完成 | 7/7（5.7 取消） |
| **6** | 排班協作 | ✅ 完成 | 4/4 |
| **7** | 系統健全化（技術債） | ✅ 完成 | 7/7 |
| **8** | HR 細節補強 | ✅ 完成 | 5/5 |
| **9** | 資安強化 | ✅/⏭️ 完成/停用 | 3/3 active + 9.2 TOTP 停用 |

**目前結論：** Phase 1–8 啟用功能已完成；Phase 9 啟用項目已完成。TOTP 已依產品決策移除，不再列為待辦。

---

## 2. 2026-05-25 補正重點

| 項目 | 修正後狀態 |
|------|------------|
| **TOTP** | ⏭️ 已移除登入流程、型別、元件、測試與依賴；SuperAdmin 回到單階段密碼登入 |
| **Sentry** | 程式保留，但部署決策為暫不設定 `VITE_SENTRY_DSN`；未啟用不影響系統使用 |
| **FCM Push** | 程式保留，但部署決策為暫不設定 `VITE_FCM_VAPID_KEY`；站內通知與 fallback polling 仍可用 |
| **Firestore Rules** | ✅ 已部署 client-side deny all；Netlify Functions 使用 service account 代寫 |
| **CI / Pages** | ✅ PAT workflow scope 已解卡；CI 改 Node 24；GitHub Pages 用 `.nojekyll` 避免 Jekyll build 誤跑 |
| **Admin 密碼** | ✅ 已依需求重設為 `admin1234`；請登入後改成正式強密碼 |

---

## 3. 測試與品質指標

| Metric | 目前 |
|--------|------|
| TypeScript | ✅ 0 錯誤 |
| Vitest | ✅ **174 tests** |
| Playwright e2e | ✅ **5 specs** |
| Firestore Rules tests | ✅ **7 tests** |
| Production build | ✅ pass |
| Bundle entry | 約 233 KB raw / 71.65 KB gzip |
| GitHub Actions CI | ✅ typecheck + test + build + audit |
| 已知 npm vulnerabilities | 8 moderate（無 high / critical；CI gate 不阻擋） |

### 目前測試檔案盤點

| 檔案 | 涵蓋功能 |
|------|---------|
| `tests/calculations.test.ts` | 密碼 / 遲到判定 / 特休 / 假別餘額 / 薪資 / 排班 normalize / 兩頭班 / 覆蓋率 / LOA 凍結 |
| `tests/csvMasking.test.ts` | 姓名 / empId / IP / GPS 脫敏 |
| `tests/monthLock.test.ts` | 月結鎖定邊界 |
| `tests/sentry.test.ts` | Sentry helper 與 payload scrub（部署未啟用 DSN） |
| `tests/attendancePrint.test.ts` | 出勤列印 HTML 與 XSS escape |
| `tests/cors.test.ts` | CORS allowlist |
| `tests/firestore-rules.test.ts` | Firestore Rules deny all |
| `tests/monthlyReport.test.ts` | 月結報表 |
| `tests/selfServiceRequests.test.ts` | 留停自助申請 |
| `tests/scheduleVersion.test.ts` | 排班版本快照 / 差異比對 |
| `tests/shiftSwap.test.ts` | 換班申請驗證 / 執行交換 |
| `tests/staffPreferences.test.ts` | 員工偏好去重 / 重疊偵測 / 日期命中 |
| `tests/fcm.test.ts` | FCM token 過濾 / payload 組裝 / fatal error 分類 |
| `tests/e2e/*.spec.ts` | Playwright：登入 / 打卡 / 請假 / Admin 排班 / 換班 |

---

## 4. 目前啟用功能地圖

### 員工端

- 打卡 / 下班打卡
- 我的班表 / 總班表
- 開放班次認領
- 換班 / 替班申請
- 打卡紀錄
- 請假申請與假別餘額
- 留停申請
- 偏好設定
- 補打卡申請
- 薪資明細與薪資條列印
- 站內通知

### Admin / SuperAdmin 端

- 總覽儀表板
- 排班管理（逐日、多人時段、兩頭班、休館值班、偏好提示、版本歷史）
- 排班對照表 / 出勤紀錄
- 請假審核 / 換班審核 / 留停審核 / 補打卡審核
- 開放排班
- 員工管理
- 月結報表
- SuperAdmin：薪資計算、系統日誌、系統設定

---

## 5. 核心流程核對

| 流程 | 現況 |
|------|------|
| 登入 | 單階段密碼登入；密碼雜湊、防暴力破解仍保留 |
| 打卡狀態 | 依員工個別排班時間判斷遲到/早退，不用場館營運時間 |
| 忘記上班卡 | 可透過補打卡申請補救，不讓當日完全卡死 |
| 排班與請假勾稽 | 出勤對照表會納入排班、打卡、請假資料；仍建議以真實資料做一次手動煙霧測試 |
| 休館值班 | `休館(值班)` 可排班，且應在排班/出勤對照與薪資中反映 |
| 兼職時數 | 薪資、月結報表、排班檢查均以排班/出勤資料計算；需本機實測確認實際資料 |
| 月結鎖定 | 鎖定月份會阻擋排班/打卡/審核等 retroactive 修改 |
| 通知 | 站內通知啟用；Web Push 暫不部署 |

---

## 6. 部署現況

| 項目 | 狀態 |
|------|------|
| Netlify 安全 headers | ✅ 已推送，部署後需以實際 response header 抽查 |
| Firestore Rules | ✅ 已部署，Rules 測試通過 |
| GitHub Actions | ✅ Node 24 workflow 已推送且 CI 綠燈 |
| GitHub Pages | ✅ `.nojekyll` 已推送，避免 Jekyll 處理 Vite build |
| Sentry DSN | ⏭️ 不設定 |
| FCM VAPID Key | ⏭️ 不設定 |
| TOTP | ⏭️ 已移除 |

---

## 7. 建議下一步

1. 用真實管理者/員工資料跑一次手動煙霧測試，重點放在「排班對照表、請假勾稽、休館值班、兼職時數、忘記打卡補救」。
2. 登入 `ADMIN / admin1234` 後立即改正式強密碼。
3. 若後續確定需要即時手機推播，再回頭啟用 FCM；若需要錯誤追蹤，再回頭設定 Sentry DSN。

---

## 8. 文件入口

| 文件 | 角色 |
|------|------|
| `SDD.md` | 系統設計文件；頂部已標註 v2.1 現況核對 |
| `CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md` | **最新功能/流程現況權威摘要** |
| `DEVELOPMENT_ROADMAP.md` | Phase 1–9 規劃與完成狀態 |
| `CHANGELOG.md` | 版本變更紀錄 |
| `DEPLOYMENT_CHECKLIST.md` | 部署檢查清單；TOTP/Sentry/FCM 已按目前決策調整 |
| `VERIFICATION_MANUAL.md` | 手動驗證案例 |
| `A_BATCH_SMOKE_TEST.md` | 整合性煙霧測試清單 |

---

## 9. 健康度評估

| 維度 | 狀態 | 備註 |
|------|------|------|
| 功能完整度 | 🟢 良好 | Phase 1–8 啟用功能完成 |
| 測試覆蓋 | 🟢 良好 | 174 Vitest + 5 Playwright + 7 Firestore Rules tests |
| 觀測性 | 🟡 中等 | Sentry 程式保留但部署不啟用 |
| 安全 | 🟢 良好 | Headers / CORS / Rules / 密碼雜湊 / 鎖定 / audit log；TOTP 已停用 |
| CI/CD | 🟢 良好 | CI、Pages、PAT workflow scope 均已處理 |
| 文件 | 🟢 良好 | SDD / Roadmap / Snapshot 已補正 |
| 部署 | 🟢 良好 | 目前沒有必填的 Sentry/FCM/TOTP 部署卡點 |
