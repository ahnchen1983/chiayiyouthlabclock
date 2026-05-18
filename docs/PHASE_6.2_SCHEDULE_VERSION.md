# Phase 6.2 — 排班版本歷史工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 1–1.5 天
> **對應 Roadmap：** Phase 6.2（B 批，依存 6.3）
> **依賴：** **依存 6.3 lock-month action**；本票會在 `lock-month` 內**追加** snapshot 呼叫

---

## 1. 目標

`dailySchedule/{date}` 只保留**最新狀態**，沒有任何歷史可查；改錯了只能憑記憶倒推、或翻 `auditLogs` 細節文字反推。

本工單目標：

1. 新增 `scheduleVersions` collection，每筆文件記錄某月某時間點的 dailySchedule 完整快照
2. 自動 snapshot 兩個時機：
   - **月結鎖定時**（6.3 `lock-month` 內追加呼叫），`auto: 'month-lock'`
   - **手動「💾 儲存版本」按鈕**，`auto: 'manual'`
3. 新增 4 個後端 actions：`create-schedule-version` / `list-schedule-versions` / `get-schedule-version` / `restore-schedule-version`
4. 抽 `netlify/functions/utils/scheduleVersion.ts` 純函數
5. `ScheduleManager.tsx` 加「📋 版本歷史」抽屜 + 「💾 儲存版本」按鈕
6. 回溯前**檢查該月是否鎖定**，鎖了拒絕；理由必填 ≥ 5 字、寫 `auditLogs`
7. Vitest 新增 ≥ 4 個測試

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| Firestore collections | 14 個 | 15 個 |
| API actions | 50+ | +4 |
| `lock-month` 自動 snapshot | 無 | 有，回填 `MonthLock.snapshotVersionId` |
| Vitest 總數 | 104 | ≥ 108 |
| typecheck / build / 既有測試 | 全綠 | 全綠 |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **改** — `ScheduleVersion` interface + `MonthLock` 加 `snapshotVersionId?` |
| `netlify/functions/utils/scheduleVersion.ts` | **新增** — 純函數 |
| `netlify/functions/api.ts` | **改** — 4 個 actions + `lock-month` 內追加 snapshot 呼叫 |
| `services/googleAppsScriptAPI.ts` | **改** — 加 4 個 client function |
| `components/admin/ScheduleManager.tsx` | **改** — 加版本歷史抽屜、儲存版本按鈕 |
| `tests/scheduleVersion.test.ts` | **新增** — Vitest 測試（≥ 4 個）|

### 對 6.3 `lock-month` 的整合修改（重要）

**僅在 `await db.collection('monthLocks').doc(yearMonth).set(lock);` 之前追加 snapshot 呼叫**，並在 `lock` 物件加 `snapshotVersionId`。**禁止改 lock-month 其他既有邏輯**（薪資快照計算、權限檢查、稽核日誌、回傳值結構都保持不變）。

**不要動：**
- ❌ `lock-month` 內薪資總額計算
- ❌ `unlock-month` / `get-month-lock` / `list-month-locks`
- ❌ 既有的 6 處鎖定檢查
- ❌ `netlify/functions/utils/monthLock.ts`
- ❌ 既有 104 個 Vitest 測試
- ❌ `vite.config.ts`
- ❌ `ScheduleManager.tsx` 既有時間軸視覺化、衝突檢查、套用模板等邏輯

---

## 3. 實作規格

### 3.1 `types.ts` 新增

```typescript
// 排班版本歷史（Phase 6.2）
export interface ScheduleVersionSnapshotEntry {
    status: ScheduleEvent['status'];
    openingHours?: string;
    requiredHeadcount?: number;
    shifts: StaffShift[];
}

export interface ScheduleVersion {
    id: string;
    yearMonth: string;
    snapshot: {
        [date: string]: ScheduleVersionSnapshotEntry;
    };
    auto: 'month-lock' | 'manual';
    createdBy: string;
    createdByName: string;
    createdAt: string;
    note?: string;
}
```

`MonthLock` 追加 optional 欄位（不可改其他欄位）：

```typescript
export interface MonthLock {
    yearMonth: string;
    lockedBy: string;
    lockedByName: string;
    lockedAt: string;
    totalAmount: number;
    employeeCount: number;
    unlockedBy?: string;
    unlockedByName?: string;
    unlockedAt?: string;
    unlockReason?: string;
    // Phase 6.2 新增：鎖定當下自動 snapshot 的版本 ID
    snapshotVersionId?: string;
}
```

### 3.2 `netlify/functions/utils/scheduleVersion.ts`（新檔）

```typescript
/**
 * 排班版本歷史 — 純函數，無 I/O
 * Phase 6.2
 */
import type { ScheduleEvent, ScheduleVersion } from '../../../types';

/**
 * 從 ScheduleEvent[] 建出 snapshot 結構
 */
export const buildSnapshotFromSchedule = (
    events: ScheduleEvent[]
): ScheduleVersion['snapshot'] => {
    const snap: ScheduleVersion['snapshot'] = {};
    for (const e of events || []) {
        if (!e?.date) continue;
        snap[e.date] = {
            status: e.status,
            openingHours: e.openingHours,
            requiredHeadcount: e.requiredHeadcount,
            shifts: Array.isArray(e.shifts) ? e.shifts : [],
        };
    }
    return snap;
};

export interface SnapshotDiff {
    added: string[];     // 當前有、版本沒有
    removed: string[];   // 版本有、當前沒有
    changed: string[];   // 同日期但內容不同
}

/**
 * 比對「當前」與「舊版本」snapshot
 * 用 JSON.stringify 做結構比對
 */
export const diffSnapshot = (
    current: ScheduleVersion['snapshot'],
    version: ScheduleVersion['snapshot']
): SnapshotDiff => {
    const result: SnapshotDiff = { added: [], removed: [], changed: [] };
    const allDates = new Set<string>([
        ...Object.keys(current || {}),
        ...Object.keys(version || {}),
    ]);
    for (const date of allDates) {
        const inCur = !!(current && current[date]);
        const inVer = !!(version && version[date]);
        if (inCur && !inVer) { result.added.push(date); continue; }
        if (!inCur && inVer) { result.removed.push(date); continue; }
        if (inCur && inVer) {
            if (JSON.stringify(current[date]) !== JSON.stringify(version[date])) {
                result.changed.push(date);
            }
        }
    }
    result.added.sort();
    result.removed.sort();
    result.changed.sort();
    return result;
};
```

### 3.3 `api.ts` 後端

#### 3.3.1 import

```typescript
import { buildSnapshotFromSchedule } from './utils/scheduleVersion';
import type { ScheduleVersion } from '../../types';
```

#### 3.3.2 helper

```typescript
const createScheduleVersionInternal = async (
    createdBy: string,
    createdByName: string,
    yearMonth: string,
    auto: 'month-lock' | 'manual',
    note?: string,
): Promise<string> => {
    const events = await getMonthlyDailySchedule(yearMonth);
    const snapshot = buildSnapshotFromSchedule(events);
    const docRef = db.collection('scheduleVersions').doc();
    const version: ScheduleVersion = {
        id: docRef.id,
        yearMonth,
        snapshot,
        auto,
        createdBy,
        createdByName,
        createdAt: new Date().toISOString(),
        ...(note ? { note } : {}),
    };
    await docRef.set(version);
    return docRef.id;
};
```

#### 3.3.3 在 `lock-month` 內追加 snapshot 呼叫

```typescript
// 在 const lockedByName = ... 之後、const lock: MonthLock = {...} 之前插入：
const snapshotVersionId = await createScheduleVersionInternal(
    uid,
    lockedByName,
    yearMonth,
    'month-lock',
);

// lock 物件多加一個欄位：
const lock: MonthLock = {
    yearMonth,
    lockedBy: uid,
    lockedByName,
    lockedAt: new Date().toISOString(),
    totalAmount: Math.round(totalAmount),
    employeeCount,
    snapshotVersionId,   // ← 新增
};
```

#### 3.3.4 新增 4 個 actions（在月結鎖定區塊之後）

```typescript
case 'create-schedule-version': {
    if (!isAdmin) return fail(403, '僅管理者可建立排班版本');
    const yearMonth = data.yearMonth as string;
    const note = (data.note as string | undefined)?.trim() || undefined;
    if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return fail(400, 'yearMonth 格式錯誤');
    const meSnap = await db.collection('employees').doc(uid).get();
    const createdByName = meSnap.exists ? meSnap.data()!.name : uid;
    const versionId = await createScheduleVersionInternal(uid, createdByName, yearMonth, 'manual', note);
    await writeAuditLog(uid, '建立排班版本', `${yearMonth}/${versionId}`, `manual${note ? ` 備註:${note}` : ''}`);
    const snap = await db.collection('scheduleVersions').doc(versionId).get();
    return ok(snap.data() as ScheduleVersion);
}

case 'list-schedule-versions': {
    if (!isAdmin) return fail(403, '僅管理者可查詢版本歷史');
    const yearMonth = data.yearMonth as string;
    if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return fail(400, 'yearMonth 格式錯誤');
    const snap = await db.collection('scheduleVersions')
        .where('yearMonth', '==', yearMonth)
        .get();
    const list = snap.docs.map(d => d.data() as ScheduleVersion);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return ok(list);
}

case 'get-schedule-version': {
    if (!isAdmin) return fail(403, '僅管理者可查看排班版本');
    const versionId = data.versionId as string;
    if (!versionId) return fail(400, '缺少 versionId');
    const snap = await db.collection('scheduleVersions').doc(versionId).get();
    if (!snap.exists) return fail(404, '版本不存在');
    return ok(snap.data() as ScheduleVersion);
}

case 'restore-schedule-version': {
    if (!isSuperAdmin) return fail(403, '僅最高管理者可回溯排班版本');
    const versionId = data.versionId as string;
    const reason = ((data.reason as string) || '').trim();
    if (!versionId) return fail(400, '缺少 versionId');
    if (reason.length < 5) return fail(400, '回溯理由至少 5 字');
    const verSnap = await db.collection('scheduleVersions').doc(versionId).get();
    if (!verSnap.exists) return fail(404, '版本不存在');
    const version = verSnap.data() as ScheduleVersion;
    // 鎖定檢查
    const existingLock = await getMonthLock(version.yearMonth);
    if (existingLock && isMonthLocked(existingLock)) {
        return fail(423, `${version.yearMonth} 月結已鎖定，請先解鎖才能回溯`);
    }
    // 將 snapshot 覆寫回 dailySchedule
    const batch = db.batch();
    let count = 0;
    for (const [dateStr, entry] of Object.entries(version.snapshot)) {
        batch.set(db.collection('dailySchedule').doc(dateStr), {
            status: entry.status,
            openingHours: entry.openingHours,
            requiredHeadcount: entry.requiredHeadcount,
            shifts: entry.shifts || [],
        });
        count++;
        if (count >= 450) { await batch.commit(); count = 0; }
    }
    if (count > 0) await batch.commit();
    await writeAuditLog(
        uid,
        '回溯排班版本',
        `${version.yearMonth}/${versionId}`,
        `理由：${reason}（共 ${Object.keys(version.snapshot).length} 日）`,
    );
    return ok({ restoredDays: Object.keys(version.snapshot).length });
}
```

### 3.4 `services/googleAppsScriptAPI.ts`

```typescript
import { ScheduleVersion } from '../types';

export const apiCreateScheduleVersion = async (yearMonth: string, note?: string): Promise<ScheduleVersion> => {
    return callAPI('create-schedule-version', { yearMonth, note });
};

export const apiListScheduleVersions = async (yearMonth: string): Promise<ScheduleVersion[]> => {
    return callAPI('list-schedule-versions', { yearMonth });
};

export const apiGetScheduleVersion = async (versionId: string): Promise<ScheduleVersion> => {
    return callAPI('get-schedule-version', { versionId });
};

export const apiRestoreScheduleVersion = async (versionId: string, reason: string): Promise<{ restoredDays: number }> => {
    return callAPI('restore-schedule-version', { versionId, reason });
};
```

### 3.5 `ScheduleManager.tsx` UI 改動

加 import / state / 「💾 儲存版本」與「📋 版本歷史」按鈕、抽屜元件 ScheduleVersionDrawer（含 diff view）。

詳細程式碼參考工單原稿（agent 已生成 ~150 行範例 + drawer 元件）。**不重構既有時間軸、EditScheduleModal、衝突檢查邏輯**。

「回溯到此版本」按鈕只有 SuperAdmin 看得到。

### 3.6 `tests/scheduleVersion.test.ts`（新檔，≥ 4 個）

涵蓋：

- `buildSnapshotFromSchedule`：空 schedule、兩頭班、shifts undefined fallback、無 date 忽略
- `diffSnapshot`：相同無差異、added、removed、changed（同日內容不同）

完整測試碼參考工單原稿。

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 108 個全綠** |
| 3 | `npm run build` | 無 warning |

### 4.2 程式碼審查

- [ ] `scheduleVersion.ts` 純函數
- [ ] 4 個 actions 權限：list/get/create = Admin、restore = SuperAdmin
- [ ] `restore` 鎖月檢查使用既有 `getMonthLock` + `isMonthLocked`
- [ ] `restore` 寫 `auditLogs`
- [ ] `lock-month` 內**只新增** `createScheduleVersionInternal` 呼叫與 `snapshotVersionId` 欄位
- [ ] HTTP 423 用於「該月已鎖定無法回溯」
- [ ] `ScheduleManager.tsx` 既有邏輯**完全未動**
- [ ] 「回溯」按鈕 SuperAdmin only

### 4.3 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | Admin 進「排班管理」選 2026-06，點「💾 儲存版本」 | 跳「已儲存版本」 |
| 2 | 點「📋 版本歷史」 | 抽屜開啟，看到剛建立的版本 |
| 3 | 改 2026-06-15 班次後儲存 | 排班生效 |
| 4 | 「檢視」剛剛版本 | diff 區塊顯示 2026-06-15 在「內容不同」 |
| 5 | 一般 Admin 看不到「回溯」按鈕 | SuperAdmin only |
| 6 | SuperAdmin 回溯 → 填理由「test」 | 跳「理由至少 5 字」 |
| 7 | 填「改回上週版本」 → 回溯 | 6/15 排班恢復 |
| 8 | AuditLogViewer 看到「回溯排班版本」 | 對 |
| 9 | SuperAdmin 鎖定 2026-06 | 版本歷史多一筆 `🔒 月結快照` |
| 10 | 已鎖定下嘗試回溯 | 跳 423 |
| 11 | Firestore `monthLocks/2026-06` | 有 `snapshotVersionId` 欄位 |

---

## 5. Commit message 模板

```
feat(schedule): version history with snapshot + restore (Phase 6.2)

- Add ScheduleVersion interface to types.ts
- Extend MonthLock with optional snapshotVersionId
- Add netlify/functions/utils/scheduleVersion.ts pure helpers
  (buildSnapshotFromSchedule / diffSnapshot)
- Add 4 API actions:
  - create-schedule-version (Admin) — manual snapshot with optional note
  - list-schedule-versions (Admin) — desc by createdAt
  - get-schedule-version (Admin)
  - restore-schedule-version (SuperAdmin) — requires reason >= 5 chars,
    blocked by month lock (HTTP 423), audited
- Hook lock-month: auto-snapshot before writing monthLocks doc,
  store snapshotVersionId on the lock (no other lock-month changes)
- ScheduleManager.tsx: add 💾 儲存版本 + 📋 版本歷史 drawer
  with diff view; existing schedule editing logic untouched
- Add tests/scheduleVersion.test.ts — 4 tests

Depends on Phase 6.3. Closes Phase 6.2
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 改 `lock-month` 內薪資快照計算或權限檢查 | 只能追加 snapshot 呼叫 |
| 改其他 6.3 actions | 與本票無關 |
| 改 `ScheduleManager.tsx` 既有 EditModal / 時間軸 / 衝突檢查 | 只加版本歷史相關 UI |
| 動 `scheduleTemplate` 也追版本 | 本票只追 `dailySchedule` |
| 每次 `update-schedule` 都 snapshot | 會爆量 |
| 主動刪舊版本 | 留給 follow-up cron |
| 把 diff view 做成逐欄細節 | 簡易日期清單即可 |
| 改 `vite.config.ts` 或既有 104 個測試 | 嚴禁 |
| 把 `snapshotVersionId` 設必填 | 舊 lock 沒這欄 |

---

## 7. 完工回報格式

```
Phase 6.2 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 108 | __ |
| build 警告 | 無 | __ |
| 4 個新 actions | 全部上線 | __ |
| lock-month 整合 snapshot | snapshotVersionId 有寫入 | __ |
| 6.3 既有邏輯未改 | 對 | __ |
| 回溯按鈕 SuperAdmin only | 對 | __ |
| 鎖定後拒絕回溯（423） | 對 | __ |

新增測試：___ 個案例

手動煙霧測試：- [ ] 4.3 § 1–11 全勾

備註：
```

---

## 8. 後續可能 follow-up

- Cron 清理舊版本（保留所有 month-lock 版本）
- Diff view 進階化（逐日 shifts 逐筆比對）
- 匯出版本 JSON
- 版本標籤系統（自訂 tag）
- 回溯預覽（先預覽再執行）
- `scheduleTemplate` 版本歷史
