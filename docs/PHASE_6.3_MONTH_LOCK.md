# Phase 6.3 — 月結鎖定工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex 或 Claude
> **預估工期：** 0.5–1 天（含單元測試 + typecheck + build + 手動驗收）
> **對應 Roadmap：** Phase 6.3（A 批基礎建設）
> **對應 SDD 議題：** 無對應（新功能）
> **依賴：** 無（A 批可平行）；後續 B 批的 8.4 月結報表、6.2 版本歷史、6.1 換班 都會依賴本票

---

## 1. 目標

每月薪資 SuperAdmin 在 `SalaryCalculation` 算完按「結算並鎖定」後，該月所有出勤、排班、請假、補打卡相關的「修改」操作必須一律擋下。否則會計交給人事的數字 vs 系統當下查詢的數字不一致，月結等於沒結。

本工單目標：

1. 新增 `monthLocks` collection，每月一份文件（ID = `YYYY-MM`），記錄誰鎖、何時鎖、總金額快照
2. 新增 4 個後端 actions：`lock-month`、`unlock-month`、`get-month-lock`、`list-month-locks`
3. 在 6 個既有 actions 加入「鎖定檢查」邏輯：`update-schedule`、`update-clock-record`、`approve-leave`、`approve-makeup-request`、`clock-in`、`clock-out`
   - 前 4 個：鎖定後完全擋下
   - 後 2 個（打卡）：不擋（員工今天打卡天經地義），但寫入 `note` 標記「月結後打卡」供管理員警示
4. `SalaryCalculation.tsx` 加入鎖定狀態 UI（鎖頭 icon、結算按鈕、SuperAdmin 解鎖按鈕含必填理由）
5. 依 D2 決策：SuperAdmin 可強制解鎖，但必填理由，並寫入 `auditLogs`
6. Vitest 新增 ≥ 4 個測試覆蓋鎖定 helper 與邊界條件

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| Firestore collections | 13 個 | 14 個（新增 `monthLocks`） |
| API actions | 50+ | +4（lock/unlock/get/list） |
| 鎖定檢查覆蓋 actions | 0 | 6（update-schedule、update-clock-record、approve-leave、approve-makeup-request、clock-in、clock-out） |
| Vitest 總數 | 67 | ≥ 71 |
| typecheck / build / 既有測試 | 全綠 | 全綠（67 個既有測試不可動） |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **修改** — 新增 `MonthLock` interface |
| `netlify/functions/utils/monthLock.ts` | **新增** — `isMonthLocked` / `canModifyOnDate` pure helper |
| `netlify/functions/api.ts` | **修改** — 加 4 個 actions + 6 處鎖定檢查 |
| `components/admin/SalaryCalculation.tsx` | **修改** — 鎖頭 UI + 結算按鈕 + 解鎖按鈕 + Modal |
| `services/googleAppsScriptAPI.ts` | **修改** — 加 4 個 API client function |
| `tests/monthLock.test.ts` | **新增** — Vitest 測試（≥ 4 個） |

**不要動：**
- ❌ 既有 67 個 Vitest 測試
- ❌ `vite.config.ts`
- ❌ `netlify/functions/utils/calculations.ts`（薪資算法不變）
- ❌ `netlify/functions/utils/firebaseAdmin.ts`
- ❌ 其他 admin 元件（不是這張票範圍）

---

## 3. 實作規格

### 3.1 `types.ts` 新增型別

在檔尾追加：

```typescript
// 月結鎖定（Phase 6.3）
export interface MonthLock {
    yearMonth: string;          // "YYYY-MM"（同時也是文件 ID）
    lockedBy: string;           // empId
    lockedByName: string;       // 操作者姓名（冗餘儲存供顯示）
    lockedAt: string;           // ISO timestamp
    totalAmount: number;        // 鎖定當下的薪資總額（grossSalary 加總，快照用）
    employeeCount: number;      // 鎖定當下的員工數（快照）
    // 解鎖欄位（僅當解鎖時填入）
    unlockedBy?: string;
    unlockedByName?: string;
    unlockedAt?: string;
    unlockReason?: string;      // 必填，解鎖理由
}
```

### 3.2 `netlify/functions/utils/monthLock.ts`（新檔）

**為何拉出 helper？** `canModifyOnDate` 需要被 6 個 actions 共用，且要能在 Vitest 跑（與 `calculations.ts` 同目錄、同模式）。

```typescript
/**
 * 月結鎖定 — 純函數，無 I/O
 * Phase 6.3
 */
import type { MonthLock } from '../../../types';

/**
 * 將 "YYYY-MM-DD" 或 ISO 日期取出月份 key "YYYY-MM"
 */
export const getMonthKey = (date: string): string => {
    if (!date || date.length < 7) return '';
    return date.slice(0, 7);
};

/**
 * 判斷某月份是否被鎖定
 * - 文件不存在 → false
 * - 文件存在且 unlockedAt 未填 → true（已鎖定）
 * - 文件存在且有 unlockedAt → false（已解鎖）
 */
export const isMonthLocked = (lock: MonthLock | null | undefined): boolean => {
    if (!lock) return false;
    if (lock.unlockedAt) return false;   // 已解鎖
    return true;
};

/**
 * 判斷某日期是否可以修改（用於 update-schedule / approve-leave 等）
 * - 取 date 的月份 key
 * - 查 locks map 中對應月份
 * - 若鎖定 → 不可修改
 *
 * 邊界：鎖定月「最後一天」也算在該月內，必須擋
 *   canModifyOnDate("2026-04-30", { "2026-04": {...locked} }) → false（不能改）
 *   canModifyOnDate("2026-05-01", { "2026-04": {...locked} }) → true（可以改）
 */
export const canModifyOnDate = (
    date: string,
    locks: Record<string, MonthLock | null | undefined>
): boolean => {
    const monthKey = getMonthKey(date);
    if (!monthKey) return true;          // 無效日期不擋（其他層應已 fail）
    const lock = locks[monthKey];
    return !isMonthLocked(lock);
};
```

### 3.3 `netlify/functions/api.ts` 後端改動

#### 3.3.1 import 新 helper（檔頭）

```typescript
import { getMonthKey, isMonthLocked } from './utils/monthLock';
import type { MonthLock } from '../../types';
```

#### 3.3.2 新增 helper（放在 `getSystemConfig` 旁邊）

```typescript
const getMonthLock = async (yearMonth: string): Promise<MonthLock | null> => {
    const snap = await db.collection('monthLocks').doc(yearMonth).get();
    if (!snap.exists) return null;
    return snap.data() as MonthLock;
};

// 給 6 個 actions 共用：擋下「修改鎖定月份資料」的請求
const assertMonthNotLocked = async (date: string): Promise<{ locked: boolean; lock?: MonthLock }> => {
    const monthKey = getMonthKey(date);
    if (!monthKey) return { locked: false };
    const lock = await getMonthLock(monthKey);
    if (isMonthLocked(lock!)) return { locked: true, lock: lock! };
    return { locked: false };
};
```

#### 3.3.3 新增 4 個 actions

放在「系統設定」區塊後、「補打卡申請」之前（檔案約 950 行附近）：

```typescript
// ==================== 月結鎖定（Phase 6.3）====================

case 'lock-month': {
    if (!isSuperAdmin) return fail(403, '僅最高管理者可鎖定月結');
    const yearMonth = data.yearMonth as string;
    if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return fail(400, 'yearMonth 格式錯誤（需 YYYY-MM）');
    // 重複鎖定檢查
    const existing = await getMonthLock(yearMonth);
    if (isMonthLocked(existing!)) return fail(400, `${yearMonth} 已鎖定`);
    // 計算當下薪資總額作為快照
    const empSnap = await db.collection('employees').get();
    const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Employee[];
    const sysConfig = await getSystemConfig();
    let totalAmount = 0;
    let employeeCount = 0;
    for (const emp of employees) {
        if (emp.status !== '在職' && emp.status !== '留停') continue;
        const detail = await calculateSalaryForEmployee(db, emp, yearMonth, sysConfig);
        totalAmount += detail.grossSalary;
        employeeCount++;
    }
    // 取得操作者姓名
    const meSnap = await db.collection('employees').doc(uid).get();
    const lockedByName = meSnap.exists ? meSnap.data()!.name : uid;
    const lock: MonthLock = {
        yearMonth,
        lockedBy: uid,
        lockedByName,
        lockedAt: new Date().toISOString(),
        totalAmount: Math.round(totalAmount),
        employeeCount,
    };
    await db.collection('monthLocks').doc(yearMonth).set(lock);
    await writeAuditLog(uid, '鎖定月結', yearMonth, `總額 ${Math.round(totalAmount)} / ${employeeCount} 人`);
    return ok(lock);
}

case 'unlock-month': {
    if (!isSuperAdmin) return fail(403, '僅最高管理者可解鎖月結');
    const yearMonth = data.yearMonth as string;
    const reason = (data.reason as string || '').trim();
    if (!yearMonth) return fail(400, '缺少 yearMonth');
    if (reason.length < 5) return fail(400, '解鎖理由至少 5 字');
    const existing = await getMonthLock(yearMonth);
    if (!existing) return fail(404, `${yearMonth} 尚未鎖定`);
    if (!isMonthLocked(existing)) return fail(400, `${yearMonth} 已是解鎖狀態`);
    const meSnap = await db.collection('employees').doc(uid).get();
    const unlockedByName = meSnap.exists ? meSnap.data()!.name : uid;
    await db.collection('monthLocks').doc(yearMonth).update({
        unlockedBy: uid,
        unlockedByName,
        unlockedAt: new Date().toISOString(),
        unlockReason: reason,
    });
    await writeAuditLog(uid, '解鎖月結', yearMonth, `理由：${reason}`);
    return ok(true);
}

case 'get-month-lock': {
    const yearMonth = data.yearMonth as string;
    if (!yearMonth) return fail(400, '缺少 yearMonth');
    const lock = await getMonthLock(yearMonth);
    return ok(lock);
}

case 'list-month-locks': {
    if (!isAdmin) return fail(403, '僅管理者可查看鎖定歷史');
    const snap = await db.collection('monthLocks').get();
    const list = snap.docs.map(d => d.data() as MonthLock);
    list.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    return ok(list);
}
```

#### 3.3.4 6 個既有 actions 加鎖定檢查

**3.3.4.1 `update-schedule`** — 完全擋

在 `await db.collection('dailySchedule').doc(dateStr).set(...)` 之前插入：

```typescript
const lockChk = await assertMonthNotLocked(dateStr);
if (lockChk.locked) return fail(423, `${getMonthKey(dateStr)} 月結已鎖定，無法修改排班`);
```

**3.3.4.2 `update-clock-record`** — 完全擋

在取得 orig.date 後、`await ref.update(updates)` 之前插入：

```typescript
const lockChk = await assertMonthNotLocked(orig.date);
if (lockChk.locked) return fail(423, `${getMonthKey(orig.date)} 月結已鎖定，無法修改打卡紀錄`);
```

**3.3.4.3 `approve-leave`** — 完全擋（用 `startDate` 判斷）

```typescript
const leaveDate = (lr.startDate || '').slice(0, 10);
const lockChk = await assertMonthNotLocked(leaveDate);
if (lockChk.locked) return fail(423, `${getMonthKey(leaveDate)} 月結已鎖定，無法審核該月請假`);
```

**3.3.4.4 `approve-makeup-request`** — 完全擋

```typescript
const lockChk = await assertMonthNotLocked(req.date);
if (lockChk.locked) return fail(423, `${getMonthKey(req.date)} 月結已鎖定，無法審核該月補打卡`);
```

**3.3.4.5 `clock-in`** — **不擋，留 note**

```typescript
const lockChk = await assertMonthNotLocked(today);
const lockedNote = lockChk.locked
    ? `[警示] 月結後打卡 ${today}（${lockChk.lock?.yearMonth} 已鎖定）`
    : '';
await db.collection('clockRecords').add({
    empId: uid,
    name: empName,
    date: today,
    clockInTime,
    clockOutTime: null,
    verificationMethod: data.verificationMethod,
    verificationData,
    workHours: null,
    status,
    ...(lockedNote ? { note: lockedNote, manuallyEdited: true, editedBy: 'system' } : {}),
});
```

**3.3.4.6 `clock-out`** — **不擋，留 note**

```typescript
const recDate = docSnap.data().date;
const lockChk = await assertMonthNotLocked(recDate);
const lockedNote = lockChk.locked
    ? `[警示] 月結後下班打卡（${getMonthKey(recDate)} 已鎖定）`
    : '';
// 在 update() 的 payload 加：
//   ...(lockedNote ? { note: ((docSnap.data().note || '') + ' ' + lockedNote).trim() } : {})
```

> **HTTP status 423 Locked** 是語意正確的選擇（WebDAV 標準），前端可區分 403/423。

### 3.4 `services/googleAppsScriptAPI.ts` Client 函式

仿照既有風格新增：

```typescript
export const apiLockMonth = async (yearMonth: string) =>
    callApi<MonthLock>('lock-month', { yearMonth });

export const apiUnlockMonth = async (yearMonth: string, reason: string) =>
    callApi<boolean>('unlock-month', { yearMonth, reason });

export const apiGetMonthLock = async (yearMonth: string) =>
    callApi<MonthLock | null>('get-month-lock', { yearMonth });

export const apiListMonthLocks = async () =>
    callApi<MonthLock[]>('list-month-locks');
```

（請依現有檔案實際的 helper 名稱調整 `callApi`，比照既有匯出風格）

### 3.5 `components/admin/SalaryCalculation.tsx` UI 改動

#### 3.5.1 載入鎖定狀態

```tsx
const [monthLock, setMonthLock] = useState<MonthLock | null>(null);
const [lockBusy, setLockBusy] = useState(false);
const isLocked = !!monthLock && !monthLock.unlockedAt;

const { user } = useAuth();
const isSuperAdmin = user?.role === UserRole.SuperAdmin;
```

並行 fetch lock：

```tsx
useEffect(() => {
    const fetch = async () => {
        setLoading(true);
        const [data, lock] = await Promise.all([
            apiGetAllSalaryDetails(month),
            apiGetMonthLock(month),
        ]);
        setSalaries(data);
        setMonthLock(lock);
        setLoading(false);
    };
    fetch();
}, [month]);
```

#### 3.5.2 鎖頭 icon + 結算/解鎖按鈕

在標題列「📥 完整匯出」按鈕之後追加：

```tsx
{isLocked && (
    <span className="flex items-center gap-1 px-3 py-2 bg-amber-100 text-amber-800 rounded-md text-sm font-medium">
        🔒 已鎖定（{monthLock!.lockedByName} ‧ {monthLock!.lockedAt.slice(0, 10)}）
    </span>
)}
{!isLocked && monthLock?.unlockedAt && (
    <span className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-600 rounded-md text-sm">
        🔓 曾解鎖（{monthLock.unlockedByName}）
    </span>
)}

{isSuperAdmin && !isLocked && salaries.length > 0 && (
    <button
        onClick={async () => {
            const totalGrossNow = salaries.reduce((s, x) => s + x.grossSalary, 0);
            const confirmed = window.confirm(
                `確定要結算並鎖定 ${month}?\n\n` +
                `員工數: ${salaries.length}\n應發總額: ${formatCurrency(totalGrossNow)}\n\n` +
                `鎖定後，本月排班、打卡編輯、請假審核、補打卡審核都會被擋下。\n` +
                `如需修改需 SuperAdmin 手動解鎖（會留稽核紀錄）。`
            );
            if (!confirmed) return;
            setLockBusy(true);
            try {
                const lock = await apiLockMonth(month);
                setMonthLock(lock);
                alert(`已鎖定 ${month}`);
            } catch (e: any) {
                alert(`鎖定失敗：${e.message || e}`);
            } finally {
                setLockBusy(false);
            }
        }}
        disabled={lockBusy}
        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
    >
        🔐 結算並鎖定
    </button>
)}

{isSuperAdmin && isLocked && (
    <button
        onClick={async () => {
            const reason = window.prompt(
                `確定要解鎖 ${month}?\n\n` +
                `解鎖會留下稽核紀錄。請填寫解鎖理由（至少 5 字）：`
            );
            if (!reason || reason.trim().length < 5) {
                if (reason !== null) alert('理由至少 5 字');
                return;
            }
            setLockBusy(true);
            try {
                await apiUnlockMonth(month, reason.trim());
                const fresh = await apiGetMonthLock(month);
                setMonthLock(fresh);
                alert(`已解鎖 ${month}`);
            } catch (e: any) {
                alert(`解鎖失敗：${e.message || e}`);
            } finally {
                setLockBusy(false);
            }
        }}
        disabled={lockBusy}
        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
    >
        🔓 解鎖
    </button>
)}
```

按鈕樣式比照頁面內既有風格（綠色 = 安全操作、灰色 = 次要操作、紅色 = 重要操作），**不新增 Tailwind class**。

### 3.6 `tests/monthLock.test.ts`（新檔，≥ 4 個）

```typescript
import { describe, it, expect } from 'vitest';
import { getMonthKey, isMonthLocked, canModifyOnDate } from '../netlify/functions/utils/monthLock';
import type { MonthLock } from '../types';

const lockedFor = (ym: string): MonthLock => ({
    yearMonth: ym,
    lockedBy: 'ADMIN',
    lockedByName: '系統管理員',
    lockedAt: '2026-05-01T00:00:00Z',
    totalAmount: 500000,
    employeeCount: 5,
});

const unlockedFor = (ym: string): MonthLock => ({
    ...lockedFor(ym),
    unlockedBy: 'ADMIN',
    unlockedByName: '系統管理員',
    unlockedAt: '2026-05-02T00:00:00Z',
    unlockReason: '會計補正',
});

describe('getMonthKey', () => {
    it('取 YYYY-MM-DD 的前 7 碼', () => {
        expect(getMonthKey('2026-04-30')).toBe('2026-04');
        expect(getMonthKey('2026-04-01')).toBe('2026-04');
    });
    it('空字串 / 無效輸入回空字串', () => {
        expect(getMonthKey('')).toBe('');
        expect(getMonthKey('abc')).toBe('');
    });
});

describe('isMonthLocked', () => {
    it('null / undefined → 未鎖定', () => {
        expect(isMonthLocked(null)).toBe(false);
        expect(isMonthLocked(undefined)).toBe(false);
    });
    it('有 lock 且無 unlockedAt → 鎖定', () => {
        expect(isMonthLocked(lockedFor('2026-04'))).toBe(true);
    });
    it('有 lock 且有 unlockedAt → 解鎖', () => {
        expect(isMonthLocked(unlockedFor('2026-04'))).toBe(false);
    });
});

describe('canModifyOnDate', () => {
    const locks = { '2026-04': lockedFor('2026-04') };

    it('鎖定月內任何日期都不可修改', () => {
        expect(canModifyOnDate('2026-04-01', locks)).toBe(false);
        expect(canModifyOnDate('2026-04-15', locks)).toBe(false);
    });
    it('鎖定月最後一天（邊界）也要擋', () => {
        expect(canModifyOnDate('2026-04-30', locks)).toBe(false);
    });
    it('鎖定月隔日（5 月 1 日）可以修改', () => {
        expect(canModifyOnDate('2026-05-01', locks)).toBe(true);
    });
    it('查無 lock 記錄的月份可以修改', () => {
        expect(canModifyOnDate('2026-03-15', locks)).toBe(true);
    });
    it('已解鎖月份可以修改', () => {
        const unlockedMap = { '2026-04': unlockedFor('2026-04') };
        expect(canModifyOnDate('2026-04-15', unlockedMap)).toBe(true);
    });
});
```

---

## 4. 驗收條件

### 4.1 量化（CI 自動跑）

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 71 個測試全綠**（67 + 4 新增） |
| 3 | `npm run build` | 無 chunk size 警告，無新增 warning |

### 4.2 程式碼審查

- [ ] `monthLock.ts` 是純函數（無 firebase / I/O / react import）
- [ ] 6 個 actions 鎖定檢查都用 `assertMonthNotLocked` helper，不重新實作
- [ ] `lock-month` 與 `unlock-month` 都 SuperAdmin only，403 訊息明確
- [ ] `unlock-month` 強制要求 `reason.length >= 5`，並寫 `auditLogs`
- [ ] HTTP status 423 用於「被鎖定無法操作」，不是 403（語意正確）
- [ ] `clock-in` / `clock-out` **不** return 423，只在 note 標警示
- [ ] UI 鎖頭 icon、結算/解鎖按鈕只有 SuperAdmin 看得到

### 4.3 手動煙霧測試（npm run dev）

| # | 步驟 | 期望 |
|---|------|------|
| 1 | SuperAdmin 進「薪資計算」，選 2026-04，點「🔐 結算並鎖定」 | 跳 confirm 顯示員工數 + 應發總額；確認後鎖頭 icon 出現 |
| 2 | 同個帳號去「排班管理」改 2026-04-15 的班 | 跳出「2026-04 月結已鎖定，無法修改排班」 |
| 3 | 去「出勤紀錄」點 2026-04 某筆紀錄 → 編輯打卡時間 | 跳出 423 錯誤訊息 |
| 4 | 去「請假審核」核准一筆 startDate=2026-04-20 的請假 | 跳出 423 錯誤訊息 |
| 5 | 改 2026-05 的排班、打卡、請假 | 全部正常通過（5 月未鎖） |
| 6 | SuperAdmin 點「🔓 解鎖」，理由填「test」（< 5 字） | 跳「理由至少 5 字」 |
| 7 | 填「會計帳目補正」後解鎖 | 鎖頭 icon 消失；改回「曾解鎖」徽章 |
| 8 | 解鎖後再改 2026-04 的排班 | 通過 |
| 9 | 查 AuditLogViewer | 看到「鎖定月結」與「解鎖月結（理由：會計帳目補正）」兩筆 |
| 10 | 用一般 Admin 帳號進薪資頁 | 看不到「🔐 結算並鎖定」與「🔓 解鎖」按鈕 |

---

## 5. Commit message 模板

```
feat(month-lock): SuperAdmin month-end lock for salary close-out (Phase 6.3)

- Add MonthLock interface to types.ts
- Add netlify/functions/utils/monthLock.ts pure helpers
  (getMonthKey / isMonthLocked / canModifyOnDate)
- Add 4 API actions:
  - lock-month (SuperAdmin) — snapshot grossSalary total + employeeCount
  - unlock-month (SuperAdmin) — requires reason >= 5 chars, audited
  - get-month-lock — any authed
  - list-month-locks (Admin)
- Add lock checks (HTTP 423) to 6 existing actions:
  update-schedule, update-clock-record, approve-leave,
  approve-makeup-request, clock-in (note only), clock-out (note only)
- SalaryCalculation.tsx: lock badge + 結算並鎖定 button + 解鎖 button
  (SuperAdmin only, with confirm dialogs)
- Add tests/monthLock.test.ts — ≥ 4 tests covering boundary dates
  (71 Vitest total all green)
- D2: SuperAdmin can force unlock with mandatory reason → auditLog

Closes Phase 6.3
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 鎖定狀態下擋 `clock-in` / `clock-out` 整支 | 員工今天就是要打卡，擋了系統死掉；只在 note 標警示 |
| 改 `calculateSalaryForEmployee` 算法 | 月結快照取算法當下結果即可，算法本身不動 |
| 在前端做鎖定檢查（disable 全頁編輯按鈕） | 多餘且不安全；後端 423 是真實守門員，前端只在薪資頁顯示鎖頭 |
| 在 ScheduleManager / AttendanceLog / LeaveApprovalQueue 加 UI 提示 | 後續工單再做，這張票只負責「鎖定建立 + 後端擋」 |
| 順便重構 SalaryCalculation 的 CSV 匯出 | 7.7 已完成，這張票只加按鈕 |
| 把 lockedAt 改成 Firestore Timestamp 而非 ISO string | 全專案統一用 ISO，請維持風格 |
| 加密碼/二次驗證才能解鎖 | 過度設計；reason + auditLog 已足夠 |

---

## 7. 完工回報格式

```
Phase 6.3 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 71 | __ |
| build 警告 | 無 | __ |
| 4 個新 actions | 全部上線 | __ |
| 6 個 actions 鎖定檢查 | 全部加上 | __ |
| 結算/解鎖按鈕 | SuperAdmin only | __ |

新增測試：monthLock.test.ts ___ 個案例

手動煙霧測試：
- [ ] 4.3 § 1–10 全勾

備註：
```

---

## 8. 後續可能 follow-up（不是這張工單的範圍）

- B 批 8.4「月結報表」會讀取 `monthLocks` 顯示「該月已鎖定」徽章
- B 批 6.2「排班版本歷史」鎖定時順便 snapshot 當月 `dailySchedule` 到 `scheduleVersions/{yearMonth}`
- B 批 6.1「換班/替班」需新增鎖定檢查（鎖了不能換班）
- 自動鎖定排程（每月 5 號自動鎖上個月）— 需 Netlify scheduled function
- 部分鎖定（鎖薪資但不鎖排班）— 目前是「全有全無」
- 鎖定後 `get-all-salary-details` 直接回傳鎖定當下的 snapshot
