# 開發階段規劃 (Development Roadmap)

> **建立日期：** 2026-04-08
> **對應 SDD 版本：** v1.0
> **狀態追蹤：** 以 checkbox 標記完成項目

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

## Phase 3：功能完善

> **目標：** 補齊驗證邏輯、衝突偵測、通知機制，提升系統可靠性。
> **相依性：** Phase 1（逐日排班）+ Phase 2（角色系統）完成後執行
> **對應問題：** SDD B3-B6, C1-C2, D2-D4, E1

### 3.1 請假日期驗證 + 駁回理由
- **問題：** SDD D2, D3
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
- [ ] 完成

### 3.2 打卡遲到/早退自動判定
- **問題：** SDD C1, C2
- **改動範圍：**
  - `netlify/functions/api.ts` — clock-in, clock-out actions
- **方案：**
  - clock-in：比對當日 dailySchedule 的 shiftTime 開始時間，超過則標記「遲到」
  - clock-out：比對 shiftTime 結束時間，早於則標記「早退」
  - 寬限時間：可設定 5-10 分鐘彈性（建議放在系統設定 collection）
  - 儀表板顯示遲到/早退統計
- [ ] 完成

### 3.3 排班衝突偵測 + 人力檢查
- **問題：** SDD B3, B4, B5, B6
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
- [ ] 完成

### 3.4 薪資費率設定化
- **問題：** SDD E1 — 費率硬寫死
- **改動範圍：**
  - Firestore — 新增 `systemConfig` collection
  - `netlify/functions/api.ts` — 讀取設定
  - `pages/AdminDashboard.tsx` — 新增設定頁面（SuperAdmin）
- **方案：**
  - 新增 `systemConfig/salary` 文件，存放：
    - `laborInsuranceRate`: 0.023
    - `healthInsuranceRate`: 0.0211
    - `laborPensionRate`: 0.06
    - `overtimeMultiplier`: 1.34
    - `ptMonthlyHourLimit`: 80
    - `ptWarningThreshold`: 10
  - 薪資計算從 systemConfig 讀取費率
  - SuperAdmin 可透過設定頁面修改
- [ ] 完成

### 3.5 通知機制
- **問題：** SDD D4 — 請假審核結果不通知
- **改動範圍：**
  - Firestore — 新增 `notifications` collection
  - `netlify/functions/api.ts` — 觸發通知
  - 前端 — 新增通知元件（鈴鐺圖示 + 未讀計數）
- **方案：**
  - 系統內通知（非 email/push，先做最基本的）：
    - 請假核准/駁回 → 通知員工
    - 排班異動 → 通知受影響員工
    - 打卡異常（缺勤）→ 通知管理員
  - 前端輪詢通知（每 60 秒），或頁面切換時檢查
  - 未來可升級為 Firebase Cloud Messaging 推播
- [ ] 完成

---

## Phase 4：進階功能

> **目標：** 提升使用體驗，新增進階 HR 功能。
> **相依性：** Phase 3 完成後執行

### 4.1 假別餘額管理
- **問題：** SDD D1 — 員工不知道特休剩幾天
- **方案：**
  - 依勞基法計算特休天數（依年資：6 個月 3 天、1 年 7 天...）
  - 新增 `leaveBalance` collection 追蹤各假別餘額
  - 請假申請時顯示剩餘天數，超額時阻擋
  - 員工端新增「假別餘額」頁面
- [ ] 完成

### 4.2 打卡補登申請
- **問題：** SDD C3 — 忘打卡無法補登
- **方案：**
  - 新增「補登打卡」申請流程，需填寫日期、時間、原因
  - 管理員審核後寫入 clockRecords
  - 補登紀錄標記為「補登」，與正常打卡區分
- [ ] 完成

### 4.3 員工自選班表
- **問題：** 使用者需求 #4 的進階版
- **方案：**
  - 管理員建立「開放排班」時段，設定需要幾人
  - 員工可在期限內自行選班
  - 人數額滿自動關閉
  - 管理員可手動調整最終結果
- [ ] 完成

### 4.4 薪資條 PDF 下載
- **問題：** SDD E4
- **方案：**
  - 使用 jsPDF 或類似套件產生薪資條 PDF
  - 包含：員工資訊、出勤統計、薪資明細、扣除項目
  - 員工可自行下載，管理員可批次匯出
- [ ] 完成

### 4.5 UI 統一化 + Error Boundary
- **問題：** SDD F1-F5
- **方案：**
  - 新增 ErrorBoundary 元件包覆所有頁面
  - 統一所有訊息為中文
  - Logo 改為本地檔案（移除外部 URL 依賴）
  - 狀態指示加入文字/圖示（不只靠顏色）
  - AdminDashboard sidebar 響應式設計（手機可收合）
- [ ] 完成

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
| `systemConfig` | 系統設定（費率等） | Phase 3 新增 |
| `notifications` | 系統內通知 | Phase 3 新增 |
| `leaveBalance` | 假別餘額 | Phase 4 新增 |

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
// 新增型別
export interface SystemConfig {
  laborInsuranceRate: number;
  healthInsuranceRate: number;
  laborPensionRate: number;
  overtimeMultiplier: number;
  ptMonthlyHourLimit: number;
  ptWarningThreshold: number;
  lateGraceMinutes: number;
}

export interface Notification {
  id: string;
  targetEmpId: string;
  type: '請假結果' | '排班異動' | '打卡異常';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}
```

### Phase 4
```typescript
export interface LeaveBalance {
  empId: string;
  year: number;
  annualTotal: number;    // 特休總天數
  annualUsed: number;     // 已使用
  personalUsed: number;   // 事假已用
  sickUsed: number;       // 病假已用
}
```
