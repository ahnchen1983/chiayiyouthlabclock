# PR13 日別來源定位（工作包 1）

日期：2026-10-25。基準 PR14 `0f4cf35`。目的：定位使用者確認的「例假／休息日由個人班表指定」在本系統的實際標記與來源。本文件只記錄程式面盤點與正式資料讀取狀態，不補出任何日別；正式計薪仍 NO GO。

## 已確認（不重問）

公司有區分例假與休息日，依個人班表逐人指定，不是固定星期；八月完整班表在這套系統。

## 程式面盤點結果：系統沒有可保存個人日別的欄位或畫面

| 位置 | 內容 | 能否表示例假／休息日 |
| --- | --- | --- |
| `types.ts` `ScheduleEvent` | `date`、`dayOfWeek`、`status`（營運／休館／休館(值班)）、`openingHours`、`requiredHeadcount`、`shifts` | 否；`status` 是場館狀態，不是個人日別 |
| `types.ts` `StaffShift` | `empId`、`name`、`role`（staffA／staffB／partTime／remoteWork／businessTrip）、`from`、`to`、`endDateOffset`、`note?` | 否；`role` 無休假值。`note` 型別存在，但排班編輯器未提供輸入 |
| `types.ts` `StaffPreference` | `blockedWeekdays`、`blockedDates`、`preferredDates`、`note` | 否；是員工不可排／偏好，不是公司指定 |
| `types.ts` `LeaveType` | 事假、病假、特休、其他、公出、出差、遠端工作 | 否；無例假／休息日／排休 |
| `components/admin/ScheduleManager.tsx` | 編輯班段與版本備註 | 無日別輸入 |
| `components/employee/MyScheduleCalendar.tsx`、`FullScheduleCalendar.tsx` | 顯示班段 | 無例假／休息日標示 |
| API 出勤對照 `'休假'` | 由已核准假單推導 | 否；不是日別 |
| `dayTypeCalendars/{id}`（C2a 契約） | `status:'approved'`、`version`、`approvedBy`、`approvedAt`、`employeeIds`、`days{date:dayType}`，由 `effectiveMaster` 讀取 | 是正確的目標契約，但**沒有任何 API／UI 建立它**，只有測試 seed；正式盤點 0 份 |

結論：依現有程式，八月逐人日別無法存於系統的任何結構化欄位。若八月指定確實在系統內，只可能藏在非結構化位置（例如經其他途徑寫入的 `shifts[].note`、日文件的額外欄位），或者「個人班表」指的是系統外的檔案或紙本。未排班、場館休館或偏好都不能推定為日別。

## 正式資料讀取狀態

本輪嘗試以既有 Firebase CLI 登入做唯讀查核（僅欄位名稱與關鍵字匿名計數，不輸出姓名、編號、備註原文或薪額），被本機自動權限檢查拒絕（Production Reads）。未重試、未換通道。**正式資料中是否有非結構化標記，本輪未驗。**

## 使用者回答（2026-10-25）與處理

使用者確認：日別在系統後台「偏好設定」由每人自行設定，且**偏好設定沒有區分例假與休息日**（只有不可上班星期／日期與備註）。因此：

- 現有偏好資料不能直接當成日別：不分例假／休息日、是員工意願而非核定指定，且只保存最新狀態、無八月當時版本。
- 使用者選擇「加正式指定」。已實作：偏好設定新增逐月例假／休息日指定，另一位管理者核定後產生 `dayTypeCalendars` 版本；管理者可附原因代為補錄八月。詳 SDD「個人例假／休息日」與 `CHANGELOG` 2026-10-25。
- 八月日別仍待：由管理者依當時實際安排補錄並經另一位管理者核定，或員工自行補送後核定。未核定前八月日別一律 `unknown`。
