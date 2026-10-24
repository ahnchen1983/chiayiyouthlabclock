# B3：案件待辦 UI（增量，非正式計薪上線）

基準 `e52378788201fc5c557dabbbf731c7f098cf63cb`。僅接上 B2 現有案件契約，不包含其他工作樹的 review 修正；後續移植應先納入 B1/B2 review 修復，再移植本批差異，避免回退公開文件。

## 使用流程與權限

員工及管理者導航新增「異常待辦」，沿用 lazy view 與現有手機版導航。初始不全量讀取名冊或案件；指定月份按查詢，員工固定本人，管理者輸入既有員工編號。沿用 B2 Admin/SuperAdmin 出勤 scope；未建立逐員工主管／HR 權限模型，不能宣稱已完成分層管理。

案件依狀態、12 類異常篩選，先篩選再每頁 50 筆；顯示查詢條件與頁碼，改條件需明確查詢，前後頁沿用已套用條件。列表空白不表示完整驗證。每名員工最多 500 案件的既有查詢上限保留，正式大型歷史資料仍需索引化入口。

詳情顯示案件、期間（台北）、負責人、來源判定、原因、版本與 actor/time/history。申請 pending、核准未反映及未知政策明確可見，不判曠職或扣薪。DTO 不新增薪資、raw 卡、驗證位置、假單私密理由或完整來源內容；完整證據須由既有授權來源核實。

員工只能送本人說明，不能指派、結案、自核或消除 payroll block。管理者可指派現有管理者、補充說明、退回補件／要求說明、重核來源結案／重開；每個動作原因必填。退回補件對應既有 `request-info`，不是假單或補卡申請的駁回。結案／重開依 B2 後端重核結果，未知／無證據不會因按鈕而清除。

送出時同步 ref 防連點；network/5xx 不確定結果保留完整 command 與 operationId，只能重試原操作，不能編輯後偷用同一 ID。已確認寫入成功但讀取失敗，不重送寫入。409/423/權限錯誤後禁用送出，需明確重新載入與重新編輯；不自動蓋過其他人的版本。取消編輯不寫入；回列表會重新查詢。伺服器錯誤顯示受控文字，不回顯任意 server body。

「前往補打卡申請／審核」、「前往請假／外勤申請／審核」在中心內重用既有元件並提供返回詳情，不自動提交或核准；帶入授權案件的員工與可確定日期，未核實時間維持空白。寬範圍 scope 案件日期須明選，不預設今天。管理者來源清單依案件員工與相交日期／期間篩選。**尚無特定 request 的深連結、附件、完整退回重送狀態機、申請與 case 的持久 link API**；既有表單不會因此自動擁有新功能。完成來源流程後須重新讀取／由管理者重核；本批不自動執行掃描排程。

## 最小 API 補充

- `list-attendance-cases` 增加可選 status/type 並驗證，分頁前篩選；保留既有 employee/month scope 與 read limit。
- `get-attendance-case` 通過原案件 scope 後才讀該 case outbox，僅回 mode、各狀態數量、complete、deliveryEnabled=false。最多讀 501 筆，超過 500 標摘要不完整；不回 recipient、leaseToken、receipt、provider error。
- 前端 APIError 新增 status（保留 Error 相容性），供 409／423／403 流程處理。沒有新增寫入 API、真通知 API、排程或政策參數。

通知區明確標 Sandbox、非真實送達。held/retry/dead-letter/delivered 等只代表 demo 狀態，沒有 retry delivery 按鈕。「重新載入案件」只有 GET，不呼叫通知 worker。通知結果不能代替案件已解或正式門檻。

## 需求矩陣增量

|需求|狀態與本批證據|
|---|---|
|2.1|部分：12 類案件可見、scope 列表／詳情；detector 及來源能力完整度仍沿用 B1/B2 限制|
|2.2|部分：本人說明／管理者補件、既有補卡表單連結；附件、指定主管及完整取消重送／request link 尚缺|
|2.3／2.4|未實作完整 OTcomp／解釋假 model；UI 明示流程未提供、政策待設定|
|2.5|部分：待辦、owner、history、sandbox 通知狀態；無真通知、升級規則、正式 scheduler|
|6.1|保持 BLOCKED；本批未改 preflight 或正式鎖月邏輯，完成單案不等於正式可結算|
|6.3|沿用 B2 鎖月／版本拒絕，UI 不提供改已結算或略過 gate；歷史差額流程尚缺|
|7.1|員工限本人，管理者沿用既有 scope；case API 不給薪資；細分主管／HR 仍未建立|
|7.3|部分：案件狀態／類別分頁清單；非完整人事／薪資報表|
|8.1–8.3|正式 2026-08 全體正兼、到離職／留停核對仍未進行；mock／emulator／瀏覽器合成測試不可代替正式驗收|

## 固定合成驗收案例

Playwright `tests/e2e/attendance-cases.spec.ts` 使用 EMP001、2026-08-01 09–17 台北、待審補卡案件。外部 HTTPS 封鎖，所有 API mock；不存在正式帳號或真實人事紀錄。

|案例輸入／操作|人工明示預期|
|---|---|
|員工登入、pending case|只能本人清單／說明；不可管理或看薪資；history 可見|
|連點送出／取消編輯|一次 command；取消零寫入|
|network 結果不確定再重試|完全相同 operationId／內容|
|revision1 送出收到409、重讀7|不自動重送；重新編輯後以7及新 operationId 送出|
|管理者指派／退回補件|原因必填，assign／request-info，非申請 approve|
|結案來源未清409／鎖月423|維持未解，不繞過 server，須重讀|
|讀取錯誤、filter、分頁|可重試；filter 在 API，換條件回第一頁，前後頁不遺漏條件|
|前往既有補卡表單再返回|保留案件，導航本身零寫入|
|案件詳情403|不顯示詳情或前一人的資料|
|390×844 手機、approved-unapplied unknown|不橫向溢出，顯示待核而非結案|

API 合成回歸另驗：50 筆後的 matching cases 不被前頁異類排除；通知摘要不洩私有 token/recipient/receipt 且零寫入；跨員工403及超限 complete=false。真 Firestore emulator 驗 status/type query 與 own-case outbox summary；仍不代表正式權限設定或真通知已驗證。

## 實跑結果與可重跑指令

- `npm test -- --configLoader runner`：23 files，507 passed，0 failed（B2 504 + B3 API 3）。
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator`：2 files，31 passed，0 failed（B2 30 + B3 1）。只能指向本機 demo emulator；測試會刪除該 demo 的合成資料。
- `npm run typecheck`、`VITE_E2E=false npm run build -- --configLoader runner`、`git diff --check`：passed。
- `npm run test:e2e -- --workers=2`：當時全套 26 passed（既有 16 + 新增 10）。之後強化既有表單實際載入並增添「已成功寫入、讀取失敗」案例，案件 suite 為 12 項：11 passed，1 因兩個 role=status 的測試選取器歧義 failed；精確限定成功訊息、等待 error 後單獨重跑該項 1 passed。最終覆蓋既有 16 + B3 12 = 28 個獨立 E2E，未解失敗 0；不將重跑重複加總，也不宣稱曾以單次全套執行 28 項。
- 本機 Playwright 使用已安裝的對應瀏覽器快取（透過 `PLAYWRIGHT_BROWSERS_PATH`）；所有外部 HTTPS 阻擋，API 使用合成 mock。首次因預設快取缺瀏覽器未能執行案例，已解；emulator 新案例 fixture 缺 Employee role 的首次失敗已補角色後重跑，未放寬權限。

最終獨立案例覆蓋合計 566（507 + 31 + 28），不是正式資料驗收。日誌：`b3-tests.log`、`b3-emulator-final.log`、`b3-type-final.log`、`b3-build.log`、`b3-e2e-final.log`、`b3-e2e-cases-final.log`、`b3-e2e-ack-final.log`，保留在本機暫存目錄，不上傳真資料。demo emulator 已停止。

未測正式資料、真通知、負載及完整新申請流程。正式 NO GO。


## B3 獨立 review 修復（與 B4a 分離）

兩個阻擋項：來源表單遺失八月案件上下文，以及未確認寫入被成功 GET 清掉 operationId。

- 新 `caseFormContext` 僅由已授權 case DTO 建立，沒有 URL/query 參數入口。補卡帶案件日期與已知 card ID；假單分開顯示台北日期與空白時間，避免捏造請假起訖。跨夜保留完整可見期間；無法確定事件日期的 scope 窗口需明選。管理者補卡／假單清單限制在案件 employee/date/window，但不擴充既有 server 角色權限。這不是 B4 的持久 case/request link。
- 未確認操作使用按 uid 分隔的 tab-session journal 保留白名單 command（operationId、原內容、版本）；不存 auth token、薪資、原卡、通知憑證，也不輸出到 logs。切頁、返回、GET 或同分頁刷新不會消耗 journal；恢復後只顯示提示，須本人按原操作重試，不自動執行。新 GET revision 不能覆蓋原 expectedRevision。其他案件不能借用此 pending command。
- 初次寫入的明確拒絕或成功回應可完成本次嘗試；已經結果不明的重試再遇拒絕，仍保留原 command 待核實，不能把拒絕當作前次未執行證明。權限或鎖月使原操作無法確認時可能持續阻擋，需受控查證，沒有任意清除按鈕。
- 儲存不可用／內容不合法時停止新 mutation；關閉分頁、清除瀏覽器資料或換裝置不提供跨裝置保證，應先核實原操作，不能盲重送。正式跨裝置 receipt recovery 尚未提供。

新增合成回歸：review 原兩項、跨切頁／刷新保留 exact command、假單日期與空白時間、寬範圍日期不猜、管理者來源範圍；另有 context／journal 純函式測試。本次實跑：全套 unit/API 512 passed（25 files），完整 E2E 34 passed（含 review 原兩例及四項新增情境），typecheck／build／diff check passed，0 未解失敗。未改後端，此輪未重跑 emulator；先前 31 項結果不能冒充本次重跑。日誌 b3fix-tests-final.log、b3fix-e2e.log、b3fix-type-final.log、b3fix-build-final.log 留在本機暫存目錄。B4a 未納入本修復。

## 發布前獨立完整驗證

以乾淨419adeba來源建立隔離發布副本，保留遠端既有sanitize文件，只加入本批增量。發布前本輪完整單元/API 512 passed、typecheck與production build passed；完整Chromium E2E單次34 passed、0 failed，非定向案例加總。測試只有合成mock API，外部HTTPS封鎖。先前作者與定向review數字皆為重疊不同runs，不再相加。本輪未獨立重跑emulator，遠端CI另行執行並保存附件。

不含B4a。持久申請/案件關聯及完整申請生命週期、附件、OTcomp、細分主管scope、必要政策和正式2026-08人工核對仍未完成；正式資格BLOCKED、真通知預設off、正式發薪NO GO。B3 UI完成不代表全規格驗收。
