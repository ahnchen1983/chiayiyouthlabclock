# B5a：加班申請與指定覆核工作流

基準d7cf775（B4d）；獨立本機分支，不修改已交review目錄。不含B5b補休帳本、C薪資引擎、真通知、正式排程或正式資料驗收。

## 四種時數與狀態

- actualWorkMinutes：僅申請區間內，從既有confirmedWork/sourceKey核實的工作聯集；不以班表裁切，多卡／跨夜去重，任何相關來源未核則null。保留完整來源hash/refs及區間快照。UI另展示即時來源與是否改變。
- requestedMinutes：員工明確申請的完整時區分鐘跨度。
- approvedMinutes：指定非本人主管確認且不超申請／已核工作之範圍；partial-approved可部分核准。來源改變必須新版本重查，不能用過期snapshot核准。
- statutoryPayableMinutes：本批一律null（待政策／依法應計模組），不是0。缺申請、撤回、駁回、事前授權均不修改raw卡或confirmedWork，不將工資義務消除。

事前計畫可以preauthorized，只記authorizedIntervals，並非核准實際工作或依法應付；事後需新版本帶入實際來源。submitted／needs-info可本人撤回；submitted、needs-info、preauthorized、rejected、cancelled可重送新版本，舊版superseded且來源/history保留。已核工作不得直接取消或覆寫。主管可request-info／return／reject／approve／partial-approve；所有操作有reason、revision、sourceVersion、operationId與server actor/time。

## 權限與政策

最小overtimeWorkflowPolicies依employee ID指定approved版本、reviewerIds、核定者時間與有效期間。無預設全員管理權、無自核；未知政策可本人留待審申請，不能核准。主管讀取限指定員工／政策期間，事件掃描須涵蓋已核期間；本批沒有政策管理或正式啟用入口。

日別固定unverified；complianceStatus／policyStatus為needs-review。日期與區間技術合法性有檢查，但各日別法定工時上限、例外、支付倍率等實質判定尚未實作；違法與否不能在此被轉換成不付薪。外勤／出差不自動排除已確認工作，但法定歸屬仍待政策。31日、500來源、100關聯／200歷史均為技術上限，達限拒絕，非公司規則。

## API／資料與案件

get-overtime-workflow、submit-overtime-request、act-overtime-request、scan-overtime-candidates；獨立overtimeRequests、overtimeEvents、overtimeCommands、caseOvertimeLinks、overtimeWorkflowPolicies。提交／狀態變更共用month transaction gate，核對完整跨月與關聯案件期間；重跑收據避免重複history/outbox，重疊有效申請不能同時建立。

沿用12類detector：pending-request／approved-unapplied追蹤加班來源。日曆日區間聯集超480分鐘建立hours-difference候選，僅要求調查，非宣告該日為平日或直接算薪。候選具穩定鍵，不因重跑增生；取消申請不抹掉工作候選。事件handler僅可測函式，沒有部署scheduler；所有outbox沿用sandbox held、delivery disabled。

preflight納入待審、待補件、事前計畫與已核未計薪；OT_COMP_REQUEST_MODEL完整能力gap保留，正式仍BLOCKED。員工、主管及案件UI重用原操作暫存：未知結果跨GET／重新整理仍保留原ID/payload，不自動重送；案件日期傳入但不假填工作時間。

## 合成人工基準

|輸入／假設|明示預期|
|---|---|
|15–17已核工作，申請120分鐘，未設定覆核政策|actual120/requested120/approved null/payable null；普通管理者不得任意核准或讀取|
|指定政策，核准15–16|approved60，actual/requested仍120；approved-unapplied、formal BLOCKED|
|同一申請操作重送／併發|一份request/event/link；不同操作重疊期間只一成功|
|來源卡改變後核准|409，須新版本重新核實；原工作不覆寫|
|撤回或駁回申請|原confirmedWork保留，payable仍null，不設0|
|事前2099計畫授權|只有authorizedIntervals，不製造actual/approved/payable|
|4/30 23–5/1 02，跨卡重疊|工作聯集180分鐘，不雙算；任一月份鎖定即拒絕變更|
|已核日曆區間超8h重掃|穩定候選與held outbox，不假定日別／倍率|
|案件8月日期進申請UI|員工／日期保留、時間空白、未填不得提交|

## 未完成／NO GO

補休取得、FIFO、使用／到期結清、各日別與法遵上限引擎、依法應付計算、政策核定UI、已核更正差額、正式通知與排程、production／2026-08全體對帳未完成。本批只交工作流可測程式，不宣稱2.4完整法規計薪或正式發薪完成。

## 修復沿革與覆核邊界

本地原始基準 d7cf775。B4d 獨立修復 5cdf6dd 已以等價增量 da44ea5 接入，B5a 可單獨比較 da44ea5..HEAD，不必重套 B4d。原始工作暫存保留，無覆寫已審目錄。

自查新增反例：08–19 原始跨度、已確認 workIntervals=[]，超時候選應 clear；不能從跨度補造工作分鐘。日曆日候選只是待調查訊號，非正式跨夜歸屬／日別法定工時算法。

## 實跑證據

- 最終 unit/API：28 files，594 passed、0 failed；含獨立 B4d 修復及空工作區間反例。
- 整合 Firestore emulator/rules：63 passed、0 failed；真本機 demo Firestore 的交易競爭／重播驗證，非正式資料。附件 bytes/scanner 仍是 fake adapter。
- Chromium UI：63 passed、0 failed，包含新增5個加班案例；API 為 synthetic mocks。此輪在接入 B4d 後端修復及最後 detector 空區間修正之前，UI 未再修改，不能當正式整合驗收。
- 最終 typecheck、build、diff check 通過。最後 detector 修正另重跑 B5a 定向 emulator，4 passed、0 failed，59 個非本範圍案例由 -t 篩掉（前一全套均已通過），未刪除或停用測試。

保留來源證據，不把核准狀態當作依法應付已確認；所有正式 gate 仍 BLOCKED。未 push／部署／發送通知，未存取正式人資資料。
