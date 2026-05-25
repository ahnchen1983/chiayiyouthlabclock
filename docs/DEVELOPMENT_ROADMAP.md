# 開發階段規劃 (Development Roadmap)

> **建立日期：** 2026-04-08
> **最後更新：** 2026-05-25
> **對應 SDD 版本：** v2.1（現況核對版）
> **狀態追蹤：** 以 checkbox 標記完成項目

## 進度總覽

| 階段 | 狀態 | 完成項目 |
|------|------|---------|
| **Phase 1 基礎修正** | ✅ 完成 (2026-04-08) | 5/5 |
| **Phase 2 權限與安全** | ✅ 完成 (2026-04-08) | 4/4 |
| **Phase 3 功能完善（客戶優先）** | ✅ 完成 (2026-04-09) | 6/6 |
| **Phase 4 進階功能** | ✅ 完成 (2026-04-10) | 4/4 |
| **Phase 5 排班模型重構（v2.0 核心）** | ✅ 完成 (2026-04-10) | 7/7 |
| **Phase 6 排班協作** | ✅ 完成 (2026-05-20) | 4/4 |
| **Phase 7 系統健全化（技術債）** | ✅ 完成 (2026-05-20) | 7/7 |
| **Phase 8 HR 細節補強** | ✅ 完成 | 5/5 |
| **Phase 9 資安強化** | ✅/⏭️ 完成/停用 (2026-05-25) | 3/3 active + 9.2 停用 |

> **v2.0 規劃：** 詳見 [SDD_v2_PROPOSAL.md](./SDD_v2_PROPOSAL.md)。Phase 5 為 v2.0 核心（資料模型重構），Phase 6~8 為延伸。
> **2026-05-25 現況核對：** 最新功能/流程盤點請以 [CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md](./CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md) 為準。TOTP 已依產品決策移除；Sentry / FCM 程式保留但部署不啟用。

## v1.4 Roadmap 重整說明

2026-04-10 客戶回報三項需求：
1. 正職月薪無法設定（EmployeeManager 只有時薪欄位）
2. 管理員無法調整打卡狀態（AttendanceLog 為唯讀）
3. 無補打卡申請機制

經分析與原 Phase 3/4 項目比對後，重新整併如下：

| 客戶需求 | 原規劃位置 | 整併後位置 | 整併原因 |
|----------|-----------|-----------|---------|
| ①正職月薪 | 無（屬缺陷） | 3.1 與費率設定化合併 | 同屬「薪資設定」主題 |
| ②管理員改打卡 | 無（屬缺陷） | 3.2 與遲到/早退判定合併 | 動到同一個 `clockRecords.status` 欄位與 API |
| ③補打卡 | 原 Phase 4.2 | 3.3 提前到 Phase 3 | 客戶急需 |

原 Phase 3 其餘項目順延為 3.4/3.5/3.6，Phase 4 項目編號調整。

---

## 總覽

本文件將系統改善工作分為 4 個階段，共 20 項工作項目。每個階段有明確的目標、預期產出、相依性說明。

```
Phase 1: 基礎修正         ──> Phase 2: 權限與安全
  (排班重構/管理員功能)          (角色分層/安全強化)
                                      │
Phase 3: 功能完善         <───────────┘
  (驗證/偵測/通知)
        │
        └──> Phase 4: 進階功能
               (餘額/補登/PDF)
```

---

## Phase 1：基礎修正

> **目標：** 修正排班核心邏輯、補齊管理員基本功能，使系統可正常用於日常營運。
> **對應問題：** SDD #1, #2, #4, #5, A4

### 1.1 修正預設假人名問題
- **問題：** SDD #1 — 初始化自動寫入假人名（王小明等），無法清除
- **改動範圍：**
  - `netlify/functions/api.ts` — `initialize-database` action
- **方案：**
  - 移除預設員工資料和排班模板中的假人名
  - 初始化改為只建立空的 scheduleTemplate 結構（7 天，staffA/staffB 為空字串，partTime 為空陣列）
  - 新增「系統初始設定」引導流程，讓管理員首次登入時自行建立員工
- **驗證：** 全新初始化後，排班表不顯示任何人名
- [x] 完成 (2026-04-08)

### 1.2 排班改為逐日制
- **問題：** SDD #4 — 修改某天排班會連動所有同星期
- **改動範圍：**
  - `netlify/functions/api.ts` — 排班相關 actions
  - `types.ts` — ScheduleEvent（可能需新增欄位）
  - Firestore 資料結構
- **方案：**
  - 新增 Firestore collection `dailySchedule`（doc id: `"YYYY-MM-DD"`）
  - 保留 `scheduleTemplate` 作為「預設模板」，每月初可「套用模板」批次產生 dailySchedule
  - `update-schedule` 改為寫入 `dailySchedule/{date}`，不再覆寫模板
  - `get-monthly-schedule` 優先讀 `dailySchedule`，不存在才 fallback 到 template
  - 新增 `apply-template` action：管理員可手動將模板套用到指定月份
- **資料遷移：** 現有 scheduleTemplate 資料保留不動，作為預設模板
- **驗證：** 修改 4/9（三）排班後，4/16（三）的排班不受影響
- [x] 完成 (2026-04-08)

### 1.3 排班加入時段編輯
- **問題：** SDD #2 — 前端 Modal 無法編輯上班時段
- **改動範圍：**
  - `components/admin/ScheduleManager.tsx` — EditScheduleModal
- **方案：**
  - EditModal 新增 shiftTime 開始/結束時間選擇器（兩個 `<input type="time">`）
  - 驗證結束時間 > 開始時間
  - 顯示該班總時數（結束 - 開始）
  - 顯示已排人數、預估 PT 時數
- **驗證：** 可將某天從 08:30-17:30 改為 10:00-20:00，儲存後重新載入仍為新時段
- [x] 完成 (2026-04-08)

### 1.4 管理員加入打卡與請假功能
- **問題：** SDD #5 — Admin 角色無法打卡和請假
- **改動範圍：**
  - `pages/AdminDashboard.tsx` — 新增 ClockIn、LeaveRequestForm、MyRecords 子頁面
  - `components/admin/` — 可能需新增管理員打卡元件或直接引用 employee 版
- **方案：**
  - AdminDashboard 側邊欄新增「我的打卡」、「我的請假」、「我的紀錄」選項
  - 直接重用 `components/employee/` 的 ClockIn、LeaveRequestForm、MyRecords、MySalary 元件
  - 後端不需改動（已支援所有 empId 打卡/請假）
- **驗證：** 以管理員帳號登入，可成功打卡、提交請假申請
- [x] 完成 (2026-04-08)

### 1.5 修正打卡 IP 驗證
- **問題：** SDD A4 — IP 驗證寫死 `127.0.0.1`
- **改動範圍：**
  - `components/employee/ClockIn.tsx`
  - `netlify/functions/api.ts` — clock-in action
- **方案：**
  - 前端：移除假 IP，改用 `fetch('https://api.ipify.org?format=json')` 或由後端取得 client IP
  - 後端：從 `event.headers['x-forwarded-for']` 或 `event.headers['client-ip']` 取得真實 IP
  - 設定允許的 IP 範圍（或改為僅支援 GPS 驗證，視場域網路環境）
- **驗證：** 打卡紀錄中的 verificationData 為真實 IP 或 GPS 座標
- [x] 完成 (2026-04-08)

---

## Phase 2：權限與安全

> **目標：** 建立多層級角色系統，修正安全性漏洞。
> **相依性：** Phase 1 完成後執行
> **對應問題：** SDD #3, #6, A1-A3, A6

### 2.1 新增 Super Admin 角色
- **問題：** SDD #6 — 所有 Admin 都能看薪資
- **改動範圍：**
  - `types.ts` — UserRole enum
  - `netlify/functions/api.ts` — 權限檢查
  - `pages/AdminDashboard.tsx` — 條件渲染
  - `contexts/AuthContext.tsx` — User 型別
- **方案：**
  - UserRole 新增 `SuperAdmin = '最高管理者'`
  - 角色層級：`SuperAdmin > Admin > Employee`
  - SuperAdmin 獨有功能：薪資計算、員工薪資欄位編輯
  - Admin 可看自己薪資，但不能看他人薪資
  - 後端 API 加入角色檢查（get-all-salary-details 需 SuperAdmin）
- **驗證：** 一般 Admin 看不到薪資計算頁面；SuperAdmin 可以
- [x] 完成 (2026-04-08)

### 2.2 修正密碼安全問題
- **問題：** SDD A1, A2, A3
- **改動範圍：**
  - `netlify/functions/api.ts` — login, change-password, reset-password, create-employee
  - `components/admin/EmployeeManager.tsx`
  - `components/ChangePasswordModal.tsx`
  - `pages/LoginPage.tsx`
- **方案：**
  - **密碼雜湊：** 使用 bcrypt（或 crypto.subtle）加密儲存，login 時比對雜湊
  - **密碼強度：** 最少 8 字元，需含英文+數字
  - **重設密碼：** 不顯示密碼，改為產生臨時 token 或強制首次登入改密碼
  - **防暴力破解：** Firestore 記錄失敗次數，5 次失敗鎖定 15 分鐘
- **驗證：** Firestore 中不再存在明文密碼；連續 5 次失敗後帳號暫時鎖定
- [x] 完成 (2026-04-08)

### 2.3 新增操作稽核日誌
- **問題：** SDD A6 — 管理員操作無 log
- **改動範圍：**
  - `netlify/functions/api.ts` — 所有寫入 action
  - Firestore — 新增 `auditLogs` collection
- **方案：**
  - 新增 `auditLogs` collection，欄位：`timestamp`, `userId`, `action`, `targetId`, `details`
  - 所有管理操作（新增/修改/刪除員工、核假、改排班、重設密碼）自動寫入 log
  - AdminDashboard 新增「系統日誌」頁面（僅 SuperAdmin 可查看）
- **驗證：** 執行管理操作後，auditLogs 中有對應紀錄
- [x] 完成 (2026-04-08)

### 2.4 休館值班機制
- **問題：** SDD #3 — 休館日無法安排值班
- **改動範圍：**
  - `types.ts` — ScheduleEvent.status 新增狀態
  - `components/admin/ScheduleManager.tsx` — 休館日可編輯
  - `netlify/functions/api.ts` — 相關邏輯
- **方案：**
  - 營運狀態改為三種：`'營運'` / `'休館(值班)'` / `'休館(全休)'`
  - `休館(值班)`：不對外開放，但正職需到班值班
  - ScheduleManager 中，休館日可切換為「值班模式」並安排人員
  - 薪資計算仍計入休館值班的工時
- **驗證：** 休館日可設定值班人員，該人員的班表和薪資中有反映
- [x] 完成 (2026-04-08)

---

## Phase 3：功能完善（客戶優先）

> **目標：** 補齊客戶急需功能 + 原規劃的驗證邏輯、衝突偵測、通知機制。
> **相依性：** Phase 1（逐日排班）+ Phase 2（角色系統）完成後執行
> **對應問題：** 客戶回報 #1-#3、SDD B3-B6, C1-C2, D2-D4, E1

### 3.1 薪資設定完善（月薪欄位 + 費率設定化）
- **對應：** 客戶回報 #1 + 原 Phase 3.4（SDD E1）
- **問題：**
  - EmployeeManager Modal 只顯示兼職時薪，正職月薪無法設定（硬編碼 30000）
  - 勞保/健保/勞退/加班倍率/PT 上限都寫死在 `calculateSalaryForEmployee()`
- **改動範圍：**
  - `components/admin/EmployeeManager.tsx` — Modal 加入 `monthlySalary` 欄位（專責人員顯示）
  - `netlify/functions/api.ts` — 讀取 systemConfig、`calculateSalaryForEmployee()` 改用動態費率
  - `pages/AdminDashboard.tsx` — 新增「系統設定」子頁面（SuperAdmin 限定）
  - Firestore — 新增 `systemConfig/salary` 文件
- **方案：**
  - **A. 員工月薪欄位：**
    - EmployeeFormModal 根據 `position === '專責人員'` 顯示 `monthlySalary` input
    - `position === '兼職人員'` 顯示 `hourlyRate` input（現況）
    - 前端驗證：月薪 > 0、不可為負
  - **B. 薪資費率設定化：**
    - 新增 `systemConfig/salary` 文件：
      - `laborInsuranceRate`: 0.023
      - `healthInsuranceRate`: 0.0211
      - `laborPensionRate`: 0.06
      - `overtimeMultiplier`: 1.34
      - `ptMonthlyHourLimit`: 80
      - `ptWarningThreshold`: 10
    - 新增 `get-system-config` / `update-system-config` actions（後者限 SuperAdmin）
    - `calculateSalaryForEmployee()` 改為從 systemConfig 讀取
    - 新增 `SystemSettings.tsx` 頁面（SuperAdmin 限定）
    - 變更寫入 auditLogs
- **驗證：**
  - 新增正職員工可設定月薪，薪資計算使用該值（不再用 30000）
  - SuperAdmin 可調整勞保費率，下次薪資計算立即生效
- [x] 完成 (2026-04-09)

### 3.2 打卡紀錄管理（自動判定 + 管理員編輯）
- **對應：** 客戶回報 #2 + 原 Phase 3.2（SDD C1, C2）
- **問題：**
  - 打卡紀錄 `status` 固定寫入 `'正常'`，無遲到/早退判定
  - AttendanceLog 為純唯讀，管理員無法修正錯誤打卡
- **改動範圍：**
  - `netlify/functions/api.ts` — clock-in/clock-out 加入判定、新增 `update-clock-record` action
  - `components/admin/AttendanceLog.tsx` — 加入編輯按鈕 + EditModal
  - `types.ts` — `ClockRecord` 加入 `note?: string`、`manuallyEdited?: boolean`
- **方案：**
  - **A. 自動判定：**
    - clock-in：比對當日 `dailySchedule.shiftTime` 開始時間，超過 `lateGraceMinutes`（預設 5 分鐘，取自 systemConfig）標記 `'遲到'`
    - clock-out：比對 shiftTime 結束時間，早於則標記 `'早退'`
    - 同時遲到+早退時 status 優先顯示「遲到」，另存 `isEarlyLeave: true`
    - 儀表板顯示遲到/早退當月統計
  - **B. 管理員編輯：**
    - AttendanceLog 每列加「編輯」按鈕（Admin+ 可見）
    - EditModal 可修改：`clockInTime`, `clockOutTime`, `status`, `note`
    - 儲存時自動標記 `manuallyEdited: true` 並寫入 auditLogs（記錄修改前後值）
    - UI 上 `manuallyEdited` 的紀錄顯示「✏️ 已編輯」標記
- **驗證：**
  - 員工晚 10 分鐘打卡 → 自動標記「遲到」
  - 管理員可將該紀錄手動改為「正常」並填寫備註
  - auditLogs 有修改紀錄
- [x] 完成 (2026-04-09)

### 3.3 補打卡申請流程
- **對應：** 客戶回報 #3 + 原 Phase 4.2
- **問題：** 員工忘記打卡完全無補救機制
- **改動範圍：**
  - `types.ts` — 新增 `ClockMakeupRequest` 型別
  - `netlify/functions/api.ts` — 新增 4 個 actions：`submit-makeup-request`, `get-makeup-requests`, `approve-makeup-request`, `get-employee-makeup-requests`
  - 前端新增 `components/employee/ClockMakeupForm.tsx`
  - 前端新增 `components/admin/MakeupApprovalQueue.tsx`
  - Firestore 新增 `makeupRequests` collection
- **方案：**
  - **A. 員工申請：**
    - 員工端新增「補打卡申請」頁面（側欄入口）
    - 表單欄位：日期、補登時段（上班/下班/雙打卡）、時間、原因（必填）
    - 可上傳佐證（先省略，後期補）
    - 狀態：`待審核` → `核准` / `駁回`
  - **B. 管理員審核：**
    - `MakeupApprovalQueue` 類似 LeaveApprovalQueue
    - 核准時：
      - 自動寫入 `clockRecords`（標記 `source: 'makeup'`、`manuallyEdited: true`）
      - 該筆補登紀錄列表顯示「📝 補登」標記
    - 駁回時必填理由
    - 寫入 auditLogs
- **驗證：**
  - 員工可提交補登申請
  - 管理員核准後 `clockRecords` 多一筆該日紀錄
  - 薪資計算納入該筆工時
- [x] 完成 (2026-04-09)

### 3.4 請假日期驗證 + 駁回理由
- **對應：** 原 Phase 3.1（SDD D2, D3）
- **改動範圍：**
  - `components/employee/LeaveRequestForm.tsx` — 前端驗證
  - `netlify/functions/api.ts` — 後端驗證 + approve-leave 加 reason 欄位
  - `types.ts` — LeaveRequest 加 rejectReason
  - `components/admin/LeaveApprovalQueue.tsx` — 駁回理由輸入
- **方案：**
  - 前端驗證：endDate > startDate、不可選過去日期、最少 1 小時
  - 後端雙重驗證：同樣邏輯
  - 駁回時必填理由，存入 `rejectReason` 欄位
  - 員工端顯示駁回理由
- [x] 完成 (2026-04-09)

### 3.5 排班衝突偵測 + 人力檢查
- **對應：** 原 Phase 3.3（SDD B3-B6）
- **改動範圍：**
  - `components/admin/ScheduleManager.tsx` — EditModal 加入即時檢查
  - `netlify/functions/api.ts` — update-schedule 加入後端驗證
- **方案：**
  - 儲存排班前檢查：
    - staffA ≠ staffB（同人不得同時擔任 A/B）
    - 兼職人員該月累計時數不超過 80h（加上本次排班）
    - 營運日至少 1 名專責人員
  - 警告（可儲存但顯示提示）：
    - 兼職人員時數 ≥ 70h
    - 當日僅 1 名人員
  - 阻擋（不可儲存）：
    - 營運日 0 名人員
    - 同人擔任 A + B
- [x] 完成 (2026-04-09，提供 `check-schedule-conflicts` API；前端即時警告於 Phase 4 補強)

### 3.6 通知機制
- **對應：** 原 Phase 3.5（SDD D4）
- **改動範圍：**
  - Firestore — 新增 `notifications` collection
  - `netlify/functions/api.ts` — 觸發通知
  - 前端 — 新增通知元件（鈴鐺圖示 + 未讀計數）
- **方案：**
  - 系統內通知（非 email/push，先做最基本的）：
    - 請假核准/駁回 → 通知員工
    - 補打卡核准/駁回 → 通知員工（Phase 3.3 新增）
    - 排班異動 → 通知受影響員工
    - 打卡異常（缺勤、遲到）→ 通知管理員
  - 前端輪詢通知（每 60 秒），或頁面切換時檢查
  - 未來可升級為 Firebase Cloud Messaging 推播
- [x] 完成 (2026-04-09)

---

## Phase 4：進階功能

> **目標：** 提升使用體驗，新增進階 HR 功能。
> **相依性：** Phase 3 完成後執行
> **變更：** 原 4.2「打卡補登」已於 v1.4 Roadmap 重整時提前到 Phase 3.3

### 4.1 假別餘額管理
- **問題：** SDD D1 — 員工不知道特休剩幾天
- **方案：**
  - 依勞基法計算特休天數（依年資：6 個月 3 天、1 年 7 天…最高 30 天）
  - 以 `getLeaveBalanceForEmployee()` 即時計算（特休/事假/病假），無需額外 collection
  - `get-leave-balance` API + `submit-leave-request` 餘額檢查
  - `MyLeaveBalance` 元件：配額 / 已用 / 剩餘進度條
  - `LeaveRequestForm` 選擇假別時即時顯示剩餘時數，超額阻擋
- [x] 完成 (2026-04-10)

### 4.2 員工自選班表（原 4.3）
- **問題：** 使用者需求 #4 的進階版
- **方案：**
  - `openShifts` Firestore collection（date/shiftTime/requiredCount/takenBy/status）
  - 管理員 `OpenShiftManager`：建立開放排班、一覽、刪除
  - 員工 `OpenShiftPicker`：認領/釋出班次
  - 認領使用 Firestore Transaction 確保原子性，額滿自動關閉
  - 認領後自動同步到 `dailySchedule.partTime`
  - 管理員可手動調整結果（透過既有排班管理）
- [x] 完成 (2026-04-10)

### 4.3 薪資條列印下載（原 4.4）
- **問題：** SDD E4
- **方案：**
  - `openPayslipPrintView()` 開新視窗產生可列印 HTML
  - 包含：員工資訊、出勤統計、請假明細、薪資項目、法定扣除、實發薪資
  - 瀏覽器列印對話框可直接另存 PDF
  - 員工 `MySalary` + 管理端 `SalaryCalculation` 均有下載按鈕
  - 無需額外 npm 依賴（jsPDF 等）
- [x] 完成 (2026-04-10)

### 4.4 UI 統一化 + Error Boundary（原 4.5）
- **問題：** SDD F1-F5
- **方案：**
  - `ErrorBoundary` class component 包覆全 App，捕捉渲染錯誤顯示友善中文畫面
  - Logo 從外部 CDN URL 改為本地文字圖示（`青`），消除外部依賴
  - `AdminDashboard` sidebar 改為 `fixed/static` 響應式（手機漢堡選單 + 背景遮罩）
  - `EmployeeDashboard` 底部導覽列加入 `overflow-x-auto` + `min-w-[72px]` 支援水平滑動
- [x] 完成 (2026-04-10)

---

## Phase 5：排班模型重構（v2.0 核心）

> **目標：** 解決客戶 V2 第二輪回報；ScheduleEvent 從「全日單一時段」改為「每員工獨立時段陣列」，支援兩頭班與應到人數檢核。
> **相依性：** 建議先完成 Phase 7.1+7.4（測試骨架）再動模型。
> **詳細設計：** [SDD_v2_PROPOSAL.md](./SDD_v2_PROPOSAL.md) § 2

**客戶決策（2026-04-10）：**
1. 休館(值班) ✅ 允許排兼職
2. 兩頭班 ✅ 限 1 人最多 2 段
3. 應到人數不足 ⚠️ 僅警示不阻擋
4. 舊 dailySchedule 🗑️ 清空重建（取消 v1→v2 migration）
5. ✅ 先做 Phase 7.1+7.4 測試骨架

| 編號 | 項目 | 對應問題 | 狀態 |
|------|------|---------|------|
| 5.1 | ScheduleEvent 改為 `shifts: StaffShift[]`（兩頭班 ≤ 2 段） | V2-2 / V2-3 / V2-5 | [x] 完成 (2026-04-10) |
| 5.2 | 應到人數欄位 + 時段覆蓋檢核（**警示不阻擋**） | V2-1b | [x] 完成 (2026-04-10)：30 分鐘區段覆蓋計算 + 缺人時段列出 + 後端 conflicts API 整合 |
| 5.3 | 排班 UI 重做：時間軸視覺化 + 每人時段編輯 | V2-2 / V2-3 | [x] 完成 (2026-04-10)：班次列表編輯 + 員工時段橫向時間軸 + 覆蓋率條 |
| 5.4 | 修 bug — 休館(值班) 兼職在日曆顯示（**允許排**） | V2-4 | [x] 完成 (2026-04-10) |
| 5.5 | Onboarding wizard — **清空 dailySchedule + scheduleTemplate** 工具 | V2-1a / 決策 4 | [x] 完成 (2026-04-10) |
| 5.6 | 薪資計算 / 遲到判定 / 打卡比對遷移到新模型 | 5.1 連動 | [x] 完成 (2026-04-10) |
| 5.7 | ~~Migration script：v1 → v2 dailySchedule 轉換~~ | — | ❌ **取消**（決策 4） |
| 5.8 | 排班衝突即時警告（前端整合 Phase 3.5 API） | 技術債 | [x] 完成 (2026-04-10) |

---

## Phase 6：排班協作

> **目標：** 進階排班流程，提升日常運維效率。

| 編號 | 項目 | 狀態 |
|------|------|------|
| 6.1 | 換班/替班申請（員工互換 + 對方確認） | [x] |
| 6.2 | 排班版本歷史（snapshot + 回溯） | [x] |
| 6.3 | 月結鎖定：薪資結算後該月排班/打卡不可改 | [x] |
| 6.4 | 員工偏好班次設定（可上/不可上時段） | [x] |

---

## Phase 7：系統健全化（技術債）

> **目標：** 補上自動化測試、CI、觀測性等開發基礎建設。
> **建議：** 7.1+7.4 在 Phase 5 之前先做，避免重構破壞既有功能。

| 編號 | 項目 | 狀態 |
|------|------|------|
| 7.1 | Vitest 單元測試（薪資、遲到、餘額、密碼）— **36 個測試** | [x] 完成 (2026-04-10) |
| 7.2 | Playwright e2e（登入→打卡→請假→審核） | [x] 完成 (2026-05-20)：5 條 specs（登入 / 打卡 / 請假 / Admin 排班 / 換班） |
| 7.3 | Code splitting — dashboard view lazy load + vendor chunk 拆分 | [x] 完成 (2026-04-10)：27 view chunks + react-vendor + firebase-vendor；entry 503KB→217KB raw（gzip 127→67KB），無 chunk-size 警告 |
| 7.4 | GitHub Actions CI（typecheck + test + build） | [x] 完成 (2026-04-10) |
| 7.5 | 錯誤監控整合（Sentry 或自架） | [x] 程式完成 (2026-05-18)；2026-05-25 部署決策：暫不設定 `VITE_SENTRY_DSN` |
| 7.6 | FCM Push 通知取代 60s 輪詢 | [x] 程式完成 (2026-05-20)：Web Push token 管理 + service worker + 180s fallback polling；2026-05-25 部署決策：暫不設定 `VITE_FCM_VAPID_KEY` |
| 7.7 | CSV 匯出個資脫敏（A5） | [x] 完成 (2026-05-18)：csvMasking.ts 純函數 + 16 個 Vitest + 雙按鈕（脫敏 / 完整+確認） + 警語列 + AttendanceLog 補上「驗證資料」欄使 maskIP/maskGPS 實質生效 |

---

## Phase 8：HR 細節補強

> **目標：** 補齊勞基法細節與管理報表。

| 編號 | 項目 | 狀態 |
|------|------|------|
| 8.1 | 特休跨年結轉（保留 1 年） | [x] |
| 8.2 | 留停 / 育嬰假期間餘額不扣除 | [x] |
| 8.3 | 出勤紀錄 PDF 列印 | [x] |
| 8.4 | 月結報表（管理員月度統計） | [x] |
| 8.5 | 員工自助申請流程（特休、留停） | [x] |

---

## Phase 9：資安強化

> **目標：** 補齊部署前的安全邊界與操作檢查。2026-05-25 現況核對後，保留已啟用且符合使用情境的項目；移除不適用的 TOTP 流程。

| 編號 | 項目 | 狀態 |
|------|------|------|
| 9.1 | Netlify 安全 Headers + CORS allowlist | [x] 完成並推送；需以部署環境 header 檢查確認 |
| 9.2 | TOTP 2FA | [ ] ⏭️ 停用/移除：使用者決策為登入流程保持單階段密碼，不再要求 SuperAdmin 設定 2FA |
| 9.3 | Dependency Audit + CI gate | [x] 完成；CI 已改用 Node 24，PAT workflow scope 已解卡 |
| 9.4 | Firestore Rules client-side deny all | [x] 完成並已部署；Rules 測試通過 |

---

## 附錄：Firestore Collections 規劃（含新增）

| Collection | 用途 | 階段 |
|-----------|------|------|
| `employees` | 員工資料 | 現有 |
| `scheduleTemplate` | 排班模板（週為單位） | 現有 |
| `dailySchedule` | 逐日排班 | Phase 1 新增 |
| `clockRecords` | 打卡紀錄 | 現有 |
| `leaveRequests` | 請假申請 | 現有 |
| `auditLogs` | 操作稽核日誌 | Phase 2 新增 |
| `systemConfig` | 系統設定（費率等） | Phase 3.1 新增 |
| `makeupRequests` | 補打卡申請 | Phase 3.3 新增 |
| `notifications` | 系統內通知 | Phase 3.6 新增 |
| `openShifts` | 開放排班（自選班表） | Phase 4.2 新增 |
| `_archive_v1` | v2.0 migration 備份（dailySchedule/scheduleTemplate） | Phase 5.7 新增 |
| `shiftSwapRequests` | 換班申請 | Phase 6.1 新增 |
| `scheduleVersions` | 排班版本快照 | Phase 6.2 新增 |
| `monthLocks` | 月結鎖定狀態 | Phase 6.3 新增 |
| `staffPreferences` | 員工偏好班次 | Phase 6.4 新增 |
| `leaveOfAbsenceRequests` | 留停申請 | Phase 8.5 新增 |
| `fcmTokens` | Web Push token（目前部署未啟用 VAPID） | Phase 7.6 新增 |

---

## 附錄：型別變更規劃

### Phase 1
```typescript
// types.ts — 無破壞性變更，僅新增
// dailySchedule 使用既有 ScheduleEvent 型別
```

### Phase 2
```typescript
// types.ts
export enum UserRole {
  SuperAdmin = '最高管理者',  // 新增
  Admin = '管理者',
  Employee = '員工',
}

// ScheduleEvent.status 擴充
status: '營運' | '休館(值班)' | '休館(全休)';

// LeaveRequest 新增
rejectReason?: string;
```

### Phase 3
```typescript
// 3.1 薪資設定完善
export interface SystemConfig {
  laborInsuranceRate: number;
  healthInsuranceRate: number;
  laborPensionRate: number;
  overtimeMultiplier: number;
  ptMonthlyHourLimit: number;
  ptWarningThreshold: number;
  lateGraceMinutes: number;  // 3.2 遲到寬限時間
}

// 3.2 打卡紀錄管理 — ClockRecord 擴充
export interface ClockRecord {
  // ...既有欄位
  status: '正常' | '遲到' | '早退' | '遲到+早退';  // 實作自動判定
  note?: string;                                    // 備註（管理員編輯用）
  manuallyEdited?: boolean;                         // 是否人工編輯
  source?: 'normal' | 'makeup';                     // 3.3 補登來源
}

// 3.3 補打卡申請
export interface ClockMakeupRequest {
  id: string;
  empId: string;
  name: string;
  date: string;           // YYYY-MM-DD
  type: 'in' | 'out' | 'both';
  clockInTime?: string;   // HH:mm
  clockOutTime?: string;  // HH:mm
  reason: string;
  status: '待審核' | '核准' | '駁回';
  requestDate: string;    // ISO
  approver?: string;
  approvalDate?: string;
  rejectReason?: string;
}

// 3.4 LeaveRequest 擴充
// LeaveRequest 新增 rejectReason?: string

// 3.6 通知
export interface Notification {
  id: string;
  targetEmpId: string;
  type: '請假結果' | '補登結果' | '排班異動' | '打卡異常';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}
```

### Phase 4（已完成 2026-04-10）
```typescript
// 4.1 假別餘額（即時計算，無需額外 collection）
export interface LeaveBalance {
  leaveType: LeaveType;
  quotaHours: number;       // 年度配額（小時）
  usedHours: number;        // 已使用
  remainingHours: number;   // 剩餘
  note?: string;
}

// 4.2 員工自選班表
export type OpenShiftStatus = 'open' | 'closed';
export interface OpenShift {
  id: string;
  date: string;
  shiftTime: string;
  requiredCount: number;
  takenBy: string[];
  takenNames: string[];
  status: OpenShiftStatus;
  note?: string;
  createdBy: string;
  createdAt: string;
}
```
