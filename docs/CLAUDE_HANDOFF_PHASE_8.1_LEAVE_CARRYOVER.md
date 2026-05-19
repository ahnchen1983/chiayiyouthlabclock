# Claude Handoff — Phase 8.1 特休跨年結轉

> 建立日期：2026-05-19
> 目標：請 Claude 依既有工單實作 Phase 8.1，完成後回報可供 Codex review / merge。

---

## 1. 任務摘要

請實作 `docs/PHASE_8.1_LEAVE_CARRYOVER.md`。

核心需求：

- 特休未休時數可跨年結轉，保留 1 年。
- 本年度使用特休時，採 FIFO：先抵去年結轉，再抵今年新給。
- 上上年度結轉若到今年仍未使用，標記為 `expiredHours`，但不加入可用餘額。
- 保持 Phase 8.2 留停扣除邏輯相容，特休年資計算必須透過既有 `computeAnnualLeaveDays(hireDate, asOf, leaveOfAbsencePeriods?)`。

---

## 2. 寫入範圍

Claude 只負責下列檔案：

| 檔案 | 任務 |
|------|------|
| `netlify/functions/utils/calculations.ts` | 新增 `AnnualLeaveSnapshot` 與 `computeLeaveBalanceWithCarryover` |
| `types.ts` | `LeaveBalance` 新增 optional `annualLeaveDetail` |
| `netlify/functions/api.ts` | `getLeaveBalanceForEmployee` 改用結轉計算 |
| `components/employee/MyLeaveBalance.tsx` | 只在特休卡新增結轉 / 失效提示 |
| `tests/calculations.test.ts` | 追加至少 6 個 Phase 8.1 測試 |

如果需要新增測試輔助常數，請盡量放在 `tests/calculations.test.ts` 同一檔內。

---

## 3. 不可碰範圍

請不要修改：

- `computeAnnualLeaveDays` 函數簽名或既有實作
- `computeLeaveOfAbsenceDays`
- `computeLeaveBalances`
- `calculateSalaryForEmployee`
- `vite.config.ts`
- `.github/workflows/*`
- 任何 `.env*`
- 既有測試案例的語意

也不要順手做：

- 折算工資
- cron job
- Admin UI 結轉管理
- systemConfig retention years
- 大型重構

---

## 4. 實作重點

請完全依 `docs/PHASE_8.1_LEAVE_CARRYOVER.md` 的公式實作。

`computeLeaveBalanceWithCarryover` 建議簽名：

```ts
export interface AnnualLeaveSnapshot {
    year: number;
    newGrantedHours: number;
    carriedFromPreviousYear: number;
    usedHours: number;
    expiredHours: number;
    remainingHours: number;
    carriedExpiresAt: string;
}

export const computeLeaveBalanceWithCarryover = (
    hireDate: string,
    asOf: Date,
    leaveOfAbsencePeriods: LeaveOfAbsencePeriod[],
    annualLeaveUsageByYear: Record<number, number>
): AnnualLeaveSnapshot => {
    // See docs/PHASE_8.1_LEAVE_CARRYOVER.md § 3.1.
};
```

API 層重點：

- `leaveRequests` 要讀該員工所有已核准紀錄。
- 只有 `LeaveType.Annual` 要進 `annualLeaveUsageByYear`。
- 其他假別仍只計算本年度 used hours。
- 特休回傳的 `usedHours` / `remainingHours` 直接使用 `annualSnap`。
- `annualLeaveDetail` 只放在特休那筆 balance。

UI 層重點：

- 只動特休卡。
- `carriedFromPreviousYear > 0` 時顯示藍字結轉與失效日。
- `expiredHours > 0` 時顯示紅字已失效。
- 其他假別卡片外觀與文字不變。

---

## 5. 驗收指令

請完成後執行：

```bash
npm run typecheck
npm test
npm run build
```

期望：

- typecheck 0 錯誤
- Vitest 全綠，總數至少 110
- build 無新增錯誤
- `computeAnnualLeaveDays` diff 顯示未改動

---

## 6. 回報格式

請用以下格式回報：

```md
Phase 8.1 完工回報

Changed files:
- ...

Validation:
- npm run typecheck: pass / fail
- npm test: pass / fail, total __ tests
- npm run build: pass / fail

Important checks:
- computeAnnualLeaveDays signature untouched: yes / no
- annualLeaveDetail only on annual leave balance: yes / no
- other leave cards unchanged: yes / no

Notes / risks:
- ...
```

---

## 7. 參考文件

- `docs/PHASE_8.1_LEAVE_CARRYOVER.md`
- `docs/PROGRESS_SNAPSHOT_2026-05-19.md`
- `docs/EXECUTION_PLAN.md`
- `docs/DEVELOPMENT_ROADMAP.md`
