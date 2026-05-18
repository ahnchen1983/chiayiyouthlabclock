# Phase 8.1 — 特休跨年結轉工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 0.5–1 天
> **對應 Roadmap：** Phase 8.1
> **對應 EXECUTION_PLAN 決策：** D4 — 特休保留 1 年（勞基法 § 38 第 4 項）
> **依賴：** **依存 8.2 的 `computeAnnualLeaveDays` 第 3 參數 `leaveOfAbsencePeriods?`**（8.2 已在 main，本票於其上疊加邏輯，**不可改其簽名**）

---

## 1. 目標

目前 `getLeaveBalanceForEmployee` 只用「本年到職至今的特休天數」當配額，**不處理跨年結轉**：員工 12/31 沒用完的特休，到了 1/1 就直接消失。這違反勞基法 § 38 第 4 項。

客戶已決策（D4）：

> **未使用之特休，保留 1 年。1 年內仍可使用；逾期未休則標記 expired。**

本工單目標：

1. `calculations.ts` 新增 `AnnualLeaveSnapshot` 介面與 `computeLeaveBalanceWithCarryover` 純函數
2. `api.ts` 改 `getLeaveBalanceForEmployee` 改用新函數，聚合 `leaveRequests` 按年分組
3. `types.ts` `LeaveBalance` 新增 optional `annualLeaveDetail?: AnnualLeaveSnapshot`
4. `MyLeaveBalance.tsx` 特休卡多顯示「結轉小時 + 失效日」與紅字「已失效 X 小時」
5. Vitest 新增 ≥ 6 個測試

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 跨年結轉邏輯 | 無 | 完整實作 + 1 年保留 |
| `computeAnnualLeaveDays` 簽名 | 3 參數（8.2 留下） | **完全不動** |
| Vitest 總數 | 104 | ≥ 110 |
| typecheck / build / 既有測試 | 全綠 | 全綠 |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `netlify/functions/utils/calculations.ts` | **加** — 新增介面 + 新函數；**不改** `computeAnnualLeaveDays` |
| `types.ts` | **改** — `LeaveBalance` 加 optional `annualLeaveDetail` |
| `netlify/functions/api.ts` | **改** — `getLeaveBalanceForEmployee` 改呼叫新函數 |
| `components/employee/MyLeaveBalance.tsx` | **改** — 特休卡顯示結轉量、失效日、已失效 |
| `tests/calculations.test.ts` | **追加** — ≥ 6 個測試案例 |

**特別註明（嚴格）：**

- ❌ **不可改** 8.2 留下的 `computeAnnualLeaveDays(hireDate, asOf, leaveOfAbsencePeriods)` 簽名與實作
- ❌ **不可改** 8.2 留下的 `computeLeaveOfAbsenceDays`
- ❌ **不可改** `computeLeaveBalances`（純函數版，保留）
- ❌ **不可改** `vite.config.ts`
- ❌ **不可改** `calculateSalaryForEmployee`
- ❌ **不可改** 既有 104 個 Vitest 測試
- ❌ 不做折算工資功能（後續再切票）
- ❌ 不做 cron job（系統 runtime 算即可）

---

## 3. 實作規格

### 3.1 演算法說明

#### 名詞定義

| 名詞 | 意義 |
|------|------|
| 本年 current | `asOf.getFullYear()` |
| 上年 previous | 本年 − 1 |
| 上上年 two years ago | 本年 − 2 |
| newGranted | 本年「依年資」該有的特休（小時 = 天 × 8） |
| carriedFromPreviousYear | 自上年帶到本年的剩餘 |
| usedHours | 本年實際使用 |
| expiredHours | 上上年帶來的結轉，到本年 1/1 已逾 1 年，標 expired |
| carriedExpiresAt | 本年 12/31 |

#### 核心公式

```
newGrantedHours = computeAnnualLeaveDays(hireDate, new Date(本年, 0, 1), loaPeriods) * 8

prevQuota       = computeAnnualLeaveDays(hireDate, new Date(上年, 0, 1), loaPeriods) * 8
prevUsed        = annualLeaveUsageByYear[上年] ?? 0

prevPrevQuota   = computeAnnualLeaveDays(hireDate, new Date(上上年, 0, 1), loaPeriods) * 8
prevPrevUsed    = annualLeaveUsageByYear[上上年] ?? 0
prevPrevCarried = max(0, prevPrevQuota - prevPrevUsed)

// 上上年的結轉到了上年，上年的 prevUsed 先抵 prevPrevCarried（FIFO）
prevPrevConsumedInPrev = min(prevPrevCarried, prevUsed)
expiredHours    = max(0, prevPrevCarried - prevPrevConsumedInPrev)

// 上年實際從 prevQuota 扣的量
prevConsumedFromQuota = max(0, prevUsed - prevPrevCarried)
carriedFromPreviousYear = max(0, prevQuota - prevConsumedFromQuota)

usedHours       = annualLeaveUsageByYear[本年] ?? 0
remainingHours  = max(0, newGrantedHours + carriedFromPreviousYear - usedHours)
carriedExpiresAt = `${本年}-12-31`
```

#### 邊界

- 員工新進（< 6 個月）：`newGranted = 0`，`carriedFromPrev = 0`，`expiredHours = 0`
- 第一次發特休：`prevQuota = 0` → `carriedFromPrev = 0`
- 員工請假時 FIFO：`usedHours` 先抵 `carriedFromPrev`，超出才扣 `newGranted`
- `leaveOfAbsencePeriods` 透傳給 `computeAnnualLeaveDays`，不重複實作留停邏輯

### 3.2 `calculations.ts` 新增

```typescript
// ==================== 特休跨年結轉（Phase 8.1）====================

export interface AnnualLeaveSnapshot {
    year: number;
    newGrantedHours: number;
    carriedFromPreviousYear: number;
    usedHours: number;
    expiredHours: number;
    remainingHours: number;
    carriedExpiresAt: string;       // YYYY-12-31
}

/**
 * 計算特休餘額（含跨年結轉，1 年保留期）
 *
 * @param hireDate 到職日
 * @param asOf 基準日
 * @param leaveOfAbsencePeriods 留停期間（8.2 相容）
 * @param annualLeaveUsageByYear 每年「特休」請假時數 { 2024: 16, 2025: 24 }
 */
export const computeLeaveBalanceWithCarryover = (
    hireDate: string,
    asOf: Date,
    leaveOfAbsencePeriods: LeaveOfAbsencePeriod[],
    annualLeaveUsageByYear: Record<number, number>
): AnnualLeaveSnapshot => {
    const year = asOf.getFullYear();
    const prevYear = year - 1;
    const prevPrevYear = year - 2;

    const quotaHoursAt = (y: number): number => {
        const days = computeAnnualLeaveDays(hireDate, new Date(y, 0, 1), leaveOfAbsencePeriods);
        return days * 8;
    };

    const newGrantedHours = quotaHoursAt(year);
    const prevQuota = quotaHoursAt(prevYear);
    const prevPrevQuota = quotaHoursAt(prevPrevYear);

    const prevUsed = Math.max(0, annualLeaveUsageByYear[prevYear] || 0);
    const prevPrevUsed = Math.max(0, annualLeaveUsageByYear[prevPrevYear] || 0);
    const usedHours = Math.max(0, annualLeaveUsageByYear[year] || 0);

    const prevPrevCarried = Math.max(0, prevPrevQuota - prevPrevUsed);
    const prevPrevConsumedInPrev = Math.min(prevPrevCarried, prevUsed);
    const expiredHours = Math.max(0, prevPrevCarried - prevPrevConsumedInPrev);

    const prevConsumedFromQuota = Math.max(0, prevUsed - prevPrevCarried);
    const carriedFromPreviousYear = Math.max(0, prevQuota - prevConsumedFromQuota);

    const remainingHours = Math.max(0, newGrantedHours + carriedFromPreviousYear - usedHours);

    return {
        year,
        newGrantedHours,
        carriedFromPreviousYear,
        usedHours: Math.round(usedHours * 10) / 10,
        expiredHours: Math.round(expiredHours * 10) / 10,
        remainingHours: Math.round(remainingHours * 10) / 10,
        carriedExpiresAt: `${year}-12-31`,
    };
};
```

### 3.3 `types.ts` 擴充

```typescript
import type { AnnualLeaveSnapshot } from './netlify/functions/utils/calculations';
// 若 import 循環，改在 types.ts 重新宣告 AnnualLeaveSnapshot

export interface LeaveBalance {
    leaveType: LeaveType;
    quotaHours: number;
    usedHours: number;
    remainingHours: number;
    note?: string;
    // Phase 8.1：特休專屬，含結轉資訊
    annualLeaveDetail?: AnnualLeaveSnapshot;
}
```

### 3.4 `api.ts` 改 `getLeaveBalanceForEmployee`

```typescript
import { computeAnnualLeaveDays, computeLeaveBalanceWithCarryover } from './utils/calculations';

const getLeaveBalanceForEmployee = async (empId: string): Promise<any[]> => {
    const empSnap = await db.collection('employees').doc(empId).get();
    if (!empSnap.exists) return [];
    const emp = empSnap.data()!;
    const asOf = new Date();
    const year = asOf.getFullYear();

    const loaPeriods = emp.leaveOfAbsenceStart
        ? [{ start: emp.leaveOfAbsenceStart, end: emp.leaveOfAbsenceEnd }]
        : [];

    // 讀全部已核准請假紀錄
    const lrSnap = await db.collection('leaveRequests').where('empId', '==', empId).get();
    const annualLeaveUsageByYear: Record<number, number> = {};
    const usedByTypeThisYear = new Map<string, number>();

    lrSnap.docs.forEach(d => {
        const lr = d.data();
        if (lr.status !== LeaveStatus.Approved) return;
        if (!lr.startDate) return;
        const lrYear = Number(lr.startDate.slice(0, 4));
        if (Number.isNaN(lrYear)) return;
        if (lrYear === year) {
            usedByTypeThisYear.set(lr.leaveType, (usedByTypeThisYear.get(lr.leaveType) || 0) + (lr.hours || 0));
        }
        if (lr.leaveType === LeaveType.Annual) {
            annualLeaveUsageByYear[lrYear] = (annualLeaveUsageByYear[lrYear] || 0) + (lr.hours || 0);
        }
    });

    const annualSnap = computeLeaveBalanceWithCarryover(
        emp.hireDate, asOf, loaPeriods, annualLeaveUsageByYear,
    );

    const annualQuotaHours = annualSnap.newGrantedHours + annualSnap.carriedFromPreviousYear;
    const carriedNote = annualSnap.carriedFromPreviousYear > 0
        ? `；其中 ${annualSnap.carriedFromPreviousYear}h 為去年結轉，於 ${annualSnap.carriedExpiresAt} 失效`
        : '';
    const expiredNote = annualSnap.expiredHours > 0
        ? `；已失效 ${annualSnap.expiredHours}h（超過 1 年保留期）`
        : '';

    const quotas: Record<string, { hours: number; note: string; detail?: any }> = {
        [LeaveType.Annual]: {
            hours: annualQuotaHours,
            note: `依到職日 ${emp.hireDate || '未設定'} 計算本年 ${annualSnap.newGrantedHours / 8} 天${carriedNote}${expiredNote}`,
            detail: annualSnap,
        },
        [LeaveType.Personal]: { hours: 14 * 8, note: '勞基法事假上限 14 天/年（不給薪）' },
        [LeaveType.Sick]:     { hours: 30 * 8, note: '勞基法普通病假上限 30 天/年（半薪）' },
        [LeaveType.Other]:    { hours: 9999, note: '其他假別不設上限' },
    };

    return Object.entries(quotas).map(([type, q]) => {
        if (type === LeaveType.Annual) {
            return {
                leaveType: type,
                quotaHours: q.hours,
                usedHours: annualSnap.usedHours,
                remainingHours: annualSnap.remainingHours,
                note: q.note,
                annualLeaveDetail: q.detail,
            };
        }
        const used = usedByTypeThisYear.get(type) || 0;
        return {
            leaveType: type,
            quotaHours: q.hours,
            usedHours: Math.round(used * 10) / 10,
            remainingHours: Math.round((q.hours - used) * 10) / 10,
            note: q.note,
        };
    });
};
```

### 3.5 `MyLeaveBalance.tsx` 改動

只動特休卡（其他卡不變）：

```tsx
{b.annualLeaveDetail && b.annualLeaveDetail.carriedFromPreviousYear > 0 && (
    <p className="text-xs text-blue-600 mt-1">
        其中 {b.annualLeaveDetail.carriedFromPreviousYear}h 為去年結轉，
        於 {b.annualLeaveDetail.carriedExpiresAt} 失效
    </p>
)}
{b.annualLeaveDetail && b.annualLeaveDetail.expiredHours > 0 && (
    <p className="text-xs text-red-600 mt-1 font-medium">
        已失效 {b.annualLeaveDetail.expiredHours}h（超過 1 年保留期）
    </p>
)}
```

**絕對不動其他假別卡片的顯示**。

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 110 個全綠** |
| 3 | `npm run build` | 無 warning |

### 4.2 新增測試（`tests/calculations.test.ts` 追加，≥ 6 個）

```typescript
describe('computeLeaveBalanceWithCarryover — 特休跨年結轉（Phase 8.1）', () => {
    it('案例 1：第一次發特休的年份（上年無配額）→ carried = 0', () => {
        const snap = computeLeaveBalanceWithCarryover(
            '2024-07-01', new Date('2025-06-01'), [], {},
        );
        expect(snap.year).toBe(2025);
        expect(snap.newGrantedHours).toBe(24);    // 3 天
        expect(snap.carriedFromPreviousYear).toBe(0);
        expect(snap.expiredHours).toBe(0);
        expect(snap.remainingHours).toBe(24);
    });

    it('案例 2：上年特休全用完 → carried = 0', () => {
        const snap = computeLeaveBalanceWithCarryover(
            '2022-01-01', new Date('2025-06-01'), [], { 2024: 80 },
        );
        expect(snap.newGrantedHours).toBe(80);
        expect(snap.carriedFromPreviousYear).toBe(0);
        expect(snap.remainingHours).toBe(80);
    });

    it('案例 3：上年完全沒用 → carried = 上年完整配額', () => {
        const snap = computeLeaveBalanceWithCarryover(
            '2022-01-01', new Date('2025-06-01'), [], { 2024: 0 },
        );
        expect(snap.carriedFromPreviousYear).toBe(80);
        expect(snap.remainingHours).toBe(160);
    });

    it('案例 4：上年用一部分 → carried = 上年配額 − 用量', () => {
        const snap = computeLeaveBalanceWithCarryover(
            '2022-01-01', new Date('2025-06-01'), [], { 2024: 24 },
        );
        expect(snap.carriedFromPreviousYear).toBe(56);
        expect(snap.remainingHours).toBe(136);
    });

    it('案例 5：本年又用了一些 → FIFO 先扣結轉', () => {
        const snap = computeLeaveBalanceWithCarryover(
            '2022-01-01', new Date('2025-06-01'), [], { 2024: 24, 2025: 32 },
        );
        expect(snap.carriedFromPreviousYear).toBe(56);
        expect(snap.usedHours).toBe(32);
        expect(snap.remainingHours).toBe(104);
    });

    it('案例 6：跨 2 年 → 上上年結轉 expired', () => {
        // 到職 2021-01-01
        // 2023 配額 80h 全沒用 → 2024 結轉 80h
        // 2024 配額 80h，用 40h → 先抵 2023 結轉 → 2023 結轉殘 40h
        // 到 2025/1/1 已過 1 年 → expired 40h
        const snap = computeLeaveBalanceWithCarryover(
            '2021-01-01', new Date('2025-06-01'), [],
            { 2023: 0, 2024: 40, 2025: 0 },
        );
        expect(snap.expiredHours).toBe(40);
        expect(snap.carriedFromPreviousYear).toBe(80);
        expect(snap.newGrantedHours).toBe(80);
        expect(snap.remainingHours).toBe(160);
    });
});
```

### 4.3 程式碼審查

- [ ] `computeAnnualLeaveDays` 簽名與實作**完全沒動**（diff 只有「新增」沒有「修改」）
- [ ] `computeLeaveBalanceWithCarryover` 內部呼叫 `computeAnnualLeaveDays`，未重複實作年資邏輯
- [ ] 內部呼叫時第 3 參數一律傳入 `leaveOfAbsencePeriods`
- [ ] `getLeaveBalanceForEmployee` 對特休的 `usedHours / remainingHours` 直接用 `annualSnap`
- [ ] `LeaveBalance.annualLeaveDetail` 為 optional，**只有特休**那筆會回傳
- [ ] `MyLeaveBalance.tsx` 對其他假別卡片無任何改動

### 4.4 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 「上年沒請過特休」員工的「假別餘額」 | 顯示「其中 Xh 為去年結轉，於 YYYY-12-31 失效」（藍字） |
| 2 | 「上年特休全用完」員工 | **不顯示**結轉行 |
| 3 | 「上上年也沒用」員工（Firestore 後台塞測資） | 顯示「已失效 Xh」紅字 |
| 4 | 留停員工 | 特休餘額計算正確（依扣除後年資） |
| 5 | 其他假別卡 | 顯示與改動前完全一致 |

---

## 5. Commit message 模板

```
feat(hr): annual leave carryover across year boundary (Phase 8.1)

- calculations.ts: add AnnualLeaveSnapshot interface and
  computeLeaveBalanceWithCarryover pure function. Internally calls
  Phase 8.2 computeAnnualLeaveDays(hireDate, asOf, loaPeriods) — signature
  untouched — to obtain each year's quota.
- Carryover rules per EXECUTION_PLAN D4 (勞基法 §38 IV):
    * Unused annual leave is carried over for 1 year
    * Current-year usage consumes carryover first (FIFO), then new grant
    * After 1 year unused, carried hours flagged as expiredHours
- types.ts: LeaveBalance gains optional annualLeaveDetail
- api.ts: getLeaveBalanceForEmployee aggregates leaveRequests by year
  for Annual type and delegates to computeLeaveBalanceWithCarryover
- MyLeaveBalance.tsx: annual leave card shows
    * blue note "其中 Xh 為去年結轉" if carried > 0
    * red note "已失效 Xh" if expiredHours > 0
- tests/calculations.test.ts: +6 cases covering first-year, fully-used,
  zero-used, partially-used, current-year-deduction, two-year expiry
- Resolves D4
- Backward compatible: computeAnnualLeaveDays untouched, all 104 existing
  Vitest tests remain green
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 改 `computeAnnualLeaveDays` 簽名或實作 | 8.2 已穩定，嚴格疊加 |
| 改 `computeLeaveOfAbsenceDays` | 同上 |
| 改 `calculateSalaryForEmployee` | 薪資扣款只看時數總和 |
| 改 `vite.config.ts` 或既有 104 個測試 | 嚴禁 |
| 做折算工資 | 後續工單 |
| 寫 cron job 自動標 expired | runtime 算即可 |
| Admin UI 加「結轉管理」 | 後續再切票 |
| 1 年保留期做成 systemConfig | D4 已拍板 1 年 |
| 順便重構 `MyLeaveBalance` / `getLeaveBalanceForEmployee` | 嚴禁 |

---

## 7. 完工回報格式

```
Phase 8.1 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 110 | __ |
| 既有 104 個測試 | 全綠（不可改） | __ |
| build 警告 | 無新增 | __ |
| computeAnnualLeaveDays 簽名 | 未動 | __ |
| AnnualLeaveSnapshot 介面 | 已 export | __ |
| LeaveBalance.annualLeaveDetail | optional 欄位 | __ |
| MyLeaveBalance 結轉/失效顯示 | 兩種訊息正常 | __ |

新增測試：___ 個案例

手動煙霧測試：
- [ ] § 1 結轉訊息顯示
- [ ] § 2 用完不顯示結轉
- [ ] § 3 失效紅字顯示
- [ ] § 4 8.2 留停相容
- [ ] § 5 其他假別卡未變動

備註：
```

---

## 8. 後續可能 follow-up

- 折算工資（到期未休自動算入該月薪資）
- 保留期設定化（`systemConfig.annualLeaveRetentionYears`）
- 離職結算（一次折算所有未過期特休）
- 多次留停 + 多年結轉（型別已支援陣列）
- Admin 視角的「結轉一覽表」
- 每月 1 日跨年 audit log
