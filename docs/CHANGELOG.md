# 變更紀錄 (Changelog)

本檔案記錄嘉義青年實驗室打卡系統的所有重要版本變更，方便前後比對。

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

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

## 未來版本規劃

### [v1.4] - Phase 3 功能完善（未開始）
- 3.1 請假日期驗證 + 駁回理由
- 3.2 打卡遲到/早退自動判定
- 3.3 排班衝突偵測 + 人力檢查
- 3.4 薪資費率設定化
- 3.5 通知機制

### [v1.5] - Phase 4 進階功能（未開始）
- 4.1 假別餘額管理
- 4.2 打卡補登申請
- 4.3 員工自選班表
- 4.4 薪資條 PDF 下載
- 4.5 UI 統一化 + Error Boundary

### 客戶優先需求（待排入）
- 員工管理：正職月薪欄位（目前只能設時薪）
- 管理員調整打卡狀態（編輯 clockRecords）
- 補打卡申請流程
