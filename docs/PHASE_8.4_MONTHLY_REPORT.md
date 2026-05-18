# Phase 8.4 — 月結報表工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 1 天
> **對應 Roadmap：** Phase 8.4（B 批進階功能）
> **對應 SDD 議題：** D6「月結報表（完整版）」
> **依存：** **Phase 6.3 月結鎖定**（已上線）— 需呼叫 `apiGetMonthLock` 顯示鎖定徽章

---

## 1. 目標

目前管理者要看「該月狀況」必須跳三個畫面（AdminOverview 看今日 / SalaryCalculation 看薪資總和 / AttendanceLog 看打卡細節），且都沒有「月結視角」的彙整數字。會計、主管月底結算時，需要**單頁看完該月全貌**。

本工單目標：

1. 新增後端 action `get-monthly-report`（Admin+ 可看）— **單一 endpoint 一次回所有指標**
2. 抽離聚合邏輯到純函數模組 `netlify/functions/utils/monthlyReport.ts`
3. 新前端元件 `components/admin/MonthlyReport.tsx`：5 大區塊 + 鎖定徽章 + CSV 匯出
4. 整合進 `AdminDashboard`：加 `monthlyReport` view + 側欄 NavItem
5. Vitest 新增 ≥ 4 個測試
6. **不裝任何圖表函式庫**

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 月結報表元件 | 0 | 1 |
| 後端 actions | 既有 | +1（get-monthly-report）|
| Vitest 總數 | 104 | ≥ 108 |
| typecheck / build / 既有測試 | 全綠 | 全綠 |
| 新裝套件 | — | **0** |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **加** `MonthlyReportData` interface |
| `netlify/functions/utils/monthlyReport.ts` | **新增** — 聚合純函數 |
| `netlify/functions/api.ts` | **改** — 加 1 個 action `get-monthly-report` |
| `services/googleAppsScriptAPI.ts` | **改** — 加 `apiGetMonthlyReport` |
| `components/admin/MonthlyReport.tsx` | **新增** — UI 元件 |
| `pages/AdminDashboard.tsx` | **改** — AdminView + lazy import + renderView + NavItem |
| `tests/monthlyReport.test.ts` | **新增** — Vitest（≥ 4 個）|

**不要動：**
- ❌ `vite.config.ts`
- ❌ 既有 104 個 Vitest 測試
- ❌ `calculations.ts`（直接複用）
- ❌ `monthLock.ts`（直接複用）
- ❌ AdminOverview / SalaryCalculation 等既有元件
- ❌ 安裝任何圖表庫（recharts / chart.js / victory / nivo / d3）

---

## 3. 實作規格

### 3.1 `types.ts` 新增型別

```typescript
// 月結報表（Phase 8.4）
export interface MonthlyReportData {
    yearMonth: string;
    lock: MonthLock | null;
    summary: {
        totalEmployees: number;
        totalWorkDays: number;
        totalWorkHours: number;
        totalOvertimeHours: number;
        totalLeaveHours: number;
        avgWorkHoursPerEmployee: number;
    };
    leaveDistribution: {
        [LeaveType.Annual]: number;
        [LeaveType.Sick]: number;
        [LeaveType.Personal]: number;
        [LeaveType.Other]: number;
    };
    clockAnomalies: {
        lateCount: number;
        earlyLeaveCount: number;
        missingClockOutCount: number;
        manuallyEditedCount: number;
        makeupCount: number;
    };
    partTimeStatus: {
        empId: string;
        name: string;
        monthHours: number;
        limit: number;
        usagePercent: number;
        overLimit: boolean;
    }[];
    employeeRanking: {
        empId: string;
        name: string;
        totalHours: number;
        overtimeHours: number;
        workDays: number;
    }[];
}
```

### 3.2 `netlify/functions/utils/monthlyReport.ts`（新檔）

```typescript
/**
 * 月結報表 — 純聚合函數，無 I/O
 * Phase 8.4
 */
import type { ClockRecord, LeaveRequest, SalaryDetail, MonthlyReportData } from '../../../types';
import { LeaveType, LeaveStatus } from '../../../types';

export const aggregateLeaveDistribution = (
    leaveRequests: LeaveRequest[],
    yearMonth: string
): MonthlyReportData['leaveDistribution'] => {
    const dist = {
        [LeaveType.Annual]: 0,
        [LeaveType.Sick]: 0,
        [LeaveType.Personal]: 0,
        [LeaveType.Other]: 0,
    };
    for (const lr of leaveRequests) {
        if (lr.status !== LeaveStatus.Approved) continue;
        if (!lr.startDate || lr.startDate.slice(0, 7) !== yearMonth) continue;
        if (dist[lr.leaveType] !== undefined) {
            dist[lr.leaveType] += lr.hours || 0;
        }
    }
    (Object.keys(dist) as LeaveType[]).forEach(k => {
        dist[k] = Math.round(dist[k] * 10) / 10;
    });
    return dist;
};

/**
 * 異常打卡分類聚合
 * 一筆紀錄可能同時被算進多個欄位（如同時遲到 + 漏打卡）
 */
export const aggregateClockAnomalies = (
    records: ClockRecord[]
): MonthlyReportData['clockAnomalies'] => {
    let lateCount = 0, earlyLeaveCount = 0, missingClockOutCount = 0;
    let manuallyEditedCount = 0, makeupCount = 0;
    for (const r of records) {
        if (r.status && r.status.includes('遲到')) lateCount++;
        if (r.status && r.status.includes('早退')) earlyLeaveCount++;
        if (r.clockInTime && !r.clockOutTime) missingClockOutCount++;
        if (r.manuallyEdited === true) manuallyEditedCount++;
        if (r.source === 'makeup') makeupCount++;
    }
    return { lateCount, earlyLeaveCount, missingClockOutCount, manuallyEditedCount, makeupCount };
};

/**
 * 員工工時排名（desc by totalHours，穩定排序）
 * tie-break: overtimeHours desc → workDays desc → empId asc
 */
export const rankEmployeesByHours = (
    salaries: SalaryDetail[]
): MonthlyReportData['employeeRanking'] => {
    return [...salaries]
        .map(s => ({
            empId: s.empId,
            name: s.name,
            totalHours: s.totalWorkHours,
            overtimeHours: s.overtimeHours,
            workDays: s.totalWorkDays,
        }))
        .sort((a, b) => {
            if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
            if (b.overtimeHours !== a.overtimeHours) return b.overtimeHours - a.overtimeHours;
            if (b.workDays !== a.workDays) return b.workDays - a.workDays;
            return a.empId.localeCompare(b.empId);
        });
};

export const buildSummary = (
    salaries: SalaryDetail[]
): MonthlyReportData['summary'] => {
    const totalEmployees = salaries.length;
    const totalWorkDays = salaries.reduce((s, x) => s + x.totalWorkDays, 0);
    const totalWorkHours = Math.round(salaries.reduce((s, x) => s + x.totalWorkHours, 0) * 10) / 10;
    const totalOvertimeHours = Math.round(salaries.reduce((s, x) => s + x.overtimeHours, 0) * 10) / 10;
    const totalLeaveHours = Math.round(salaries.reduce((s, x) => s + x.totalLeaveHours, 0) * 10) / 10;
    const avgWorkHoursPerEmployee = totalEmployees > 0
        ? Math.round((totalWorkHours / totalEmployees) * 10) / 10
        : 0;
    return {
        totalEmployees,
        totalWorkDays,
        totalWorkHours,
        totalOvertimeHours,
        totalLeaveHours,
        avgWorkHoursPerEmployee,
    };
};
```

### 3.3 `netlify/functions/api.ts` 後端

加 1 個 action（位置：放在 `get-employee-salary` 之後、稽核日誌之前）：

```typescript
import {
    aggregateLeaveDistribution, aggregateClockAnomalies,
    rankEmployeesByHours, buildSummary,
} from './utils/monthlyReport';
import type { MonthlyReportData } from '../../types';

case 'get-monthly-report': {
    if (!isAdmin) return fail(403, '僅管理者可查看月結報表');
    const yearMonth = data.yearMonth as string;
    if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) {
        return fail(400, 'yearMonth 格式錯誤（需 YYYY-MM）');
    }

    const [scheduleEvents, empSnap, clockSnap, leaveSnap, cfg, lock] = await Promise.all([
        getMonthlyDailySchedule(yearMonth),
        db.collection('employees').get(),
        db.collection('clockRecords').get(),
        db.collection('leaveRequests').get(),
        getSystemConfig(),
        getMonthLock(yearMonth),
    ]);

    const allEmployees = empSnap.docs.map(d => d.data()) as Employee[];
    const activeEmployees = allEmployees.filter(e => e.status === '在職' || e.status === '留停');
    const allClockRecords = clockSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClockRecord));
    const monthClockRecords = allClockRecords.filter(r => r.date.startsWith(yearMonth));
    const allLeaveRequests = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));

    // 複用既有 helper（不重新實作薪資計算）
    const salaries = activeEmployees.map(emp =>
        calculateSalaryForEmployee(emp, yearMonth, scheduleEvents, allClockRecords, allLeaveRequests, cfg)
    );

    const summary = buildSummary(salaries);
    const leaveDistribution = aggregateLeaveDistribution(allLeaveRequests, yearMonth);
    const clockAnomalies = aggregateClockAnomalies(monthClockRecords);

    const limit = cfg.ptMonthlyHourLimit ?? 80;
    const partTimers = activeEmployees.filter(e => e.position === '兼職人員');
    const partTimeStatus = partTimers.map(pt => {
        const hours = Math.round(
            monthClockRecords
                .filter(r => r.empId === pt.id)
                .reduce((s, r) => s + (r.workHours || 0), 0) * 10
        ) / 10;
        const usagePercent = limit > 0 ? Math.round((hours / limit) * 1000) / 10 : 0;
        return {
            empId: pt.id, name: pt.name, monthHours: hours,
            limit, usagePercent, overLimit: hours > limit,
        };
    }).sort((a, b) => b.usagePercent - a.usagePercent);

    const employeeRanking = rankEmployeesByHours(salaries);

    const report: MonthlyReportData = {
        yearMonth,
        lock: lock || null,
        summary,
        leaveDistribution,
        clockAnomalies,
        partTimeStatus,
        employeeRanking,
    };
    return ok(report);
}
```

### 3.4 `services/googleAppsScriptAPI.ts`

```typescript
import { MonthlyReportData } from '../types';

export const apiGetMonthlyReport = async (yearMonth: string): Promise<MonthlyReportData> => {
    return callAPI('get-monthly-report', { yearMonth });
};
```

### 3.5 `components/admin/MonthlyReport.tsx`（新檔）

#### UI 結構（5 大區塊）

```
┌────────────────────────────────────────────────────────────┐
│ 📋 月結報表                                                │
│ [月份選擇▾]  [🔒 已鎖定 / 🔓 未鎖定]  [📥 匯出 CSV]        │
├────────────────────────────────────────────────────────────┤
│ ┌─摘要卡（6 個並列）─────────────────────────────────┐   │
│ │ 員工數│工作天│總工時│加班│請假│平均工時            │   │
│ └────────────────────────────────────────────────────┘   │
│ ┌─請假分布（純 CSS bar）────────────────────────────┐    │
│ │ 特休 ████████████ 48h                              │    │
│ │ 病假 ████ 16h                                      │    │
│ └────────────────────────────────────────────────────┘   │
│ ┌─打卡異常（5 個小卡並列）─────────────────────────┐    │
│ │ 遲到│早退│漏打卡│手動編輯│補打卡                │    │
│ └────────────────────────────────────────────────────┘   │
│ ┌─PT 時數狀況（表格）──────────────────────────────┐    │
│ │ 姓名│月時數│上限│使用率(progress)│警示          │    │
│ └────────────────────────────────────────────────────┘   │
│ ┌─員工工時排名（表格 desc）───────────────────────┐    │
│ │ 排名│姓名│工時│加班│工作天                     │    │
│ └────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

#### 鎖定徽章（比照 SalaryCalculation 樣式）

```tsx
{isLocked && (
    <span className="flex items-center gap-1 px-3 py-2 bg-amber-100 text-amber-800 rounded-md text-sm font-medium">
        🔒 已鎖定（{report!.lock!.lockedByName} ‧ {report!.lock!.lockedAt.slice(0, 10)}）
    </span>
)}
{!isLocked && report?.lock?.unlockedAt && (
    <span className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-600 rounded-md text-sm">
        🔓 曾解鎖（{report.lock.unlockedByName}）
    </span>
)}
```

#### 請假分布 Bar（純 CSS，0 套件）

```tsx
const LeaveBar: React.FC<{ label: string; hours: number; max: number; color: string }> = ({ label, hours, max, color }) => {
    const widthPct = max > 0 ? Math.min((hours / max) * 100, 100) : 0;
    return (
        <div className="mb-2">
            <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">{label}</span>
                <span className="text-gray-500">{hours} 小時</span>
            </div>
            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${widthPct}%` }} />
            </div>
        </div>
    );
};
```

#### PT progress bar + 超限警示

```tsx
<div className="flex items-center gap-2">
    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
            className={`h-full rounded-full ${pt.overLimit ? 'bg-red-500' : pt.usagePercent >= 80 ? 'bg-amber-500' : 'bg-blue-500'}`}
            style={{ width: `${Math.min(pt.usagePercent, 100)}%` }}
        />
    </div>
    <span className={`text-xs w-12 text-right ${pt.overLimit ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
        {pt.usagePercent}%
    </span>
</div>
{pt.overLimit && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">超限</span>}
{!pt.overLimit && pt.usagePercent >= 80 && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">接近上限</span>}
```

#### CSV 匯出

```tsx
const exportReportCSV = (r: MonthlyReportData) => {
    const lines: string[] = [];
    lines.push(`"# 月結報表 ${r.yearMonth}"`);
    lines.push(`"# 匯出時間: ${new Date().toLocaleString('zh-TW')}"`);
    lines.push(`"# 鎖定狀態: ${r.lock && !r.lock.unlockedAt ? `已鎖定（${r.lock.lockedByName} ${r.lock.lockedAt.slice(0, 10)}）` : '未鎖定'}"`);
    lines.push('');
    lines.push('"== 摘要 =="');
    lines.push(`"員工數","${r.summary.totalEmployees}"`);
    lines.push(`"總工作天數","${r.summary.totalWorkDays}"`);
    lines.push(`"總工時","${r.summary.totalWorkHours}"`);
    lines.push(`"加班總時數","${r.summary.totalOvertimeHours}"`);
    lines.push(`"請假總時數","${r.summary.totalLeaveHours}"`);
    lines.push(`"平均工時/人","${r.summary.avgWorkHoursPerEmployee}"`);
    lines.push('');
    lines.push('"== 請假分布 =="');
    (Object.keys(r.leaveDistribution) as LeaveType[]).forEach(k => {
        lines.push(`"${k}","${r.leaveDistribution[k]}"`);
    });
    lines.push('');
    lines.push('"== 打卡異常 =="');
    lines.push(`"遲到","${r.clockAnomalies.lateCount}"`);
    lines.push(`"早退","${r.clockAnomalies.earlyLeaveCount}"`);
    lines.push(`"漏打卡","${r.clockAnomalies.missingClockOutCount}"`);
    lines.push(`"手動編輯","${r.clockAnomalies.manuallyEditedCount}"`);
    lines.push(`"補打卡","${r.clockAnomalies.makeupCount}"`);
    lines.push('');
    lines.push('"== 員工工時排名 =="');
    lines.push('"排名","員工編號","姓名","總工時","加班時數","工作天數"');
    r.employeeRanking.forEach((e, i) => {
        lines.push(`"${i + 1}","${e.empId}","${e.name}","${e.totalHours}","${e.overtimeHours}","${e.workDays}"`);
    });

    const BOM = '﻿';
    const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `月結報表_${r.yearMonth}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
```

### 3.6 `pages/AdminDashboard.tsx` 整合

```tsx
const MonthlyReport = lazy(() => import('../components/admin/MonthlyReport'));

// AdminView type 加 'monthlyReport'
// renderView switch 加 case 'monthlyReport': return <MonthlyReport />;
// NavItem 放在「員工管理」之後、SuperAdmin 區塊之前（Admin+ 可看）
<NavItem view="monthlyReport" icon={<ListIcon className="w-6 h-6" />} label="月結報表" />
```

**為何 Admin+ 可看（不是 SuperAdmin only）：** 月結報表是匯總統計（總工時、請假分布、PT 狀況、異常數），**不含個別薪資數字**。Admin 看「該月狀況」做管理決策很合理。

### 3.7 `tests/monthlyReport.test.ts`（新檔，≥ 4 個）

至少覆蓋：

- `aggregateLeaveDistribution`：依假別聚合、排除非核准、排除非當月
- `aggregateClockAnomalies`：5 種異常各自計數，且「遲到+早退」同時算進兩個欄位
- `rankEmployeesByHours`：依總工時 desc + tie-break 穩定排序
- `buildSummary`：四捨五入 0.1、空陣列 avg = 0 不爆 NaN

完整測試碼請參考工單原稿（agent 已生成詳細範例）。

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 108 個全綠** |
| 3 | `npm run build` | 無 chunk size 警告 |
| 4 | `npm ls recharts chart.js victory nivo d3` | **全部 not found** |

### 4.2 程式碼審查

- [ ] `monthlyReport.ts` 是純函數（無 firebase / react import）
- [ ] 後端 action 複用 `calculateSalaryForEmployee`
- [ ] PT 上限取自 `systemConfig.ptMonthlyHourLimit`（不寫死 80）
- [ ] `get-monthly-report` 只要 `isAdmin`（不限 SuperAdmin）
- [ ] `MonthlyReport.tsx` 無 `import recharts/chart.js/d3/victory/nivo`
- [ ] 鎖定徽章樣式比照 `SalaryCalculation.tsx`
- [ ] NavItem 在「員工管理」之後、SuperAdmin 區塊之前
- [ ] CSV 含「鎖定狀態」標頭 + 摘要 + 排名兩個 section

### 4.3 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | Admin 帳號登入，左側欄「📋 月結報表」 | 顯示位置正確 |
| 2 | 點進去預設顯示當月，6 個摘要卡有數字 | 完整 |
| 3 | 切到已鎖定的月份 | amber 徽章 |
| 4 | 請假分布有 4 條 bar | 比例正確 |
| 5 | PT 時數表格：超限紅 tag、>= 80% amber tag | 正確 |
| 6 | 員工排名 desc by totalHours | 對 |
| 7 | 點「📥 匯出 CSV」 | 下載完整 |
| 8 | 一般 Admin 進入此頁 | 不 403 |
| 9 | 空月份（2099-01） | 顯示 0，不爆 NaN |

---

## 5. Commit message 模板

```
feat(reports): monthly report dashboard for admin (Phase 8.4)

- Add MonthlyReportData interface to types.ts (D6 complete version)
- Add netlify/functions/utils/monthlyReport.ts pure helpers:
  - aggregateLeaveDistribution / aggregateClockAnomalies
  - rankEmployeesByHours (stable sort with tie-break)
  - buildSummary (totals + avg, rounded to 0.1h)
- Add API action get-monthly-report (Admin+, single endpoint)
- Reuses calculateSalaryForEmployee — no recomputation
- Add components/admin/MonthlyReport.tsx — 5 sections,
  pure Tailwind, no chart library
- AdminDashboard: + AdminView 'monthlyReport' (Admin+ visible)
- CSV export: summary + ranking with lock status header
- Display lock badge matching SalaryCalculation
- Add tests/monthlyReport.test.ts — ≥ 4 tests (≥ 108 total)
- D6 (complete monthly report) — depends on Phase 6.3 month-lock

Closes Phase 8.4
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 安裝 recharts / chart.js / d3 / victory / nivo | 工單明確禁止 |
| 放進 SuperAdmin only 區塊 | 月結報表是匯總數字，Admin 也應可看 |
| 拆成多個 actions | 工單要求單一 endpoint |
| 重新實作薪資 / 工時計算 | 必須複用 `calculateSalaryForEmployee` |
| 改 `monthLocks` collection 結構 | 6.3 已穩 |
| 加 PDF 匯出 / 寄信 / 排程 | 後續工單 |
| 順便重構 `AdminOverview` 或 `SalaryCalculation` | 嚴禁 |
| PT 上限寫死 80 | 必須讀 `systemConfig.ptMonthlyHourLimit` |
| 動 `vite.config.ts` 或 既有 104 個測試 | 嚴禁 |

---

## 7. 完工回報格式

```
Phase 8.4 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 108 | __ |
| build 警告 | 無 | __ |
| 新增 action | get-monthly-report | __ |
| 圖表函式庫 | 未安裝 | __ |
| 5 大區塊 | 全部顯示 | __ |
| 鎖定徽章 | 顯示正確 | __ |
| Admin（非 SuperAdmin）可看 | 是 | __ |

新增測試：___ 個案例

手動煙霧測試：- [ ] 4.3 § 1–9 全勾

備註：
```

---

## 8. 後續可能 follow-up

- PDF 匯出（類似 `payslipPrint.ts` 模式）
- 圖表升級（若 D6 視覺需求進階）
- 自動寄送（每月 1 號）
- 趨勢比較（跨月 / 跨年）
- 個人月結報表（員工視角）
- 匯出操作寫進 `auditLogs`
- 依職位篩選
