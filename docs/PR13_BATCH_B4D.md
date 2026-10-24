# B4d：假單生命周期、政策邊界與私有附件

基於 B4c 90e3e7c，先接獨立來源修復4374b15（本分支等價2933f9b），再做本批。舊B4c／B4b目錄不修改。僅合成資料、本機驗證；不push、部署、真通知或正式資料存取。

## 狀態與資料契約

- `get-leave-workflow` 查本人或既有管理者 scope；`act-leave-version` 使用 expectedRevision、完整 sourceVersion、operationId，案件假單另核案件revision/evidenceVersion。
- 本人 pending/needs-info 可取消；非本人主管 pending 可要求補件／退回補件；needs-info/rejected/cancelled 可建立新版本。原版 superseded，歷史、來源說明、案件與附件保留；新版本重新驗證期間、雇用、假別、重疊、政策、附件與來源。
- 已核准不得取消／覆寫。現有核准與分配入口保持相容；versioned一般假單使用新入口，case假單沿B4c入口。原版legacy pending也能取消、退回補件與重送為新版；不回填已結算資料。
- `leaveRevisions`、`caseLeaveEvents`、`leaveWorkflowCommands` 留server actor/time與重送收據。共用月結transaction gate；來源全期間、跨月、附件綁定均在同一交易驗證。
- 新版本可明確指定新的已採納說明，或明確不引用（原版仍保存）；若引用則沿B4cfix核對acceptedSource與涵蓋區間。取消不消除原出勤異常；detector仍以來源重算，不靠文字關閉案件。

## 政策與額度

最小 `leavePolicyVersions` 結構含version/status/approvedBy/approvedAt、員工範圍、假別、生效起訖、backdatedMaxDays及quota期間／分鐘／basis／reservePending。無管理設定或正式啟用入口；測試明示注入合成已核政策。

未核／缺欄位維持 needs-review，沒有製造0或無限餘額。已核政策的有效期間不符、期限超過、重疊政策或額度超限拒絕。額度預占只在明確核定 `requested-span-minutes` 及 `reservePending:true` 時，於同交易按 pending/needs-info/approved 有效來源合計。這是額度用量假設，不是計薪休息或給付規則。取消／駁回／舊版取代後排除於有效預占，歷史保留；未知政策不產生虛假預占或釋放紀錄。未支持的額度計時方式仍待設定，不能換成跨度猜算。

## 附件與UI

共用B4b私有處理核心和元件，但假單使用獨立leaveAttachmentDrafts／leaveAttachments／leaveAttachmentEvents／leaveAttachmentAccess，metadata含subjectType/subjectId。假單與補卡ID及命名空間隔離，不能跨主體引用。保留舊補卡operation key相容性。

假單新送／新版本檢查已核附件政策；未完成上傳、安全掃描或綁定不一致拒絕。正式getLeaveAttachmentRuntime固定disabled/policy:null，不建儲存、憑證、token或真scanner。只在測試fake adapter可驗證私有存取流程；撤除僅草稿邏輯狀態，不硬刪提交附件。

本人既有請假頁加版本列表、取消／補件重送／歷史與私有附件；主管既有隊列加補件操作；不重建審核中心。未知mutation沿既有分頁暫存保留原operation與payload，GET不清除，禁止盲目另送。舊版推定餘額顯示為待覆核參考，不再作未核政策的申請阻擋。

## 合成 golden cases

|輸入／明示假設|人工預期|覆核方式|
|---|---|---|
|本人待審假單取消、同operation重送|一次revision/history，原來源保留|API/emulator/UI|
|主管要求補件→本人新版本→主管核准|不同ID、原版superseded、已核不得取消|API/emulator/UI|
|合成已核60分鐘額度，兩個不同時段各60分鐘同時重送|一成功一409，無超額或部分supersede|emulator|
|同政策取消有效60分鐘申請後再申請|預占釋放，新申請可送；原歷史仍在|API|
|政策draft、期限缺漏、或有效期間外|draft不啟用，缺漏待核；確認有效期外拒絕|API|
|跨月假單任一月鎖定|423，零revision/receipt寫入|API/emulator|
|假單引用補卡草稿／附件|404/拒絕，不跨命名空間綁定|API/emulator|
|必附假單、fake clean附件、新送後要求刪除|只能clean且原子綁定；已提交拒絕撤除|API|
|正式attachment runtime未設定|503／UI停用，零新申請資料|API/UI|
|結果未知後GET/reload|相同operation/payload重試，非自動重送|UI|

## 邊界

本批已提供假單取消／退回補件／新版本重送可測流程；並非公司政策核定或正式附件啟用。薪資日別、額度不同計時法、主管指定／期限政策核定、已核更正差額流程、OTcomp、正式storage/scanner及2026-08全體正式核對仍未驗收。正式計薪仍BLOCKED；不將本批視為全規格或正式發薪完成。

## 本輪驗證結果

- Unit/API：580 passed，27 files，0 failed。含B4cfix、舊入口不可自核、完整分鐘不四捨五入、無時區舊表單統一台北與UTC表示跨日的雇用界線。
- 真實本機Firestore emulator/rules：55 passed，2 files，0 failed。附件位元組及scanner仍為fake adapter，未聲稱正式storage驗收。
- 完整Chromium E2E：58 passed，0 failed（新增6項B4d，既有52項保留）；API mock，不是正式後端端到端驗收。
- Typecheck、build、git diff --check通過。
- 首輪新UI測試兩個定位錯誤（選單名稱／未展開歷程）及新API測試登入fixture錯誤已修正，原驗收斷言保留；沒有刪測試或skip湊綠。

重跑：`npm test -- --configLoader runner`、`npm run typecheck`、`VITE_E2E=false npm run build -- --configLoader runner`。Emulator必須限定localhost8086/8087與demo-chiayi-payroll，會清除合成資料；`FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator`。瀏覽器用本機cache執行 `npm run test:e2e -- --workers=2`。
