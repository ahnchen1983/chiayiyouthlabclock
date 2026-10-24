# B1：純出勤異常判定與版本化案件契約

基準 `05dd3bc9d7aff54ae0bebfb8cc476e5a5bfe8d9b`；分支 `fix/pr13-attendance-cases-b1`。A未改，正式月結仍由A必要能力門檻阻擋。核對範圍2026-08全體正兼職及當月到離職／留停人員；本批只有固定合成案例，未讀正式資料。

## 本批 owned files 與呼叫方式

- `attendanceCaseTypes.ts`：12類CaseType、CaseObservation、AttendanceCase、append-only history、既有Clock/Leave/Makeup/LOA/Swap型別adapter及outbox契約。
- `attendanceCaseDetector.ts`：`detectAttendanceCases(input)`，只吃顯式 employee、完整絕對分鐘window、asOf、來源資料、coverage、policy；無IO、無Date.now、無薪資決策。沿用 `clockInterval`、`confirmedWork`、`validLeaveAllocations`、A的 `hasAppliedMakeup`。
- `attendanceCaseLifecycle.ts`：`caseKey`、`reconcileCase`、`transitionCase`、`outboxIntent`。沒有DB/transaction/queue worker；transition僅驗版本／流程，B2仍須server scope授權。
- `tests/attendanceCases.test.ts`：逐類正例／反例／未知來源、時間與來源邊界、案件狀態、版本及冪等測試。

前三個檔案位於 `netlify/functions/utils/`；不用改API、主types、rules、UI或薪制引擎。函式尚未接任何正式入口，不建立正式case。

## 識別與來源規則

identity以schema namespace＋employee＋type＋anchor hash組成，與時間內容、policy版本及每次掃描時間分離。舊班表沒有穩定班段ID，因此明示使用`employee/date/type`每日聚合anchor，並不是假裝完成逐班段occurrence migration；同日分段仍逐段計算，再聚合結果。一日同類不會因調整時間／重排array重複增生。卡用recordId；申請用collection/requestId。

evidenceVersion另外包含detector version、完整期間、觀察結果、policy與排序後來源version refs；改資料會增加revision。清楚的clear可resolve，新的finding或unknown可reopen原case並保留原事件。相同掃描重跑不增加history；同operation重送不增事件，衝突operation/stale revision拒絕。遺漏一個observation絕不代表該case已解決：刪除來源的tombstone/全範圍清除證明留待B2。

同來源ID有多份投影會聚合一個識別，來源衝突待核，不任選最後一筆。缺ID／壞window或日期無法辨識時丟出契約錯誤，B2必須將scan標為失敗／不完整，不能catch後當空陣列all-clear。

coverage是未來可信server adapter對完整讀取的斷言，**不是client可上傳的正式豁免旗標**；B1未提供API。完整性未知會留下scope unknown observation；所有輸出settlementEligibility固定BLOCKED並保留workflow、scope、transaction、delivery、OTcomp、production reconciliation缺口。B1契約不會清除A的ATTENDANCE_CASE_WORKFLOW gap。

## 人工明示基準／12類驗收

合成fixture：SYNTH，2026-04-01，已確認09–17的480分鐘，一般班09–17；明示容許0分鐘、結班寬限0、核准休息規則explicit、淨應工作480分鐘（綁schedule version），無真實員工或正式公司政策。asOf為事後明示時間。

|類型|正例輸入／人工預期|反例／未知策略|
|---|---|---|
|缺in|只有out17，finding|完整in/out clear；壞字串unknown|
|缺out|in09、過已知結班點無out，finding|完整out clear；進行中／結班政策未知unknown|
|整段無卡無核准解釋|有效雇用內班09–17、來源完整、無卡無解釋，候選finding|完整卡或充分核准假/外勤解釋clear；核准但缺分配unknown；不判曠職扣薪|
|遲到|10–17對09–17且容許0，finding|09–17 clear；寬限未知unknown；部分核准解釋尚無可靠淨邊界時unknown|
|早退|09–16對09–17且容許0，finding|09–17 clear；政策／來源未知unknown|
|工時差|已確認420分鐘對明示淨480，finding|480對480 clear；休息或綁定基準過期unknown；部分假／外勤不猜淨工時|
|有卡無班|有效卡09–17且完整班表無相交班段，finding|有相交班段clear；班表缺漏unknown；不抹去實際工作|
|重複/順序/重疊|兩record相交、相同ID衝突、絕對時間逆序，finding|正常單卡clear；歧義舊HH:mm unknown；不刪原卡|
|跨夜錯日|in的Taipei日期不符record日期，finding|完整跨夜與明示歸屬clear；舊22–06或未知歸屬unknown|
|卡假重疊|已核09–17工作與核准13–17休假相交，finding|無假clear；公出差/遠端不是休假，不列此衝突；缺工作覆核／假分配unknown|
|pending|既有申請待審，finding|明確終止狀態clear；未知狀態／來源缺漏unknown；無OTcomp模型仍列缺口|
|approved未反映|核准補至18、卡仍17且無revision，finding|完整來源鏈沿用A驗證；無核准輸入clear；舊換班沒有投影鏈unknown，不能只看approved|

額外驗證：跨月底的前一日完整卡／班段與次月申請；相同月份但不相交日期不納入日掃描；到離職區間外不推定班表出勤義務；資料排序／掃描時間不使ID或history增生；policy及source version改動保持identity但更新evidence；resolve/reopen/history保留；未知資料不能手動close/cancel；outbox重建同key且永遠held/sandbox。

## B2/B3 留存接口及未完成

- 沒有持久化、transaction、revision gate整合、scope ACL、source query、scheduler、案件API或UI。正式月結仍全面阻擋。
- 狀態純函式不能替代資料庫原子性或權限。B2需要在同transaction核實source version、optimistic revision與月鎖，且case/event/outbox同寫；source coverage不能相信client。
- 補卡沿用A已核准投影證據；假單沿用已核准且有approver/time與有效分配；LOA須與員工留停投影一致。這不是完整歷史調整流程。舊swap缺少before/after映射維持unknown。
- legacy無固定shift ID採daily聚合，不提供每段獨立case UI。逐班段ID遷移、刪除來源清除證明、長假及休息細節、部分核准原因淨邊界、OTcomp adapter待後續。
- outbox僅schema／穩定intent，永遠held且sandbox；無發送、重試執行、時機頻率設定或真通知。不得宣稱exactly-once外部投遞。
- 正式2026-08資料、效能／全量scan、真併發、授權與UI驗收未做。每條finding只是候選異常，所有observation的payrollDecision皆none。

## 本輪驗證

`npm test -- --configLoader runner`：22 files、489 passed、0 failed（A基準425＋B1新增64）；所有12類均有finding正例、clear反例及unknown來源案例，額外跨月／版本／生命週期邊界通過。早期定向56、58項與全套485項不重複加總。固定輸入及人工預期在tests/attendanceCases.test.ts；本輪最終各assert實際與預期一致，無薪資金額測試或真資料差額聲稱。

最後 `npm run typecheck` 與 `VITE_E2E=false npm run build -- --configLoader runner` 均通過；`git diff --check` 通過。本批無API/UI接線，未跑emulator/E2E、通知、production、scope授權或效能測試；不把A前版數字宣稱為B1本輪驗證。離線安裝因快取缺postcss-selector-parser失敗，後以既有lockfile正常安裝成功，無依賴或lockfile變更。

## 安全移植範圍

相對05dd3bc僅本文件、3個attendanceCase*.ts與tests/attendanceCases.test.ts，共5個新增檔案。沒有修改A既有程式／文件，可由主對話將此增量移植到已sanitize的最新遠端；不要整棵覆寫遠端tree，也不需要帶回舊A文件。B1本機不push、merge或部署。


## B1 獨立 review 邊界修正（獨立 commit，B2 尚未接線）

修正兩個阻擋點：
1. 工時差異不再把已核實際工作與班表dayWindow取交集。依已核clock-in-date政策歸屬，計入完整已核工作區間的聯集（包括班前／班後獨立時段）；沒有歸屬政策保持unknown，不將多出分鐘自動認定為加班薪資。
2. 先展開與核對窗口相交的完整班次，再保留其完整卡與核准假單證據；四月掃描不得漏掉3/31夜班22–24的核准假，窄／寬窗口結果須一致。

固定回歸：班09–17／target480，實08–16為480（clear），實08–17為540（finding）；另有班前07–08獨立核准工作不得消失；歸屬政策缺失unknown。3/31 22–4/1 06由兩張核准假完整覆蓋，四月及擴大窗口的未出勤／遲到／早退皆clear。對照測試為獨立review原3案例加2項邊界。

此patch只改detector、tests/attendanceBoundaryFix.test.ts與本文件；不混入未提交的B2 service，不改任何正式資料或薪資。定向回歸 `npm test -- --configLoader runner tests/attendanceCases.test.ts tests/attendanceBoundaryFix.test.ts`：2 files、69 passed、0 failed（原64＋新增5，包含review的3個失敗案例）。此獨立patch尚未宣稱全套／build或正式驗收。

## 獨立複驗與發布範圍

B1兩項finding已以原始3個失敗案例重跑確認修正，與作者69項定向測試合計72項通過（重疊的不同runs不加總）。僅本批6個新增檔案；不含B2後端、API或持久化。正式發薪仍NO GO。遠端CI結果另記PR；本輪獨立複驗未跑emulator/E2E。
