# B2：案件後端、交易與 sandbox outbox（未部署）

工作分支 `fix/pr13-attendance-cases-b2`，繼承 B1 ab7abd4。前一獨立commit `8faf4fc`僅修B1兩個邊界問題，定向69項通過；B2增量應從8faf4fc開始看，不混作B1修復。沒有push、正式資料讀寫、UI、實際推播/email、scheduler或憑證配置。

## API 與既有授權邊界

新增 `list-attendance-cases`（empId/yearMonth/afterId）、`get-attendance-case`（caseId）、`scan-attendance-cases`（empId/yearMonth）、`act-attendance-case`（caseId/mode/operationId/reason/expectedRevision/expectedEvidenceVersion，assign另owner）。

沿用既有Employee/Admin/SuperAdmin：Employee只能查本人及explain本人未結案案件，不能scan、assign、resolve或reopen；Admin/SuperAdmin沿用既有全域出勤管理權限。沒有新tenant，也不宣稱已有逐員工指定主管scope；該模型仍缺。Owner僅能指定已存在管理者。案件DTO不回傳薪資、raw卡、verificationData、假單理由、套用hash或完整source refs；只顯示案件、原因、期間及必要歷程。

API拒絕client傳proof/observation/coverage/policy/actor/at/sourceVersion。resolve/reopen由server重新讀來源並執行detector；無clear證據不能resolve，clear不能任意reopen，沒有刪除來源的tombstone則維持未核，不把缺資料當clear。closed case不能以explain/request-info繞過reopen。assign/explain/request-info均寫actor、server time與必填reason；stale revision/evidence拒絕，operation重送內容不符拒絕。

## 持久化與交易

- `attendanceCases`：現行投影＋原history append保留，附scanMonth/sourceVersion。
- `attendanceCaseEvents`：每次變更使用create的不可變event，作audit；沒有刪除或覆寫歷史入口。
- `attendanceCaseCommands`：uid＋operationId去重，重送返回原結果。
- `attendanceCaseScans`：來源版本、actor/time、detectorVersion，`complete:false`與缺能力清單；不能當完整workflow已驗收。
- `attendanceCaseOutbox`／`attendanceOutboxEvents`：穩定event/recipient/sandbox/template+policyversion去重，紀錄claim/result。

scan與case處理使用既有runPayrollMutation及revision gate，同交易讀角色、來源、案件與月鎖後才寫case/event/outbox。檢查選定月份及新舊觀察完整受影響月份；鎖月拒絕，不改快照。每次變更最多100個新event、case歷程最多200且文檔500KB上限，超過整批拒絕，不裁掉歷史。B2尚未提供歸檔／歷史差額提案流程。

來源查詢最多讀501筆，每集合超過500拒絕，避免截斷後宣稱完整。仍需讀員工完整卡／假／申請及全域班表、換班、revision，再做相交判定；大型歷史資料需下一步索引化範圍入口，本批不宣稱production可擴充。舊班表沿用normalizeScheduleDoc，缺employee ID不猜姓名配對，coverage保持unknown。

通用scope observation存入時加月份namespace，避免五月覆蓋四月；實體來源case保持B1穩定key，保留過去受影響window，跨月不抹除舊證據。相同scan不新增case/event/outbox；scan摘要和共用revision仍可更新，這不表示重送產生新案件。

## Sandbox outbox 的明確限制

所有新intent預設held／sandbox；沒有部署的worker或Netlify schedule。`runAttendanceScanTrigger`預設disabled，測試可直接呼叫純入口；不設定正式排程。

`runSandboxOutbox`預設disabled；另需明確127.0.0.1:8086/8087與demo-chiayi-payroll，且adapter.kind=sandbox、policy=sandbox-retry-v1。只傳穩定job ID給fake adapter，無FCM/email provider、channel credentials或真發API。測試顯式opt-in才會claim。

原子租約60秒；最多3次，失敗backoff 60秒、120秒，第三次dead-letter；不刪案件。錯誤只存generic code，不存provider秘密。expired lease可恢復，stale lease不能覆蓋新結果。成功後不重送，並發worker只一個有效claim；job key包含event/recipient/channel/版本。同一次外部發送成功但ACK前crash仍可能at-least-once，本批fake測試不代表真provider exactly-once。真通知須另行批准、設定渠道與送達不確定策略。

## Preflight 與需求矩陣增量

|需求|本批狀態／界線|
|---|---|
|2.1 案件／12類|部分：server detector upsert、版本及source refs，B1未知政策仍unknown；非所有來源已可完整核實|
|2.2 申請與說明|部分：本人說明及管理者request-info，既有補卡核准證據沿用；完整補件／取消／重送UI仍B3|
|2.3／2.4|未擴建解釋假／OTcomp model；不由case決定扣薪或加班|
|2.5 通知／處理中心|部分：持久case/history/owner與sandbox outbox/retry；無UI、真通知或正式scheduler|
|6.1 preflight|讀入未解案件作CASE_UNRESOLVED，形式資格仍固定BLOCKED；scan.complete=false、來源未知或缺workflow皆不能轉正式READY|
|6.3 月鎖／歷史|新入口共用revision gate與完整受影響月份；鎖月拒絕，原snapshot不動，差額流程仍缺|
|7.1 權限|沿用全域出勤Admin角色，員工限本人；細分主管／人事scope未建立，薪資不進case DTO|
|8.1–8.3|正式2026-08全員資料仍未讀／未核；只有合成與demo emulator，正式NO GO|

ATTENDANCE_CASE_WORKFLOW及其他A門檻沒有移除。沒有完整scan證明時，既有試算完整度不代表正式ready。UI與更細scope、正式資料／效能驗收、production適用性仍未測。

## 驗證

最終：`npm test -- --configLoader runner` 23 files／504 passed／0 failed；`npm run test:emulator`（明示loopback/demo）2 files／30 passed／0 failed；合計534 passed。504包含A/B1既有489、獨立B1修復5項、B2新增10項API回歸；30包含A既有22與B2新增8項真實SDK/rules/交易測試，不與先前定向數字重複加總。`npm run typecheck`、`VITE_E2E=false npm run build -- --configLoader runner`及diff check通過。沒有本輪E2E/UI或正式環境測試。新測試涵蓋重掃／operation去重、權限、偽造proof、stale version、fresh resolve/reopen、鎖月rollback、source上限拒絕、跨月scope隔離、真實並行scan/transition、共享月鎖交易、outbox失敗backoff上限、並發lease及過期恢復、default-off／demo guard。

原有快照機制測試依A的測試邊界隔離正式資格；不可把它們視為正式月結放行。B2共享月鎖競態以synthetic lock transaction測試guard，明確不代表實際正式payroll lock獲准。


本機日誌：/tmp/b2-final-all.log、/tmp/b2-final-emulator.log、/tmp/b2-final-type.log、/tmp/b2-final-build.log。測試使用合成資料、mock auth及fake delivery；emulator使用官方暫存Java/jar，沒有production credentials。固定案例實際與預期皆一致；沒有以此宣稱正式八月差額為零。
