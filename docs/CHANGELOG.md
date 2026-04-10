# 變更紀錄 (Changelog)

本檔案記錄嘉義青年實驗室打卡系統的所有重要版本變更，方便前後比對。

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

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

所有計畫中的 Phase 1~4 功能已全部完成。
