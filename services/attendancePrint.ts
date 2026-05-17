import { ClockRecord } from '../types';

// ==========================================================
// 出勤紀錄 PDF 列印（Phase 8.3）
// 完全依靠瀏覽器原生 window.print()，不引入任何 PDF 套件。
// 比照 services/payslipPrint.ts 既有模式。
// ==========================================================

export interface AttendancePrintOptions {
    empName?: string;       // 員工版：必填；管理員版可省略
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
