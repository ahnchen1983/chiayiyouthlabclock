# Phase 8.5 — 員工自助申請流程（特休 / 留停）工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Codex（規劃）
> **負責實作：** Claude / Codex
> **預估工期：** 1–1.5 天
> **對應 Roadmap：** Phase 8.5
> **對應 EXECUTION_PLAN：** C2 — 員工自助申請流程
> **依存：** Phase 4.1 假別餘額、Phase 8.1 特休跨年結轉、Phase 8.2 留停凍結、Phase 6.3 月結鎖定

---

## 1. 目標

目前員工已可從 `LeaveRequestForm` 送一般請假（含特休），Admin 也可審核請假；但「留停 / 育嬰假」只能由 Admin 在 `EmployeeManager` 手動設定，缺少員工自助申請、審核紀錄、通知與 audit trail。

本工單目標：

1. **保留並強化既有特休請假流程**：特休仍使用 `leaveRequests` + `submit-leave-request` + `approve-leave`，不得另建重複流程。
2. **新增留停自助申請流程**：員工提出留停期間與理由，Admin 審核後自動更新員工狀態與 `leaveOfAbsenceStart / leaveOfAbsenceEnd`。
3. **新增 Admin 審核入口**：在後台可審核留停申請，與請假審核分區但不混淆資料模型。
4. **建立完整追蹤**：通知、audit log、拒絕理由、已核准不可重複審核。
5. **補測試**：新增純函數驗證留停申請日期、狀態轉換、月結鎖定邊界。

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| 特休自助申請 | 已有基礎流程 | 強化 UI 文案與餘額提示，不重做資料模型 |
| 留停自助申請 | 無 | 新增員工申請 + Admin 審核 |
| 後端 actions | 既有 | +4（submit / list mine / list all / approve LOA） |
| 新 collection | 無 | +1 `leaveOfAbsenceRequests` |
| Vitest 總數 | 145 | ≥ 150 |
| typecheck / test / build | 全綠 | 全綠 |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `types.ts` | **加** `LeaveOfAbsenceRequest` / status 型別 |
| `netlify/functions/utils/selfServiceRequests.ts` | **新增** — 留停申請純驗證 helper |
| `netlify/functions/api.ts` | **改** — 加 4 個 LOA actions；核准時更新 employee |
| `services/googleAppsScriptAPI.ts` | **改** — 加 LOA API helper |
| `components/employee/LeaveRequestForm.tsx` | **改** — 特休餘額提示更清楚，連到留停申請入口 |
| `components/employee/LeaveOfAbsenceRequestForm.tsx` | **新增** — 員工留停申請 UI |
| `components/admin/LeaveOfAbsenceApprovalQueue.tsx` | **新增** — Admin 留停審核 UI |
| `pages/AdminDashboard.tsx` | **改** — Admin+ 增加留停審核 nav；我的功能增加留停申請 |
| `pages/EmployeeDashboard.tsx` | **改** — 員工側 nav 增加留停申請 |
| `tests/selfServiceRequests.test.ts` | **新增** — ≥ 5 個測試 |

**不要動：**

- ❌ `LeaveType` 不要新增「留停」；留停不是日常請假假別，應走獨立 collection
- ❌ 不重寫 `leaveRequests` 結構
- ❌ 不改 `computeAnnualLeaveDays` / `computeLeaveBalanceWithCarryover`
- ❌ 不改 `calculateSalaryForEmployee`
- ❌ 不改 `monthLock.ts`
- ❌ 不安裝新套件
- ❌ 不做附件上傳、PDF、Email 寄送、薪資折算

---

## 3. 資料模型

### 3.1 `types.ts`

```ts
export type LeaveOfAbsenceRequestStatus = '待審核' | '核准' | '駁回';

export interface LeaveOfAbsenceRequest {
    id: string;
    empId: string;
    name: string;
    startDate: string;       // YYYY-MM-DD
    endDate?: string;        // YYYY-MM-DD；空值 = 仍在留停
    reason: string;
    contactInfo?: string;    // 留停期間聯絡方式，可選
    requestDate: string;     // ISO
    status: LeaveOfAbsenceRequestStatus;
    approver?: string;
    approvalDate?: string;
    rejectReason?: string;
}
```

### 3.2 Firestore collection

`leaveOfAbsenceRequests/{autoId}`

欄位同 `LeaveOfAbsenceRequest`。不需要 migration。

核准時更新：

```ts
employees/{empId}.status = '留停'
employees/{empId}.leaveOfAbsenceStart = request.startDate
employees/{empId}.leaveOfAbsenceEnd = request.endDate || ''
```

駁回時不改 employee。

---

## 4. 後端規格

### 4.1 純函數 helper

新增 `netlify/functions/utils/selfServiceRequests.ts`：

```ts
export const validateLeaveOfAbsenceRequest = (
    startDate: string,
    endDate: string | undefined,
    reason: string,
    today: Date = new Date(),
): string | null => {
    // null = valid；string = error message
};
```

驗證規則：

- `startDate` 必填且需為 `YYYY-MM-DD`
- `endDate` 可空；若有值也需為 `YYYY-MM-DD`
- `endDate` 若有值，必須 >= `startDate`
- `reason.trim().length >= 5`
- `startDate` 不可早於今日往前 30 天（避免員工自行 retroactive 太久）
- 不檢查法規資格，先交由 Admin 審核

另加：

```ts
export const isTerminalLoaStatus = (status: LeaveOfAbsenceRequestStatus): boolean =>
    status === '核准' || status === '駁回';
```

### 4.2 `api.ts` 新增 actions

#### `submit-leave-of-absence-request`

權限：登入者本人。

流程：

1. 讀 `employees/{uid}`，不存在回 404。
2. 呼叫 `validateLeaveOfAbsenceRequest`。
3. 若員工 `status === '留停'` 且沒有 `leaveOfAbsenceEnd`，回 400「目前已在留停中」。
4. 查同員工是否已有 `status === '待審核'` 的 LOA request，有則回 400。
5. 寫入 `leaveOfAbsenceRequests`。
6. 寫通知給 Admin/SuperAdmin（若現有通知 helper 無廣播，可先寫給 `ADMIN`，並在備註列為 follow-up）。
7. 寫 audit log：`提交留停申請`。

#### `get-my-leave-of-absence-requests`

權限：登入者本人。

回傳該員工自己的 LOA requests，依 `requestDate desc` 排序。Firestore 若缺複合 index，先讀後端排序即可。

#### `get-leave-of-absence-requests`

權限：Admin+。

回傳所有 LOA requests，預設待審核在前，再依 `requestDate desc`。

#### `approve-leave-of-absence-request`

權限：Admin+。

payload：

```ts
{
  requestId: string;
  status: '核准' | '駁回';
  approverName: string;
  rejectReason?: string;
}
```

流程：

1. 讀 request，不存在回 404。
2. 若 request 不是 `待審核`，回 400，避免重複審核。
3. 若 status 是 `駁回`，`rejectReason.trim().length >= 2`。
4. 月結鎖定檢查：對 `request.startDate` 呼叫 `assertMonthNotLocked(startDate)`；若鎖定，回 423。
5. 核准：
   - 更新 request status / approver / approvalDate
   - 更新 employee 狀態與留停期間
   - 寫 audit log：`核准留停`
   - 寫通知給員工
6. 駁回：
   - 更新 request status / approver / approvalDate / rejectReason
   - 不改 employee
   - 寫 audit log：`駁回留停`
   - 寫通知給員工

---

## 5. 前端規格

### 5.1 員工側：`LeaveRequestForm.tsx`

保留既有一般請假表單。

要補強：

- 當 `leaveType === LeaveType.Annual` 時，顯示：
  - 今年新給時數
  - 去年結轉時數
  - 結轉失效日
  - 已失效時數（若有）
- 文案：`特休會依剩餘餘額檢查；留停請使用「留停申請」頁面。`
- 不新增留停到假別 dropdown。

### 5.2 員工側：新增 `LeaveOfAbsenceRequestForm.tsx`

功能：

- 顯示員工目前留停狀態（可由 `apiGetEmployee()` 或新 action 回傳；建議用既有 `apiGetEmployee(user.id)`）
- 表單欄位：
  - 留停起始日（必填）
  - 預計結束日（可空）
  - 留停事由（必填，至少 5 字）
  - 留停期間聯絡方式（可選）
- 顯示自己過去 LOA requests（狀態、日期、審核人、拒絕理由）
- 若已有待審核 LOA request，送出按鈕 disabled。
- 若目前已在留停中且沒有結束日，送出按鈕 disabled。

### 5.3 Admin 側：新增 `LeaveOfAbsenceApprovalQueue.tsx`

功能：

- 列出所有 LOA requests，待審核排前。
- 可切換 filter：全部 / 待審核 / 已核准 / 已駁回。
- 待審核卡片顯示：
  - 員工姓名與 empId
  - 留停期間
  - 事由
  - 申請時間
  - 核准 / 駁回
- 駁回需填理由（至少 2 字）。
- 核准前 confirm，提醒「核准後會把員工狀態改為留停，並影響特休年資計算」。

### 5.4 Dashboard 整合

`pages/AdminDashboard.tsx`：

- lazy import `LeaveOfAbsenceRequestForm`
- lazy import `LeaveOfAbsenceApprovalQueue`
- Admin+ nav：
  - `留停審核` 放在 `請假審核` 後、`補打卡審核` 前
- 我的功能：
  - `留停申請` 放在 `我的請假` 後、`補打卡申請` 前

`pages/EmployeeDashboard.tsx`：

- 新增 `leaveOfAbsence` view
- nav 加 `留停申請`

---

## 6. 測試規格

新增 `tests/selfServiceRequests.test.ts`，至少 5 個案例：

1. `validateLeaveOfAbsenceRequest`：合法資料回 `null`
2. startDate 格式錯誤 → 回錯誤
3. endDate 早於 startDate → 回錯誤
4. reason 少於 5 字 → 回錯誤
5. startDate 早於今日 30 天以上 → 回錯誤
6. `isTerminalLoaStatus`：核准 / 駁回為 true，待審核為 false

可選加測：

- endDate 空值合法
- endDate 等於 startDate 合法

---

## 7. 驗收條件

### 7.1 自動驗證

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | ≥ 150 tests 全綠 |
| 3 | `npm run build` | pass |
| 4 | `rg "LeaveType\\.LeaveOfAbsence|留停'\\s*," types.ts components netlify` | 不應出現把留停塞進 `LeaveType` 的改法 |

### 7.2 程式碼審查

- [ ] 特休仍走既有 `leaveRequests`，沒有新建 annual leave request collection
- [ ] 留停走 `leaveOfAbsenceRequests`
- [ ] 核准 LOA 時才改 employee 狀態與留停期間
- [ ] 駁回 LOA 不改 employee
- [ ] 已核准 / 已駁回 request 不可重複審核
- [ ] LOA startDate 月份若已月結鎖定，審核應回 423
- [ ] `computeAnnualLeaveDays` / `computeLeaveBalanceWithCarryover` 未改
- [ ] 通知與 audit log 有寫入

### 7.3 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 員工送出留停申請 | 顯示成功，列表出現待審核 |
| 2 | 同員工再次送出 LOA | 被擋，提示已有待審核申請 |
| 3 | Admin 進「留停審核」核准 | request 變核准，Employee 狀態變留停 |
| 4 | 員工假別餘額頁 | 特休年資計算納入留停凍結 |
| 5 | Admin 駁回另一筆 LOA | request 變駁回，Employee 不變，員工看得到拒絕理由 |
| 6 | 對已鎖定月份的 startDate 審核 | 回 423，不可核准 / 駁回 |
| 7 | 特休請假表單 | 沒有「留停」假別；Annual 顯示結轉/失效資訊 |

---

## 8. Commit message 模板

```text
feat(hr): employee self-service LOA requests (Phase 8.5)

- Add LeaveOfAbsenceRequest type and leaveOfAbsenceRequests collection contract
- Add selfServiceRequests pure validation helpers
- Add submit/list/approve LOA API actions with Admin+ approval
- Approval updates employee status and leaveOfAbsenceStart/End
- Rejection keeps employee unchanged and stores rejectReason
- Add employee LOA request form and Admin approval queue
- Keep annual leave on existing leaveRequests flow; do not add LOA to LeaveType
- Add tests/selfServiceRequests.test.ts

Closes Phase 8.5
```

---

## 9. 完工回報格式

```md
Phase 8.5 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest 總數 | ≥ 150 | __ |
| build | pass | __ |
| LOA actions | 4 個 | __ |
| LeaveType 未新增留停 | 是 | __ |
| 核准更新 employee | 是 | __ |
| 駁回不改 employee | 是 | __ |
| 月結鎖定擋 retroactive 審核 | 423 | __ |

新增測試：___ 個案例

手動煙霧測試：
- [ ] 員工送出 LOA
- [ ] 重複待審核被擋
- [ ] Admin 核准後 employee 狀態變留停
- [ ] Admin 駁回後 employee 不變
- [ ] 鎖定月份審核回 423
- [ ] 特休請假 UI 仍正常

備註：
```

---

## 10. 後續可能 follow-up

- LOA 附件上傳（育嬰留停證明等）
- LOA 回任申請流程（員工主動申請結束留停）
- HR request 統一中心（補打卡 / 請假 / 留停）
- Admin 批次匯出 LOA 申請紀錄
- 通知廣播改為查所有 Admin/SuperAdmin，而非單一 ADMIN
