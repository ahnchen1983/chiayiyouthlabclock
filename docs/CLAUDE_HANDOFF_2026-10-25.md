# Claude 接手 checkpoint（2026-10-25）

使用者明確要求「工作移交給 claude」。本文件是最新接手入口，優先於舊交接中的「未 review／未跑測試／未讀正式資料」歷史敘述。原目標仍是逐項確認政策與資料、修復及驗證，條件滿足後合併 PR13 上線；**目前條件未滿足，正式計薪 NO GO，不能提前合併或部署。** 本次移交僅更新文件，未改產品程式、未重跑長測試、未寫正式資料。

## 版本、工作樹與閱讀順序

- Repo：`ahnchen1983/chiayiyouthlabclock`。
- 接手分支：`handoff/pr13-c2b-portable-20261024`，對應 [PR14](https://github.com/ahnchen1983/chiayiyouthlabclock/pull/14)。本次文件移交前 head 是 `8a025e4f26a976701b3b7ed09c5ed2ffa785a362`；文件發布後以 PR14 head／`git log` 為準，不用舊 SHA 覆蓋後續同事更新。
- 2026-10-25 交接前重新核對：[PR13](https://github.com/ahnchen1983/chiayiyouthlabclock/pull/13) head `13717ca8cffcb50209ac53fab9cb281714dae600`、base main `84091c6108bbc6d55f47bca5455fc944b9a7f0cd`；PR14 base 是 PR13 分支 `fix/attendance-payroll-consistency`。兩者 Draft、未合併。
- 交接前 tracked 工作樹乾淨，另有使用者未追蹤的 `tests/snap/`。**不讀、不搬、不刪、不提交該目錄；保留既有 `.env`，不輸出憑證。** 本次沒有未提交程式修復，也沒有仍在執行的子代理工作。
- 不要把早期暫存 clone／其他未提交工作整棵搬回來；PR14 已含 portable snapshot、`cf1d746` 與獨立修復。分批 diff、覆核後才整合增量。

依序讀：本文件 → `PR14_INDEPENDENT_REVIEW_2026-10-24.md` → `PR13_AUGUST_ROSTER_AUDIT_2026-10-24.md` → `PR13_BATCH_C2A_FIX.md`、`PR13_BATCH_C2M.md`、`PR13_BATCH_C2B.md` → `PR13_PHASE1_REQUIREMENTS_2026-10-24.md`、`PR13_REPAIR_LOOP.md`。以上均在 `docs/`；舊 `CLAUDE_HANDOFF.md` 其餘內容保留作歷史，不能把舊未驗狀態當現況。

## 最新對話落點：不要重問已回答的題目

使用者在 2026-10-25 最新明確回答：**例假與休息日由「個人班表指定」**。已回答有區分、按個人班表指定，不是固定星期的問題；還沒取得的是八月每人每日的實際指定內容、標記方式與可核對來源。

接手第一步是定位該指定：先檢查現有系統畫面／API／資料契約是否有明示例假／休息日標記；若仍找不到，只針對「哪個畫面／欄位／標記方式或哪份個人班表保留了八月指定」向使用者釐清。不要再問「有沒有區分」「是否固定星期幾」「班表在哪裡」：這些已回答。

目前已看過的 `ScheduleEvent`／`StaffShift` 與管理排班編輯器保存場館狀態及班段；`StaffPreference` 保存不可排／偏好日期。這些契約本身沒有明示個人法定日別。正式新制 `dayTypeCalendars` 盤點為 0；這不代表公司沒指定，也不能把偏好、未排班、休館值班或一般備註自動當成已核定日別。尚未完成原始備註／其他個人班表指定來源的辨識。

## 已確認的政策與資料事實

| 項目 | 使用者已確認的內容 |
| --- | --- |
| 計薪參與 | 純系統管理帳號排除；實際受薪的最高管理權限帳號保留，不得只按角色剔除 |
| 固定薪資結構 | 只有單一約定月薪金額；不另捏造固定津貼拆項，仍核對各人薪額／有效期與其他實際給付扣款 |
| 正常工時／工作事實 | 每日8h；按已核實際工作，不以月總量沖掉逐日加班，不以班表裁切已工作時間 |
| 休息 | 主管核實工作／休息，無固定午休自動扣除；九小時班段不代表九小時實際工作 |
| 月中到職 | 全薪 × 在職曆日數 ÷ 當月實際總日數（calendar-earned） |
| 離職 | 日期與當月薪資皆人工輸入，保留逐項來源／雙人覆核與差額；不是任意手填即合法，不覆寫已鎖薪資 |
| 合計進位 | 最後合計四捨五入到整數元：final／precision 0／half-up；分段保留精確值，不覆蓋法定項目個別規則 |
| 勞健保 | 各項依法扣員工自付額，不一律套薪資在職比例；實際投保／計費來源仍待核對 |
| 假日加給 | 依適用法定基準，無另外確認的公司額外加給；日別與工資基礎仍須有適用證據 |
| 補休 | 依法定期限／原日來源結清，不到期歸零，不推定永久免結清；個別同意與帳本待核 |
| 核對月份／人員 | 2026-08全體正兼職與當月到離職；使用者確認該月無留停或當月復職，待名冊對照 |
| 排班方式／來源 | 按月排班，八月完整班表在這套系統；月排班不是法定特殊制度成立的證據 |
| 例假／休息日 | 公司有區分，由個人班表指定；八月逐人逐日指定內容與來源待定位 |

按月排班的補充，不能直接把先前選項「有其他制度」轉成二／四／八週變形工時或84-1，也不能在證據不足時替全員核定一般8/40。正式政策版本、生效月份、適用人員及週界仍未建立。法律來源與查證日期沿獨立審查報告，不把現在官方頁面當八月個別契約／付款證據。

## 已完成的修復與驗證

接手前作者 `cf1d746` 修正 approvalId 以最後一個 `@` 拆 reviewer／ISO時間，已保留。其後獨立審查修復9項（1個P1、8個P2），含送審來源漏讀、更正鏈錯查、過期政策、無效來源誤ready、未知整日假日金額誤列已知、來源版本配對及畸形日期／區間例外；都有紅綠回歸與交叉覆核，詳獨立報告，不要重做或丟失。

最終受測程式提交：`d3ca818f32a983d0746ac53ad374dd68a71ae288`；此後皆為文件。2026-10-24台北22:53:33–22:56:59的同一輪 `verify:pr13`：

| 項目 | 結果 |
| --- | --- |
| 單元/API | 832 passed，38檔 |
| 真實 Firestore emulator/rules | 87 passed，2檔，僅 demo-chiayi-payroll |
| Chromium E2E | 85 passed，合成API mock |
| 型別／production build／production dependency audit | 全部通過 |

manifest：`.verification/pr13/2026-10-24T14-53-33-058Z/manifest.json`；source hash：`ef6d762bf08cae254a5ad7b62b4864409aacf8eeec535aad30b98a22b0b94d34`。本機證據為ignored檔，跨機clone不會附帶，不可假稱取得原log。不同runs不加總；CI僅監聽main，stacked PR14沒有遠端CI成功證據，空checks不算通過。

新環境先依lock檔安裝依賴。需要驗證程式變更時，標準入口為 `npm run verify:pr13`；任何失敗先保留失敗測試、做最小修復、定向綠燈及交叉覆核，再跑最終完整驗證。只改交接文件不需為此重跑全套。runner會核對HEAD／來源hash，驗證中不要改碼或提交。測試僅可使用可拋棄demo專案及本機8086/8087；會清資料，不可指向正式Firebase，也不kill未知程序。

## 正式資料核對與既有操作邊界

八月班表最新完整readTime：`2026-10-24T15:37:57.176516Z`（台北23:37:57）。31份真實日文件、90班次、6位員工，全以ID對應；無未知、無無效時間、無重疊、無系統帳號班次。81筆跨度9h、9筆4h；月前／月後各6天共43天外框都有文件。這不是核定週界、實際工時或歷史核准證據。另2個非系統帳號未排八月班，現有到／離職日期線索與八月不相交，仍待任職證據核實。

本次指定專案的主檔head、日別日曆、政策版本、邊界月份覆核及八月班表版本均未取得新制紀錄。尚未核對完整八月打卡、假單／外勤、保費、實付與正式Netlify後端環境綁定。詳匿名班表報告；不要把Firebase專案已確認寫成已核實所有正式後端設定。

更早使用者已授權一個純系統帳號排除，曾以條件交易設定 accountKind=system-account 並同交易稽核／版本協調、寫後讀回；最新盤點明示系統帳號為1。另兩個高權限受薪帳號保留，無需再改。舊main尚未套用此分類，不能說正式畫面已排除。該早期單筆寫入與後來班表唯讀盤點不同，不得概稱整個專案從未寫過正式資料。

唯讀授權來自使用者原先要求檢查Firebase資料及此次班表定位。沿用必要欄位投影、同readTime、記憶體分析與匿名合計；不輸出密碼、個人薪額／保費或原始名冊，不把原始人事資料存入repo／CI。先前整批原始人事資料落盤方案曾被自動審查拒絕；改良後的投影／記憶體方案已執行，不重試原方案、不換通道繞過。既有Firebase CLI授權可依工具正常流程使用；不另建憑證、服務帳號或登入應用程式來充當唯讀probe（應用程式登入有寫入副作用）。

暫存分析程式與其他clone不屬跨機交付；重建時由讀取範圍、純函式與合成自測復現，不能依賴原主機私有路徑。報告中的12個分析器合成斷言及4種制度的記憶體probe，不與832／87／85產品測試加總。

## 已知未解能力與接手工作包

OT對非 standard-8-40／缺 regime保持needs-review、payable=null／BLOCKED；knownLiability=0不表示沒有給付義務。正常項目候選沒有制度來源欄位、固定480分鐘，可能仍呈現ready與基本月薪；不是完整正常工時或正式薪資驗證。外層C2a非結算理由與preflight固定能力缺口仍硬擋所有新月結。人工離職approved仍只是recorded-inputs-only、not-applied、not-paid。

| 順序／建議分支 | owned（唯一編輯者） | read-only／report-only | 驗收與整合 |
| --- | --- | --- | --- |
| 1：codex/pr14-daytype-source-audit | 新增 docs/PR13_DAYTYPE_SOURCE_DISCOVERY.md | read-only：排班UI/API、types、effectiveMaster與現有報告；正式資料只由整合者按既有唯讀界線核對 | 定位實際標記／來源或明確記缺口；區分公司回答與可核證據，不猜日別。回報後整合文件 |
| 2：codex/pr14-regime-source-guard | 規劃後明確限定正常／OT來源投影及其回歸測試檔，每檔單一所有者 | read-only：純引擎／既有gate；report-only：共享政策／交接文件 | 依已核來源保留未知／不支援制度待核，保留已知工時／基本比較證據，紅綠回歸及獨立review，不清正式gate |
| 3：codex/pr14-validation-integration | 整合者獨占共享docs與提交／發布操作 | read-only：各修復diff、manifest | 小批整合→完整驗證→公開內容檢查→同步既有Draft PR14；不混入未review批次 |

工作包2先按1的發現定界，不實作未知的變形／84-1倍率。上述是待執行工作，不是已建立的分支、已寫完的程式或已驗收功能。可以先做read-only重建與程式審查，不需另等使用者一句「開始」；真正缺的公司事實才逐項提問。

更後續仍有：完整跨月週工作來源、事假12h與外勤／出差投影、補休原日逐段對帳、月46/54及三月138上限、輪班／連續出勤及例假超時分類、C3完整項目／保費／稅、D差額與採用、rollout與rollback、八月全員人工對帳。先前已鎖快照不重算覆寫；未知保費／給付不填0，缺政策／證據不直接啟用。保持Draft與[skip netlify]，保留既有CI，不觸發manual hooks、真通知或付款。

每批回報：分支、完整commit、相對基準與檔案清單、最初失敗及修後測試、獨立覆核、manifest／source hash、來源是否合成或正式唯讀、未解問題與下一個必要確認。沒有證據就標未跑／未驗收。

## Claude 接手進度（2026-10-25）

| 工作包 | 狀態 |
| --- | --- |
| 1 日別來源定位 | 程式面完成：系統沒有任何可保存個人例假／休息日的欄位或畫面；`dayTypeCalendars` 契約存在但無建立 API／UI。正式資料唯讀查核被本機自動權限檢查拒絕，**未驗**。詳 `docs/PR13_DAYTYPE_SOURCE_DISCOVERY.md`，待使用者指出八月指定的畫面／檔案，或授權唯讀查核 |
| 2 制度來源防護 | `01a8aa2`：`NormalPayPolicy.workRegime`；非 `standard-8-40`（含缺漏、unknown、variable、84-1）一律 needs-review、amount=null，但保留分段與精確值。OT 預覽在工日 regime 與正常政策不一致時列待核。先紅（6 fail）後綠，新增 `tests/normalPayRegime.test.ts` 7 例。未另做獨立 review |
| 3 驗證整合 | 未 push；PR14 未同步 |

`npm run verify:pr13`（commit `01a8aa2998dcb2a07008b99357fad873a01c6d48`，sourceHash `bdc357574ff370dac32f837ccbac2fa18269b67d317aed495da62bc3314397f4`，manifest `.verification/pr13/2026-10-24T23-41-57-434Z/`，本機 ignored）：dependency audit、typecheck、unit/API 839／39 檔、Firestore emulator 87／2 檔（demo-chiayi-payroll）、Chromium E2E 85、production build 全部通過。

正式資料影響：既有 `payrollPolicyVersions` 正式盤點為 0，新欄位不改任何正式紀錄；未來建立政策版本時必須明填 `workRegime`。正式計薪仍 NO GO。
