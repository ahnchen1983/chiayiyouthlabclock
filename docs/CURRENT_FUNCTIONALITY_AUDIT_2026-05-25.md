# 目前功能與流程核對報告 — 2026-05-25

> **用途：** 依目前 `main` 實作核對 SDD / Roadmap / 部署文件，整理「現在系統實際能做什麼、哪些功能已停用、哪些功能只保留程式但未啟用」。
> **基準 commit：** `1e9c0a1 refactor(auth): remove TOTP login flow`
> **核對方式：** 以 `types.ts`、`pages/*Dashboard.tsx`、`services/googleAppsScriptAPI.ts`、`netlify/functions/api.ts`、測試結果與部署決策為準。

---

## 1. 結論

目前系統定位維持：

> 嘉義市有事青年實驗室的人資排班打卡系統，涵蓋員工資料、排班、打卡、請假、補打卡、換班、開放班、員工偏好、留停、薪資、月結、通知、稽核與部署安全。

實作狀態：

| 類別 | 狀態 | 說明 |
|------|------|------|
| Phase 1–8 | ✅ 完成 | 客戶核心流程與 HR 補強均已實作 |
| Phase 9.1 安全 Headers / CORS | ✅ 完成 | `netlify.toml` + Functions CORS |
| Phase 9.3 Dependency audit / CI | ✅ 完成 | CI 跑 typecheck / test / build；audit gate 文件已備 |
| Phase 9.4 Firestore Rules | ✅ 已部署 | client-side deny-all；Functions 走 Admin SDK |
| Phase 9.2 TOTP | ⏭️ 已停用 | 2026-05-25 產品決策：不採用 TOTP，避免現場維運負擔 |
| Sentry | ⏭️ 程式保留、部署不啟用 | 未設定 `VITE_SENTRY_DSN` 時不啟動 |
| FCM Web Push | ⏭️ 程式保留、部署不啟用 | 未設定 `VITE_FCM_VAPID_KEY` 時不啟用，站內通知仍可用 |

品質基線：

| 項目 | 目前結果 |
|------|----------|
| TypeScript | `npm run typecheck` ✅ |
| Vitest | 174 tests ✅ |
| Playwright | 5 specs ✅ |
| Firestore Rules test | 7 tests ✅ |
| Build | `npm run build` ✅ |
| GitHub CI | ✅ success |
| GitHub Pages | ✅ success（`.nojekyll` 避免 Jekyll 解析 docs 程式碼） |

---

## 2. 角色與入口

### 2.1 角色

| 角色 | 進入頁 | 權限摘要 |
|------|--------|----------|
| 最高管理者 | `AdminDashboard` | 全部管理功能、薪資計算、系統設定、稽核日誌、月結鎖定/解鎖 |
| 管理者 | `AdminDashboard` | 排班、出勤、請假、補打卡、換班、留停、員工管理等一般管理功能 |
| 員工 | `EmployeeDashboard` | 打卡、看班表、請假、留停申請、補打卡、換班、認領班、偏好設定、薪資明細 |

### 2.2 登入流程

目前登入是單階段：

1. 使用者輸入帳號 / 密碼。
2. 後端 `login` action 檢查 `loginAttempts` 是否鎖定。
3. 後端以 scrypt 驗證 `employees/{empId}.password`。
4. 成功後清除登入失敗紀錄，產 Firebase custom token。
5. 前端 `signInWithCustomToken()`，後續 API 帶 ID token。

已停用：

- 不再檢查 `totpSecrets`。
- 不再建立 `totpChallenges`。
- 不再顯示 TOTP / 2FA modal。

---

## 3. 員工端功能流程

| 功能 | 入口 | 後端 action / 資料 | 狀態 |
|------|------|--------------------|------|
| 打卡 / 下班 | `ClockIn` | `clock-in`, `clock-out`, `clockRecords` | ✅ |
| GPS / IP 驗證 | `ClockIn` | `validate-gps`，IP 由 header 取值 | ✅ |
| 漏上班卡仍可下班卡 | `clock-out` | 建立 `異常` 紀錄，註記缺少上班打卡 | ✅ 2026-05-21 修正 |
| 我的班表 | `MyScheduleCalendar` | `get-employee-schedule` | ✅ |
| 總班表 | `FullScheduleCalendar` | `get-monthly-schedule`, `get-all-leave-requests` | ✅ |
| 打卡紀錄 | `MyRecords` | `get-clock-records` | ✅ |
| 請假申請 | `LeaveRequestForm` | `submit-leave-request`, `leaveRequests` | ✅ |
| 假別餘額 | `MyLeaveBalance` | `get-leave-balance` | ✅ 含特休結轉資訊 |
| 補打卡申請 | `ClockMakeupForm` | `submit-makeup-request`, `makeupRequests` | ✅ |
| 薪資明細 | `MySalary` | `get-employee-salary` | ✅ |
| 認領開放班 | `OpenShiftPicker` | `openShifts`, claim/release actions | ✅ |
| 換班申請 | `ShiftSwapPage` | `shiftSwapRequests` | ✅ 含對方確認 |
| 員工偏好 | `MyPreferences` | `staffPreferences` | ✅ 僅提示、不阻擋排班 |
| 留停申請 | `LeaveOfAbsenceRequestForm` | `leaveOfAbsenceRequests` | ✅ |

---

## 4. 管理端功能流程

| 功能 | 入口 | 後端 action / 資料 | 狀態 |
|------|------|--------------------|------|
| 總覽儀表板 | `AdminOverview` | `get-dashboard-stats`, `get-all-part-time-hours` | ✅ |
| 排班管理 | `ScheduleManager` | `dailySchedule`, `scheduleTemplate` | ✅ |
| 排班版本歷史 | `ScheduleManager` | `scheduleVersions` | ✅ |
| 排班對照表 | `ScheduleComparison` | `get-schedule-attendance-comparison` | ✅ |
| 休館值班排班列出 | `ScheduleComparison` | `休館(值班)` 視為可比對日 | ✅ 2026-05-21 修正 |
| 出勤紀錄編輯 | `AttendanceLog` | `update-clock-record` | ✅ |
| 請假審核 | `LeaveApprovalQueue` | `approve-leave` | ✅ |
| 補打卡審核 | `MakeupApprovalQueue` | `approve-makeup-request` | ✅ |
| 換班審核 | `ShiftSwapApprovalQueue` | `admin-approve-shift-swap` | ✅ |
| 留停審核 | `LeaveOfAbsenceApprovalQueue` | `approve-leave-of-absence-request` | ✅ |
| 開放排班管理 | `OpenShiftManager` | `openShifts` | ✅ |
| 員工管理 | `EmployeeManager` | employee CRUD / reset password | ✅ |
| 月結報表 | `MonthlyReport` | `get-monthly-report` | ✅ |
| 薪資計算 | `SalaryCalculation` | `get-all-salary-details` | ✅ SuperAdmin only |
| 月結鎖定 / 解鎖 | `SalaryCalculation` | `monthLocks` | ✅ |
| 系統設定 | `SystemSettings` | `systemConfig` | ✅ SuperAdmin only |
| 稽核日誌 | `AuditLogViewer` | `auditLogs` | ✅ SuperAdmin only |

---

## 5. 關鍵流程確認

### 5.1 排班 → 打卡 → 對照表

目前標準流程：

1. Admin 在 `ScheduleManager` 建立或調整每日 `shifts`。
2. 員工依自己的班段打卡。
3. `clock-in` / `clock-out` 依員工自己的最早 `from` / 最晚 `to` 判定出勤狀態。
4. `ScheduleComparison` 每次以當月排班、打卡、請假重新計算，不再盲信舊 `clockRecords.status`。
5. 部分請假會抵扣晚到 / 早退缺口；完整覆蓋班段才顯示 `休假`。
6. `休館(值班)` 會列出值班排班與出勤資料。

已修正的客訴點：

- ✅ 遲到/早退不再用場館營運時間判斷。
- ✅ 準時上下班不再誤顯示遲到。
- ✅ 1 小時請假不再整天顯示休假。
- ✅ 休館值班會出現在排班 vs 出勤對照表。
- ✅ 兼職時數進度改用排班工時勾稽。
- ✅ 忘記上班卡仍可打下班卡，紀錄為異常。

### 5.2 請假 / 留停 / 特休餘額

| 流程 | 現況 |
|------|------|
| 一般請假 | 員工送出，Admin 審核；前後端都檢查餘額 |
| 特休 | 依到職日計算，支援跨年結轉與失效提示 |
| 留停 | 員工自助申請，Admin 審核後更新員工狀態與留停期間 |
| 留停年資 | 特休計算會扣除留停期間 |
| 月結鎖定 | 鎖定月不可審核會回寫歷史的留停 / 補打卡 / 換班等資料 |

### 5.3 通知

| 通知類型 | 現況 |
|----------|------|
| 站內通知 | ✅ 啟用，透過 `notifications` collection |
| NotificationBell | ✅ 啟用 |
| FCM Web Push | ⏭️ 程式保留，部署決策先不啟用 |
| Sentry 錯誤監控 | ⏭️ 程式保留，部署決策先不啟用 |

---

## 6. 資料集合實況

| Collection | 用途 | 狀態 |
|------------|------|------|
| `employees` | 員工 / 密碼雜湊 / 角色 / 薪資欄位 / 留停狀態 | ✅ |
| `scheduleTemplate` | 週模板 | ✅ |
| `dailySchedule` | 每日排班，v2 `shifts[]` | ✅ |
| `clockRecords` | 打卡紀錄 | ✅ |
| `leaveRequests` | 一般請假 | ✅ |
| `leaveOfAbsenceRequests` | 留停申請 | ✅ |
| `makeupRequests` | 補打卡申請 | ✅ |
| `shiftSwapRequests` | 換班申請 | ✅ |
| `openShifts` | 開放班 / 認領班 | ✅ |
| `staffPreferences` | 員工偏好 | ✅ |
| `scheduleVersions` | 月排班快照與回溯 | ✅ |
| `monthLocks` | 月結鎖定 | ✅ |
| `systemConfig` | 薪資費率 / PT 上限 / 寬限分鐘 | ✅ |
| `notifications` | 站內通知 | ✅ |
| `auditLogs` | 稽核日誌 | ✅ |
| `fcmTokens` | FCM token | ⏭️ 支援但目前不啟用 |
| `totpSecrets` / `totpChallenges` | 舊 TOTP | ⏭️ 不再使用 |

---

## 7. SDD / Roadmap 修正重點

本次核對後，文件應以以下狀態為準：

1. SDD 原 v2.0 內容保留歷史設計脈絡，但首頁需標示「最新實況見本檔」。
2. Roadmap 進度改為 Phase 1–8 完成，Phase 9 中 TOTP 已取消/停用。
3. Progress snapshot 測試數需改為 174 Vitest + 7 Firestore rules + 5 Playwright。
4. 部署清單中 Sentry / FCM / TOTP 皆不是目前必要步驟。
5. TOTP 不再列為安全紅線或手動煙霧測試項。

---

## 8. 剩餘人工驗收

建議下一輪只跑「目前啟用」功能：

| 優先 | 測試 | 重點 |
|------|------|------|
| P0 | ADMIN 登入 | `ADMIN / admin1234` 可進，不跳 TOTP |
| P0 | Firestore client deny | Console / Rules Playground 直接讀寫應被擋 |
| P0 | 排班對照表 | 個別班段、部分請假、休館值班三種案例 |
| P1 | 月結鎖定 | 鎖定後補打卡 / 留停 / 換班回寫應擋 423 |
| P1 | 請假 / 補打卡 / 換班 / 留停 | 完整送審與審核流程 |
| P1 | 月結報表 / PDF / CSV | 匯出與列印視覺確認 |

---

## 9. 目前不做

| 項目 | 決策 |
|------|------|
| TOTP / 2FA | 停用，不再納入登入流程 |
| Sentry DSN | 暫不設定；需要正式錯誤追蹤時再啟用 |
| FCM VAPID key | 暫不設定；站內通知已足夠 |
| 多店 / multi-tenant / mobile app | 下一階段規劃，不在本次收尾範圍 |
