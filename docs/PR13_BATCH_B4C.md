# B4c：獨立異常說明與追補假單

基準 0d6d7d0（B4b）。僅本機合成驗證，不讀寫正式資料、不送通知、不啟用 scheduler。2026-08 全體正兼職及當月到離職／留停核對仍未執行，正式計薪 BLOCKED／NO GO。

## 可測流程與來源

- `anomalyExplanations` 與假單分開：本人 submitted → 主管 needs-info → 本人新文件 resubmit（前版 superseded）→ 主管 accepted/rejected；本人僅能撤回未採納版本。採納不改 raw 卡、假單核准、工作認定或薪資。
- `caseExplanationLinks`／`caseLeaveLinks` 保留關聯；actor、server time、revision、immutable events/history、原始來源 refs。API 檢查本人／既有管理者權限，禁止自核、client 偽造 proof、stale revision。來源改變須補件／重核。
- `submit-case-leave` 使用既有 leaveRequests，保存 case/explanation 來源；完整時區分鐘、有效 enum、雇用區間、跨月鎖、既有 pending/approved 假單重疊檢查。未知假別給付／餘額／外勤門檻保留 needs-review；跨度不是計薪分鐘。
- `review-case-leave` 及既有 `review-leave-allocation` 留下 leaveRevisions，交易內重新產生 detector cases。核准未分配仍待核；已確認卡假重疊仍 finding，不因文字說明結清。
- UI 重用異常中心、請假表單、審核隊列、薪資分配覆核；未知 mutation 保留原 operationId/payload 跨 GET／切頁／重新整理，只能明確重試原操作。
- 交易共用 month mutation gate，先讀／檢查後寫。每軸100個保留關聯、500來源、200歷史與31日單次申請只是技術容量，不是已核公司政策。達限拒絕，replay 不新增 quota/history/outbox。

## API / 儲存

新增 get-case-explanation-workflow、submit/act-anomaly-explanation、submit/link/review-case-leave。集合：anomalyExplanations、anomalyExplanationEvents、anomalyWorkflowCommands、caseExplanationLinks、caseLeaveLinks、caseLeaveLinkEvents、caseLeaveEvents、leaveRevisions、caseLeaveAllocationCommands。既有 rules 的 client deny 保護維持。事件僅沿用 sandbox held outbox。

## 合成驗收基準

|輸入|人工明示預期|驗證入口|
|---|---|---|
|本人說明、主管補件、本人重送、主管採納|原文保留，新版本鏈；原卡與假單不變|unit/API、emulator、UI|
|同 operationId 重送／並發|一份來源、history 與 outbox；不同內容拒絕|unit/API、emulator、UI|
|兩個同時段追補假競爭|僅一份建立；無部分寫入|emulator|
|3/31–4/1 案件，任一月鎖|423、零來源與關聯新增|unit/API、emulator|
|100保留關聯後新建、最後一額併發|拒絕超額、GET仍讀得到100份|unit/API、emulator|
|核准假並分配與已核工作相交|仍有卡假重疊 finding；正式 gate BLOCKED|unit/API、emulator|
|本人自核／他人讀取／偽造給付或來源|403/400；不新增資料|unit/API、UI|
|網路未知結果後GET與reload|原意圖保留，不另生 operationId|UI|

## 明確未完成

本批未完成完整假單取消／補件重送版本流程、假單附件、有效期間假別目錄與餘額政策、主管指定／期限政策、OT/comp、正式通知、正式儲存掃描與所有日別薪制。追補假只接既有核准與分配；解釋採納不當作 approved leave evidence。舊一般假單流程仍需後續統一版本模型。本批不得宣稱2.2/2.3或正式驗收全完成。

後續 B5/C 需分開 actualWorkMinutes、leaveMinutes/pay、statutoryComplianceMinutes 與 scheduledNormalIntervals；本批未將每日8h擴充為所有日別的萬用公式。補休原加班日工資／級距、FIFO期限，以及保費各自有效版本／部分月規則留待後批與政策覆核，不啟用任何新預設。

## 可重跑指令

- `npm test -- --configLoader runner`：565 unit/API，27 files，全過。
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator`：49 tests，2 files，全過；只允許隔離 demo emulator，會清除該 emulator 的合成資料。
- `npm run typecheck`、`VITE_E2E=false npm run build -- --configLoader runner`：通過。
- `PLAYWRIGHT_BROWSERS_PATH=<local-browser-cache> npm run test:e2e -- --workers=2`：全程 mock API、localhost preview，不作正式存取。

首輪瀏覽器回歸發現新舊原因欄位標籤混淆，已以不同可讀標籤修正，保留原測試。正式資料、真 storage/scanner、實際通知均未測。

最終完整 E2E：52 passed、0 failed（含新增5項B4c UI）；unit/API 565、emulator/rules 49，均0 failed。沒有刪除或跳過失敗測試。上述為合成驗證，不能替代正式驗收。

## 獨立 review 後來源修復

採納說明現在保存 server-generated acceptedSource（來源版本、涵蓋期間、refs hash、說明 revision、核准者與時間及 hash）；假單建立與核准都在同一交易核對目前來源與完整涵蓋時段，並保留 explanationSource 鏈。09–17採納後卡改為09–18且重新掃描，舊採納說明不能為17–18假單背書；缺採納證據的舊資料也需明確重新覆核，不補造證據。此修復針對來源關聯完整性，並非修補正式發薪 gate bypass；正式 gate 原本即 BLOCKED。
