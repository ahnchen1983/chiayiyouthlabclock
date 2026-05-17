# 嘉義青年實驗室打卡系統 — v2.0 規劃提案 (SDD Proposal)

> **狀態：** Phase 5 已實作完成 (2026-04-10) ✅ ｜ Phase 6/7/8 規劃中
> **建立日期：** 2026-04-10
> **對應 v1.x SDD：** v1.6（Phase 1+2+3+4 已完成）→ v2.0（Phase 5 完成）
> **提案來源：** 客戶 V2 回報 + 系統面盤點

## 📌 v2.0 實作狀態速覽

| Phase | 內容 | 狀態 |
|-------|------|------|
| **5** 排班模型重構 | 5.1 StaffShift[] · 5.2 應到+覆蓋 · 5.3 時間軸 · 5.4 bug · 5.5 清空 · 5.6 遷移 · 5.8 警告 | ✅ **全部完成** |
| **6** 排班協作 | 換班/版本/月結鎖定/偏好 | ⬜ 規劃中 |
| **7** 系統健全化 | 7.1 Vitest ✅ · 7.4 CI ✅ · 7.2/7.3/7.5/7.6/7.7 待做 | 🟡 2/7 |
| **8** HR 補強 | 特休結轉 / 留停 / PDF / 月結報表 / 自助申請 | ⬜ 規劃中 |

---

## 1. 為什麼需要 v2.0？

v1.6 完成後客戶提出第二輪回報，加上開發過程累積的技術債，已超出單一 Phase 能容納的範圍，整理如下：

### 1.1 客戶 V2 回報

| # | 問題 | v1.6 現況 | v2.0 需求 |
|---|------|---------|---------|
| V2-1a | 假人名修改後還存在 | `initialize-database` 已不再寫假人名，但**既有資料庫的舊 dailySchedule 文件**沒被清理 | 補資料清理工具 / Onboarding wizard |
| V2-1b | 管理員無法設定當日「應到人數」 | 排班只有「實際排了幾人」，沒有「應到幾人」的標的 | ScheduleEvent 新增 `requiredHeadcount` 欄位 + 缺人檢核 |
| V2-2 | 出勤人員無法選擇個別上班時段（檢查是否時時刻刻有 2 人） | 一日只有一個 `shiftTime`，所有人共用 | **資料模型重構**：每人獨立時段 |
| V2-3 | 專責人員需要兩頭班（如三、四營業時間長） | 同上 | 同上，且允許同人同日多時段 |
| V2-4 | 休館(值班)若加兼職人員不會顯示在日曆 | `ScheduleManager.tsx:99` 條件式只允許「營運」顯示兼職 | 修 bug，並決定休館值班是否允許排兼職的政策 |
| V2-5 | 兼職人員時段可否個別調整？ | 不行，共用全日 shiftTime | 同 V2-2 |

### 1.2 v1.x 累積的技術債

| 類別 | 項目 | 嚴重度 |
|------|------|--------|
| 效能 | Bundle 已 504kB，vite 報 chunk size 警告 | 中 |
| 測試 | 0 個自動化測試（單元/整合/e2e 全無） | 高 |
| 觀測性 | 無錯誤監控（ErrorBoundary 只在客戶端記 console） | 中 |
| CI/CD | 無 GitHub Actions，沒人擋住壞 commit | 高 |
| 通知 | 仍用 60s 輪詢，浪費頻寬且延遲 | 低 |
| 安全 | A5「CSV 匯出含個資」尚未處理 | 中 |
| 假別 | 特休跨年結轉、留停扣除等勞基法細節未實作 | 低 |
| 排班 | Phase 3.5 衝突 API 做了但前端沒接 | 低 |

---

## 2. v2.0 的核心轉變

### 2.1 資料模型重構：ScheduleEvent

**目前（v1.6）：**
```typescript
interface ScheduleEvent {
    date: string;
    status: '營運' | '休館(值班)' | '休館';
    shiftTime: string;           // ← 全日只有一個時段
    staffA: string;              // 共用 shiftTime
    staffB: string;              // 共用 shiftTime
    partTime: string[];          // 全部共用 shiftTime
}
```

**v2.0 提案：**
```typescript
interface ScheduleEvent {
    date: string;
    status: '營運' | '休館(值班)' | '休館';
    openingHours?: string;       // 場館對外營業時段（如 "08:30-17:30"），僅顯示用
    requiredHeadcount: number;   // 應到人數（管理員設定）
    shifts: StaffShift[];        // ← 每位員工一筆班次
}

interface StaffShift {
    empId: string;
    name: string;                // 冗餘儲存方便顯示
    role: 'staffA' | 'staffB' | 'partTime';
    from: string;                // "08:30"
    to: string;                  // "13:00"
    note?: string;
}
```

**改動影響範圍：**
- `dailySchedule/{date}` 文件結構（破壞性，需 migration）
- `scheduleTemplate/{0..6}` 同上
- 薪資計算：`calculateSalaryForEmployee` 從 staffList 改讀 shifts，工時計算改為加總每人時段
- 遲到/早退判定：`determineClockStatus` 改為依該員工當日的 shifts 比對
- 打卡邏輯 `clock-in`：同上
- 排班對照 / 衝突偵測 / 排班 UI 全部受影響
- 員工自選班次 `openShifts` 認領後寫回的方式

### 2.2 兩頭班支援

同一員工同日可有多筆 `StaffShift`，例如：

```json
{
  "date": "2026-04-15",
  "status": "營運",
  "openingHours": "08:30-20:00",
  "requiredHeadcount": 2,
  "shifts": [
    { "empId": "EMP001", "name": "千雯", "role": "staffA", "from": "08:30", "to": "13:00" },
    { "empId": "EMP001", "name": "千雯", "role": "staffA", "from": "17:00", "to": "20:00" },
    { "empId": "EMP002", "name": "小明", "role": "staffB", "from": "13:00", "to": "20:00" },
    { "empId": "EMP005", "name": "PT甲", "role": "partTime", "from": "10:00", "to": "14:00" }
  ]
}
```

### 2.3 缺勤檢核

```typescript
function checkCoverage(event: ScheduleEvent): Coverage[] {
    // 將 openingHours 切成 30 分鐘區段
    // 對每個區段檢查：覆蓋人數 >= requiredHeadcount？
    // 回傳缺人時段
}
```

排班 UI 即時顯示「⚠️ 12:00-13:00 只有 1 人」。

---

## 3. v2.0 功能藍圖

按優先序排列：

### Phase 5：排班模型重構（核心 — 解決 V2 客戶需求）

| 編號 | 項目 | 對應問題 |
|------|------|---------|
| 5.1 | ScheduleEvent 升級為 `shifts: StaffShift[]` | V2-2 / V2-3 / V2-5 |
| 5.2 | 應到人數欄位 + 時段覆蓋檢核 | V2-1b |
| 5.3 | 排班 UI 重做：時間軸視覺化 + 每人時段編輯 | V2-2 / V2-3 |
| 5.4 | 修 bug：休館(值班) 兼職顯示 | V2-4 |
| 5.5 | Onboarding wizard：首次部署清除示範資料 | V2-1a |
| 5.6 | 薪資計算 / 遲到判定 / 打卡比對遷移到 shifts | 5.1 連動 |
| 5.7 | 資料 migration script：v1 → v2 dailySchedule 轉換 | 5.1 連動 |
| 5.8 | 排班衝突即時警告（前端整合 Phase 3.5 API） | 技術債 |

### Phase 6：排班協作

| 編號 | 項目 |
|------|------|
| 6.1 | 換班/替班申請（員工互換班次 + 對方確認） |
| 6.2 | 排班版本歷史（每次儲存留快照，可回溯） |
| 6.3 | 月結鎖定：管理員結算薪資後該月排班/打卡不可改 |
| 6.4 | 員工偏好班次設定（不可上班的日期/時段，排班時警示） |

### Phase 7：系統健全化（技術債）

| 編號 | 項目 |
|------|------|
| 7.1 | Vitest 單元測試：薪資計算、遲到判定、餘額計算 |
| 7.2 | Playwright e2e：核心流程（登入→打卡→請假→審核） |
| 7.3 | Code splitting：dashboard 各 view 改 lazy load，bundle 拆分 |
| 7.4 | GitHub Actions CI：tsc + build + 測試 |
| 7.5 | 錯誤監控：整合 Sentry 或自架 |
| 7.6 | FCM Push 通知取代 60s 輪詢 |
| 7.7 | CSV 匯出個資脫敏（A5） |

### Phase 8：HR 細節補強

| 編號 | 項目 |
|------|------|
| 8.1 | 特休跨年結轉（依勞基法可保留 1 年） |
| 8.2 | 留停 / 育嬰假期間餘額不扣除 |
| 8.3 | 出勤紀錄 PDF 列印（員工/管理員） |
| 8.4 | 月結報表：管理員月度統計（總工時、加班、請假分布） |
| 8.5 | 員工自助申請：特休、留停（走審核流程） |

---

## 4. Migration 策略

### 4.1 dailySchedule 轉換

```javascript
// 從 v1
{ shiftTime: "08:30-17:30", staffA: "千雯", staffB: "小明", partTime: ["PT甲"] }
// 轉為 v2
{
  openingHours: "08:30-17:30",
  requiredHeadcount: 2,
  shifts: [
    { empId, name: "千雯", role: "staffA", from: "08:30", to: "17:30" },
    { empId, name: "小明", role: "staffB", from: "08:30", to: "17:30" },
    { empId, name: "PT甲", role: "partTime", from: "08:30", to: "17:30" }
  ]
}
```

寫一支 `migrate-schedule-v2` action（SuperAdmin only），讀全部 `dailySchedule` 與 `scheduleTemplate` 文件，逐一轉換，並備份到 `_archive_v1/dailySchedule_{date}` 以利回滾。

### 4.2 既有打卡紀錄

不需轉換。`clockRecords` 結構不變，只是「比對排班」的邏輯改讀新欄位。

### 4.3 部署策略

採 **feature flag**：
- 新增 `systemConfig.scheduleModelVersion: 1 | 2`
- 預設仍為 1，後端兩套邏輯並存
- migration 完成後手動切換到 2
- 切換後保留舊欄位 1 個月，確認穩定再清

---

## 5. 已知風險

| 風險 | 緩解 |
|------|------|
| ScheduleEvent 改動牽動 8+ 個檔案，回歸測試成本高 | Phase 7.1+7.2 先把測試打底再動 |
| 兩頭班讓 UI 複雜度暴增 | 排班 UI 限定 1 人最多 2 段，過多時提示拆兩位員工 |
| 應到人數檢核可能干擾管理員（彈紅字過多） | 設定為「警示不阻擋」，儲存時提醒但允許 |
| 既有資料庫舊 dailySchedule 殘留假人名 | Onboarding wizard 提供「重置該月排班」按鈕 |

---

## 6. 執行順序（決策後）

```
Step 1  Phase 7.1 + 7.4         測試骨架 + CI            ~1 天
Step 2  Phase 5.4 + 5.5 + 5.8   止血修正 + Onboarding   ~1~2 天
        ├─ 5.4 修 bug：休館(值班) 顯示兼職
        ├─ 5.5 清空舊 dailySchedule 工具（取代原 migration）
        └─ 5.8 排班衝突即時警告
Step 3  Phase 5.1 + 5.6         資料模型重構（v2 主體）   ~3~5 天
        ├─ 5.1 StaffShift[] 結構（兩頭班 ≤ 2 段）
        └─ 5.6 薪資/遲到/打卡比對遷移
Step 4  Phase 5.2 + 5.3         應到人數 + 新排班 UI    ~2~3 天
        ├─ 5.2 應到人數欄位 + 缺人警示（不阻擋）
        └─ 5.3 時間軸視覺化 + 每人時段編輯
Step 5  Phase 6 / 7 剩餘 / 8    視優先序滾動
```

**取消的工項：** 原 Phase 5.7（v1→v2 migration script），因決策 4 改為清空重建。
**先打測試底再重構** 已由決策 5 確認。

---

## 7. 客戶決策（2026-04-10 確認）

| # | 問題 | 決策 | 影響 |
|---|------|------|------|
| 1 | 休館(值班) 是否允許排兼職？ | **✅ 允許** | 5.4 修 bug 的修法為「補上顯示」而非「禁止排」 |
| 2 | 兩頭班是否限定 1 人最多 2 段？ | **✅ 限定 ≤ 2 段** | 5.1 資料模型容許多段，5.3 UI 在新增第 3 段時阻擋 |
| 3 | 應到人數不足時阻擋還是警示？ | **⚠️ 僅警示** | 5.2 儲存不阻擋，但 UI 紅字提示 + 排班一覽顯示警示 icon |
| 4 | 舊 dailySchedule 保留轉換還是清空重建？ | **🗑️ 清空重建** | **5.7 migration script 取消**，改為簡單的「清空 dailySchedule」工具，併入 5.5 Onboarding wizard |
| 5 | Phase 5 是否先做測試骨架？ | **✅ 先做 7.1+7.4** | 執行順序：Phase 7.1 + 7.4 → Phase 5.4/5.5/5.8 → Phase 5.1/5.6 → Phase 5.2/5.3 |

### 7.1 決策衍生的範圍調整

- **Phase 5.7（v1→v2 migration）取消** — 直接清空重建，省下 1~2 天，但需要使用者在升級前自行 export 舊資料（若需保留歷史）。
- **scheduleTemplate 也清空重建** — 模板亦改為 v2 結構，初始化或 Onboarding 時建立空白 v2 模板。
- **休館(值班) UI 流程**：營運狀態 = 休館(值班) 時，仍可在 EditModal 勾選兼職人員，且日曆顯示 PT 列表。
- **兩頭班 UI**：每位員工旁有「+ 新增第二段」按鈕，達 2 段時按鈕變灰並顯示「已達上限」。
- **應到人數警示樣式**：日曆格子右上角顯示 ⚠️ icon + tooltip「12:00-13:00 缺 1 人」；儲存時不阻擋。
