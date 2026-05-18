# Phase 6.1 — 換班/替班申請工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 1–2 天
> **對應 Roadmap：** Phase 6.1
> **對應 SDD 議題：** § 4.2 排班模組
> **依賴：** **6.3 月結鎖定**（必須先完成）；本票使用 `assertMonthNotLocked` / `canModifyOnDate` / `getMonthKey`
> **對應 EXECUTION_PLAN：** D1（3 階段審核）

---

## 1. 目標

目前換班只能員工自行 LINE 群組橋好 → 私訊管理員 → 管理員手動改 dailySchedule，零稽核、零留痕、易爭議。

本工單目標：

1. 提供員工自助發起「換班/替班申請」流程（新增 `shiftSwapRequests` collection）
2. 採 **D1 三階段審核**：發起人 A → 對方 B 確認 → Admin 核可 → 系統自動執行 shift 交換
3. 每階段狀態變更自動寫入 `notifications`
4. 換班生效僅修改 `dailySchedule.shifts`，**不**動 schema
5. **每個狀態轉換都先呼叫 `assertMonthNotLocked`**
6. 拆純函數 `netlify/functions/utils/shiftSwap.ts`；新增 ≥ 5 個單元測試

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| Firestore collections | 14 | 15（新增 `shiftSwapRequests`） |
| API actions | 54+ | +5 |
| 員工 dashboard view | 9 | 10（+`shiftSwap`） |
| Admin dashboard view | 既有 | +1（`shiftSwapApproval`） |
| Vitest 總數 | 104 | ≥ 109 |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **改** — `ShiftSwapStatus` + `ShiftSwapRequest` + 5 個 NotificationType |
| `netlify/functions/utils/shiftSwap.ts` | **新增** — `validateSwapRequest` / `executeSwap` 純函數 |
| `netlify/functions/api.ts` | **改** — 加 5 個 actions |
| `services/googleAppsScriptAPI.ts` | **改** — 加 5 個 client function |
| `components/employee/ShiftSwapRequestForm.tsx` | **新增** |
| `components/employee/ShiftSwapInbox.tsx` | **新增** |
| `components/admin/ShiftSwapApprovalQueue.tsx` | **新增** |
| `components/employee/MyScheduleCalendar.tsx` | **改** — 加「⇄ 換班」入口 |
| `pages/EmployeeDashboard.tsx` | **改** — view `shiftSwap` + lazy + NavItem |
| `pages/AdminDashboard.tsx` | **改** — view `shiftSwapApproval` + lazy + NavItem |
| `tests/shiftSwap.test.ts` | **新增** — Vitest（≥ 5 個） |

**不要動：**
- `vite.config.ts`
- 既有 104 個 Vitest 測試
- `ScheduleEvent` / `StaffShift` schema（**只修改 shifts 陣列內容**）
- `monthLock.ts`（直接 import）
- 既有 `update-schedule` / `apply-template` actions

---

## 3. 實作規格

### 3.1 `types.ts` 新增型別

```typescript
// 換班/替班申請（Phase 6.1）
export type ShiftSwapStatus =
    | 'awaiting-peer'       // 等對方確認
    | 'awaiting-admin'      // 對方同意，等管理員核可
    | 'approved'            // 已生效
    | 'rejected-by-peer'    // 對方拒絕
    | 'rejected-by-admin'   // 管理員駁回
    | 'cancelled';

export interface ShiftSwapRequest {
    id: string;
    fromEmpId: string;
    fromName: string;
    fromDate: string;
    fromShiftIndex: number;

    toEmpId: string;
    toName: string;
    toDate: string;
    toShiftIndex: number;

    reason: string;
    status: ShiftSwapStatus;
    createdAt: string;

    peerResponseAt?: string;
    peerRejectReason?: string;

    adminResponseBy?: string;
    adminResponseByName?: string;
    adminResponseAt?: string;
    adminRejectReason?: string;
}
```

並在 NotificationType union 加入：
- `'shift-swap-requested'`
- `'shift-swap-peer-agreed'`
- `'shift-swap-peer-rejected'`
- `'shift-swap-approved'`
- `'shift-swap-rejected'`

### 3.2 狀態機

```
                       ┌──────────────────┐
                       │  A 發起 submit   │
                       └────────┬─────────┘
                                ▼
                       ┌──────────────────┐
                  ┌────│  awaiting-peer   │────┐
   A cancel       │    └────────┬─────────┘    │ B reject + reason
                  ▼             ▼              ▼
           ┌──────────┐  ┌──────────────┐  ┌──────────────────┐
           │ cancelled│  │awaiting-admin│  │rejected-by-peer  │
           └──────────┘  └──────┬───────┘  └──────────────────┘
                                │
            A cancel │ Admin approve │ Admin reject
                     │      │       │
                  ┌──▼┐  ┌──▼──────┐  ┌──▼────────────────┐
                  │canc│  │approved │  │rejected-by-admin  │
                  └────┘  └─────────┘  └───────────────────┘

進入 approved 前：再次 assertMonthNotLocked(fromDate, toDate)
進入 approved 時：原子交換 shifts[fromShiftIndex] ⇄ shifts[toShiftIndex] 的 empId/name
```

**重要：** `submit` + `peer-respond agree` + `admin-approve` 三點都要 `assertMonthNotLocked`。

### 3.3 `shiftSwap.ts`（新檔）

```typescript
/**
 * 換班申請 — 純函數，無 I/O
 * Phase 6.1
 */
import type { ScheduleEvent, ShiftSwapRequest, MonthLock } from '../../../types';
import { canModifyOnDate, getMonthKey } from './monthLock';

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * 驗證換班申請是否合法
 * 規則：
 * 1. fromEmpId !== toEmpId
 * 2. reason >= 5 字
 * 3. fromDate / toDate 月份皆未鎖
 * 4. schedule[fromDate].shifts[fromShiftIndex] 存在且 empId 匹配
 * 5. schedule[toDate].shifts[toShiftIndex] 存在且 empId 匹配
 */
export const validateSwapRequest = (
    req: Pick<ShiftSwapRequest, 'fromEmpId' | 'fromDate' | 'fromShiftIndex' |
                                  'toEmpId' | 'toDate' | 'toShiftIndex' | 'reason'>,
    schedule: Record<string, ScheduleEvent | undefined>,
    locks: Record<string, MonthLock | null | undefined>
): ValidationResult => {
    if (req.fromEmpId === req.toEmpId) {
        return { valid: false, error: '不能與自己換班' };
    }
    if (!req.reason || req.reason.trim().length < 5) {
        return { valid: false, error: '原因至少 5 字' };
    }
    if (!canModifyOnDate(req.fromDate, locks)) {
        return { valid: false, error: `${getMonthKey(req.fromDate)} 月結已鎖定，無法換班` };
    }
    if (!canModifyOnDate(req.toDate, locks)) {
        return { valid: false, error: `${getMonthKey(req.toDate)} 月結已鎖定，無法換班` };
    }
    const fromDay = schedule[req.fromDate];
    const toDay   = schedule[req.toDate];
    const fromShift = fromDay?.shifts?.[req.fromShiftIndex];
    const toShift   = toDay?.shifts?.[req.toShiftIndex];
    if (!fromShift) return { valid: false, error: `${req.fromDate} 找不到 index ${req.fromShiftIndex} 的班次` };
    if (!toShift)   return { valid: false, error: `${req.toDate} 找不到 index ${req.toShiftIndex} 的班次` };
    if (fromShift.empId !== req.fromEmpId) return { valid: false, error: '發起人非該班次的擁有者' };
    if (toShift.empId   !== req.toEmpId)   return { valid: false, error: '對方非該班次的擁有者' };
    return { valid: true };
};

/**
 * 執行交換：回傳兩份新的 ScheduleEvent
 * 僅交換 shift 的 empId / name（role / from / to 不動）
 * 同日 swap 時 fromDay 與 toDay 指向同一物件，呼叫者要去重
 */
export const executeSwap = (
    schedule: Record<string, ScheduleEvent>,
    req: Pick<ShiftSwapRequest, 'fromDate' | 'fromShiftIndex' | 'toDate' | 'toShiftIndex' |
                                  'fromEmpId' | 'fromName' | 'toEmpId' | 'toName'>
): { fromDay: ScheduleEvent; toDay: ScheduleEvent } => {
    // 深 clone fromDay 與 toDay（同日時只 clone 一份）
    const isSameDay = req.fromDate === req.toDate;
    const fromDay = JSON.parse(JSON.stringify(schedule[req.fromDate])) as ScheduleEvent;
    const toDay = isSameDay ? fromDay : JSON.parse(JSON.stringify(schedule[req.toDate])) as ScheduleEvent;

    // 交換 empId / name
    fromDay.shifts[req.fromShiftIndex].empId = req.toEmpId;
    fromDay.shifts[req.fromShiftIndex].name = req.toName;
    toDay.shifts[req.toShiftIndex].empId = req.fromEmpId;
    toDay.shifts[req.toShiftIndex].name = req.fromName;

    return { fromDay, toDay };
};
```

**為何只交換 `empId` / `name`：** 班表的 role / time 是「該日該班次的職務需求」，員工是被指派到那個職務。

### 3.4 5 個後端 actions

**3.4.1 `submit-shift-swap`**（員工）：
- `uid !== payload.toEmpId`
- assertMonthNotLocked(fromDate, toDate)
- 撈兩天班表 → 用 `validateSwapRequest` 驗證
- 寫入 `shiftSwapRequests` 文件、發通知給對方、auditLog

**3.4.2 `peer-respond-shift-swap`**（員工，僅對方可）：
- `req.toEmpId === uid && req.status === 'awaiting-peer'`
- 同意：再次 assertMonthNotLocked（B 同意瞬間可能月剛被鎖）→ 改狀態 → 通知所有 Admin
- 拒絕：必填 reason ≥ 2 字 → 改狀態 → 通知發起人

**3.4.3 `admin-approve-shift-swap`**（Admin+）：
- `req.status === 'awaiting-admin'`
- 核准：生效前再 assertMonthNotLocked → 再 validate 一次 → 用 `executeSwap` → batch.set 雙日（同日去重）→ 雙方通知
- 駁回：reason ≥ 2 字 → 雙方通知

**3.4.4 `cancel-shift-swap`**（員工，僅發起人）：
- `req.fromEmpId === uid && status in [awaiting-peer, awaiting-admin]`

**3.4.5 `list-shift-swap-requests`**（依角色）：
- `mode = 'mine' | 'admin-pending' | 'admin-all'`
- 員工：自己發起的 + 等自己確認的（去重）
- Admin：`admin-pending` 只看 `awaiting-admin`；`admin-all` 看全部

完整實作碼參考工單原稿（agent 已生成 ~150 行詳細範例）。

### 3.5 UI 元件

#### `ShiftSwapRequestForm.tsx`（員工）

4 步流程：
1. 選自己某天某班次（從 `apiGetEmployeeSchedule(year, month)`）
2. 選對方員工（排除自己）
3. 選對方某天某班次
4. 填理由（textarea，≥ 5 字）

#### `ShiftSwapInbox.tsx`（員工）

兩個 section：
- **待我確認**：顯示卡片、「同意」「拒絕（含 reason）」按鈕
- **我發起的**：狀態 badge（6 種顏色區分）、`awaiting-*` 顯示「取消」按鈕、駁回時顯示對方/Admin 留言

#### `ShiftSwapApprovalQueue.tsx`（Admin）

比照 `LeaveApprovalQueue.tsx` 模式：
- Tabs：「待核可」/「全部歷史」
- 卡片：發起人 ⇄ 對方、雙方日期+班次、原因、對方同意時間
- 按鈕：「核准」「駁回（必填理由）」

#### `MyScheduleCalendar.tsx` 改動

每個 cell（有自己班次的日期）右下角加小按鈕「⇄ 換班」，點擊跳轉 `setView('shiftSwap')` 並預填 date + shiftIndex。

### 3.6 Dashboard 整合

```tsx
// EmployeeDashboard.tsx
const ShiftSwapPage = lazy(() => import('../components/employee/ShiftSwapPage'));
// 或拆兩個元件做 wrapper
<NavItem view="shiftSwap" icon={<CalendarIcon className="w-6 h-6" />} label="換班申請" />

// AdminDashboard.tsx
const ShiftSwapApprovalQueue = lazy(() => import('../components/admin/ShiftSwapApprovalQueue'));
<NavItem view="shiftSwapApproval" icon={<CalendarIcon className="w-6 h-6" />} label="換班審核" />
```

### 3.7 `tests/shiftSwap.test.ts`（≥ 5 個）

涵蓋：

- `validateSwapRequest`：合法 / 自己跟自己 / shiftIndex 不存在 / 月份已鎖 / reason < 5 字
- `executeSwap`：基本交換、兩頭班同日 swap、role/time 不變

完整測試碼參考工單原稿。

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 109 個全綠** |
| 3 | `npm run build` | 無 warning |

### 4.2 程式碼審查

- [ ] `shiftSwap.ts` 純函數（只 import `monthLock` 與 types）
- [ ] `submit` 與 `admin-approve` **都**呼叫 `assertMonthNotLocked`
- [ ] `peer-respond` 在「同意」時**也**再 assert 一次
- [ ] 5 個狀態變更都呼叫 `writeNotification` + `writeAuditLog`
- [ ] `executeSwap` 只交換 `empId` / `name`，不動 `role` / `from` / `to`
- [ ] 同日兩頭班 swap 時 `batch.set` 只寫一次（去重）
- [ ] `cancel` 只允許發起人本人且狀態為 `awaiting-*`
- [ ] `list` 員工模式不會看到他人之間的申請

### 4.3 手動 e2e 三方煙霧測試

開三個瀏覽器分頁（A、B、Admin），走完整流程：

| # | 操作者 | 步驟 | 期望 |
|---|--------|------|------|
| 1 | A | 發起換班（5/20 ⇄ B 的 5/21，理由「家裡有事」） | 提示「等待對方確認」 |
| 2 | B | 鈴鐺 +1，收件匣看到 A 邀請 | 顯示完整 |
| 3 | B | 拒絕但留空 reason | 擋下 |
| 4 | B | 填理由 → 拒絕 | 狀態 `rejected-by-peer` |
| 5 | A | 收到通知，顯示對方理由 | 對 |
| 6 | A | 再發起，B 同意 | 狀態 `awaiting-admin` |
| 7 | Admin | 收到通知，「換班審核」queue 有 1 筆 | 對 |
| 8 | Admin | 核准 | 雙方 dailySchedule 已交換、雙方通知「已核准生效」 |
| 9 | A & B | 看「我的班表」 | 雙方班表已對調 |
| 10 | SuperAdmin | 鎖定 5 月 → A 發 5/20 ⇄ 5/21 | 擋下 423 |
| 11 | A | 跨月發起（5/20 ⇄ 6/05），5 月已鎖 | 擋下 |
| 12 | A | 發起後立刻取消 | `cancelled`，不通知 |

### 4.4 邊界與並發

- [ ] B 同意瞬間，Admin 同時鎖月 → Admin 核可時被擋（423）
- [ ] Admin 核可瞬間 dailySchedule 被改 → 跳「班表狀態已變動」

---

## 5. Commit message 模板

```
feat(scheduling): shift swap with 3-stage approval (Phase 6.1)

- types.ts: add ShiftSwapStatus + ShiftSwapRequest + 5 NotificationType
- netlify/functions/utils/shiftSwap.ts: validateSwapRequest + executeSwap
  pure helpers (delegates lock check to monthLock helper from Phase 6.3)
- api.ts: 5 new actions
  - submit-shift-swap (employee, asserts month not locked)
  - peer-respond-shift-swap (target only, re-asserts lock on agree)
  - admin-approve-shift-swap (Admin+, re-asserts + re-validates + batch-writes)
  - cancel-shift-swap (originator, awaiting-* only)
  - list-shift-swap-requests (mine | admin-pending | admin-all)
- writeNotification + writeAuditLog hooked at every state transition
- 3 new components: ShiftSwapRequestForm / ShiftSwapInbox / ShiftSwapApprovalQueue
- MyScheduleCalendar: add ⇄ entry button per own shift
- Dashboard integration: new view + NavItem
- tests/shiftSwap.test.ts: 7 unit tests covering validation + execution
- Depends on Phase 6.3

Implements D1 decision (3-stage approval). Closes Phase 6.1
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 改 `ScheduleEvent` / `StaffShift` schema | 只動 shifts 內容 |
| 改 `update-schedule` / `apply-template` | 不在範圍 |
| 改 `monthLock.ts` | 直接 import 使用 |
| 加自動超時失效 | follow-up |
| 加多人換班鏈 | follow-up |
| 加 Push / Email | follow-up |
| 動 `vite.config.ts` 或既有 104 個測試 | 嚴禁 |
| 順便重構 LeaveApprovalQueue | 只比照不動原檔 |
| 對方拒絕後 reset 同一張再用 | 一張一個生命週期 |

---

## 7. 完工回報格式

```
Phase 6.1 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 109 | __ |
| build 警告 | 無 | __ |
| 新增 collection | shiftSwapRequests | __ |
| 新增 API actions | 5 | __ |
| 新增前端元件 | 3 | __ |
| 月鎖整合處 | submit + peer-agree + admin-approve | __ |

新增測試：shiftSwap.test.ts ___ 個案例

e2e 煙霧測試：
- [ ] § 1–5  A 發起 → B 拒絕
- [ ] § 6–9  A 重發 → B 同意 → Admin 核准 → 雙方班表對調
- [ ] § 10   月鎖後發起被擋（423）
- [ ] § 11   跨月（其中一月已鎖）被擋
- [ ] § 12   A 取消成功

邊界：
- [ ] B 同意 + 同時月鎖 → Admin 核可被擋
- [ ] Admin 核可瞬間班表被改 → 跳錯誤

備註：
```

---

## 8. 後續可能 follow-up

- 自動超時失效（72h 對方未回應 → 自動 cancelled）
- 多人換班鏈（A ↔ B ↔ C）
- Push Notification（FCM / Web Push）
- 「常用換班對象」推薦
- 班表變動偵測（swap 後 Admin 又改 → 通知雙方）
- 匯出換班紀錄 CSV（比照 7.7 PII masking）
- 同部門限制
