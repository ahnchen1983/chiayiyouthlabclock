# Phase 8.2 — 留停期間餘額凍結工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 半天（含單元測試 + typecheck + build + 手動驗收）
> **對應 Roadmap：** Phase 8.2
> **對應 SDD 議題：** 補強 HR 細節（§ 4.4 假別、§ 4.5 薪資模組）
> **對應 EXECUTION_PLAN 決策：** D5 — 留停凍結
> **依賴：** 無（純 type 擴充 + 純函數 + UI 改一個 Modal + 後端 audit log）

---

## 1. 目標

`Employee.status` 已支援 `'留停'`，但目前留停期間員工的特休**仍會繼續累積年資**（因為 `computeAnnualLeaveDays` 只看到職日 → asOf 月差），這違反勞動實務「留職停薪期間年資中斷」的慣例。

客戶已決策（EXECUTION_PLAN D5）：

> **留停期間特休不累積、不扣除。回任後從留停前的剩餘餘額繼續計算。**

本工單目標：

1. `Employee` 新增兩個 optional 欄位 `leaveOfAbsenceStart` / `leaveOfAbsenceEnd`
2. `computeAnnualLeaveDays` 支援第 3 參數 `leaveOfAbsencePeriods?: { start: string; end?: string }[]`（向後相容，預設空陣列），計算年資時扣除留停期間總天數
3. `getLeaveBalanceForEmployee` 串接該員工的留停期間到 `computeAnnualLeaveDays`
4. `EmployeeManager` 編輯 Modal 新增「設定留停」UI（勾選 → 展開兩個 date input；清空 = 結束留停）
5. 設定／結束留停均寫 `auditLogs`
6. Vitest 新增 ≥ 5 個測試（既有 67 個測試不可動，必須全綠）

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| Employee 留停欄位 | 僅 status='留停' 字串標記 | 新增 start / end 日期 |
| `computeAnnualLeaveDays` 簽名 | 2 參數 | 3 參數（第 3 個 optional，向後相容） |
| Vitest 新增測試 | 0 | ≥ 5 |
| Vitest 總數 | 67 | ≥ 72 |
| typecheck / build / 既有測試 | 全綠 | 全綠（不可破壞） |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **改** — `Employee` 新增 `leaveOfAbsenceStart?` / `leaveOfAbsenceEnd?` |
| `netlify/functions/utils/calculations.ts` | **改** — `computeAnnualLeaveDays` 新增第 3 參數；新增 `computeLeaveOfAbsenceDays` helper |
| `netlify/functions/api.ts` | **改** — `getLeaveBalanceForEmployee` 串接留停期間；`update-employee` action 偵測留停欄位變更時寫專屬 audit log |
| `components/admin/EmployeeManager.tsx` | **改** — `EmployeeFormModal` 新增「設定留停」勾選與兩個 date input |
| `tests/calculations.test.ts` | **改** — 新增 ≥ 5 個測試案例（不動既有測試） |

**不要動：**
- ❌ `vite.config.ts`
- ❌ `api.ts` 的其他 action
- ❌ `calculateSalaryForEmployee`（薪資計算邏輯維持原狀）
- ❌ `computeLeaveBalances`（純函數版本不動）
- ❌ 既有 67 個 Vitest 測試

---

## 3. 實作規格

### 3.1 `types.ts` — `Employee` 擴充

```typescript
export interface Employee {
    id: string;
    name: string;
    phone: string;
    email: string;
    hourlyRate: number;
    monthlySalary?: number;
    hireDate: string;
    resignDate?: string;
    status: EmployeeStatus;
    position: '專責人員' | '兼職人員';
    role: UserRole;
    // === Phase 8.2 新增 ===
    leaveOfAbsenceStart?: string;   // 留停起始日 YYYY-MM-DD
    leaveOfAbsenceEnd?: string;     // 留停結束日 YYYY-MM-DD；空字串或 undefined = 仍在留停
}
```

> **設計備註：** 目前 UI 只支援單次留停，但 helper 與型別保留將來擴充為陣列的彈性。

### 3.2 `calculations.ts` — `computeLeaveOfAbsenceDays` 新增 + `computeAnnualLeaveDays` 改寫

```typescript
// ==================== 留停期間（Phase 8.2）====================

export interface LeaveOfAbsencePeriod {
    start: string;       // YYYY-MM-DD
    end?: string;        // 空字串或缺值 = 仍在留停
}

/**
 * 計算所有留停期間在 [hireDate, asOf] 區間內被吃掉的「總天數」。
 * - 含頭含尾：(end - start) + 1 天
 * - end 缺值 = 用 asOf 當結束點
 * - 自動裁切到 [hireDate, asOf]
 * - 多筆留停累加
 */
export const computeLeaveOfAbsenceDays = (
    hireDate: string,
    periods: LeaveOfAbsencePeriod[],
    asOf: Date
): number => {
    if (!periods || periods.length === 0) return 0;
    const hire = new Date(hireDate);
    if (Number.isNaN(hire.getTime())) return 0;
    const asOfTime = asOf.getTime();
    const hireTime = hire.getTime();

    let totalDays = 0;
    for (const p of periods) {
        if (!p.start) continue;
        const start = new Date(p.start);
        if (Number.isNaN(start.getTime())) continue;
        const end = (p.end && p.end.length > 0) ? new Date(p.end) : asOf;
        if (Number.isNaN(end.getTime())) continue;

        const clampedStart = Math.max(start.getTime(), hireTime);
        const clampedEnd = Math.min(end.getTime(), asOfTime);
        if (clampedEnd < clampedStart) continue;

        const days = Math.floor((clampedEnd - clampedStart) / (24 * 60 * 60 * 1000)) + 1;
        totalDays += days;
    }
    return totalDays;
};

/**
 * 依勞基法計算特休天數
 * Phase 8.2：新增 leaveOfAbsencePeriods 參數，留停期間從年資中扣除
 */
export const computeAnnualLeaveDays = (
    hireDate: string,
    asOf: Date = new Date(),
    leaveOfAbsencePeriods: LeaveOfAbsencePeriod[] = []
): number => {
    if (!hireDate) return 0;
    const hire = new Date(hireDate);
    if (Number.isNaN(hire.getTime())) return 0;

    const rawMonths = (asOf.getFullYear() - hire.getFullYear()) * 12 + (asOf.getMonth() - hire.getMonth());

    // 扣除留停天數（換算為月：1 月 = 30 天）
    const loaDays = computeLeaveOfAbsenceDays(hireDate, leaveOfAbsencePeriods, asOf);
    const loaMonths = Math.floor(loaDays / 30);
    const months = Math.max(0, rawMonths - loaMonths);

    if (months < 6) return 0;
    if (months < 12) return 3;
    const years = Math.floor(months / 12);
    if (years < 2) return 7;
    if (years < 3) return 10;
    if (years < 5) return 14;
    if (years < 10) return 15;
    return Math.min(30, 15 + (years - 9));
};
```

**換算說明：** 「30 天 = 1 個月」是勞動實務簡化規則。例：留停 183 天 → `Math.floor(183/30) = 6` 個月。

**情境驗算：** 到職 2024-01-01、asOf 2026-01-01、留停 2025-04-01 ~ 2025-09-30。
- `rawMonths = 24`
- 留停天數 = **183 天**
- `loaMonths = Math.floor(183/30) = 6`
- `months = 24 - 6 = 18 個月` → `years = 1` → 特休 **7 天**（原本沒留停會是 10 天）

### 3.3 `api.ts` — `getLeaveBalanceForEmployee` 串接留停期間

```typescript
const getLeaveBalanceForEmployee = async (empId: string): Promise<any[]> => {
    const empSnap = await db.collection('employees').doc(empId).get();
    if (!empSnap.exists) return [];
    const emp = empSnap.data()!;
    const year = new Date().getFullYear();

    // === Phase 8.2：將員工的留停期間傳入 ===
    const loaPeriods = emp.leaveOfAbsenceStart
        ? [{ start: emp.leaveOfAbsenceStart, end: emp.leaveOfAbsenceEnd }]
        : [];
    const annualDays = computeAnnualLeaveDays(emp.hireDate, new Date(), loaPeriods);

    // ... 以下不變
```

### 3.4 `api.ts` — `update-employee` action 留停 audit log

```typescript
case 'update-employee': {
    const ref = db.collection('employees').doc(data.empId);
    const snap = await ref.get();
    if (!snap.exists) return ok(null);
    const before = snap.data()!;  // ← 新增：保留更新前狀態
    await ref.update(data.updates);
    const updated = await ref.get();
    const { password: _p, ...emp } = updated.data()!;
    await writeAuditLog(uid, '更新員工', data.empId, JSON.stringify(data.updates));

    // === Phase 8.2：留停欄位變動專屬 audit log ===
    const startChanged = 'leaveOfAbsenceStart' in data.updates && data.updates.leaveOfAbsenceStart !== before.leaveOfAbsenceStart;
    const endChanged = 'leaveOfAbsenceEnd' in data.updates && data.updates.leaveOfAbsenceEnd !== before.leaveOfAbsenceEnd;
    if (startChanged || endChanged) {
        const newStart = data.updates.leaveOfAbsenceStart ?? before.leaveOfAbsenceStart;
        const newEnd = data.updates.leaveOfAbsenceEnd ?? before.leaveOfAbsenceEnd;
        if (newStart && !newEnd) {
            await writeAuditLog(uid, '設定留停', data.empId, `${before.name} 留停起始 ${newStart}`);
        } else if (newStart && newEnd) {
            await writeAuditLog(uid, '結束留停', data.empId, `${before.name} 留停 ${newStart} ~ ${newEnd}`);
        } else if (!newStart && before.leaveOfAbsenceStart) {
            await writeAuditLog(uid, '清除留停', data.empId, `${before.name} 原留停 ${before.leaveOfAbsenceStart} ~ ${before.leaveOfAbsenceEnd || '進行中'}`);
        }
    }
    return ok(emp);
}
```

### 3.5 `EmployeeManager.tsx` — 設定留停 UI

於 `EmployeeFormModal` 的「狀態」下方新增區塊。**只在編輯模式（`!isNew`）顯示**：

```tsx
const [showLoa, setShowLoa] = useState<boolean>(
    !!(employee?.leaveOfAbsenceStart)
);

const [formData, setFormData] = useState<Omit<Employee, 'id'>>({
    // ... 既有欄位
    leaveOfAbsenceStart: employee?.leaveOfAbsenceStart || '',
    leaveOfAbsenceEnd: employee?.leaveOfAbsenceEnd || '',
});
```

UI 區塊：

```tsx
{!isNew && (
    <div className="border-t pt-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
            <input
                type="checkbox"
                checked={showLoa}
                onChange={(e) => {
                    setShowLoa(e.target.checked);
                    if (!e.target.checked) {
                        setFormData(prev => ({
                            ...prev,
                            leaveOfAbsenceStart: '',
                            leaveOfAbsenceEnd: '',
                        }));
                    }
                }}
                className="w-4 h-4"
            />
            設定留停期間
        </label>
        {showLoa && (
            <div className="grid grid-cols-2 gap-4 mt-2 pl-6">
                <div>
                    <label className="block text-xs text-gray-600 mb-1">留停起始日</label>
                    <input
                        type="date"
                        name="leaveOfAbsenceStart"
                        value={formData.leaveOfAbsenceStart || ''}
                        onChange={handleChange}
                        className="w-full p-2 border rounded-md"
                    />
                </div>
                <div>
                    <label className="block text-xs text-gray-600 mb-1">留停結束日（空 = 仍在留停）</label>
                    <input
                        type="date"
                        name="leaveOfAbsenceEnd"
                        value={formData.leaveOfAbsenceEnd || ''}
                        onChange={handleChange}
                        className="w-full p-2 border rounded-md"
                    />
                </div>
                <p className="col-span-2 text-xs text-gray-500">
                    留停期間特休不累積、不扣除；回任後從留停前的剩餘餘額繼續計算。
                </p>
            </div>
        )}
    </div>
)}
```

**`handleChange` 不需改動** — date input 走既有 string 分支即可。

**注意：** UI 不檢查 `status === '留停'`，由 admin 自行同步切換狀態。

---

## 4. 驗收條件

### 4.1 量化（CI 自動跑）

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 72 個測試全綠**（67 既有 + ≥ 5 新增） |
| 3 | `npm run build` | 無新增 warning |

### 4.2 新增測試（`tests/calculations.test.ts`）

```typescript
describe('computeAnnualLeaveDays — 留停期間扣除（Phase 8.2）', () => {
    it('未留停（傳入空陣列）= 簡單年資計算', () => {
        const asOf = new Date('2026-01-01');
        expect(computeAnnualLeaveDays('2024-01-01', asOf, [])).toBe(10);
        expect(computeAnnualLeaveDays('2024-01-01', asOf)).toBe(10);     // 預設空陣列
    });

    it('留停 183 天（2025-04-01 ~ 2025-09-30）扣 6 個月：24 月 → 18 月 → 7 天', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2025-04-01', end: '2025-09-30' }
        ]);
        expect(days).toBe(7);
    });

    it('留停跨年（2024-10-01 ~ 2025-03-31，182 天）→ 跨年的天數也扣', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2024-10-01', end: '2025-03-31' }
        ]);
        expect(days).toBe(7);
    });

    it('留停尚未結束（end 為空字串）→ 用 asOf 當結束點', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2025-04-01', end: '' }
        ]);
        expect(days).toBe(7);
    });

    it('多次留停累加扣除（helper 支援陣列）', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2024-04-01', end: '2024-06-30' },  // 91 天 = 3 月
            { start: '2025-04-01', end: '2025-06-30' },  // 91 天 = 3 月
        ]);
        expect(days).toBe(7);
    });

    it('留停 < 30 天（不滿一個月）= 不扣月份', () => {
        const asOf = new Date('2026-01-01');
        const days = computeAnnualLeaveDays('2024-01-01', asOf, [
            { start: '2025-04-01', end: '2025-04-10' }
        ]);
        expect(days).toBe(10);
    });
});
```

### 4.3 程式碼審查

- [ ] `types.ts` 兩個新欄位皆為 optional
- [ ] `computeAnnualLeaveDays` 第 3 參數有 `= []` 預設值
- [ ] `computeLeaveOfAbsenceDays` 為 export
- [ ] `api.ts` 把 `leaveOfAbsenceStart/End` 包成單元素陣列
- [ ] `update-employee` 既有 audit log **保留**，只追加留停專屬 log
- [ ] UI 取消勾選會清空兩個欄位

### 4.4 手動煙霧測試（`npm run dev`）

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 員工管理 → 編輯某員工 | Modal 出現「設定留停期間」勾選 |
| 2 | 勾選 → 填 2025-04-01、結束日留空 → 儲存 | auditLog 多一筆「設定留停」 |
| 3 | 員工 dashboard 看請假餘額 | 特休天數**比未設留停時少** |
| 4 | 再編輯 → 填結束日 2025-09-30 → 儲存 | auditLog 多「結束留停」 |
| 5 | 再編輯 → 取消勾選 → 儲存 | 兩欄位清空；auditLog 多「清除留停」；餘額恢復 |

---

## 5. Commit message 模板

```
feat(hr): freeze annual leave accrual during leave of absence (Phase 8.2)

- types.ts: Employee adds optional leaveOfAbsenceStart / leaveOfAbsenceEnd
- calculations.ts: computeAnnualLeaveDays accepts third arg
  leaveOfAbsencePeriods[], subtracting LOA days (floor(days/30) months)
  from raw tenure; new export computeLeaveOfAbsenceDays helper
- api.ts: getLeaveBalanceForEmployee passes employee's LOA period into
  computeAnnualLeaveDays; update-employee action emits dedicated
  audit log (設定留停 / 結束留停 / 清除留停) in addition to existing log
- EmployeeManager: edit modal adds 設定留停期間 checkbox + two date
  inputs; unchecking clears both fields
- tests/calculations.test.ts: +6 tests (72 total)
- Resolves EXECUTION_PLAN D5
- Backward compatible: third arg defaults to [], existing 67 tests pass
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 改 `calculateSalaryForEmployee` | 薪資邏輯維持原狀 |
| 改 `computeLeaveBalances`（純函數版） | 範圍爆炸；只動 api.ts 端的 wrapper 即可 |
| 自動同步切換 `status` | 留給 admin 手動操作 |
| 加 cron job 自動結束留停 | 超出範圍 |
| 留停期間自動凍結登入 | 超出範圍 |
| 改 `vite.config.ts` / `api.ts` 其他 action | 不需 |
| 改既有 67 個測試 | 簽名向後相容，舊測試**必須**保持綠 |
| 多次留停 UI（陣列輸入） | 本工單 UI 只支援單次 |
| 「順便」重構 `EmployeeFormModal` | 嚴禁，只加新區塊 |

---

## 7. 完工回報格式

```
Phase 8.2 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 72 | __ |
| 既有 67 個測試 | 全綠（不可改） | __ |
| build 警告 | 無新增 | __ |
| Employee 新增 2 欄位 | optional | __ |
| computeAnnualLeaveDays 簽名 | 第 3 參數 optional 預設 [] | __ |
| UI 勾選方塊 | 編輯模式有 | __ |
| audit log（設定/結束/清除留停） | 3 種事件均寫入 | __ |

新增測試：___ 個案例

手動煙霧測試：- [ ] § 1–5 全勾

備註：
```

---

## 8. 後續可能 follow-up

- 多次留停 UI（陣列輸入）
- 留停狀態自動同步（填起始日自動切 status）
- 留停期間凍結登入
- 留停 cron 自動處理
- 留停期間員工 dashboard 提示橫幅
- 薪資跑批自動跳過留停員工
