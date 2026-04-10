import { SalaryDetail } from '../types';

const fmt = (n: number): string =>
    new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0 }).format(n);

/**
 * 在新視窗開啟可列印的薪資條，使用者可在列印對話框另存為 PDF。
 */
export const openPayslipPrintView = (salary: SalaryDetail): void => {
    const w = window.open('', '_blank', 'width=820,height=1000');
    if (!w) {
        alert('請允許彈出視窗以下載薪資條。');
        return;
    }
    const leaveRows = (salary.leaveDetails || [])
        .map(ld => `<tr><td>${ld.type}</td><td class="right">${ld.hours} 小時</td></tr>`)
        .join('') || '<tr><td colspan="2" class="muted">無</td></tr>';

    const html = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8" />
<title>薪資條 - ${salary.name} - ${salary.yearMonth}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; margin: 0; padding: 32px; color: #222; background: #fff; }
  h1 { text-align: center; margin: 0 0 4px; font-size: 22px; }
  .sub { text-align: center; color: #666; margin-bottom: 24px; font-size: 14px; }
  .meta { display: flex; justify-content: space-between; border: 1px solid #ddd; padding: 12px 16px; border-radius: 6px; margin-bottom: 18px; font-size: 14px; }
  .meta div span { color: #666; margin-right: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  td.right, th.right { text-align: right; }
  .muted { color: #999; text-align: center; }
  .section-title { font-size: 15px; font-weight: 700; margin: 18px 0 6px; padding-left: 6px; border-left: 4px solid #16a34a; }
  .total-row td { background: #f0fdf4; font-weight: 700; }
  .deduct-row td { background: #fef2f2; }
  .net { margin-top: 24px; padding: 16px; border: 2px solid #16a34a; border-radius: 8px; text-align: right; font-size: 18px; }
  .net strong { font-size: 26px; color: #15803d; margin-left: 12px; }
  .footer { text-align: center; color: #999; font-size: 12px; margin-top: 32px; }
  .actions { text-align: center; margin-top: 24px; }
  .actions button { padding: 10px 24px; font-size: 14px; background: #16a34a; color: #fff; border: 0; border-radius: 6px; cursor: pointer; margin: 0 6px; }
  .actions button.secondary { background: #6b7280; }
  @media print {
    body { padding: 16px; }
    .actions { display: none; }
  }
</style>
</head>
<body>
  <h1>嘉義青年實驗室 — 薪資條</h1>
  <div class="sub">${salary.yearMonth.replace('-', ' 年 ')} 月</div>

  <div class="meta">
    <div><span>員工編號：</span>${salary.empId}</div>
    <div><span>姓名：</span>${salary.name}</div>
    <div><span>職位：</span>${salary.position}</div>
  </div>

  <div class="section-title">出勤統計</div>
  <table>
    <tr><th>出勤天數</th><td class="right">${salary.totalWorkDays} 天</td>
        <th>總工時</th><td class="right">${salary.totalWorkHours} 小時</td></tr>
    <tr><th>請假時數</th><td class="right">${salary.totalLeaveHours} 小時</td>
        <th>加班時數</th><td class="right">${salary.overtimeHours} 小時</td></tr>
  </table>

  <div class="section-title">請假明細</div>
  <table>
    <thead><tr><th>假別</th><th class="right">時數</th></tr></thead>
    <tbody>${leaveRows}</tbody>
  </table>

  <div class="section-title">薪資項目</div>
  <table>
    <tr><td>${salary.position === '專責人員' ? '月薪' : '時薪計算'}</td><td class="right">${fmt(salary.baseSalary)}</td></tr>
    ${salary.overtimePay > 0 ? `<tr><td>加班費</td><td class="right">${fmt(salary.overtimePay)}</td></tr>` : ''}
    <tr class="total-row"><td>應發合計</td><td class="right">${fmt(salary.grossSalary)}</td></tr>
  </table>

  <div class="section-title">法定扣除</div>
  <table>
    <tr class="deduct-row"><td>勞保自付</td><td class="right">- ${fmt(salary.laborInsurance)}</td></tr>
    <tr class="deduct-row"><td>健保自付</td><td class="right">- ${fmt(salary.healthInsurance)}</td></tr>
    <tr class="deduct-row"><td>勞退自提</td><td class="right">- ${fmt(salary.laborPensionSelf)}</td></tr>
    ${salary.leaveDeduction > 0 ? `<tr class="deduct-row"><td>請假扣薪</td><td class="right">- ${fmt(salary.leaveDeduction)}</td></tr>` : ''}
    <tr class="total-row"><td>扣除合計</td><td class="right">- ${fmt(salary.totalDeductions)}</td></tr>
  </table>

  <div class="net">實發薪資 <strong>${fmt(salary.netSalary)}</strong></div>

  <div class="footer">本薪資條由系統自動產生，如有疑問請洽人事承辦。</div>

  <div class="actions">
    <button onclick="window.print()">列印 / 另存 PDF</button>
    <button class="secondary" onclick="window.close()">關閉</button>
  </div>

  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;
    w.document.write(html);
    w.document.close();
};
