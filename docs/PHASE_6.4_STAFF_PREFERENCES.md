# Phase 6.4 — 員工偏好班次設定工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex 或 Claude
> **預估工期：** 0.5–1 天
> **對應 Roadmap：** Phase 6.4（Phase 6 最後一張）
> **對應 EXECUTION_PLAN：** C3 — 員工偏好班次（**僅警示不阻擋**）
> **依存：** Phase 5.1 StaffShift[] 結構、Phase 6.3 月結鎖定（複用 `assertMonthNotLocked`）

---

## 1. 目標

目前 Admin 在 `ScheduleManager` EditModal 排班時，員工選單只有姓名與職位，沒有「這個人這天不能上 / 偏好不要上」的資訊。員工口頭跟主管反映「禮拜六不能來」「6/15 那天家裡有事」之類的需求只能靠記憶 / Slack 訊息追蹤，排錯了會引發換班要求或缺勤。

本工單目標：

1. **員工自助設定偏好**：固定每週幾不可上、特定日期不可上、特定日期偏好上、自由備註
2. **Admin 排班 UI 即時顯示提示**：在 EditModal 員工下拉與班次列表中顯示「⚠️ 偏好不上班」「💚 偏好上班」標記
3. **僅警示、不阻擋儲存**（沿用 5.2 應到人數、6.3 解鎖的決策原則）
4. **Audit log**：員工更新自己偏好 / Admin 看到他人偏好都不需 log；只在 Admin 「忽略偏好排班」時提示（不強制）
5. **純函數測試 ≥ 6 個**

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 員工偏好設定頁 | 無 | 新增 `MyPreferences` |
| Firestore collection | — | +1 `staffPreferences/{empId}` |
| 後端 actions | — | +3（get-mine / update-mine / get-all） |
| 排班 UI 偏好提示 | 無 | EditModal 員工旁顯示警告/偏好標記 |
| Vitest 總數 | 169 | ≥ 175 |
| typecheck / build / 既有測試 | 全綠 | 全綠 |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **加** — `StaffPreference` interface |
| `netlify/functions/utils/staffPreferences.ts` | **新增** — 純驗證 + 匹配函數 |
| `netlify/functions/api.ts` | **改** — 加 3 個 actions（讀我自己、寫我自己、Admin 讀全部） |
| `services/googleAppsScriptAPI.ts` | **改** — 加 3 個 client helpers |
| `components/employee/MyPreferences.tsx` | **新增** — 員工偏好設定頁 |
| `components/admin/ScheduleManager.tsx` | **改** — EditModal 員工下拉旁加偏好標記 |
| `pages/AdminDashboard.tsx` | **改** — 加 `myPreferences` view（我的功能區） |
| `pages/EmployeeDashboard.tsx` | **改** — 加 `preferences` view |
| `tests/staffPreferences.test.ts` | **新增** — ≥ 6 個測試 |

**不要動：**

- ❌ `vite.config.ts`
- ❌ `monthLock.ts` / `calculations.ts` / `scheduleVersion.ts`
- ❌ `update-schedule` 既有兩頭班檢查邏輯
- ❌ 不要把偏好升級為「強制阻擋」（決策已敲定為警示）
- ❌ 既有 169 個 Vitest 測試
- ❌ 不安裝新套件
- ❌ 不做附件 / 申請審核 / 通知（員工偏好不需走審核）
- ❌ 不做 admin 端批次匯出 / 排班自動建議
- ❌ 不在 `clock-in` / `clock-out` 加偏好檢查（這純粹是排班輔助）

---

## 3. 資料模型

### 3.1 `types.ts` 新增

```ts
// 員工偏好班次設定（Phase 6.4）
// 僅警示，不影響後端排班儲存
export interface StaffPreference {
    empId: string;                       // 文件 ID = empId
    blockedWeekdays: number[];           // 0=日, 1=一, ..., 6=六；不可上班的星期
    blockedDates: string[];              // YYYY-MM-DD；特定不可上班日期
    preferredDates: string[];            // YYYY-MM-DD；偏好上班日期（非強制）
    note?: string;                       // 自由備註（≤ 200 字）
    updatedAt?: string;                  // ISO；後端寫入
}
```

### 3.2 Firestore collection

`staffPreferences/{empId}`，欄位即 `StaffPreference`。**不需要 migration**；無設定的員工 = 「無偏好」。

文件 ID 直接用 empId（每員工一份），無歷史記錄需求。

---

## 4. 後端規格

### 4.1 純函數 helper

新增 `netlify/functions/utils/staffPreferences.ts`：

```ts
import type { StaffPreference } from '../../../types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_LEN = 200;
const MAX_DATES = 200;   // 每邊（blocked / preferred）上限，避免文件過大

/**
 * 驗證並 normalize 員工提交的偏好設定。
 * @returns { ok: true, value } 或 { ok: false, error }
 */
export const validateStaffPreference = (
    input: Partial<StaffPreference>,
): { ok: true; value: Omit<StaffPreference, 'empId' | 'updatedAt'> } | { ok: false; error: string } => {
    // blockedWeekdays: 0-6 整數，去重
    const rawWds = Array.isArray(input.blockedWeekdays) ? input.blockedWeekdays : [];
    const blockedWeekdays = Array.from(new Set(
        rawWds.filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
    )).sort();

    // blockedDates / preferredDates: YYYY-MM-DD 格式檢查 + 去重
    const cleanDates = (arr: unknown): string[] => {
        if (!Array.isArray(arr)) return [];
        const filtered = arr.filter((s): s is string => typeof s === 'string' && DATE_RE.test(s));
        return Array.from(new Set(filtered)).sort();
    };
    const blockedDates = cleanDates(input.blockedDates);
    const preferredDates = cleanDates(input.preferredDates);

    if (blockedDates.length > MAX_DATES) return { ok: false, error: `不可上班日期上限 ${MAX_DATES} 筆` };
    if (preferredDates.length > MAX_DATES) return { ok: false, error: `偏好上班日期上限 ${MAX_DATES} 筆` };

    // blocked / preferred 不可重疊
    const overlap = blockedDates.filter(d => preferredDates.includes(d));
    if (overlap.length > 0) {
        return { ok: false, error: `日期 ${overlap[0]} 同時出現在不可上與偏好上，請擇一` };
    }

    // note 長度
    const rawNote = typeof input.note === 'string' ? input.note.trim() : '';
    if (rawNote.length > MAX_NOTE_LEN) {
        return { ok: false, error: `備註不可超過 ${MAX_NOTE_LEN} 字` };
    }

    return {
        ok: true,
        value: {
            blockedWeekdays,
            blockedDates,
            preferredDates,
            ...(rawNote ? { note: rawNote } : {}),
        },
    };
};

/**
 * 判斷指定日期對該員工偏好設定的態度。
 */
export type PreferenceMatch = 'blocked' | 'preferred' | 'neutral';

export const matchPreferenceForDate = (
    pref: StaffPreference | null | undefined,
    date: string,
): PreferenceMatch => {
    if (!pref) return 'neutral';
    if (!DATE_RE.test(date)) return 'neutral';

    // 1) blockedDates 顯式列入 → blocked（最強）
    if (pref.blockedDates?.includes(date)) return 'blocked';
    // 2) preferredDates 顯式列入 → preferred
    if (pref.preferredDates?.includes(date)) return 'preferred';
    // 3) blockedWeekdays 命中 → blocked
    const dow = new Date(date).getDay();
    if (pref.blockedWeekdays?.includes(dow)) return 'blocked';
    return 'neutral';
};
```

### 4.2 `api.ts` 新增 3 個 actions

#### `get-my-staff-preference`

權限：登入者本人。

```ts
case 'get-my-staff-preference': {
    const snap = await db.collection('staffPreferences').doc(uid).get();
    if (!snap.exists) {
        return ok({ empId: uid, blockedWeekdays: [], blockedDates: [], preferredDates: [] });
    }
    return ok({ empId: uid, ...snap.data() });
}
```

#### `update-my-staff-preference`

權限：登入者本人。

```ts
case 'update-my-staff-preference': {
    const validation = validateStaffPreference(data.preference || {});
    if (!validation.ok) return fail(400, validation.error);
    const doc: StaffPreference = {
        empId: uid,
        ...validation.value,
        updatedAt: new Date().toISOString(),
    };
    await db.collection('staffPreferences').doc(uid).set(doc);
    // 不寫 auditLog（員工自助設定不算管理操作）
    return ok(doc);
}
```

> **個資與安全：** **不**允許 Admin 透過此 action 改別人的偏好。要改別人，員工自己改。如未來有需求再切 follow-up。

#### `get-all-staff-preferences`

權限：Admin+。

```ts
case 'get-all-staff-preferences': {
    if (!isAdmin) return fail(403, '僅管理者可查看全員偏好');
    const snap = await db.collection('staffPreferences').get();
    const list = snap.docs.map(d => ({ empId: d.id, ...d.data() } as StaffPreference));
    return ok(list);
}
```

> **設計備註：** 沒做 `get-staff-preference/{empId}`（單一員工讀取）— 排班 UI 一次拉全表 cache 即可，省 N+1 query。

### 4.3 不需動 `update-schedule`

排班儲存時不檢查偏好（決策：警示）。前端讓 admin 看到提示即可。

---

## 5. 前端規格

### 5.1 員工側：`components/employee/MyPreferences.tsx`（新檔）

功能：

- 載入 `apiGetMyStaffPreference()`
- 七個 checkbox：日 / 一 / 二 / 三 / 四 / 五 / 六（對應 0–6），勾選 = 不可上班
- 「特定不可上班日期」與「偏好上班日期」兩個獨立列表
  - 每個列表：date input + 「加入」按鈕、底下列出已加入日期（可移除）
  - 後端會去重，前端只需基本驗證（YYYY-MM-DD）
- 自由備註 textarea（≤ 200 字，顯示剩餘字數）
- 儲存按鈕 → `apiUpdateMyStaffPreference()` → success toast / error alert
- **不需要審核**；存進去就生效

UI 比照 `SystemSettings.tsx` 樣式，**不新增 Tailwind class**。

提示文案：

> 偏好設定僅供管理者排班參考，**不會自動阻擋**排班。若有具體請假需求請走「請假申請」。

### 5.2 Admin 側：`components/admin/ScheduleManager.tsx`（修改）

#### 5.2.1 載入時抓全員偏好

```ts
const [staffPrefs, setStaffPrefs] = useState<Map<string, StaffPreference>>(new Map());

useEffect(() => {
    apiGetAllStaffPreferences()
        .then(list => {
            const m = new Map<string, StaffPreference>();
            list.forEach(p => m.set(p.empId, p));
            setStaffPrefs(m);
        })
        .catch(() => {});
}, []);
```

#### 5.2.2 傳入 EditModal

`EditScheduleModal` 多接一個 prop：

```ts
{
    event: ScheduleEvent;
    employees: User[];
    staffPrefs: Map<string, StaffPreference>;   // ← 新增
    onClose: () => void;
    onSave: (event: ScheduleEvent) => void;
}
```

#### 5.2.3 EditModal 內偏好提示

在「班次列表」每筆 shift 的員工 `<select>` 旁，依 `matchPreferenceForDate(staffPrefs.get(empId), event.date)` 顯示：

- `blocked` → `<span class="text-red-600 text-xs">⚠️ 偏好不上班</span>`
- `preferred` → `<span class="text-green-600 text-xs">💚 偏好上班</span>`
- `neutral` → 不顯示

員工下拉的 `<option>` 旁不要加標記（會破壞 select 樣式）；只在 row 標記即可。

#### 5.2.4 日曆格子（可選做，不強制）

若想做：在每天的格子下方加一個小灰字「⚠️ N 人偏好不上班」（依該日所有 blocked 員工數）— **此為加分項，可省略**。

### 5.3 Dashboard 整合

**`pages/AdminDashboard.tsx`：**

- lazy import `MyPreferences`
- 我的功能 nav 增加「偏好設定」，放在「假別餘額」後面
- `AdminView` type 加 `myPreferences`，`renderView` 對應

**`pages/EmployeeDashboard.tsx`：**

- 新增 `preferences` view + nav 「偏好設定」（放在「假別餘額」後面）

---

## 6. 測試規格（`tests/staffPreferences.test.ts`，≥ 6 個）

```typescript
import { describe, it, expect } from 'vitest';
import {
    validateStaffPreference,
    matchPreferenceForDate,
} from '../netlify/functions/utils/staffPreferences';
import type { StaffPreference } from '../types';

describe('validateStaffPreference', () => {
    it('合法輸入：去重 + 排序', () => {
        const r = validateStaffPreference({
            blockedWeekdays: [6, 0, 6, 3],
            blockedDates: ['2026-06-15', '2026-05-01', '2026-06-15'],
            preferredDates: ['2026-07-01'],
            note: '  我比較喜歡早班  ',
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.blockedWeekdays).toEqual([0, 3, 6]);
        expect(r.value.blockedDates).toEqual(['2026-05-01', '2026-06-15']);
        expect(r.value.preferredDates).toEqual(['2026-07-01']);
        expect(r.value.note).toBe('我比較喜歡早班');
    });

    it('空輸入：回傳空陣列、無 note', () => {
        const r = validateStaffPreference({});
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.blockedWeekdays).toEqual([]);
        expect(r.value.blockedDates).toEqual([]);
        expect(r.value.preferredDates).toEqual([]);
        expect(r.value).not.toHaveProperty('note');
    });

    it('無效星期（負數 / 超過 6 / 小數）會被過濾', () => {
        const r = validateStaffPreference({ blockedWeekdays: [-1, 7, 3.5, 2, 0] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.blockedWeekdays).toEqual([0, 2]);
    });

    it('無效日期格式被過濾', () => {
        const r = validateStaffPreference({
            blockedDates: ['2026/06/15', '2026-06-15', 'abc', '2026-13-99'],
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // 注意：'2026-13-99' 表面格式合法（regex 過了），但實務不存在
        // helper 用正規表達式判斷，不做日期語意檢查；接受 '2026-13-99'
        expect(r.value.blockedDates).toContain('2026-06-15');
        expect(r.value.blockedDates).not.toContain('2026/06/15');
        expect(r.value.blockedDates).not.toContain('abc');
    });

    it('blocked / preferred 重疊 → 錯誤', () => {
        const r = validateStaffPreference({
            blockedDates: ['2026-06-15'],
            preferredDates: ['2026-06-15'],
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/2026-06-15/);
    });

    it('備註超過 200 字 → 錯誤', () => {
        const longNote = 'a'.repeat(201);
        const r = validateStaffPreference({ note: longNote });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/200/);
    });

    it('日期超過上限 → 錯誤', () => {
        const tooMany = Array.from({ length: 201 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`);
        const r = validateStaffPreference({ blockedDates: tooMany });
        expect(r.ok).toBe(false);
    });
});

describe('matchPreferenceForDate', () => {
    const pref: StaffPreference = {
        empId: 'E001',
        blockedWeekdays: [6],            // 週六不可
        blockedDates: ['2026-06-15'],
        preferredDates: ['2026-07-01'],
    };

    it('null / undefined → neutral', () => {
        expect(matchPreferenceForDate(null, '2026-06-15')).toBe('neutral');
        expect(matchPreferenceForDate(undefined, '2026-06-15')).toBe('neutral');
    });

    it('blockedDates 命中 → blocked', () => {
        expect(matchPreferenceForDate(pref, '2026-06-15')).toBe('blocked');
    });

    it('preferredDates 命中 → preferred', () => {
        expect(matchPreferenceForDate(pref, '2026-07-01')).toBe('preferred');
    });

    it('blockedWeekdays 命中（週六）→ blocked', () => {
        // 2026-05-23 是週六
        expect(matchPreferenceForDate(pref, '2026-05-23')).toBe('blocked');
    });

    it('沒命中任何規則 → neutral', () => {
        // 2026-05-20 是週三
        expect(matchPreferenceForDate(pref, '2026-05-20')).toBe('neutral');
    });

    it('blockedDates 優先於 preferredDates（同日同列極端情境）', () => {
        // validateStaffPreference 會擋下這種情境，但 match 函式仍要 safe
        const weirdPref: StaffPreference = {
            empId: 'E001',
            blockedWeekdays: [],
            blockedDates: ['2026-06-15'],
            preferredDates: ['2026-06-15'],
        };
        expect(matchPreferenceForDate(weirdPref, '2026-06-15')).toBe('blocked');
    });
});
```

---

## 7. 驗收條件

### 7.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 175 個全綠**（169 + ≥ 6） |
| 3 | `npm run build` | 無新增 warning |

### 7.2 程式碼審查

- [ ] `staffPreferences.ts` 為純函數（無 firebase / I/O / React）
- [ ] 3 個新 actions 皆有權限檢查（前 2 個本人、第 3 個 Admin+）
- [ ] `update-my-staff-preference` 寫入時設 `updatedAt`
- [ ] **不**做 audit log（員工自助）
- [ ] ScheduleManager EditModal 在 shift row 顯示 ⚠️ / 💚 標記
- [ ] **不**改 `update-schedule` 邏輯（不阻擋）
- [ ] MyPreferences 提交前對備註長度做客戶端驗證
- [ ] 員工不可改別人偏好（後端只信 uid）

### 7.3 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 員工進入「偏好設定」 | 看到 7 個星期 checkbox、兩個日期列表、備註欄 |
| 2 | 勾「週六」，加日期 2026-06-15 到不可上 | 儲存成功 |
| 3 | 同日加進偏好上班 | 前端或後端擋下，提示重疊 |
| 4 | 備註輸 250 字 | 儲存被擋，提示 200 上限 |
| 5 | Admin 進排班管理，編輯 2026-05-23（週六） | 員工下拉旁顯示 ⚠️ 偏好不上班 |
| 6 | 編輯 2026-07-01 | 對應員工旁顯示 💚 偏好上班 |
| 7 | 編輯 2026-05-20（週三） | 該員工旁無標記 |
| 8 | Admin 仍可儲存含 ⚠️ 的排班 | 不阻擋（決策） |

---

## 8. Commit message 模板

```text
feat(schedule): staff preference settings (Phase 6.4)

- Add StaffPreference type and staffPreferences/{empId} collection
- Add staffPreferences.ts pure helpers
  (validateStaffPreference + matchPreferenceForDate)
- Add 3 API actions:
  - get-my-staff-preference / update-my-staff-preference (own only)
  - get-all-staff-preferences (Admin+)
- Add MyPreferences page (employee self-service):
  weekday checkboxes, blocked/preferred date lists, note ≤ 200 chars
- ScheduleManager EditModal shows ⚠️/💚 markers next to each shift
  row based on matchPreferenceForDate; warning only, never blocks save
- Add tests/staffPreferences.test.ts — ≥ 6 cases covering
  validation rules and weekday/date matching
- Closes Phase 6.4
```

---

## 9. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 改 `update-schedule` 加偏好阻擋 | 決策：僅警示 |
| 在 `clock-in` / `clock-out` 檢查偏好 | 偏好只是排班輔助，不影響打卡 |
| 寫 audit log 紀錄員工改自己偏好 | 過度監控 |
| 加偏好的 Admin 編輯 / 強制覆寫 UI | 員工自助為原則；如要 Admin 改別人 → 另切票 |
| 整合「排班自動建議」演算法 | 超出範圍 |
| 多時段偏好（如「6/15 上午不可、下午可」） | 本工單以日為粒度即可 |
| 把偏好寫進 `Employee` 主文件 | 用獨立 collection，避免 employees 文件膨脹 |
| 動 `vite.config.ts` / 既有 169 測試 | 嚴禁 |

---

## 10. 完工回報格式

```md
Phase 6.4 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 175 | __ |
| build 警告 | 無新增 | __ |
| 3 個新 actions | 全部上線 | __ |
| ScheduleManager 偏好標記 | ⚠️ / 💚 顯示 | __ |
| 員工可改自己偏好 | 是 | __ |
| Admin 不可改他人偏好 | 是 | __ |
| 不阻擋儲存 | 是 | __ |

新增測試：___ 個案例

手動煙霧測試（§ 7.3）：
- [ ] § 1–8 全勾

備註：
```

---

## 11. 後續可能 follow-up

- 偏好統計（Admin 看「全員偏好分布」儀表板）
- 多時段偏好（早 / 中 / 晚 / 自訂時段）
- 偏好歷史變更紀錄（誰改、何時改）
- 員工偏好變動自動通知排班管理員
- 排班自動建議演算法（用偏好 + 應到人數 + 兩頭班限制做啟發式排班）
- 把偏好「軟阻擋」做成 admin 可切換的選項（systemConfig.enforceStaffPreference）
