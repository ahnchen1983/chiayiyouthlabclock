# 變更紀錄 (Changelog)

本檔案記錄嘉義青年實驗室打卡系統的所有重要版本變更，方便前後比對。

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

---

## [Unreleased] - 2026-05-20 — Phase 6 / Phase 7 / Phase 8 補強

### 新增 (Added)
- **7.2 Playwright e2e**
  - 新增 Playwright harness 與 `npm run test:e2e` / UI / headed scripts
  - 新增 `VITE_E2E=true` auth bypass，只在 e2e 模式跳過 Firebase signIn/signOut
  - 以 route mock 隔離 Netlify Functions API，不碰真 Firebase / Firestore
  - 新增 5 條瀏覽器 smoke specs：登入、打卡、請假、Admin 排班、換班
  - 未修改 CI workflow，避免 PAT `workflow` scope 卡點
- **7.6 FCM Web Push 通知**
  - 新增 `fcmTokens` collection 資料契約與 `FcmTokenDoc` 型別
  - 新增 `fcm.ts` 純函數：tokenId 雜湊、active token 過濾、payload 組裝、fatal error 分類
  - 新增 `register-fcm-token` / `unregister-fcm-token` actions
  - `writeNotification` 寫入通知後 fire-and-forget 推 FCM，失敗不影響原流程
  - 新增 `public/firebase-messaging-sw.js` 背景通知與前景 `CustomEvent` refresh
  - `NotificationBell` 輪詢 60s → 180s fallback，並新增「啟用即時通知」
- **6.4 員工偏好班次設定**
  - 新增 `staffPreferences` collection 資料契約與 `StaffPreference` 型別
  - 新增 `staffPreferences.ts` 純函數：偏好資料去重/排序/重疊驗證與日期命中判斷
  - 新增 3 個 API actions：查本人、更新本人、Admin 查全部
  - 員工後台與 Admin「我的功能」新增「偏好設定」頁
  - `ScheduleManager` 編輯班次時顯示「偏好不上班 / 偏好上班」提醒，維持僅警示不阻擋
- **6.1 換班 / 替班申請**
  - 新增 `shiftSwapRequests` collection 資料契約與 `ShiftSwapRequest` 型別
  - 新增 `shiftSwap.ts` 純函數：換班申請驗證與班次交換
  - 新增 5 個 API actions：提交、對方確認、Admin 審核、取消、列表
  - 員工後台新增「換班」頁，可發起申請、同意/拒絕待確認、取消自己發起的申請
  - 管理者後台新增「換班審核」頁，Admin+ 可核准或駁回
  - 狀態轉換寫入通知與 audit log，核准前再次檢查月結鎖定
- **6.2 排班版本歷史（snapshot + 回溯）**
  - 新增 `scheduleVersions` collection 資料契約與 `ScheduleVersion` 型別
  - 新增 `scheduleVersion.ts` 純函數：建立月排班 snapshot、比對版本差異
  - 新增 4 個 API actions：建立、列表、檢視、回溯排班版本
  - `lock-month` 會自動建立月結快照，並在 `MonthLock.snapshotVersionId` 記錄版本 ID
  - `ScheduleManager` 新增「儲存版本」與「版本歷史」抽屜；回溯僅 SuperAdmin 可操作
- **8.4 月結報表（管理員月度統計）**
  - 新增 `get-monthly-report` API action，Admin+ 可一次讀取月結摘要
  - 新增 `MonthlyReportData` 型別與 `monthlyReport.ts` 純聚合函數
  - 新增管理者後台「月結報表」頁面：摘要、請假分布、打卡異常、PT 時數狀況、員工工時排名
  - CSV 匯出含鎖定狀態、摘要、請假分布、打卡異常、PT 時數、工時排名
  - 複用既有 `calculateSalaryForEmployee` 與 Phase 6.3 月結鎖定資料
- **8.5 員工自助申請流程**
  - 特休沿用既有 `leaveRequests`；留停新增 `leaveOfAbsenceRequests`
  - 新增員工留停申請表單與 Admin 留停審核佇列
  - 新增 4 個 LOA actions：提交、查本人、查全部、審核
  - 核准留停會更新 employee 狀態與 `leaveOfAbsenceStart/End`；駁回不改 employee
  - 審核支援通知、audit log、重複審核防護與月結鎖定 423 防護

### 測試
- Vitest 增至 **190 個測試**
- Playwright e2e 新增 **5 條 specs**
- 新增 `tests/fcm.test.ts`：FCM token 過濾、payload 組裝、fatal error 分類
- 新增 `tests/staffPreferences.test.ts`：員工偏好去重、上限、重疊偵測與日期命中
- 新增 `tests/shiftSwap.test.ts`：換班申請驗證與交換執行
- 新增 `tests/monthlyReport.test.ts`：請假分布、打卡異常、員工工時排名、月結摘要與空陣列平均值
- 新增 `tests/selfServiceRequests.test.ts`：留停申請日期與狀態驗證
- 新增 `tests/scheduleVersion.test.ts`：排班版本 snapshot 與 diff

---

## [v2.0] - 2026-04-10 — 排班模型重構（Phase 5 全部完成）

### 重大變更 (Breaking)
- **ScheduleEvent 資料模型**從 v1 全日單一 `shiftTime` + 三欄位（`staffA`/`staffB`/`partTime`）
  改為 v2 統一陣列 `shifts: StaffShift[]`，每員工獨立時段並支援兩頭班
- **scheduleTemplate** 結構同步重構，改為 `status + openingHours + requiredHeadcount + defaultShifts`
- 舊資料庫文件透過 `normalizeScheduleDoc` 自動 in-memory 轉換，**不回寫**，保證舊環境不崩潰
- 客戶決策 4：採「直接切換 + 清空重建」策略，不做 v1→v2 migration

### 新增 (Added)
- **5.1 ScheduleEvent → StaffShift[]**
  - `StaffShift` / `StaffRole` / `ScheduleTemplate` / `ScheduleShiftTemplate` 型別
  - 後端 `normalizeScheduleDoc` 相容層 + `getEmployeeShiftsForDay` / `shiftHours` / `isEmployeeScheduledForDay` helpers
  - `update-schedule` 後端驗證兩頭班 ≤ 2 段
- **5.2 應到人數 + 30 分鐘區段覆蓋檢核**
  - `ScheduleEvent.requiredHeadcount` 欄位
  - `computeCoverageSlots` / `computeCoverageGaps` 純函式
  - `check-schedule-conflicts` API 整合覆蓋率分析
  - 客戶決策 3：僅警示，**不阻擋儲存**
- **5.3 時間軸視覺化排班 UI**
  - `ScheduleTimeline` 子元件：整點刻度 + 員工色塊（按角色分色）+ 覆蓋率條
  - EditModal 班次列表編輯器（員工選擇 / 角色 / from / to / 刪除 / + 新增）
  - 缺人警示列出「12:00-13:00 缺 2 人」精確時段
- **5.5 `reset-all-schedule` API + SystemSettings 危險區**
  - SuperAdmin 可清空 `dailySchedule`（可選同清 `scheduleTemplate`）
  - 雙重確認（confirm + 輸入 `RESET` 字串）
- **5.8 排班衝突即時警告**
  - 月份頂部摘要區塊（最多 10 筆）+ 日曆格子 ⚠️ icon

### 變更 (Changed)
- `clock-in` / `clock-out`：遲到/早退判定改用「員工自己的 shift 範圍」（最早 from + 最晚 to）而非全日 shiftTime
- `calculateSalaryForEmployee`：從 shifts 加總工時，正確支援兩頭班
- `apply-template`：v2 模板僅描述班次框架（status + openingHours + defaultShifts），套用後 `shifts: []` 待管理員填人
- `claim-open-shift` / `release-open-shift`：push/remove `StaffShift` 到 `dailySchedule.shifts`
- `get-employee-schedule` / `get-dashboard-stats` / `get-schedule-attendance-comparison`：改用 `isEmployeeScheduledForDay` + `getEmployeeShiftRangeStr`
- `initialize-database` 預設模板改為 v2 結構

### 修正 (Fixed)
- **5.4** ScheduleManager.tsx 條件修正：休館(值班) 也顯示兼職人員列表

### 測試
- Vitest 從 36 → **51 個測試**（+15）覆蓋：
  - normalizeScheduleDoc（v1→v2、v2 passthrough、null 處理）
  - getEmployeeShiftsForDay（empId 優先、name fallback、兩頭班）
  - shiftHours、calculateSalaryForEmployee 兩頭班加總
  - computeCoverageSlots / computeCoverageGaps（全程覆蓋、30 分鐘解析度、中午缺人、部分覆蓋、無 openingHours、requiredHeadcount=0、兩頭班同人不重複）

### 文件
- SDD.md → v2.0（資料模型、API 清單、缺陷清單、變更紀錄）
- DEVELOPMENT_ROADMAP.md → Phase 5 全 7 項完成（5.7 取消）
- VERIFICATION_MANUAL.md → 新增 Phase 5 測試案例
- SDD_v2_PROPOSAL.md → 標註實作狀態

### 客戶 V2 需求對應
| 編號 | 需求 | 對應 |
|------|------|------|
| V2-1a | 假人名資料殘留 | 5.5 |
| V2-1b | 應到人數設定 | 5.2 |
| V2-2 | 個別員工時段 | 5.1 |
| V2-3 | 兩頭班 | 5.1 |
| V2-4 | 休館值班顯示 bug | 5.4 |
| V2-5 | 兼職可調時段 | 5.1 |

---

## [v1.6] - 2026-04-10 — Phase 4 全部完成

### 新增 (Added)
- **4.1 假別餘額管理**
  - `computeAnnualLeaveDays()` 依勞基法計算特休天數（6 個月 3 天、1 年 7 天…最高 30 天）
  - `getLeaveBalanceForEmployee()` 計算特休/事假/病假年度餘額
  - `get-leave-balance` API action
  - 請假申請前後端均驗證餘額，超額時阻擋
  - `MyLeaveBalance` 元件：顯示各假別配額/已用/剩餘，含進度條
  - `LeaveRequestForm` 內嵌餘額顯示（選擇假別即時顯示剩餘時數）
- **4.2 員工自選班表**
  - `OpenShift` 型別 + `openShifts` Firestore collection
  - `create-open-shift` / `list-open-shifts` / `claim-open-shift` / `release-open-shift` / `delete-open-shift` 五個 action
  - 認領使用 Firestore Transaction 確保原子性，額滿自動關閉
  - 認領後自動同步到 `dailySchedule.partTime`
  - `OpenShiftManager` 管理端：建立 + 一覽 + 刪除
  - `OpenShiftPicker` 員工端：認領 / 釋出
- **4.3 薪資條列印下載**
  - `openPayslipPrintView()` 開新視窗產生可列印 HTML 薪資條
  - 包含出勤統計、薪資項目、扣除明細、實發薪資
  - 員工 `MySalary` + 管理端 `SalaryCalculation` 均有下載按鈕
- **4.4 ErrorBoundary + UI 統一化**
  - `ErrorBoundary` class component 包覆全 App，捕捉渲染錯誤顯示友善畫面
  - Logo 從外部 URL 改為本地文字圖示（移除 CDN 依賴）
  - `AdminDashboard` sidebar 改為響應式（手機端收合 + 漢堡選單 + 背景遮罩）
  - `EmployeeDashboard` 底部導覽列支援水平滑動（`overflow-x-auto`）

### 變更 (Changed)
- `LeaveRequestForm` 提交前檢查假別餘額，不足時前端即阻擋
- `submit-leave-request` 後端亦檢查餘額（特休/事假/病假），防止前端繞過
- `AdminDashboard` 新增 `openShifts`、`myLeaveBalance`、`myOpenShifts` 三個 view
- `EmployeeDashboard` 新增 `leaveBalance`、`openShifts` 兩個 view
- `SalaryCalculation` Modal 新增「下載薪資條」按鈕

### 文件更新
- SDD.md → v1.6
- DEVELOPMENT_ROADMAP.md → 勾選 Phase 4 全部 4 項
- VERIFICATION_MANUAL.md → 新增 V4.1.x ~ V4.4.x 測試案例

---

## [v1.5] - 2026-04-09 — Phase 3 全部完成

### 新增 (Added)
- **3.1 薪資設定完善**
  - `Employee.monthlySalary` 欄位（專責人員月薪）
  - `systemConfig/salary` Firestore collection（勞健保費率、加班倍率、PT 時數上限、遲到寬限）
  - `SystemSettings` 頁面（僅 SuperAdmin），可調整所有費率與規則
  - `calculateSalaryForEmployee()` 改用 `SystemConfig`，不再硬寫死費率
  - `EmployeeManager` 表單依職位顯示時薪 / 月薪欄位
- **3.2 打卡紀錄管理**
  - `clock-in` / `clock-out` 自動比對排班 `shiftTime` 並判定 `正常 / 遲到 / 早退 / 遲到+早退`
  - `update-clock-record` action：管理員可修改任一筆打卡紀錄
  - `AttendanceLog` 加入「編輯」按鈕與 EditModal
  - `ClockRecord` 新增 `note / manuallyEdited / source / editedBy / editedAt` 欄位
- **3.3 補打卡申請流程**
  - `makeupRequests` Firestore collection
  - 後端 actions：`submit-makeup-request` / `get-employee-makeup-requests` / `get-makeup-requests` / `approve-makeup-request`
  - 員工端 `ClockMakeupForm`：填寫日期、類型、補打時間與理由
  - 管理端 `MakeupApprovalQueue`：核准 / 駁回（含理由）
  - 核准後自動寫入或合併 `clockRecords`
- **3.4 請假驗證 + 駁回理由**
  - 前後端皆驗證日期：endDate > startDate、不可早於 7 天前、最少 0.5 小時
  - `LeaveRequest.rejectReason` 欄位
  - `LeaveApprovalQueue` 駁回時必填理由
- **3.5 排班衝突偵測**
  - `check-schedule-conflicts` action：同人重複排班、營運日無專責人員 A
- **3.6 通知機制**
  - `notifications` Firestore collection
  - 觸發點：請假核准/駁回、補打卡核准/駁回
  - `NotificationBell` 元件嵌入 Admin / Employee Dashboard 頭部，含未讀數徽章

### 變更 (Changed)
- 薪資費率（勞保、健保、勞退、加班倍率）改為從 `systemConfig` 讀取，預設仍為 0.023 / 0.0211 / 0.06 / 1.34
- `approve-leave` 增加角色檢查、駁回理由、自動發通知
- `EmployeeManager` 預設密碼從 `'password'` 改為 `'Aa123456'`，前端 minLength 從 4 → 8

### 文件更新
- SDD.md → v1.5
- DEVELOPMENT_ROADMAP.md → 勾選 Phase 3 全部 6 項
- VERIFICATION_MANUAL.md → 新增 V3.1.x ~ V3.6.x 共 12 個測試案例

---

## [v1.4] - 2026-04-10 — Roadmap 重整

### 變更 (Changed)
客戶 2026-04-10 回報三項需求後，重新組織 Phase 3/4：

- **Phase 3 從 5 項擴充為 6 項：**
  - `3.1` 薪資設定完善：員工月薪欄位（客戶 #1）+ 費率設定化（原 3.4）
  - `3.2` 打卡紀錄管理：遲到/早退自動判定（原 3.2）+ 管理員編輯打卡（客戶 #2）
  - `3.3` 補打卡申請流程（原 4.2 提前，客戶 #3）
  - `3.4` 請假日期驗證 + 駁回理由（原 3.1）
  - `3.5` 排班衝突偵測 + 人力檢查（原 3.3）
  - `3.6` 通知機制（原 3.5）
- **Phase 4 重新編號：**
  - `4.1` 假別餘額管理（不變）
  - `4.2` 員工自選班表（原 4.3）
  - `4.3` 薪資條 PDF 下載（原 4.4）
  - `4.4` UI 統一化 + Error Boundary（原 4.5）

### 文件更新
- SDD.md → v1.4
- DEVELOPMENT_ROADMAP.md → 重整 Phase 3 章節、加入重整說明

---

## [v1.3] - 2026-04-09

### 文件同步
- SDD 全面更新到 Phase 1+2 實際狀態
- DEVELOPMENT_ROADMAP 加上進度總覽表格
- 新增 VERIFICATION_MANUAL.md 驗證手冊
- 新增 CHANGELOG.md 獨立變更紀錄檔

---

## [v1.2.1] - 2026-04-09 — Hotfix

### 修正
- `initialize-database` 在既有資料庫環境無法建立 SuperAdmin 帳號的問題
  - **原因：** 原邏輯若 `employees` collection 已有任何資料就直接返回「已初始化」，導致升級部署無法補建 ADMIN
  - **修正：** 改為分別檢查 `scheduleTemplate` 和 `employees/ADMIN` 是否存在，各自獨立建立
  - **附加：** ADMIN 預設密碼改為 `hashPassword('admin1234')` 儲存（原為明文）
- Commit: `ba31961`

---

## [v1.2] - 2026-04-08 — Phase 2 完成

### 新增 (Added)
- **SuperAdmin 角色**（最高管理者）
  - `UserRole.SuperAdmin = '最高管理者'`
  - 薪資計算頁 (`SalaryCalculation`) 僅 SuperAdmin 可見
  - 系統日誌頁 (`AuditLogViewer`) 僅 SuperAdmin 可見
  - 後端 `get-all-salary-details`、`get-audit-logs` 加上 role check
- **密碼雜湊機制**
  - scrypt 雜湊儲存（`salt:hash` 格式）
  - 舊版明文密碼登入時自動升級為雜湊
  - 密碼強度要求：8 字元以上，需含英文字母與數字
- **防暴力破解**
  - 新增 `loginAttempts` collection 記錄登入失敗次數
  - 5 次失敗後鎖定 15 分鐘
- **操作稽核日誌**
  - 新增 `auditLogs` collection
  - 記錄事件：update-schedule、apply-template、approve-leave、create/update/delete-employee、reset-password
  - 新增前端 `AuditLogViewer` 元件
  - 新增後端 `get-audit-logs` action
- **休館值班狀態**
  - `ScheduleEvent.status` 新增 `'休館(值班)'`
  - 休館日可安排正職值班，工時計入薪資

### 修正 (Fixed)
- 重設密碼時不再 alert 顯示明文密碼
- 員工管理新增時的預設密碼從 `'password'` 改為 `'Aa123456'`（符合強度要求）

### 變更 (Changed)
- `employees.password` 從明文改為雜湊儲存
- Commit: `8964c63`

---

## [v1.1] - 2026-04-08 — Phase 1 完成

### 新增 (Added)
- **逐日排班 (dailySchedule)**
  - 新增 `dailySchedule/{YYYY-MM-DD}` Firestore collection
  - 排班以日為單位儲存，修改單日不影響其他同星期日期
  - 保留 `scheduleTemplate` 作為預設模板
  - 新增 `apply-template` action 批次將模板套用到指定月份
- **排班時段編輯**
  - `ScheduleManager` 的 EditModal 新增 `<input type="time">` 起訖時間選擇器
  - 顯示該班總時數（自動計算）
  - 顯示已排人數與預估 PT 時數摘要
- **管理員打卡/請假/紀錄/薪資**
  - `AdminDashboard` 新增「我的功能」區塊
  - 子頁面：myClock、myLeave、myRecords、mySalary
  - 直接重用 `components/employee/` 的元件，後端無需改動
- **IP 驗證真實化**
  - 後端從 `event.headers['x-forwarded-for']` 取得真實 IP
  - 前端移除寫死的 `'127.0.0.1'`

### 修正 (Fixed)
- 初始化資料庫不再寫入 5 位假員工（王小明等）
- 改為只建立空白排班模板 + 單一 ADMIN 帳號

### 變更 (Changed)
- `update-schedule` action 從寫入 `scheduleTemplate` 改為寫入 `dailySchedule/{date}`
- `get-monthly-schedule` / `get-employee-schedule` 優先讀 `dailySchedule`，不存在則 fallback 到 template

---

## [v1.0] - 2026-04-08 — 基準版本

### 對應 commit
- `7796637` (v2)

### 已知問題
- #1 預設假人名無法清除
- #2 班表無法編輯上班時段
- #3 休館日無正職值班機制
- #4 值班人員連動同星期所有日期
- #5 管理員無法打卡/請假
- #6 所有管理員都能看薪資（無分級）
- A1 密碼明文儲存與顯示
- A2 密碼強度僅 4 字元
- A3 無防暴力破解
- A4 IP 驗證寫死 `127.0.0.1`
- A6 無操作稽核紀錄
- 以上問題已於 v1.1 / v1.2 全數修正，詳見上方對應版本

---

## 已完成版本

- **v1.5** — Phase 3 功能完善（2026-04-09）✅
- **v1.6** — Phase 4 進階功能（2026-04-10）✅
- **v2.0** — Phase 5 排班模型重構（2026-04-10）✅

## 規劃中

- **Phase 6** — 排班協作（換班、版本歷史、月結鎖定、員工偏好）
- **Phase 7** — 系統健全化剩餘（e2e、code splitting、Sentry、FCM、CSV 脫敏）
- **Phase 8** — HR 細節補強（特休結轉、留停、PDF、月結報表、自助申請）

詳見 [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) 與 [SDD_v2_PROPOSAL.md](./SDD_v2_PROPOSAL.md)。
