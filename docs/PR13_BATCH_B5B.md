# B5b 補休獨立帳本（程式／合成驗證）

基準 5ca3d64；獨立分支 fix/pr13-comp-ledger-b5b。未推送、未部署，正式計薪仍 BLOCKED / NO GO。

## 規則與適用邊界

已讀官方 [勞基法32-1](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=32-1) 及 [施行細則22-2](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=22-2)：本人選擇且雇主同意，以工作時數一比一取得；依原加班發生先後使用；期限不超過約定特休年度末；未休結清依原加班日基準。

本批不把一般加班申請核准直接當作法定加班分類。另需受控、已覆核 compSourceReviews，明示 normal/rest 與 eligibleMinutes；國假／例假或未知分類只能待核，不能混入此帳本。來源保留 overtime version、confirmedWork version/refs、核准區間、原加班日、原工資／級距 metadata。金額未知保持 pending-payroll/null，不取目前時薪、不設0；C engine 尚未實作。

## API／資料契約

- get-comp-workflow：本人或指定非本人主管，回 requests、ledger、tasks、available/reserved/used/pendingPolicy 及來源問題；未知為 null，不等於0。已鎖來源可唯讀。
- submit-comp-request：credit 本人明確 employeeChoice=true；use 明確起訖；adjustment 指定主管提議沖回可用未消耗分鐘。
- act-comp-request：expectedRevision + sourceVersion + operationId；cancel、request-info/return、reject、resubmit（新版本）、agree。已核不能直接撤回。取得需非本人指定主管同意；沖回另需不同提議人的指定主管。
- scan-comp-settlement：顯式指定主管命令，僅建立到期／離職 pending-payroll 任務；未啟用 scheduler，不移動錢、不改 ledger、不覆歷史 snapshot。

Collections：compRequests、compLedger（僅 create）、compCommands（receipt）、compSettlementTasks（每來源穩定ID，變更留revision/history的待結清證據）；compPolicies、compSourceReviews 為唯讀可信政策／覆核來源，沒有本批任意核定入口。

compPolicies 最少包含 employee、核准版本／actor/time、本人期限同意、指定reviewerIds、有效期間、deadline、annualEnd、one-to-one、explicit-request-interval、reservePending=true；缺任一必要項不推定政策已核。這是可測程式契約，不代表公司已完成政策設定。

帳本 credit/reserve/debit/release/adjustment 採連續 sequence、唯一 event、原來源 root 去重。使用按原工作時間 FIFO，保留每次預占的來源配置，使用或釋放須精確對應；禁止負餘額。沖回只能減少可用未使用額度，沒有任意加值或刪原事件入口。跨月及原來源月份均使用既有交易月鎖。容量為500來源/申請/帳本事件、100歷程等技術上限，非公司保存政策；超限整筆拒絕。

## 人工合成基準

|輸入|預期|
|---|---|
|原已核工作120分，本人選擇，指定主管同意|credit120；原actual不變，未知工資仍null|
|無期限政策／未知或國假例假分類|pending-policy，沒有credit或無限額度|
|同來源重複選擇／相同命令重播|最多一份來源取得；receipt回原結果|
|可用120，預占60，取消兩次|120→available60/reserved60→120/0，僅一次release|
|預占60核准使用|available60/reserved0/used60，不改credit|
|兩來源原工作早120、晚120，使用180|早120+晚60，非依取得時間或最新時薪|
|兩個不同時段各預占120、總可用120|僅一成功，另一409、無部分寫入|
|核准後source changed／policy same version不同內容|阻擋，須重新核實，不繼續舊證據|
|跨月使用任一月份鎖定|整筆拒絕；已結算快照不改|
|到期／離職還有120未使用|待結清task120與原日基準；不自動扣帳或付款|
|另一指定主管核准沖回30|追加adjustment，可用減30，原credit完整保留|

## 尚未完成與限制

正式 policy 核定UI／正式資料、工資計算／法遵日別引擎、支付與差額核付、已使用補休更正、國假協商／例假補假、真正通知與排程均未實作。補休 approved 仍產生未套用／待薪資投影狀態；完整 OT/comp 能力缺口不清除。後補已過去補休使用需後續獨立更正流程，本批不回填歷史。帳本技術容量達上限需後續分頁／封存設計，不能刪舊資料騰空。

通知僅沿既有案件 held sandbox outbox，不發真通知。UI測試為 synthetic API；真本機 Firestore emulator 僅驗交易與規則，不可替代正式八月全體資料對帳。

到期任務採每原始來源批次穩定ID；預占釋放等變更重掃只新增任務版本/history，不製造另一筆可被重複結清的任務。帳本仍不因掃描改動。日後付款整合必須驗任務 sourceVersion 與未付款狀態，本批沒有付款 endpoint。

鎖定限制：來源月份已結算時，本批連取得、使用及到期／離職掃描都會拒絕寫入；不能藉待結清任務繞過既有月鎖。已結算來源需要後續受控差額工作流，本批未提供該入口，不宣稱已能正式處理所有歷史到期款項。

## 本批實跑結果

- 最終 unit/API：29 files、615 passed、0 failed；包含21個新增補休合成案例。
- 完整 Firestore emulator/rules：重跑67 passed、0 failed。首輪66 passed、1 beforeEach初始化20秒逾時；原日誌保留，未調高timeout、未刪案例。重跑在無UI測試併行時完成。
- 完整 Chromium E2E：67 passed、0 failed，含4個新增補休UI案例；使用synthetic API mocks，不代表正式後端驗收。其後僅後端任務去重／原工資metadata等修正，UI未更動。
- typecheck、build、diff check 通過。跨月emulator案例另加強為有可用額度時仍須423，最後另跑B5b定向4案例；4 passed、0 failed，63個非本範圍案例由-t篩掉（前一全套皆已通過），沒有停用或刪測試。

測試通過不表示公司政策已核、原日工資已核或八月正式資料對帳通過。沒有建立正式storage、token、推播、排程或付款能力。
