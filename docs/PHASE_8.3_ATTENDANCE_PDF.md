# Phase 8.3 — 出勤紀錄 PDF 列印工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 0.5–1 天（含單元測試 + typecheck + build + 手動驗收）
> **對應 Roadmap：** Phase 8.3
> **對應 SDD 議題：** 補強 HR 報表（月結 PDF / 出勤紙本佐證需求）
> **依賴：** 無（純前端 + 工具函數 + 單元測試，不裝任何 PDF 套件）

---

## 1. 目標

目前出勤紀錄只能在網頁上瀏覽或匯出 CSV。對於：

- 員工想要 **保留個人月度出勤紙本紀錄**（報帳、申訴佐證）
- 管理員想要 **印月度全員出勤表交給主管簽核 / 紙本歸檔**

CSV 不適合直接列印。本工單提供「列印 PDF」功能，**完全依靠瀏覽器原生 `window.print()`**（使用者可在列印對話框選「另存為 PDF」），不引入任何 PDF 函式庫。

採用 Phase 4.3 `payslipPrint.ts` 已驗證的相同模式：**開新視窗、寫入內含 inline CSS 的 HTML、`setTimeout` 觸發 `window.print()`**。

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 出勤紀錄列印按鈕 | 0 | 2（員工端 + 管理員端） |
| `services/attendancePrint.ts` | 不存在 | 新增純函數模組 |
| 新增 Vitest 測試 | 0 | ≥ 3 |
| Vitest 總數 | 67 | ≥ 70 |
| typecheck / build / 既有測試 | 全綠 | 全綠 |
| 新裝套件 | 0 | 0（嚴禁裝 jsPDF/pdfkit） |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `services/attendancePrint.ts` | **新增** — 列印 HTML 產生器（純函數） |
| `tests/attendancePrint.test.ts` | **新增** — Vitest 測試（≥ 3 個） |
| `components/employee/MyRecords.tsx` | 新增「列印出勤紀錄」按鈕 |
| `components/admin/AttendanceLog.tsx` | 新增「列印出勤紀錄」按鈕（用 `filteredRecords`） |

**不要動：**
- ❌ `netlify/functions/api.ts`（後端不需改動）
- ❌ `types.ts`
- ❌ `services/payslipPrint.ts`（不要重構共用，後續若樣式收斂再切票）
- ❌ `vite.config.ts`
- ❌ 既有 67 個 Vitest 測試
- ❌ MyRecords / AttendanceLog 既有畫面（只加按鈕）

---

## 3. 實作規格

### 3.1 `services/attendancePrint.ts`（新檔）

**為何放在 `services/`？** 比照 `services/payslipPrint.ts` 既有慣例。HTML 字串組裝可被獨立測試。

```typescript
import { ClockRecord } from '../types';

export interface AttendancePrintOptions {
    empName?: string;       // 員工版：必填；管理員版：可省略
    month: string;          // "YYYY-MM"
    isAdminView: boolean;   // true = 全員分組；false = 單一員工
}

interface AttendanceStats {
    totalHours: number;
    normalCount: number;
    lateCount: number;
    earlyCount: number;
    recordCount: number;
}

const calcStats = (records: ClockRecord[]): AttendanceStats => ({
    recordCount: records.length,
    totalHours: records.reduce((s, r) => s + (r.workHours || 0), 0),
    normalCount: records.filter(r => r.status === '正常').length,
    lateCount: records.filter(r => r.status === '遲到' || r.status === '遲到+早退').length,
    earlyCount: records.filter(r => r.status === '早退' || r.status === '遲到+早退').length,
});

const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const renderStatsBar = (stats: AttendanceStats): string => `
  <div class="stats">
    <div class="stat"><span class="stat-num">${stats.recordCount}</span><span class="stat-label">總筆數</span></div>
    <div class="stat"><span class="stat-num">${stats.totalHours.toFixed(1)}</span><span class="stat-label">總工時</span></div>
    <div class="stat"><span class="stat-num">${stats.normalCount}</span><span class="stat-label">正常</span></div>
    <div class="stat"><span class="stat-num">${stats.lateCount}</span><span class="stat-label">遲到</span></div>
    <div class="stat"><span class="stat-num">${stats.earlyCount}</span><span class="stat-label">早退</span></div>
  </div>`;

const renderRecordTable = (records: ClockRecord[]): string => {
    if (records.length === 0) {
        return '<table><tbody><tr><td colspan="6" class="muted">本月無打卡紀錄</td></tr></tbody></table>';
    }
    const rows = records.map(r => `
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.clockInTime || '-')}</td>
        <td>${escapeHtml(r.clockOutTime || '-')}</td>
        <td class="right">${r.workHours != null ? r.workHours.toFixed(2) : '-'}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${escapeHtml(r.note || '')}</td>
      </tr>`).join('');
    return `
      <table>
        <thead><tr>
          <th>日期</th><th>上班</th><th>下班</th>
          <th class="right">工時</th><th>狀態</th><th>備註</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
};

const groupByEmployee = (records: ClockRecord[]): Map<string, { name: string; records: ClockRecord[] }> => {
    const map = new Map<string, { name: string; records: ClockRecord[] }>();
    records.forEach(r => {
        if (!map.has(r.empId)) map.set(r.empId, { name: r.name, records: [] });
        map.get(r.empId)!.records.push(r);
    });
    map.forEach(g => g.records.sort((a, b) => a.date.localeCompare(b.date)));
    return map;
};

/**
 * 純函數：產生列印 HTML（給 Vitest 用）。
 */
export const buildAttendanceHtml = (
    records: ClockRecord[],
    options: AttendancePrintOptions,
): string => {
    const { empName, month, isAdminView } = options;
    const title = isAdminView
        ? `全員出勤紀錄 - ${month}`
        : `${empName || ''} 的出勤紀錄`;

    let body: string;
    if (isAdminView) {
        const groups = groupByEmployee(records);
        if (groups.size === 0) {
            body = `<p class="muted" style="text-align:center;margin:40px 0;">無符合條件的紀錄</p>`;
        } else {
            body = Array.from(groups.entries()).map(([empId, g]) => `
              <section class="emp-section">
                <h2>${escapeHtml(g.name)} <span class="empid">(${escapeHtml(empId)})</span></h2>
                ${renderStatsBar(calcStats(g.records))}
                ${renderRecordTable(g.records)}
              </section>`).join('');
        }
    } else {
        body = `${renderStatsBar(calcStats(records))}${renderRecordTable(records)}`;
    }

    return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; margin: 0; padding: 28px; color: #222; background: #fff; }
  h1 { text-align: center; margin: 0 0 4px; font-size: 22px; }
  .sub { text-align: center; color: #666; margin-bottom: 20px; font-size: 14px; }
  .stats { display: flex; gap: 8px; margin: 12px 0; }
  .stat { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 10px; text-align: center; }
  .stat-num { display: block; font-size: 20px; font-weight: 700; color: #16a34a; }
  .stat-label { display: block; font-size: 12px; color: #666; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  td.right, th.right { text-align: right; }
  .muted { color: #999; text-align: center; }
  .emp-section { margin-bottom: 24px; page-break-inside: avoid; }
  .emp-section h2 { font-size: 16px; margin: 18px 0 6px; padding-left: 8px; border-left: 4px solid #16a34a; }
  .empid { color: #999; font-weight: 400; font-size: 13px; }
  .footer { text-align: center; color: #999; font-size: 11px; margin-top: 28px; border-top: 1px solid #eee; padding-top: 10px; }
  .actions { text-align: center; margin-top: 20px; }
  .actions button { padding: 8px 20px; font-size: 14px; background: #16a34a; color: #fff; border: 0; border-radius: 6px; cursor: pointer; margin: 0 6px; }
  .actions button.secondary { background: #6b7280; }
  @media print {
    body { padding: 12px; }
    .actions { display: none; }
    @page { size: A4; margin: 12mm; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">月份：${escapeHtml(month)}</div>
  ${body}
  <div class="footer">
    列印時間：${new Date().toLocaleString('zh-TW')} ｜ 嘉義青年實驗室打卡系統
  </div>
  <div class="actions">
    <button onclick="window.print()">列印 / 另存 PDF</button>
    <button class="secondary" onclick="window.close()">關閉</button>
  </div>
  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;
};

/**
 * 在新視窗開啟可列印的出勤紀錄。
 */
export const openAttendancePrintView = (
    records: ClockRecord[],
    options: AttendancePrintOptions,
): void => {
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) {
        alert('請允許彈出視窗以列印出勤紀錄。');
        return;
    }
    const html = buildAttendanceHtml(records, options);
    w.document.write(html);
    w.document.close();
};
```

### 3.2 `tests/attendancePrint.test.ts`（新檔）

至少 3 個測試。**測 `buildAttendanceHtml` 純函數即可**，不需要 mock window.open。

```typescript
import { describe, it, expect } from 'vitest';
import { buildAttendanceHtml } from '../services/attendancePrint';
import { ClockRecord } from '../types';

const mk = (over: Partial<ClockRecord>): ClockRecord => ({
    id: 'r1', empId: 'E001', name: '王小明', date: '2026-05-01',
    clockInTime: '09:00', clockOutTime: '18:00',
    verificationMethod: 'IP', verificationData: '192.168.1.1',
    workHours: 8, status: '正常',
    ...over,
});

describe('buildAttendanceHtml — 員工版', () => {
    it('標題含員工姓名與「的出勤紀錄」字樣', () => {
        const html = buildAttendanceHtml([mk({})], {
            empName: '王小明', month: '2026-05', isAdminView: false,
        });
        expect(html).toContain('王小明 的出勤紀錄');
        expect(html).toContain('2026-05');
    });

    it('統計列包含正確總工時與筆數', () => {
        const records = [
            mk({ workHours: 8, status: '正常' }),
            mk({ id: 'r2', workHours: 7.5, status: '遲到' }),
        ];
        const html = buildAttendanceHtml(records, {
            empName: '王小明', month: '2026-05', isAdminView: false,
        });
        expect(html).toContain('>15.5<');
        expect(html).toContain('>2<');
        expect(html).toContain('>1<');
    });

    it('明細表含每筆日期、上下班時間、狀態', () => {
        const html = buildAttendanceHtml([mk({ date: '2026-05-01', status: '遲到', note: '塞車' })], {
            empName: '王小明', month: '2026-05', isAdminView: false,
        });
        expect(html).toContain('2026-05-01');
        expect(html).toContain('09:00');
        expect(html).toContain('18:00');
        expect(html).toContain('遲到');
        expect(html).toContain('塞車');
    });
});

describe('buildAttendanceHtml — 管理員版', () => {
    it('標題為「全員出勤紀錄 - YYYY-MM」', () => {
        const html = buildAttendanceHtml([mk({})], { month: '2026-05', isAdminView: true });
        expect(html).toContain('全員出勤紀錄 - 2026-05');
    });

    it('多員工資料按員工分節', () => {
        const records = [
            mk({ empId: 'E001', name: '王小明' }),
            mk({ id: 'r2', empId: 'E002', name: '陳大文' }),
        ];
        const html = buildAttendanceHtml(records, { month: '2026-05', isAdminView: true });
        expect(html).toContain('王小明');
        expect(html).toContain('陳大文');
        expect(html).toContain('(E001)');
        expect(html).toContain('(E002)');
        const sectionCount = (html.match(/class="emp-section"/g) || []).length;
        expect(sectionCount).toBe(2);
    });

    it('空陣列顯示「無符合條件的紀錄」', () => {
        const html = buildAttendanceHtml([], { month: '2026-05', isAdminView: true });
        expect(html).toContain('無符合條件的紀錄');
    });
});

describe('buildAttendanceHtml — 頁尾與安全', () => {
    it('頁尾含「列印時間」與系統名稱', () => {
        const html = buildAttendanceHtml([], { empName: '王', month: '2026-05', isAdminView: false });
        expect(html).toContain('列印時間');
        expect(html).toContain('嘉義青年實驗室打卡系統');
    });

    it('員工姓名含 HTML 特殊字元時會被 escape', () => {
        const html = buildAttendanceHtml(
            [mk({ name: '<script>alert(1)</script>' })],
            { month: '2026-05', isAdminView: true },
        );
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});
```

> **注意：** 若 `ClockRecord` 型別實際無 `id` 欄位，請從 mk helper 拿掉 `id`，並用 record 自帶的識別欄位。

### 3.3 `components/employee/MyRecords.tsx` 改動

在月份選擇器外層的 `<div className="mb-4">` 改為 flex 排版：

```tsx
import { openAttendancePrintView } from '../../services/attendancePrint';

<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
  <div>
    <label htmlFor="month-select" className="mr-2 font-semibold">選擇月份:</label>
    <input
      type="month"
      id="month-select"
      value={month}
      onChange={(e) => setMonth(e.target.value)}
      className="p-2 border rounded-md"
    />
  </div>
  <button
    onClick={() => {
      if (records.length === 0) {
        alert('本月無打卡紀錄可列印');
        return;
      }
      openAttendancePrintView(records, {
        empName: user?.name || '',
        month,
        isAdminView: false,
      });
    }}
    className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
  >
    📥 列印出勤紀錄
  </button>
</div>
```

### 3.4 `components/admin/AttendanceLog.tsx` 改動

在標題列既有兩顆 CSV 匯出按鈕**右邊**再加一顆：

```tsx
import { openAttendancePrintView } from '../../services/attendancePrint';

<button
  onClick={() => {
    if (filteredRecords.length === 0) {
      alert('無符合條件的紀錄可列印');
      return;
    }
    openAttendancePrintView(filteredRecords, {
      month,
      isAdminView: true,
    });
  }}
  title="列印目前篩選結果（依員工分組）"
  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
>
  <DownloadIcon className="w-5 h-5" />
  列印出勤紀錄
</button>
```

**注意：** 管理員可先篩選員工 / 狀態，列印就只列印該子集。**不需提供「全部 / 已篩選」切換**。

---

## 4. 驗收條件

### 4.1 量化（CI 自動跑）

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 70 個測試全綠** |
| 3 | `npm run build` | 無 chunk size 警告 |
| 4 | `git diff --stat package.json package-lock.json` | **無變化**（不裝任何套件） |

### 4.2 程式碼審查

- [ ] `buildAttendanceHtml` 為純函數（不呼叫 window/document）
- [ ] `openAttendancePrintView` 是唯一接觸 `window.open` 的地方
- [ ] 兩個 UI 元件只 `import { openAttendancePrintView }`
- [ ] **沒有 `import jspdf` 或 `import pdfkit`**
- [ ] HTML 內所有 ClockRecord 字串都經過 `escapeHtml`
- [ ] CSS `@media print` 隱藏 `.actions`、`@page { size: A4 }`
- [ ] `.emp-section` 有 `page-break-inside: avoid`
- [ ] MyRecords / AttendanceLog 既有畫面**完全沒動**

### 4.3 手動煙霧測試（npm run dev）

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 員工身份「我的打卡紀錄」 → 選有資料月份 | 看到「📥 列印出勤紀錄」按鈕 |
| 2 | 點按鈕 | 新視窗開啟，標題「○○○ 的出勤紀錄」，自動觸發列印 |
| 3 | Chrome「另存為 PDF」 | **打開檢查**：標題、月份、統計、表格完整 |
| 4 | A4 邊界 / 表格沒被切到行中間 | 是 |
| 5 | 某月無紀錄 → 點按鈕 | alert「本月無打卡紀錄」 |
| 6 | 管理員「出勤紀錄」 | 三顆按鈕：脫敏匯出、完整匯出、列印 |
| 7 | 點「列印出勤紀錄」 | 新視窗「全員出勤紀錄 - YYYY-MM」按員工分節 |
| 8 | 另存 PDF | 同一員工不被切兩頁 |
| 9 | 篩單一員工後列印 | 只一節 |
| 10 | 篩「遲到」後列印 | 統計數字正確 |
| 11 | 頁尾「列印時間 ｜ 嘉義青年實驗室打卡系統」 | 都有 |
| 12 | 員工備註含 `<test>` | escape 後顯示為純文字 |

---

## 5. Commit message 模板

```
feat(reports): attendance PDF print for employee & admin (Phase 8.3)

- Add services/attendancePrint.ts:
  - buildAttendanceHtml (pure, testable) — produces print-ready HTML
  - openAttendancePrintView — opens new window, auto-triggers window.print()
- Two render modes:
  - Employee view: single person, with month stats + detail table
  - Admin view: grouped by employee, each section has its own stats
- A4-optimized inline CSS, page-break-inside: avoid per employee section
- All ClockRecord strings HTML-escaped
- MyRecords: add 「📥 列印出勤紀錄」 next to month picker
- AttendanceLog: add 「列印出勤紀錄」 next to CSV export buttons
  (uses filteredRecords)
- Add tests/attendancePrint.test.ts — 7 unit tests (70 Vitest total)
- No new dependencies; relies on browser's native print → save as PDF
- Mirrors the proven pattern from services/payslipPrint.ts (Phase 4.3)
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| `npm install jspdf` / `pdfkit` / `html2pdf` | 工單明確 0 依賴 |
| 改 `api.ts` 或新增 API endpoint | 純前端可解 |
| 動 `types.ts` | 不需新型別 |
| 改 `services/payslipPrint.ts`（哪怕順便收斂 CSS） | 出包風險高，另切票 |
| 重構 MyRecords / AttendanceLog 既有畫面 | 嚴禁，只加按鈕 |
| 加浮水印、加密碼、加簽核欄位 | 後續強化再做 |
| 把列印頁做成 React component + ReactDOM.render | 用 inline HTML 字串就好 |
| 動既有 67 個測試 | 必須全綠 |
| 改 `vite.config.ts` | 不需 |

---

## 7. 完工回報格式

```
Phase 8.3 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 70 | __ |
| build 警告 | 無 | __ |
| package.json 變化 | 無新增依賴 | __ |
| 員工端列印按鈕 | 有 | __ |
| 管理員端列印按鈕 | 有 | __ |
| 員工版 PDF 標題 | ○○○ 的出勤紀錄 | __ |
| 管理員版 PDF 標題 | 全員出勤紀錄 - YYYY-MM | __ |
| 管理員版按員工分節 | 是 | __ |

新增測試：___ 個案例

手動煙霧測試（4.3）：- [ ] § 1–12 全勾

實際另存 PDF 截圖：- [ ] 員工版 + 管理員版各 1 張

備註：
```

---

## 8. 後續可能 follow-up

- CSV / Excel 真正的 .xlsx 匯出（解 Excel 編碼）
- 加浮水印（列印者姓名 + 時間戳）
- PDF 加簽核欄位
- 薪資條與出勤紀錄列印樣式收斂（抽 `services/printShared.ts`）
- 批次列印全員 PDF 並打包 ZIP
- e-mail 寄送 PDF
- 列印操作寫入 `auditLogs`
