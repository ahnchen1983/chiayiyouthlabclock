# Phase 7.7 — CSV 個資脫敏工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 半天（含單元測試 + typecheck + build + 手動驗收）
> **對應 Roadmap：** Phase 7.7
> **對應 SDD 議題：** A5「CSV 匯出含未脫敏個資」
> **依賴：** 無（純前端 + 工具函數 + 單元測試，不動 API、不動資料模型）

---

## 1. 目標

目前 `AttendanceLog` 與 `SalaryCalculation` 兩支頁面匯出的 CSV 含**未經處理的個資**（姓名全名、IP 位址、GPS 座標）。一旦檔案被誤寄、隨身碟遺失或上傳到雲端硬碟外洩，會造成員工個資外流。

本工單目標：

1. 提供「**脫敏匯出**」選項（預設提供，與「完整匯出」並列）
2. 抽離脫敏邏輯到純函數模組 `netlify/functions/utils/csvMasking.ts`（可被 Vitest 測）
3. CSV 末尾加註標頭警語：「本檔可能含敏感個資，請依個資法妥善處理」
4. UI 在按下「完整匯出」時跳出確認對話框
5. 為脫敏函數寫 8–12 個 Vitest 單元測試

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 兩個 CSV 匯出按鈕 | 1 個（完整匯出） | 2 個（完整 + 脫敏） |
| 脫敏單元測試 | 0 | ≥ 8 |
| Vitest 總數 | 51 | ≥ 59 |
| typecheck / build / 既有測試 | 全綠 | 全綠（不可破壞） |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `netlify/functions/utils/csvMasking.ts` | **新增** — 脫敏純函數模組 |
| `tests/csvMasking.test.ts` | **新增** — Vitest 測試 |
| `components/admin/AttendanceLog.tsx` | 改 `exportToExcel`：拆兩個按鈕 + 確認對話框 + 接 masking |
| `components/admin/SalaryCalculation.tsx` | 改 `exportSalaryCSV`：同上 |

**不要動：**
- ❌ `netlify/functions/api.ts`（後端不需任何改動）
- ❌ 資料模型 `types.ts`
- ❌ 其他元件
- ❌ 既有 51 個 Vitest 測試

---

## 3. 實作規格

### 3.1 `netlify/functions/utils/csvMasking.ts`（新檔）

**為何放在 `netlify/functions/utils/`？** 為了能被 Vitest 跑（與 `calculations.ts` 同目錄、同模式）。前端直接 `import` 此檔，bundler 會把純函數 tree-shake 進前端 chunk，不需後端參與。

```typescript
/**
 * CSV 個資脫敏 — 純函數，無 I/O
 * Phase 7.7
 */

/**
 * 姓名脫敏：保留首末字，中間以 ○ 代替
 *   "王小明"        → "王○明"
 *   "陳大文豪"      → "陳○○豪"
 *   "Anna Wang"     → "A○○○ ○○○g"（含空格也保留）
 *   "李"            → "李"（1 字保留）
 *   "王明"          → "王○"（2 字遮中間以 ○）
 *   ""              → ""
 */
export const maskName = (name: string): string => {
    if (!name) return '';
    if (name.length === 1) return name;
    if (name.length === 2) return `${name[0]}○`;
    const first = name[0];
    const last = name[name.length - 1];
    const middle = '○'.repeat(name.length - 2);
    return `${first}${middle}${last}`;
};

/**
 * 員工編號脫敏：保留前綴與末 1 碼，中間以 * 代替
 *   "EMP001"   → "EMP*01" 不對，題意是保留首末字符
 *   採用：保留前 3 + 末 1，中間 *
 *   "EMP001"   → "EMP**1"
 *   "ADMIN"    → "ADM*N"（前 3 + 末 1，中間至少 1 個 *）
 *   "AB"       → "AB"（過短不遮）
 *   ""         → ""
 */
export const maskEmpId = (empId: string): string => {
    if (!empId) return '';
    if (empId.length <= 3) return empId;
    if (empId.length === 4) return `${empId.slice(0, 3)}*`;
    const prefix = empId.slice(0, 3);
    const suffix = empId.slice(-1);
    const mask = '*'.repeat(empId.length - 4);
    return `${prefix}${mask}${suffix}`;
};

/**
 * IP 位址脫敏：保留前兩段，後兩段以 * 代替
 *   "192.168.1.100"   → "192.168.*.*"
 *   "10.0.0.1"        → "10.0.*.*"
 *   "203.74.205.12"   → "203.74.*.*"
 *   "unknown"         → "unknown"
 *   ""                → ""
 *   非 IPv4 格式（如 IPv6、亂碼）原樣回傳
 */
export const maskIP = (ip: string): string => {
    if (!ip) return '';
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    // 必須每段都是 0–255 的數字
    if (!parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) return ip;
    return `${parts[0]}.${parts[1]}.*.*`;
};

/**
 * GPS 座標脫敏：取小數點後 2 位（約 1.1 公里精度）
 *   "23.4801,120.4501"  → "23.48,120.45"
 *   "23.4801, 120.4501" → "23.48, 120.45"（容忍空白）
 *   "unknown"           → "unknown"
 *   ""                  → ""
 *   非有效座標格式原樣回傳
 */
export const maskGPS = (gps: string): string => {
    if (!gps) return '';
    const m = gps.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (!m) return gps;
    const lat = Number(m[1]).toFixed(2);
    const lng = Number(m[2]).toFixed(2);
    // 維持原 separator（有無空白）
    const hadSpace = gps.includes(', ');
    return `${lat}${hadSpace ? ', ' : ','}${lng}`;
};

/**
 * 通用 verificationData 脫敏（依 method 判斷用哪個函數）
 */
export const maskVerificationData = (method: string, data: string): string => {
    if (method === 'IP') return maskIP(data);
    if (method === 'GPS') return maskGPS(data);
    return data;
};
```

### 3.2 `tests/csvMasking.test.ts`（新檔）

至少涵蓋以下案例（≥ 8 個，建議拆 4 個 describe）：

```typescript
import { describe, it, expect } from 'vitest';
import {
    maskName, maskEmpId, maskIP, maskGPS, maskVerificationData,
} from '../netlify/functions/utils/csvMasking';

describe('maskName', () => {
    it('3 字以上：首末字保留，中間以 ○', () => {
        expect(maskName('王小明')).toBe('王○明');
        expect(maskName('陳大文豪')).toBe('陳○○豪');
    });
    it('2 字：首字保留，第 2 字遮為 ○', () => {
        expect(maskName('王明')).toBe('王○');
    });
    it('1 字 / 空字串原樣回傳', () => {
        expect(maskName('李')).toBe('李');
        expect(maskName('')).toBe('');
    });
});

describe('maskEmpId', () => {
    it('5 碼以上：前 3 + 末 1 保留', () => {
        expect(maskEmpId('EMP001')).toBe('EMP**1');
        expect(maskEmpId('ADMIN')).toBe('ADM*N');
    });
    it('過短不遮', () => {
        expect(maskEmpId('AB')).toBe('AB');
        expect(maskEmpId('EMP')).toBe('EMP');
    });
    it('4 碼遮中間 1 個 *', () => {
        expect(maskEmpId('EMP1')).toBe('EMP*');
    });
});

describe('maskIP', () => {
    it('IPv4 遮後兩段', () => {
        expect(maskIP('192.168.1.100')).toBe('192.168.*.*');
        expect(maskIP('10.0.0.1')).toBe('10.0.*.*');
    });
    it('非 IPv4 原樣（unknown / IPv6 / 亂碼）', () => {
        expect(maskIP('unknown')).toBe('unknown');
        expect(maskIP('::1')).toBe('::1');
        expect(maskIP('abc.def')).toBe('abc.def');
    });
});

describe('maskGPS', () => {
    it('座標取小數點 2 位', () => {
        expect(maskGPS('23.4801,120.4501')).toBe('23.48,120.45');
        expect(maskGPS('23.4801, 120.4501')).toBe('23.48, 120.45');
    });
    it('非座標格式原樣', () => {
        expect(maskGPS('unknown')).toBe('unknown');
        expect(maskGPS('')).toBe('');
    });
});

describe('maskVerificationData', () => {
    it('依 method 切到正確 masker', () => {
        expect(maskVerificationData('IP', '192.168.1.100')).toBe('192.168.*.*');
        expect(maskVerificationData('GPS', '23.4801,120.4501')).toBe('23.48,120.45');
        expect(maskVerificationData('UNKNOWN', 'anything')).toBe('anything');
    });
});
```

### 3.3 `components/admin/AttendanceLog.tsx` 改動

**目前的 `exportToExcel`**（檔案第 117–147 行）改為**接收 `masked: boolean` 參數**：

```tsx
import { maskName, maskEmpId, maskVerificationData } from '../../netlify/functions/utils/csvMasking';

const exportToExcel = (records: ClockRecord[], month: string, masked: boolean) => {
    const headers = ['員工編號', '姓名', '日期', '上班時間', '下班時間', '工時', '狀態', '驗證方式', '驗證資料'];
    const csvContent = [
        headers.join(','),
        ...records.map(record => {
            const empId = masked ? maskEmpId(record.empId) : record.empId;
            const name = masked ? maskName(record.name) : record.name;
            const vData = masked
                ? maskVerificationData(record.verificationMethod, record.verificationData)
                : record.verificationData;
            return [
                empId, name, record.date,
                record.clockInTime || '', record.clockOutTime || '',
                record.workHours?.toFixed(2) || '',
                record.status, record.verificationMethod, vData,
            ].map(field => `"${field}"`).join(',');
        }),
        // 警語列（CSV 末尾）
        '',
        `"# 匯出時間: ${new Date().toLocaleString('zh-TW')}"`,
        `"# 模式: ${masked ? '脫敏匯出' : '完整匯出（含個資）'}"`,
        '"# 本檔可能含敏感個資，請依個資法妥善處理；不得另行傳遞至非經授權之第三方。"',
    ].join('\n');

    const BOM = '﻿';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `出勤紀錄_${month}${masked ? '_脫敏' : ''}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
```

**UI 兩個按鈕**（找到原本的「匯出 Excel」按鈕，改為並列兩顆）：

```tsx
{/* 找到 onClick={() => exportToExcel(filteredRecords, month)} 這個按鈕 */}
{/* 改為： */}
<button
  onClick={() => exportToExcel(filteredRecords, month, true)}
  className="..."
>
  📥 脫敏匯出 CSV
</button>
<button
  onClick={() => {
    if (window.confirm('即將匯出「完整」CSV，含未遮罩的員工姓名、IP、GPS 等個資。\n\n請確認檔案會妥善保管，並僅供授權人員使用。\n\n要繼續嗎？')) {
      exportToExcel(filteredRecords, month, false);
    }
  }}
  className="..."
>
  📥 完整匯出（含個資）
</button>
```

按鈕樣式：**脫敏匯出用主色（綠/藍）**，完整匯出用次色（灰）+ 文字暗示風險。Codex 可比照頁面內既有按鈕風格，**不要新增 Tailwind class**。

### 3.4 `components/admin/SalaryCalculation.tsx` 改動

`exportSalaryCSV`（第 147–167 行）改為**接收 `masked: boolean`**：

```tsx
import { maskName, maskEmpId } from '../../netlify/functions/utils/csvMasking';

const exportSalaryCSV = (salaries: SalaryDetail[], month: string, masked: boolean) => {
    const headers = ['員工編號', '姓名', '職位', '出勤天數', '總工時', '請假時數', '加班時數', '底薪', '加班費', '應發薪資', '勞保', '健保', '勞退', '請假扣薪', '扣除合計', '實發薪資'];
    const csvContent = [
        headers.join(','),
        ...salaries.map(s => [
            masked ? maskEmpId(s.empId) : s.empId,
            masked ? maskName(s.name) : s.name,
            s.position, s.totalWorkDays, s.totalWorkHours, s.totalLeaveHours, s.overtimeHours,
            s.baseSalary, s.overtimePay, s.grossSalary, s.laborInsurance, s.healthInsurance, s.laborPensionSelf,
            s.leaveDeduction, s.totalDeductions, s.netSalary,
        ].map(f => `"${f}"`).join(',')),
        '',
        `"# 匯出時間: ${new Date().toLocaleString('zh-TW')}"`,
        `"# 模式: ${masked ? '脫敏匯出（員工編號、姓名遮罩；薪資數字保留）' : '完整匯出（含個資）'}"`,
        '"# 薪資為極敏感資料，請依個資法妥善處理；不得另行傳遞至非經授權之第三方。"',
    ].join('\n');

    const BOM = '﻿';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `薪資明細_${month}${masked ? '_脫敏' : ''}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
```

**重要：薪資數字「不」脫敏。** 薪資 CSV 的主要用途就是給會計做月結，脫掉薪資數字就失去意義。脫敏只動 empId 與 name；員工識別交給「對照表」處理（後續可再切票）。

UI 同樣拆兩顆按鈕 + 確認對話框（複製 AttendanceLog 的模式即可）。

---

## 4. 驗收條件

### 4.1 量化（CI 自動跑）

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | **≥ 59 個測試全綠**（51 + 8 新增） |
| 3 | `npm run build` | 無 chunk size 警告，無新增 warning |

### 4.2 程式碼審查

- [ ] `csvMasking.ts` 是純函數（無 import 任何 firebase / react / I/O）
- [ ] 兩個 UI 元件只 import `csvMasking`，不重新實作 mask 邏輯
- [ ] 完整匯出按鈕**必有** `window.confirm` 二次確認
- [ ] CSV 末尾**必有**警語列
- [ ] 檔名脫敏版含 `_脫敏` 後綴

### 4.3 手動煙霧測試（npm run dev）

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 進入「出勤紀錄」，點「脫敏匯出 CSV」 | 直接下載；用 Excel 開啟看到姓名是「王○明」格式、IP 是「192.168.\*.\*」 |
| 2 | 點「完整匯出（含個資）」 | 跳出 confirm 對話框；按取消不下載；按確定下載完整版 |
| 3 | 兩個檔案末尾都有匯出時間 + 模式 + 警語 3 行 |  |
| 4 | 進入「薪資計算」，重複 1 + 2 | 同上行為；薪資數字（底薪、加班費等）兩版皆完整 |
| 5 | 脫敏版檔名後綴 `_脫敏` | 兩支頁面都符合 |

---

## 5. Commit message 模板

```
feat(security): CSV PII masking for attendance and salary exports (Phase 7.7)

- Add netlify/functions/utils/csvMasking.ts (maskName / maskEmpId /
  maskIP / maskGPS / maskVerificationData) as pure functions
- AttendanceLog & SalaryCalculation: split CSV export into two buttons
  - 脫敏匯出 (masked, default action)
  - 完整匯出 (full PII, requires window.confirm)
- Append metadata + privacy notice rows to every exported CSV
- Filename suffix _脫敏 for masked variant
- Add tests/csvMasking.test.ts — 10 unit tests (59 Vitest total all green)
- Resolves SDD A5 (CSV exports contain unmasked PII)

Note: salary figures are intentionally NOT masked even in the masked
export — they are the export's primary purpose for accountants. Only
empId and name are obscured.
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 改 `api.ts` 或新增 API endpoint | 純前端可解 |
| 動 `types.ts` | 不需新型別 |
| 改既有測試 | 51 個既有測試必須保持綠 |
| 改 `vite.config.ts` | 不需 |
| 把脫敏邏輯做成 systemConfig 設定 | 過度設計，後續再切票 |
| 加密碼保護 / OTP / 浮水印 | 超出工單範圍，後續 Phase 8 安全強化再做 |
| 「順便」重構 AttendanceLog 或 SalaryCalculation | 嚴禁，請只改 CSV 函數與按鈕區 |

---

## 7. 完工回報格式

請依此格式回報（複製貼上）：

```
Phase 7.7 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 59 | __ |
| build 警告 | 無 | __ |
| 兩支頁面雙按鈕 | 完整 + 脫敏 | __ |
| CSV 末尾警語 | 3 行 | __ |
| 完整匯出 confirm | 有 | __ |

新增測試：
- csvMasking.test.ts ___ 個案例

手動煙霧測試：
- [ ] 4.3 § 1 脫敏 CSV 姓名/IP 確實遮罩
- [ ] 4.3 § 2 完整匯出有 confirm
- [ ] 4.3 § 3 CSV 末尾警語
- [ ] 4.3 § 4 薪資數字完整
- [ ] 4.3 § 5 檔名後綴

備註（如有 follow-up 或不確定處）：
```

---

## 8. 後續可能 follow-up（不是這張工單的範圍）

- 「對照表」功能：脫敏 CSV + 加密員工編號對照檔（雙檔分流）
- 浮水印（每張 CSV 加匯出者 + 時間戳）
- 匯出操作寫入 `auditLogs`（後端工單）
- 員工可下載自己被匯出過幾次的紀錄（GDPR 透明性）
