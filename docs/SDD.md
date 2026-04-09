# 嘉義青年實驗室打卡系統 — 軟體設計文件 (SDD)

> **版本：** v1.3
> **建立日期：** 2026-04-08
> **最後更新：** 2026-04-09
> **對應程式版本：** commit `ba31961` (Phase 1+2 完成)
> **開發進度：** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ⬜ · Phase 4 ⬜
>
> **相關文件：**
> - [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) — 開發階段規劃
> - [CHANGELOG.md](./CHANGELOG.md) — 完整變更紀錄
> - [VERIFICATION_MANUAL.md](./VERIFICATION_MANUAL.md) — 系統驗證手冊

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

#### `scheduleTemplate` — 排班模板
| 文件 ID | 說明 |
|---------|------|
| "0" | 週日 |
| "1" | 週一 |
| ... | ... |
| "6" | 週六 |

每筆文件欄位：
| 欄位 | 型別 | 說明 |
|------|------|------|
| status | string | `'營運'` / `'休館(值班)'` / `'休館'`（v1.2 新增值班） |
| shiftTime | string | 時段（如 `"08:30-17:30"`） |
| staffA | string | 專責人員 A 姓名 |
| staffB | string | 專責人員 B 姓名 |
| partTime | string[] | 兼職人員姓名陣列 |

#### `dailySchedule` — 逐日排班（Phase 1 新增）
| 文件 ID | 說明 |
|---------|------|
| "YYYY-MM-DD" | 該日班表 |

每筆文件欄位與 `scheduleTemplate` 相同（status, shiftTime, staffA, staffB, partTime）。

查詢邏輯：優先讀取 `dailySchedule/{date}`，不存在則 fallback 到 `scheduleTemplate`（以星期幾為 key）。

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
| status | string | `'正常'` / `'遲到'` / `'早退'` |

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
| `update-schedule` | `event` | `boolean` | 更新排班（v1.1 起寫入 `dailySchedule/{date}`） |
| `apply-template` | `yearMonth` | `boolean` | 批次將 scheduleTemplate 套用到該月（v1.1 新增） |
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
| `salary` | `SalaryCalculation` | 薪資計算（含 CSV 匯出） | **SuperAdmin** |
| `auditLog` | `AuditLogViewer` | 系統操作日誌（v1.2） | **SuperAdmin** |
| `myClock` | `ClockIn` | 我的打卡（v1.1） | Admin+ |
| `myLeave` | `LeaveRequestForm` | 我的請假（v1.1） | Admin+ |
| `myRecords` | `MyRecords` | 我的出勤紀錄（v1.1） | Admin+ |
| `mySalary` | `MySalary` | 我的薪資（v1.1） | Admin+ |

### 7.3 EmployeeDashboard 子頁面

| View Key | 元件 | 功能 |
|----------|------|------|
| `clock` | `ClockIn` | 打卡（IP/GPS） |
| `schedule` | `MyScheduleCalendar` | 我的班表 |
| `fullSchedule` | `FullScheduleCalendar` | 總班表 |
| `records` | `MyRecords` | 打卡紀錄 |
| `leave` | `LeaveRequestForm` | 請假申請 |
| `salary` | `MySalary` | 薪資明細 |

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

### 8.3 功能缺陷（依 Phase 進度更新）

**v1.2 已修正：**
- ✅ 排班：逐日排班（v1.1）、班別時段編輯（v1.1）、休館值班（v1.2）
- ✅ 管理員打卡/請假（v1.1）

**Phase 3 待處理：**
| 模組 | 待補項目 | 對應 Roadmap |
|------|---------|-------------|
| 排班 | 人力不足偵測、排班衝突偵測（staffA≠staffB、PT 80h 上限） | 3.3 |
| 打卡 | 遲到/早退自動判定（比對 shiftTime） | 3.2 |
| 打卡 | 補登申請流程 | 4.2 |
| 請假 | 日期驗證（endDate>startDate、不可過去）、駁回理由 | 3.1 |
| 請假 | 核准/駁回通知機制 | 3.5 |
| 薪資 | 費率設定化（systemConfig collection） | 3.4 |

**Phase 4 待處理：**
| 模組 | 待補項目 | 對應 Roadmap |
|------|---------|-------------|
| 請假 | 假別餘額管理（依年資計算特休） | 4.1 |
| 排班 | 員工自選班表 | 4.3 |
| 薪資 | 薪資條 PDF 下載、月結鎖定 | 4.4 |
| UI/UX | ErrorBoundary、訊息中文化、Logo 本地化、色盲友善、響應式 sidebar | 4.5 |

---

## 9. 變更紀錄

| 日期 | 版本 | 變更內容 |
|------|------|---------|
| 2026-04-08 | v1.0 | 初版建立，記錄系統現況及所有已知問題 |
| 2026-04-08 | v1.1 | Phase 1 完成：(1) 移除預設假人名，改為空白模板+預設管理員帳號 (2) 排班改為逐日制（dailySchedule collection），保留模板作為批次套用 (3) 排班 Modal 新增時段編輯、營運狀態切換、排班摘要 (4) 管理員後台新增「我的打卡/請假/紀錄/薪資」功能 (5) IP 驗證改為從後端 header 取得真實 IP |
| 2026-04-08 | v1.2 | Phase 2 完成：(1) 新增 SuperAdmin 角色，薪資計算頁僅 SuperAdmin 可見，後端 API 權限檢查 (2) 密碼改為 scrypt 雜湊儲存，舊密碼登入時自動升級，強度要求 8 字元+英數，登入失敗 5 次鎖定 15 分鐘，移除密碼明文顯示 (3) 新增 auditLogs collection，管理操作自動記錄，SuperAdmin 可查看系統日誌 (4) 新增「休館(值班)」狀態，休館日可安排正職值班，工時納入薪資計算 |
| 2026-04-09 | v1.2.1 | 修正 `initialize-database` 在既有資料庫環境無法建立 SuperAdmin 帳號的問題；改為獨立檢查 scheduleTemplate 與 ADMIN 是否存在，並以 scrypt 雜湊儲存預設密碼 |
| 2026-04-09 | v1.3 | 文件同步 — 將 SDD 資料模型、權限表、API 清單、頁面子視圖、功能缺陷清單全面更新至 Phase 1+2 實際程式狀態；新增 Phase 3/4 待處理清單 |
