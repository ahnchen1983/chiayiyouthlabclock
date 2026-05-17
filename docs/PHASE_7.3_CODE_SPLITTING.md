# Phase 7.3 — Code Splitting 工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（前端規劃）
> **負責實作：** Codex
> **預估工期：** 半天（含 typecheck / build / 截圖驗收）
> **對應 Roadmap：** Phase 7.3
> **依賴：** 無（純前端、不動資料模型、不動 API、不動測試）

---

## 1. 目標

把 `AdminDashboard` 與 `EmployeeDashboard` 的子 view 改成 lazy load，解掉 Vite build 的 chunk size 警告（目前 503KB > 500KB 預設閾值），讓初次登入只下載「目前要看的那一頁」。

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 主 entry chunk gzip 後 | 127 KB | < 80 KB（拆掉所有 view 後） |
| 主 entry chunk 原始 | 503 KB | < 200 KB |
| Vite build 警告 | ⚠️ chunk size > 500KB | ✅ 無警告 |
| view 切換時是否額外載入 | 否（已全部 bundle） | 是（lazy chunk 載入 < 100ms） |

---

## 2. 改動範圍

只動 **兩個檔案**，其他不要碰：

| 檔案 | 動作 |
|------|------|
| `pages/AdminDashboard.tsx` | 18 個子 view static import → `React.lazy` |
| `pages/EmployeeDashboard.tsx` | 9 個子 view static import → `React.lazy` |

**不要動**：
- ❌ 任何 `components/admin/*.tsx` 或 `components/employee/*.tsx`（子 view 內容不變）
- ❌ `vite.config.ts`（不需要 manualChunks，React.lazy 已足夠）
- ❌ `NotificationBell` / `ChangePasswordModal` / `icons`（這些是頭部常駐元件，保持 static import）
- ❌ `AuthContext`、`ErrorBoundary`（核心 wrapper，必須在主 bundle）

---

## 3. 實作規格

### 3.1 AdminDashboard.tsx

**現況（第 5–22 行）：**

```tsx
import AdminOverview from '../components/admin/AdminOverview';
import ScheduleManager from '../components/admin/ScheduleManager';
import AttendanceLog from '../components/admin/AttendanceLog';
import LeaveApprovalQueue from '../components/admin/LeaveApprovalQueue';
import EmployeeManager from '../components/admin/EmployeeManager';
import ScheduleComparison from '../components/admin/ScheduleComparison';
import SalaryCalculation from '../components/admin/SalaryCalculation';
import AuditLogViewer from '../components/admin/AuditLogViewer';
import SystemSettings from '../components/admin/SystemSettings';
import MakeupApprovalQueue from '../components/admin/MakeupApprovalQueue';
import OpenShiftManager from '../components/admin/OpenShiftManager';
import ClockIn from '../components/employee/ClockIn';
import LeaveRequestForm from '../components/employee/LeaveRequestForm';
import MyRecords from '../components/employee/MyRecords';
import MySalary from '../components/employee/MySalary';
import ClockMakeupForm from '../components/employee/ClockMakeupForm';
import MyLeaveBalance from '../components/employee/MyLeaveBalance';
import OpenShiftPicker from '../components/employee/OpenShiftPicker';
```

**改為：**

```tsx
import { lazy, Suspense } from 'react';
// （上面 React import 加 lazy / Suspense；如果已 `import React, { useState }`，就改成
//   `import React, { useState, lazy, Suspense } from 'react';`）

const AdminOverview        = lazy(() => import('../components/admin/AdminOverview'));
const ScheduleManager      = lazy(() => import('../components/admin/ScheduleManager'));
const AttendanceLog        = lazy(() => import('../components/admin/AttendanceLog'));
const LeaveApprovalQueue   = lazy(() => import('../components/admin/LeaveApprovalQueue'));
const EmployeeManager      = lazy(() => import('../components/admin/EmployeeManager'));
const ScheduleComparison   = lazy(() => import('../components/admin/ScheduleComparison'));
const SalaryCalculation    = lazy(() => import('../components/admin/SalaryCalculation'));
const AuditLogViewer       = lazy(() => import('../components/admin/AuditLogViewer'));
const SystemSettings       = lazy(() => import('../components/admin/SystemSettings'));
const MakeupApprovalQueue  = lazy(() => import('../components/admin/MakeupApprovalQueue'));
const OpenShiftManager     = lazy(() => import('../components/admin/OpenShiftManager'));
const ClockIn              = lazy(() => import('../components/employee/ClockIn'));
const LeaveRequestForm     = lazy(() => import('../components/employee/LeaveRequestForm'));
const MyRecords            = lazy(() => import('../components/employee/MyRecords'));
const MySalary             = lazy(() => import('../components/employee/MySalary'));
const ClockMakeupForm      = lazy(() => import('../components/employee/ClockMakeupForm'));
const MyLeaveBalance       = lazy(() => import('../components/employee/MyLeaveBalance'));
const OpenShiftPicker      = lazy(() => import('../components/employee/OpenShiftPicker'));
```

**保留 static import 的**（這些是頭部常駐 / 控制元件，不該 lazy）：

```tsx
import ChangePasswordModal from '../components/ChangePasswordModal';
import NotificationBell from '../components/NotificationBell';
import { DashboardIcon, CalendarIcon, ListIcon, ... } from '../components/icons';
```

### 3.2 包 Suspense

`renderView()` 的返回值整包包一層 Suspense：

```tsx
const renderView = () => {
  switch (currentView) {
    case 'overview': return <AdminOverview />;
    // ... 其他 case 不變
    default: return <AdminOverview />;
  }
};

// main 區塊改為
<main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
  <Suspense fallback={<ViewLoadingFallback />}>
    {renderView()}
  </Suspense>
</main>
```

### 3.3 ViewLoadingFallback 元件

在 `AdminDashboard.tsx` 檔案頂部加一個共用 fallback（不要新建檔，inline 就好）：

```tsx
const ViewLoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center py-20 text-gray-400">
    <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
    <span className="text-sm">載入中…</span>
  </div>
);
```

色系比照系統現有 `brand-green-dark` 風格；spinner 高度刻意保留至少 5rem，避免切換 view 時主區塊高度跳動。

### 3.4 EmployeeDashboard.tsx

同樣處理，9 個 view 全部 lazy：

```tsx
const ClockIn              = lazy(() => import('../components/employee/ClockIn'));
const MyScheduleCalendar   = lazy(() => import('../components/employee/MyScheduleCalendar'));
const FullScheduleCalendar = lazy(() => import('../components/employee/FullScheduleCalendar'));
const MyRecords            = lazy(() => import('../components/employee/MyRecords'));
const LeaveRequestForm     = lazy(() => import('../components/employee/LeaveRequestForm'));
const MySalary             = lazy(() => import('../components/employee/MySalary'));
const ClockMakeupForm      = lazy(() => import('../components/employee/ClockMakeupForm'));
const MyLeaveBalance       = lazy(() => import('../components/employee/MyLeaveBalance'));
const OpenShiftPicker      = lazy(() => import('../components/employee/OpenShiftPicker'));
```

`main` 區塊同樣包 Suspense + ViewLoadingFallback（fallback 元件可在這個檔案再宣告一次，避免 cross-file dependency；或抽到 `components/ViewLoadingFallback.tsx` — Codex 自行決定，但**不要為了抽元件動超過必要範圍**）。

### 3.5 預載優化（選做，若有時間）

打卡是員工最高頻進入的 view。可以在 `EmployeeDashboard` 第一次 render 時，**預載 ClockIn 之外最常用的下一個 view**（例如 `MyScheduleCalendar`），用 idle callback：

```tsx
useEffect(() => {
  const idle = (cb: () => void) =>
    'requestIdleCallback' in window ? requestIdleCallback(cb) : setTimeout(cb, 1000);
  idle(() => { import('../components/employee/MyScheduleCalendar'); });
}, []);
```

非必要。若 Codex 覺得增加複雜度不划算可省略。

---

## 4. 驗收條件

依序執行，全部通過才算完成：

### 4.1 typecheck

```bash
npm run typecheck
```

不應有任何錯誤。`lazy` 回傳的型別應被 TS 自動推斷為對應 component（每個子 view 都有 `export default`，所以開箱即用）。

### 4.2 build

```bash
npm run build
```

**檢查項目：**
- ✅ 沒有 `chunk size larger than 500 KiB` 警告
- ✅ `dist/assets/` 目錄產生**至少 20 個** `.js` chunk（每個 view 一個 + entry + vendor）
- ✅ entry chunk（含 `index-` 前綴的主檔）小於 200 KB raw

### 4.3 test

```bash
npm run test
```

51 個 Vitest 測試應全綠（這次改動不應動到任何測試）。

### 4.4 手動煙霧測試

啟動 `npm run dev`，用 SuperAdmin 與一般 Employee 帳號各登入一次：

| 測試 | 預期結果 |
|------|---------|
| 第一次登入 Admin | overview 出現前可短暫看到 ViewLoadingFallback |
| 切換到「排班管理」 | 出現 fallback < 500ms 後渲染 ScheduleManager，DevTools Network 顯示新 chunk 載入 |
| 切換到「薪資計算」 | 同上，新 chunk |
| 切換回「總覽」 | 不再載入新 chunk（已快取） |
| Employee 登入後切換到「我的班表」 | 出現 fallback 後正常渲染 |
| Network 攔截（DevTools → throttle 4G） | 第一次切換 view 約 300–800ms 看到 fallback；不會白屏 |
| ErrorBoundary | 如果某個 chunk 載入失敗（DevTools block request 模擬），ErrorBoundary 接住並顯示中文錯誤畫面 |

### 4.5 commit message 建議

```
perf(frontend): code-split admin and employee dashboard views (Phase 7.3)

- Convert 18 admin views and 9 employee views to React.lazy
- Add ViewLoadingFallback for Suspense boundary
- Entry chunk: 503KB → ~180KB; no more vite chunk-size warning
- Resolves Roadmap Phase 7.3
```

---

## 5. 風險與緩解

| 風險 | 緩解 |
|------|------|
| chunk 載入失敗（網路抖動） | 已有 `ErrorBoundary` 包覆全 App（v1.6），會接住 chunk error |
| view 切換時主區塊高度跳動 | ViewLoadingFallback 強制 `py-20`，預留空間 |
| 開發環境 HMR 影響 | `lazy` 在 dev 模式照樣 work，Vite HMR 不受影響 |
| 既有測試誤覆蓋 | Vitest 跑的是計算邏輯（`tests/calculations.test.ts`），不會觸發 lazy 載入 |

---

## 6. 後續可能延伸（**這張票不做**）

只列在這給未來參考，本次工單只做 lazy load：

- vite.config.ts 加 `manualChunks` 把 `firebase`、`firebase-admin` 拆出獨立 vendor chunk
- 動態 import recharts / d3 等大圖表庫（目前未使用）
- HTTP/2 server push 預先推送下一個 view

完成本票後，下一張票（建議：6.3 月結鎖定）等 Claude 切新工單。
