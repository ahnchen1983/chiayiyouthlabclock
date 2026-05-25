# 嘉義青年實驗室打卡系統 — 軟體設計文件 (SDD)

> **版本：** v2.1（現況核對版）
> **建立日期：** 2026-04-08
> **最後更新：** 2026-05-25
> **對應程式版本：** Phase 1–8 完成；Phase 9 啟用項目完成；TOTP 已依產品決策停用
> **開發進度：** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 ✅ · Phase 6 ✅ · Phase 7 ✅ · Phase 8 ✅ · Phase 9 ✅/⏭️（9.2 TOTP 停用）
>
> **相關文件：**
> - [CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md](./CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md) — **目前功能與流程核對報告（最新實況）**
> - [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) — 開發階段規劃
> - [CHANGELOG.md](./CHANGELOG.md) — 完整變更紀錄
> - [VERIFICATION_MANUAL.md](./VERIFICATION_MANUAL.md) — 系統驗證手冊

> **閱讀提醒：** 本 SDD 主體保留歷史設計脈絡，部分段落仍描述早期 v1/v2 演進細節；若與 2026-05-25 之後的程式實作不同，以 `CURRENT_FUNCTIONALITY_AUDIT_2026-05-25.md`、`types.ts`、`netlify/functions/api.ts` 和測試結果為準。

---

## 目錄

1. [系統概述](#1-系統概述)
2. [系統架構](#2-系統架構)
3. [角色與權限](#3-角色與權限)
4. [功能模組](#4-功能模組)
5. [資料模型](#5-資料模型)
6. [API 端點清單](#6-api-端點清單)
7. [前端頁面與元件](#7-前端頁面與元件)
8. [已知問題與限制](#8-已知問題與限制)
9. [變更紀錄](#9-變更紀錄)

---

## 1. 系統概述

### 1.1 系統名稱
嘉義市青年實驗室出勤管理系統（Chiayi Youth Lab Clock System）

### 1.2 系統用途
為嘉義市青年實驗室（有事青年實驗室）提供員工出勤打卡、排班管理、請假申請、薪資計算等人事管理功能。適用對象包含專責人員（正職）與兼職人員（PT）。

### 1.3 技術架構總覽

| 層級 | 技術 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 樣式 | Tailwind CSS |
| 後端 | Netlify Functions (Serverless) |
| 資料庫 | Firebase Firestore |
| 認證 | Firebase Authentication (Custom Token) |
| 部署 | Netlify |

### 1.4 專案結構

```
chiayiyouthlabclock/
├── components/
│   ├── admin/                  # 管理者元件
│   │   ├── AdminOverview.tsx       # 總覽儀表板
│   │   ├── AttendanceLog.tsx       # 出勤紀錄
│   │   ├── EmployeeManager.tsx     # 員工管理
│   │   ├── LeaveApprovalQueue.tsx  # 請假審核
│   │   ├── PartTimeMonitor.tsx     # PT 時數監控
│   │   ├── SalaryCalculation.tsx   # 薪資計算
│   │   ├── ScheduleComparison.tsx  # 排班對照表
│   │   └── ScheduleManager.tsx     # 排班管理
│   ├── employee/               # 員工元件
│   │   ├── ClockIn.tsx             # 打卡
│   │   ├── FullScheduleCalendar.tsx # 總班表
│   │   ├── LeaveRequestForm.tsx    # 請假申請
│   │   ├── MyRecords.tsx           # 我的打卡紀錄
│   │   ├── MySalary.tsx            # 我的薪資
│   │   └── MyScheduleCalendar.tsx  # 我的班表
│   ├── ChangePasswordModal.tsx # 修改密碼
│   └── icons.tsx               # 圖示元件
├── contexts/
│   └── AuthContext.tsx          # 認證狀態管理
├── pages/
│   ├── App.tsx                 # 根元件
│   ├── AdminDashboard.tsx      # 管理者後台
│   ├── EmployeeDashboard.tsx   # 員工後台
│   └── LoginPage.tsx           # 登入頁
├── services/
│   ├── firebaseConfig.ts       # Firebase 設定
│   └── googleAppsScriptAPI.ts  # API 呼叫層
├── netlify/
│   └── functions/
│       ├── api.ts              # 後端 API 主體
│       └── utils/
│           └── firebaseAdmin.ts # Firebase Admin SDK
├── types.ts                    # 型別定義
├── docs/                       # 文件目錄
│   ├── SDD.md                  # 本文件
│   └── DEVELOPMENT_ROADMAP.md  # 開發階段規劃
└── README.md
```

---

## 2. 系統架構

### 2.1 架構圖

```
┌─────────────────────────────────────────────────────────┐
│                     使用者（瀏覽器）                       │
│  ┌─────────────────┐     ┌─────────────────────────┐    │
│  │   LoginPage      │     │  AdminDashboard /        │    │
│  │                  │────>│  EmployeeDashboard       │    │
│  └─────────────────┘     └───────────┬─────────────┘    │
└──────────────────────────────────────┼──────────────────┘
                                       │ HTTPS POST
                                       ▼
┌─────────────────────────────────────────────────────────┐
│              Netlify Functions (Serverless)               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  api.ts — 單一端點, 依 action 分派               │    │
│  │  • 驗證 Firebase ID Token                        │    │
│  │  • 處理所有 CRUD 操作                            │    │
│  │  • 薪資計算邏輯                                  │    │
│  └──────────────────────┬──────────────────────────┘    │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Firebase                                │
│  ┌──────────────┐  ┌─────────────────────────────┐     │
│  │ Authentication│  │ Firestore                    │     │
│  │ (Custom Token)│  │ ├─ employees                 │     │
│  │               │  │ ├─ scheduleTemplate          │     │
│  │               │  │ ├─ dailySchedule  (v1.1)     │     │
│  │               │  │ ├─ clockRecords              │     │
│  │               │  │ ├─ leaveRequests             │     │
│  │               │  │ ├─ auditLogs      (v1.2)     │     │
│  │               │  │ └─ loginAttempts  (v1.2)     │     │
│  └──────────────┘  └─────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### 2.2 認證流程

1. 使用者輸入員工編號 + 密碼
2. 前端呼叫 `POST /.netlify/functions/api` (action: `login`)
3. 後端檢查 `loginAttempts/{empId}` 鎖定狀態（5 次失敗鎖定 15 分鐘）
4. 讀取 Firestore `employees.password`，以 scrypt 雜湊比對（v1.2）
   - 若為舊版明文密碼（不含 `:`），比對成功後自動升級為雜湊
   - 失敗時寫入 `loginAttempts` 計數
5. 比對成功 → 清除失敗紀錄 → `adminAuth.createCustomToken(empId)` 產生 Custom Token
6. 前端用 `signInWithCustomToken()` 交換為 Firebase ID Token
7. 後續所有 API 請求帶 `Authorization: Bearer <ID Token>`
8. 後端用 `adminAuth.verifyIdToken()` 驗證，並依 `employees.role` 判定 `isSuperAdmin` / `isAdmin`
9. 使用者資訊存入 `sessionStorage`

### 2.3 資料流

- **所有 API 請求**透過單一端點 `/.netlify/functions/api`
- 請求格式：`POST { action: 'xxx', ...data }`
- 回應格式：`{ statusCode: 200, body: JSON }`
- 前端 API 層：`services/googleAppsScriptAPI.ts`（歷史命名，實際呼叫 Netlify Functions）

---

## 3. 角色與權限

### 3.1 現有角色定義

| 角色 | 值 | 說明 | 進入頁面 |
|------|-----|------|---------|
| 最高管理者 | `UserRole.SuperAdmin` | 具備所有管理功能 + 薪資 + 系統日誌 | `AdminDashboard` |
| 系統管理者 | `UserRole.Admin` | 具備一般管理功能（無薪資/日誌） | `AdminDashboard` |
| 員工 | `UserRole.Employee` | 僅限自身操作 | `EmployeeDashboard` |

> **角色層級：** `SuperAdmin > Admin > Employee`，SuperAdmin 為 v1.2 新增。

### 3.2 職位類型

| 職位 | 說明 |
|------|------|
| 專責人員 | 正職，月薪制，薪資欄位為 `monthlySalary` |
| 兼職人員 | PT，時薪制，薪資欄位為 `hourlyRate`，月時數上限 80 小時 |

### 3.3 各角色可用功能

| 功能 | SuperAdmin | Admin | Employee |
|------|:----------:|:-----:|:--------:|
| 打卡 | V | V | V |
| 查看自己班表 | V | V | V |
| 查看總班表 | V | V | V |
| 查看自己打卡紀錄 | V | V | V |
| 請假申請 | V | V | V |
| 查看自己薪資明細 | V | V | V |
| 總覽儀表板 | V | V | -- |
| 排班管理 | V | V | -- |
| 排班對照表 | V | V | -- |
| 出勤紀錄（全員） | V | V | -- |
| 請假審核 | V | V | -- |
| 員工管理 | V | V | -- |
| **薪資計算（全員）** | **V** | -- | -- |
| **系統日誌（auditLogs）** | **V** | -- | -- |
| 修改密碼 | V | V | V |

> **v1.1+v1.2 變更：** (1) Admin/SuperAdmin 也能打卡、請假、查看自己紀錄 (2) 薪資計算頁和系統日誌僅 SuperAdmin 可見，後端 API 有 role check。

---

## 4. 功能模組

### 4.1 登入認證模組

| 項目 | 說明 |
|------|------|
| 檔案 | `LoginPage.tsx`, `AuthContext.tsx`, `api.ts` (action: login) |
| 功能 | 員工編號 + 密碼登入 |
| 密碼儲存 | **scrypt 雜湊**（v1.2），格式 `salt:hash`；舊版明文登入時自動升級 |
| 密碼強度 | 至少 8 字元，需含英文字母與數字（v1.2） |
| 防暴力破解 | `loginAttempts` collection 記錄失敗次數，5 次鎖定 15 分鐘（v1.2） |
| Session | `sessionStorage` 存 user JSON |
| 登出 | 清除 sessionStorage + `signOut(auth)` |

### 4.2 排班管理模組

| 項目 | 說明 |
|------|------|
| 管理端 | `ScheduleManager.tsx` |
| 員工端 | `MyScheduleCalendar.tsx`, `FullScheduleCalendar.tsx` |
| 後端 | `api.ts` actions: `get-monthly-schedule`, `get-employee-schedule`, `update-schedule`, `apply-template`（v1.1） |
| 資料結構 | **逐日制**（v1.1），`dailySchedule/{YYYY-MM-DD}` 為主，`scheduleTemplate` 為預設模板 |
| 營運狀態 | `'營運'` / `'休館(值班)'` / `'休館'`（v1.2 新增休館值班） |
| 班別時段 | `shiftTime` 欄位（如 `"08:30-17:30"`），**可於 EditModal 編輯**（v1.1） |
| 人員欄位 | `staffA`（專責A）、`staffB`（專責B）、`partTime[]`（兼職陣列） |

**排班產生邏輯（v1.1 後）：**
1. 查詢月班表時，批次讀取 `dailySchedule/{YYYY-MM-DD}` 該月所有文件
2. 若某日 `dailySchedule` 不存在，fallback 到 `scheduleTemplate` 對應星期幾
3. 修改班表時，後端只寫入 `dailySchedule/{該日期}`，**不影響其他同星期日期**
4. `apply-template` action 可批次將模板套用到指定月份，一次產生該月所有 `dailySchedule` 文件

**初始化預設模板（無人員）：**

| 星期 | 狀態 | 時段 | 專責A | 專責B | 兼職 |
|------|------|------|-------|-------|------|
| 日 | 營運 | 08:30-17:30 | — | — | — |
| 一 | 休館 | — | — | — | — |
| 二 | 休館 | — | — | — | — |
| 三 | 營運 | 10:00-20:00 | — | — | — |
| 四 | 營運 | 10:00-20:00 | — | — | — |
| 五 | 營運 | 08:30-17:30 | — | — | — |
| 六 | 營運 | 08:30-17:30 | — | — | — |

> v1.1 起初始化不再寫入任何假人名，人員由管理員於員工管理頁面手動建立後再排班。

### 4.3 打卡出勤模組

| 項目 | 說明 |
|------|------|
| 前端 | `ClockIn.tsx` |
| 後端 | `api.ts` actions: `clock-in`, `clock-out`, `get-today-clock-status`, `validate-gps` |
| 驗證方式 | IP 驗證 或 GPS 驗證（二擇一） |
| IP 驗證 | **後端從 `x-forwarded-for` header 取得真實 IP**（v1.1 修正） |
| GPS 驗證 | 中心點 `(23.4800, 120.4500)`，容許範圍 100 公尺 |
| 打卡時間 | 伺服器端時間（Asia/Taipei），防前端竄改 |
| 工時計算 | `clockOutTime - clockInTime`，單位：小時（1 位小數） |
| 出勤狀態 | 目前固定寫入 `'正常'`，遲到/早退判定待 Phase 3 實作 |

**打卡紀錄結構 (ClockRecord)：**
```typescript
{
    empId: string;        // 員工編號
    name: string;         // 姓名
    date: string;         // "YYYY-MM-DD"
    clockInTime: string;  // "HH:mm"
    clockOutTime: string; // "HH:mm"
    verificationMethod: 'IP' | 'GPS';
    verificationData: string;
    workHours: number;    // 工時（小時）
    status: '正常' | '遲到' | '早退';  // 目前固定為 '正常'
}
```

### 4.4 請假管理模組

| 項目 | 說明 |
|------|------|
| 員工端 | `LeaveRequestForm.tsx` |
| 管理端 | `LeaveApprovalQueue.tsx` |
| 後端 | `api.ts` actions: `submit-leave-request`, `get-employee-leave-requests`, `get-all-leave-requests`, `approve-leave` |

**假別：**

| 假別 | 值 | 薪資影響 |
|------|-----|---------|
| 事假 | `LeaveType.Personal` | 扣全薪（時薪 x 時數） |
| 病假 | `LeaveType.Sick` | 扣半薪（時薪 x 時數 x 50%） |
| 特休 | `LeaveType.Annual` | 不扣薪 |
| 其他 | `LeaveType.Other` | 不扣薪 |

**審核狀態：** `待審核` → `核准` / `駁回`

**請假時數計算：** `(endDate - startDate)` 轉換為小時（後端計算）

### 4.5 薪資計算模組

| 項目 | 說明 |
|------|------|
| 管理端 | `SalaryCalculation.tsx` |
| 員工端 | `MySalary.tsx` |
| 後端 | `api.ts` actions: `get-all-salary-details`, `get-employee-salary` |
| 計算位置 | 後端 `calculateSalaryForEmployee()` 函數 |

**計算邏輯：**

```
【專責人員（月薪制）】
底薪 = monthlySalary（預設 30,000）
時薪 = monthlySalary / 30 / 8
加班時數 = max(0, 實際工時 - 排班天數 x 8)
加班費 = 加班時數 x 時薪 x 1.34

【兼職人員（時薪制）】
底薪 = (實際工時 - 加班時數) x hourlyRate
加班時數 = max(0, 實際工時 - 排班天數 x 8)
加班費 = 加班時數 x hourlyRate x 1.34

【共通扣除項目】
應發薪資 = 底薪 + 加班費
勞保自付額 = 應發薪資 x 2.3%
健保自付額 = 應發薪資 x 2.11%
勞退自提   = 應發薪資 x 6%
請假扣款   = Σ(假別扣款)
總扣除     = 勞保 + 健保 + 勞退 + 請假扣款
實領薪資   = 應發薪資 - 總扣除
```

**PT 時數監控：**
- 月時數上限：80 小時
- 預警門檻：剩餘 ≤ 10 小時時顯示「接近上限」

### 4.6 員工管理模組

| 項目 | 說明 |
|------|------|
| 前端 | `EmployeeManager.tsx` |
| 後端 | `api.ts` actions: `create-employee`, `update-employee`, `delete-employee`, `get-all-employees`, `get-all-employees-detail`, `get-employee` |
| 功能 | 新增/編輯/刪除員工、重設密碼 |
| 編號規則 | `EMP` + 3 位數流水號（EMP001, EMP002...） |
| 預設密碼 | `Aa123456`（8 字元含英數，scrypt 雜湊儲存） |
| 重設密碼 | v1.2 起不再 alert 明文密碼 |
| 操作稽核 | 所有新增/修改/刪除/重設密碼操作寫入 `auditLogs`（v1.2） |

### 4.7 儀表板模組

| 項目 | 說明 |
|------|------|
| 前端 | `AdminOverview.tsx` |
| 後端 | `api.ts` action: `get-dashboard-stats` |

**顯示內容：**
- 今日出勤人數 vs 排班人數
- 本月總工時
- 待審核請假件數
- PT 時數預警件數
- 今日出勤對照表（每位員工的排班 vs 實際打卡）
- 待處理事項列表（請假審核、時數警示）

### 4.8 排班對照表模組

| 項目 | 說明 |
|------|------|
| 前端 | `ScheduleComparison.tsx` |
| 後端 | `api.ts` action: `get-schedule-attendance-comparison` |
| 功能 | 逐日比較排班人員 vs 實際出勤紀錄 |

### 4.9 操作稽核日誌模組（v1.2 新增）

| 項目 | 說明 |
|------|------|
| 前端 | `components/admin/AuditLogViewer.tsx`（僅 SuperAdmin 可見） |
| 後端 | `api.ts` action: `get-audit-logs`、helper `writeAuditLog()` |
| 資料 | `auditLogs` collection |
| 記錄事件 | update-schedule、apply-template、approve-leave、create/update/delete-employee、reset-password |
| 欄位 | `timestamp`, `userId`, `action`, `targetId`, `details` |

---

## 5. 資料模型

### 5.1 Firestore Collections

#### `employees` — 員工資料
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 員工編號（EMP001、ADMIN） |
| name | string | 姓名 |
| role | string | `'最高管理者'` / `'管理者'` / `'員工'`（v1.2 新增 SuperAdmin） |
| position | string | `'專責人員'` / `'兼職人員'` |
| phone | string | 電話 |
| email | string | Email |
| hourlyRate | number | 時薪（兼職用） |
| monthlySalary | number | 月薪（專責用） |
| hireDate | string | 到職日 (YYYY-MM-DD) |
| resignDate | string? | 離職日 |
| status | string | `'在職'` / `'離職'` / `'留停'` |
| password | string | 密碼（**scrypt 雜湊**，格式 `salt:hash`，v1.2） |

#### `scheduleTemplate` — 排班模板（v2.0 結構，Phase 5.1）
| 文件 ID | 說明 |
|---------|------|
| "0" | 週日 |
| "1" | 週一 |
| ... | ... |
| "6" | 週六 |

每筆文件欄位（v2.0）：
| 欄位 | 型別 | 說明 |
|------|------|------|
| status | string | `'營運'` / `'休館(值班)'` / `'休館'` |
| openingHours | string | 場館營業時段（如 `"08:30-17:30"`），僅供顯示 |
| requiredHeadcount | number | 應到人數（警示用，不阻擋） |
| defaultShifts | array | 預設班次結構 `{ role, from, to }`（不含具體人員） |

#### `dailySchedule` — 逐日排班（v2.0 結構，Phase 5.1）
| 文件 ID | 說明 |
|---------|------|
| "YYYY-MM-DD" | 該日班表 |

每筆文件欄位（v2.0）：
| 欄位 | 型別 | 說明 |
|------|------|------|
| status | string | `'營運'` / `'休館(值班)'` / `'休館'` |
| openingHours | string? | 場館營業時段（如 `"08:30-17:30"`） |
| requiredHeadcount | number? | 應到人數（警示用，不阻擋） |
| shifts | StaffShift[] | 每員工獨立時段，支援兩頭班（同人 ≤ 2 段） |

`StaffShift` 欄位：
| 欄位 | 型別 | 說明 |
|------|------|------|
| empId | string | 員工編號（v2.0 新增，舊資料可能為空字串） |
| name | string | 姓名（冗餘儲存方便顯示） |
| role | string | `'staffA'` / `'staffB'` / `'partTime'` |
| from | string | 起始時間 `"HH:mm"` |
| to | string | 結束時間 `"HH:mm"` |
| note | string? | 備註 |

**v2.0 變更摘要：**
- 取代 v1 的 `shiftTime`（全日單一）為每員工獨立時段
- 取代 `staffA / staffB / partTime` 三個欄位為統一的 `shifts` 陣列
- 新增 `requiredHeadcount`、`openingHours` 兩個欄位
- 支援兩頭班（如三、四營業時間長，正職可拆早班+晚班）

**讀取相容層：** 後端 `normalizeScheduleDoc` 自動將 v1 舊文件 in-memory 轉換為 v2 結構，不回寫資料庫。舊資料 `empId` 欄位為空，比對時 fallback 到 `name`。

查詢邏輯：優先讀取 `dailySchedule/{date}`，不存在則 fallback 到 `scheduleTemplate`（取 status + openingHours，shifts 為空陣列）。

#### `clockRecords` — 打卡紀錄
| 欄位 | 型別 | 說明 |
|------|------|------|
| empId | string | 員工編號 |
| name | string | 姓名 |
| date | string | 日期 (YYYY-MM-DD) |
| clockInTime | string | 上班時間 (HH:mm) |
| clockOutTime | string? | 下班時間 (HH:mm) |
| verificationMethod | string | `'IP'` / `'GPS'` |
| verificationData | string | IP 或 GPS 座標 |
| workHours | number? | 工時（小時） |
| status | string | `'正常'` / `'遲到'` / `'早退'` / `'遲到+早退'` / `'異常'`（v1.5 擴充） |
| note | string? | 備註（v1.5 新增） |
| manuallyEdited | boolean? | 是否被手動編輯（v1.5 新增） |
| editedBy | string? | 編輯者 empId（v1.5 新增） |
| editedAt | string? | 編輯時間 ISO（v1.5 新增） |
| source | string? | `'normal'` / `'makeup'`（v1.5 新增） |

#### `leaveRequests` — 請假申請
| 欄位 | 型別 | 說明 |
|------|------|------|
| empId | string | 員工編號 |
| name | string | 姓名 |
| leaveType | string | 假別 |
| startDate | string | 開始日期時間 |
| endDate | string | 結束日期時間 |
| hours | number | 時數（後端計算） |
| reason | string | 事由 |
| requestDate | string | 申請日期 (ISO) |
| status | string | `'待審核'` / `'核准'` / `'駁回'` |
| approver | string? | 核准者姓名 |
| approvalDate | string? | 核准日期 (ISO) |
| rejectReason | string? | 駁回理由（v1.5 新增） |

#### `auditLogs` — 操作稽核日誌（v1.2 新增）
| 欄位 | 型別 | 說明 |
|------|------|------|
| timestamp | string | ISO 時間戳 |
| userId | string | 操作者 empId |
| action | string | 操作名稱（如 `update-schedule`） |
| targetId | string | 操作對象（如 empId 或日期） |
| details | object | 額外細節（舊值、新值等） |

#### `loginAttempts` — 登入失敗計數（v1.2 新增）
| 欄位 | 型別 | 說明 |
|------|------|------|
| failCount | number | 累計失敗次數 |
| lastFailAt | string | 最近失敗 ISO 時間 |

文件 ID 為 empId。失敗達 5 次後 15 分鐘內拒絕登入；登入成功自動刪除此文件。

#### `systemConfig` — 系統設定（v1.5 新增 / Phase 3.1）
文件 ID `salary` 內含薪資相關費率與規則：
| 欄位 | 型別 | 預設值 | 說明 |
|------|------|------|------|
| laborInsuranceRate | number | 0.023 | 勞保員工負擔率 |
| healthInsuranceRate | number | 0.0211 | 健保員工負擔率 |
| laborPensionRate | number | 0.06 | 勞退自提率 |
| overtimeMultiplier | number | 1.34 | 加班倍率 |
| ptMonthlyHourLimit | number | 80 | 兼職月時數上限 |
| ptWarningThreshold | number | 70 | 兼職時數警示閾值 |
| lateGraceMinutes | number | 5 | 遲到寬限分鐘 |
| updatedAt | string? | - | 最後更新 ISO |
| updatedBy | string? | - | 最後更新者 empId |

僅 SuperAdmin 可寫入；任何已驗證身份可讀取（供薪資計算使用）。

#### `makeupRequests` — 補打卡申請（v1.5 新增 / Phase 3.3）
| 欄位 | 型別 | 說明 |
|------|------|------|
| empId | string | 申請員工編號 |
| name | string | 姓名 |
| date | string | 補打卡日期 (YYYY-MM-DD) |
| type | string | `'上班'` / `'下班'` / `'上下班'` |
| requestedClockIn | string? | 補上班時間 (HH:mm) |
| requestedClockOut | string? | 補下班時間 (HH:mm) |
| reason | string | 申請理由（最少 5 字） |
| status | string | `'待審核'` / `'核准'` / `'駁回'` |
| requestDate | string | 申請時間 ISO |
| approver | string? | 審核者姓名 |
| approvalDate | string? | 審核時間 ISO |
| rejectReason | string? | 駁回理由 |

核准時自動寫入或合併到 `clockRecords`，並標記 `source: 'makeup'`、`manuallyEdited: true`。

#### `notifications` — 系統通知（v1.5 新增 / Phase 3.6）
| 欄位 | 型別 | 說明 |
|------|------|------|
| empId | string | 接收者 empId |
| type | string | `'leave-approved'` / `'leave-rejected'` / `'makeup-approved'` / `'makeup-rejected'` / `'schedule-changed'` / `'clock-warning'` / `'system'` |
| title | string | 標題 |
| message | string | 內容 |
| read | boolean | 是否已讀 |
| createdAt | string | 建立時間 ISO |
| link | string? | 點擊跳轉位置 |

員工只能讀寫自己的通知；前端輪詢頻率 60 秒。

#### `openShifts` — 開放排班（v1.6 新增 / Phase 4.2）
| 欄位 | 型別 | 說明 |
|------|------|------|
| date | string | 排班日期 (YYYY-MM-DD) |
| shiftTime | string | 時段（如 `"08:30-17:30"`） |
| requiredCount | number | 需要人數 |
| takenBy | string[] | 已認領的 empId 陣列 |
| takenNames | string[] | 已認領的姓名陣列（同步更新，方便顯示） |
| status | string | `'open'` / `'closed'`（人數額滿自動關閉） |
| note | string? | 備註 |
| createdBy | string | 建立者 empId |
| createdAt | string | 建立時間 ISO |

管理員建立開放排班後，員工可自行認領/釋出。認領時以 Firestore Transaction 確保原子性，同時自動同步到 `dailySchedule.partTime`。

### 5.2 預設初始資料（v1.1 後）

系統首次呼叫 `initialize-database` 時：

1. 若 `scheduleTemplate` 不存在，建立 7 天空白模板（無人名）
2. 若 `employees/ADMIN` 不存在，建立預設最高管理員帳號：

| ID | 姓名 | 角色 | 職位 | 預設密碼 |
|----|------|------|------|---------|
| ADMIN | 系統管理員 | 最高管理者 | 專責人員 | `admin1234`（雜湊儲存） |

> **v1.1 起不再寫入任何假員工**，首次部署後登入 ADMIN 帳號，由管理員手動建立其他員工。
> **v1.2.1** 修正：`initialize-database` 改為獨立檢查 ADMIN 是否存在（原先若 `employees` 非空會直接跳過），確保升級部署也能建立 SuperAdmin。

---

## 6. API 端點清單

所有 API 透過 `POST /.netlify/functions/api` 單一端點，以 `action` 欄位分派。

### 6.1 不需認證

| Action | 參數 | 回傳 | 說明 |
|--------|------|------|------|
| `login` | `empId`, `password` | `{ user, customToken }` | 登入 |
| `initialize-database` | — | `{ message }` | 初始化預設資料 |

### 6.2 需認證（Bearer Token）

| Action | 參數 | 回傳 | 說明 |
|--------|------|------|------|
| **打卡** | | | |
| `get-today-clock-status` | — | `{ clockInTime?, clockOutTime? }` | 今日打卡狀態 |
| `clock-in` | `name`, `verificationMethod`, `verificationData` | `boolean` | 打上班卡 |
| `clock-out` | — | `boolean` | 打下班卡 |
| `validate-gps` | `lat`, `lng` | `{ isValid, distance }` | GPS 驗證 |
| **打卡紀錄** | | | |
| `get-clock-records` | `yearMonth` | `ClockRecord[]` | 個人打卡紀錄 |
| `get-all-clock-records` | `yearMonth` | `ClockRecord[]` | 全員打卡紀錄 |
| **排班** | | | |
| `get-employee-schedule` | `yearMonth` | `ScheduleEvent[]` | 個人班表（v1.1 起讀 dailySchedule） |
| `get-monthly-schedule` | `yearMonth` | `ScheduleEvent[]` | 全月班表（v1.1 起讀 dailySchedule） |
| `update-schedule` | `event` | `boolean` | 更新排班（v1.1 起寫入 `dailySchedule/{date}`；v2.0 改寫入 `shifts[]` 結構，並驗證兩頭班 ≤ 2 段） |
| `apply-template` | `yearMonth` | `boolean` | 批次將 scheduleTemplate 套用到該月（v1.1 新增；v2.0 起 shifts=[] 待管理員填人） |
| `reset-all-schedule` | `alsoResetTemplate?` | `{ dailyDeleted, templateDeleted, message }` | 清空所有排班資料（v2.0 / Phase 5.5，限 SuperAdmin） |
| **請假** | | | |
| `get-employee-leave-requests` | — | `LeaveRequest[]` | 個人請假紀錄 |
| `get-all-leave-requests` | — | `LeaveRequest[]` | 全部請假紀錄 |
| `submit-leave-request` | `leaveType`, `startDate`, `endDate`, `reason` | `boolean` | 提交請假 |
| `approve-leave` | `requestId`, `status`, `approverName` | `boolean` | 審核請假 |
| **員工管理** | | | |
| `get-all-employees` | — | `User[]` | 全員基本資料 |
| `get-all-employees-detail` | — | `Employee[]` | 全員詳細資料 |
| `get-employee` | `empId` | `Employee` | 單一員工資料 |
| `create-employee` | `employee`, `initialPassword?` | `Employee` | 新增員工 |
| `update-employee` | `empId`, `updates` | `Employee` | 更新員工 |
| `delete-employee` | `empId` | `boolean` | 刪除員工 |
| **密碼** | | | |
| `change-password` | `oldPassword`, `newPassword` | `{ success, message }` | 修改密碼 |
| `reset-password` | `empId`, `newPassword` | `{ success, message }` | 重設密碼 |
| **儀表板** | | | |
| `get-dashboard-stats` | — | `DashboardStats` | 儀表板統計 |
| `get-all-part-time-hours` | `yearMonth` | `PartTimeHourInfo[]` | PT 時數 |
| **對照表** | | | |
| `get-schedule-attendance-comparison` | `yearMonth` | `Comparison[]` | 排班 vs 出勤 |
| **薪資** | | | |
| `get-all-salary-details` | `yearMonth` | `SalaryDetail[]` | 全員薪資（v1.2 限 SuperAdmin） |
| `get-employee-salary` | `empId?`, `yearMonth` | `SalaryDetail` | 個人薪資 |
| **系統日誌** | | | |
| `get-audit-logs` | `limit?` | `AuditLog[]` | 操作稽核日誌（v1.2 新增，限 SuperAdmin） |
| **系統設定（v1.5）** | | | |
| `get-system-config` | — | `SystemConfig` | 讀取薪資費率設定 |
| `update-system-config` | `config` | `SystemConfig` | 更新設定（限 SuperAdmin） |
| **打卡紀錄編輯（v1.5）** | | | |
| `update-clock-record` | `recordId`, `clockInTime?`, `clockOutTime?`, `status?`, `note?` | `boolean` | 管理員修改打卡紀錄 |
| **補打卡（v1.5）** | | | |
| `submit-makeup-request` | `date`, `type`, `requestedClockIn?`, `requestedClockOut?`, `reason` | `ClockMakeupRequest` | 提交補打卡申請 |
| `get-employee-makeup-requests` | — | `ClockMakeupRequest[]` | 個人補打卡紀錄 |
| `get-makeup-requests` | — | `ClockMakeupRequest[]` | 全部補打卡（限 Admin） |
| `approve-makeup-request` | `requestId`, `status`, `approverName`, `rejectReason?` | `boolean` | 審核補打卡 |
| **通知（v1.5）** | | | |
| `get-notifications` | `limit?` | `Notification[]` | 個人通知列表 |
| `mark-notification-read` | `notificationId` | `boolean` | 標記已讀 |
| `mark-all-notifications-read` | — | `number` | 全部標記已讀 |
| **排班衝突（v1.5 / v2.0 升級）** | | | |
| `check-schedule-conflicts` | `yearMonth` | `ScheduleConflict[]` | 排班衝突偵測；v2.0 升級為（1）兩頭班 > 2 段（2）應到人數不足（3）營運日無 staffA（4）30 分鐘區段覆蓋率不足 |
| **假別餘額（v1.6）** | | | |
| `get-leave-balance` | `empId?` | `LeaveBalance[]` | 依勞基法計算特休/事假/病假餘額 |
| **開放排班（v1.6）** | | | |
| `create-open-shift` | `date`, `shiftTime`, `requiredCount`, `note?` | `OpenShift` | 建立開放排班（限 Admin） |
| `list-open-shifts` | `onlyOpen?` | `OpenShift[]` | 列出開放排班 |
| `claim-open-shift` | `shiftId` | `boolean` | 員工認領班次（Transaction） |
| `release-open-shift` | `shiftId` | `boolean` | 員工釋出班次 |
| `delete-open-shift` | `shiftId` | `boolean` | 刪除開放排班（限 Admin） |

---

## 7. 前端頁面與元件

### 7.1 頁面路由

| 條件 | 頁面 |
|------|------|
| 未登入 | `LoginPage` |
| 登入 + role = SuperAdmin / Admin | `AdminDashboard` |
| 登入 + role = Employee | `EmployeeDashboard` |

### 7.2 AdminDashboard 子頁面

| View Key | 元件 | 功能 | 權限 |
|----------|------|------|------|
| `overview` | `AdminOverview` | 總覽儀表板 | Admin+ |
| `schedule` | `ScheduleManager` | 排班管理（v1.1 逐日制 + 時段編輯 + 套用模板） | Admin+ |
| `comparison` | `ScheduleComparison` | 排班對照表 | Admin+ |
| `attendance` | `AttendanceLog` | 出勤紀錄（含 CSV 匯出） | Admin+ |
| `leave` | `LeaveApprovalQueue` | 請假審核 | Admin+ |
| `employees` | `EmployeeManager` | 員工管理（含密碼重設） | Admin+ |
| `salary` | `SalaryCalculation` | 薪資計算（含 CSV 匯出 + 薪資條下載 v1.6） | **SuperAdmin** |
| `auditLog` | `AuditLogViewer` | 系統操作日誌（v1.2） | **SuperAdmin** |
| `systemSettings` | `SystemSettings` | 系統設定（費率等，v1.5） | **SuperAdmin** |
| `makeupApproval` | `MakeupApprovalQueue` | 補打卡審核（v1.5） | Admin+ |
| `openShifts` | `OpenShiftManager` | 開放排班管理（v1.6） | Admin+ |
| `myClock` | `ClockIn` | 我的打卡（v1.1） | Admin+ |
| `myLeave` | `LeaveRequestForm` | 我的請假（v1.1） | Admin+ |
| `myRecords` | `MyRecords` | 我的出勤紀錄（v1.1） | Admin+ |
| `mySalary` | `MySalary` | 我的薪資（v1.1 + 薪資條下載 v1.6） | Admin+ |
| `myMakeup` | `ClockMakeupForm` | 補打卡申請（v1.5） | Admin+ |
| `myLeaveBalance` | `MyLeaveBalance` | 假別餘額（v1.6） | Admin+ |
| `myOpenShifts` | `OpenShiftPicker` | 認領班次（v1.6） | Admin+ |

### 7.3 EmployeeDashboard 子頁面

| View Key | 元件 | 功能 |
|----------|------|------|
| `clock` | `ClockIn` | 打卡（IP/GPS） |
| `schedule` | `MyScheduleCalendar` | 我的班表 |
| `fullSchedule` | `FullScheduleCalendar` | 總班表 |
| `openShifts` | `OpenShiftPicker` | 認領開放班次（v1.6） |
| `records` | `MyRecords` | 打卡紀錄 |
| `leave` | `LeaveRequestForm` | 請假申請（含餘額顯示 v1.6） |
| `leaveBalance` | `MyLeaveBalance` | 假別餘額（v1.6） |
| `makeup` | `ClockMakeupForm` | 補打卡申請（v1.5） |
| `salary` | `MySalary` | 薪資明細（含薪資條下載 v1.6） |

---

## 8. 已知問題與限制

### 8.1 使用者提出的 6 項問題

| 編號 | 問題 | 嚴重度 | 影響範圍 | 現況描述 |
|------|------|--------|---------|---------|
| **#1** | ~~預設假人名自動帶入~~ | ~~高~~ | ~~排班、薪資~~ | **v1.1 已修正** — 初始化改為空白模板 + 預設管理員帳號（ADMIN），不再寫入假人名。 |
| **#2** | ~~班表無法選擇上班時段~~ | ~~高~~ | ~~排班管理~~ | **v1.1 已修正** — EditModal 新增時段選擇器（開始/結束時間），並顯示班別時數和排班摘要。 |
| **#3** | ~~休館日無正職值班機制~~ | ~~中~~ | ~~排班管理~~ | **v1.2 已修正** — 新增「休館(值班)」狀態，可安排正職值班，工時計入薪資。 |
| **#4** | ~~值班人員連動每週~~ | ~~高~~ | ~~排班管理~~ | **v1.1 已修正** — 排班改為逐日制（dailySchedule collection），修改單日不影響其他日期。模板保留作為批次套用功能。 |
| **#5** | ~~管理員無打卡/請假~~ | ~~高~~ | ~~全系統~~ | **v1.1 已修正** — AdminDashboard 新增「我的功能」區塊，含打卡、請假、出勤紀錄、薪資明細。 |
| **#6** | ~~無 Super Admin 層級~~ | ~~中~~ | ~~權限、薪資~~ | **v1.2 已修正** — 新增 SuperAdmin 角色，薪資計算頁和系統日誌僅 SuperAdmin 可見。 |

### 8.2 安全性問題

| 編號 | 問題 | 位置 |
|------|------|------|
| A1 | ~~密碼明文儲存與顯示~~ | **v1.2 已修正** — scrypt 雜湊儲存，移除 alert 顯示密碼 |
| A2 | ~~密碼強度僅 4 字元~~ | **v1.2 已修正** — 8 字元+英文+數字 |
| A3 | ~~登入無防暴力破解~~ | **v1.2 已修正** — 5 次失敗鎖定 15 分鐘 |
| A4 | ~~IP 驗證寫死假資料~~ | **v1.1 已修正** — 後端從 `x-forwarded-for` header 取得真實 IP |
| A5 | CSV 匯出含未脫敏個資 | `AttendanceLog.tsx`, `SalaryCalculation.tsx` |
| A6 | ~~無操作稽核紀錄~~ | **v1.2 已修正** — auditLogs collection，管理操作自動記錄 |

### 8.3 功能缺陷（依 v1.4 Roadmap 重整後）

**v1.2 已修正：**
- ✅ 排班：逐日排班（v1.1）、班別時段編輯（v1.1）、休館值班（v1.2）
- ✅ 管理員打卡/請假（v1.1）

**客戶 2026-04-10 回報（已整併至 Phase 3）：**
| 編號 | 客戶需求 | 整併後位置 |
|------|---------|-----------|
| ① | 正職月薪無法從員工管理介面設定 | Phase 3.1 |
| ② | AttendanceLog 唯讀，管理員無法修正打卡 | Phase 3.2 |
| ③ | 員工忘記打卡無補救機制 | Phase 3.3 |

**Phase 3 已修正（v1.5）：**
- ✅ 3.1 薪資設定完善（月薪欄位 + systemConfig 費率設定）
- ✅ 3.2 打卡紀錄管理（遲到/早退自動判定 + 管理員編輯）
- ✅ 3.3 補打卡申請流程
- ✅ 3.4 請假日期驗證 + 駁回理由
- ✅ 3.5 排班衝突偵測 API
- ✅ 3.6 通知機制

**Phase 4 已修正（v1.6）：**
- ✅ 4.1 假別餘額管理（依勞基法年資計算特休 + 前後端超額檢查）
- ✅ 4.2 員工自選班表（openShifts collection + Transaction 認領/釋出）
- ✅ 4.3 薪資條列印/下載（可列印 HTML + 瀏覽器另存 PDF）
- ✅ 4.4 ErrorBoundary + UI 統一化（Logo 本地化、響應式 sidebar、底部 nav 可滑動）

**客戶 V2 第二輪回報（已於 v2.0 解決）：**
| 編號 | 客戶需求 | 對應修正 |
|------|---------|---------|
| V2-1a | 假人名修改後仍在資料庫殘留 | Phase 5.5「清空 dailySchedule + scheduleTemplate」工具 |
| V2-1b | 管理員無法設定當日「應到人數」 | Phase 5.2 `requiredHeadcount` 欄位 + 警示 |
| V2-2 | 無法為每員工選個別上班時段 | Phase 5.1 `StaffShift[]` 資料模型 |
| V2-3 | 專責人員需要兩頭班 | Phase 5.1 允許同員工同日 ≤ 2 段 |
| V2-4 | 休館(值班)排兼職不會顯示在日曆 | Phase 5.4 修 bug |
| V2-5 | 兼職人員時段是否能調整 | Phase 5.1 每筆 shift 可獨立設定 from/to |

**Phase 5 已完成（v2.0）：**
- ✅ 5.1 ScheduleEvent → StaffShift[] 資料模型重構（含 normalize 相容層）
- ✅ 5.2 應到人數 + 30 分鐘區段覆蓋檢核
- ✅ 5.3 排班時間軸視覺化 + 班次列表編輯 + 覆蓋率條
- ✅ 5.4 休館(值班) 兼職顯示
- ✅ 5.5 清空排班資料工具（取代 v1→v2 migration）
- ✅ 5.6 薪資 / 遲到 / 打卡比對遷移到 shifts
- ✅ 5.8 排班衝突即時警告（前端整合）

**Phase 6/7/8 待處理：** 詳見 [SDD_v2_PROPOSAL.md](./SDD_v2_PROPOSAL.md) § 3 / [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) Phase 6-8。

---

## 9. 變更紀錄

| 日期 | 版本 | 變更內容 |
|------|------|---------|
| 2026-04-08 | v1.0 | 初版建立，記錄系統現況及所有已知問題 |
| 2026-04-08 | v1.1 | Phase 1 完成：(1) 移除預設假人名，改為空白模板+預設管理員帳號 (2) 排班改為逐日制（dailySchedule collection），保留模板作為批次套用 (3) 排班 Modal 新增時段編輯、營運狀態切換、排班摘要 (4) 管理員後台新增「我的打卡/請假/紀錄/薪資」功能 (5) IP 驗證改為從後端 header 取得真實 IP |
| 2026-04-08 | v1.2 | Phase 2 完成：(1) 新增 SuperAdmin 角色，薪資計算頁僅 SuperAdmin 可見，後端 API 權限檢查 (2) 密碼改為 scrypt 雜湊儲存，舊密碼登入時自動升級，強度要求 8 字元+英數，登入失敗 5 次鎖定 15 分鐘，移除密碼明文顯示 (3) 新增 auditLogs collection，管理操作自動記錄，SuperAdmin 可查看系統日誌 (4) 新增「休館(值班)」狀態，休館日可安排正職值班，工時納入薪資計算 |
| 2026-04-09 | v1.2.1 | 修正 `initialize-database` 在既有資料庫環境無法建立 SuperAdmin 帳號的問題；改為獨立檢查 scheduleTemplate 與 ADMIN 是否存在，並以 scrypt 雜湊儲存預設密碼 |
| 2026-04-09 | v1.3 | 文件同步 — 將 SDD 資料模型、權限表、API 清單、頁面子視圖、功能缺陷清單全面更新至 Phase 1+2 實際程式狀態；新增 Phase 3/4 待處理清單 |
| 2026-04-10 | v1.4 | Roadmap 重整 — 客戶回報三項需求（正職月薪、管理員改打卡、補打卡）整併至 Phase 3；原 Phase 4.2 補打卡提前為 3.3；Phase 3 從 5 項擴充為 6 項（3.1 薪資設定完善、3.2 打卡紀錄管理、3.3 補打卡、3.4 請假驗證、3.5 排班衝突、3.6 通知）；Phase 4 重新編號為 4.1~4.4 |
| 2026-04-10 | v2.0 | **排班模型重構（v2.0 核心 / Phase 5 完成）**：(1) 5.1 ScheduleEvent 改為 `shifts: StaffShift[]`，每員工獨立時段，支援兩頭班 ≤ 2 段，移除 staffA/staffB/partTime/shiftTime；後端 `normalizeScheduleDoc` 自動轉換 v1 舊資料（不回寫）(2) 5.2 `requiredHeadcount` 應到人數 + 30 分鐘區段覆蓋檢核（僅警示不阻擋）(3) 5.3 排班時間軸視覺化（橫向時間刻度 + 員工色塊 + 覆蓋率條）+ 班次列表編輯器 (4) 5.4 修 bug — 休館(值班) 兼職在日曆顯示 (5) 5.5 `reset-all-schedule` 清空工具（取代 v1→v2 migration，決策 4）(6) 5.6 薪資計算 / 遲到判定 / 打卡比對全部遷移到 shifts (7) 5.8 排班衝突即時警告前端整合。Vitest 51 個測試全綠（從 36 → +15 含 normalize / 兩頭班 / shiftHours / 覆蓋率）。 |
| 2026-04-10 | v1.6 | Phase 4 全部完成：(1) 4.1 假別餘額管理 — 依勞基法年資計算特休天數，前後端餘額檢查，MyLeaveBalance 頁面，LeaveRequestForm 內嵌餘額顯示 (2) 4.2 員工自選班表 — openShifts collection，Transaction 認領/釋出，自動同步 dailySchedule.partTime，管理端 OpenShiftManager，員工端 OpenShiftPicker (3) 4.3 薪資條列印下載 — openPayslipPrintView 可列印 HTML，員工/管理端皆有下載按鈕 (4) 4.4 ErrorBoundary 包覆全 App，Logo 改為本地文字，AdminDashboard sidebar 響應式（手機漢堡選單），EmployeeDashboard 底部 nav 可水平滑動 |
| 2026-04-09 | v1.5 | Phase 3 全部完成：(1) 3.1 Employee.monthlySalary 欄位 + systemConfig/salary collection + SystemSettings 頁面（SuperAdmin），費率/PT 上限/遲到寬限改為設定化 (2) 3.2 打卡自動比對排班判定遲到/早退，AttendanceLog 新增編輯功能（update-clock-record），ClockRecord 擴充 note/manuallyEdited/source/editedBy/editedAt (3) 3.3 補打卡申請流程：makeupRequests collection、員工 ClockMakeupForm、管理端 MakeupApprovalQueue，核准後自動寫入 clockRecords (4) 3.4 請假前後端日期驗證，駁回必填理由（rejectReason） (5) 3.5 check-schedule-conflicts API（重複排班 + 營運日無 A） (6) 3.6 notifications collection + NotificationBell 元件（請假/補打卡核准/駁回自動通知，60s 輪詢） |
