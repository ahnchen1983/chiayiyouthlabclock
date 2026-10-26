# Claude 跨機接手：PR #13 的 C1/C2a/C2m 與 C2b WIP

## 本次獨立審查（2026-10-26）

最新修補檢查點：受測程式 `de8db1b5` 在同一台Mac的乾淨 `/tmp` checkout 完整通過982 unit/API、93真實emulator、103 E2E、audit/typecheck/production build；完整manifest、source hash與失敗恢復見下述報告。之後僅補驗證文件。使用者已要求持續完成既有規格，接續結案來源新鮮度／preflight、必要項目與D；正式放行仍NO GO。

先讀 `docs/PR14_REVIEW_2026-10-26.md`：政策／跨月週／補休／C3新增修復及剩餘gate。下方「完成」屬作者歷史紀錄，不等於已獨立驗收或正式發薪。完整整合驗證狀態以新報告為準。

## 優先閱讀（2026-10-26）

請先讀 `docs/CLAUDE_HANDOFF_2026-10-25.md` 的「優先補充：已確認規則與修正版待辦（2026-10-26）」。該節彙整工作／外勤、場館狀態、個人日別、工時／休息及薪資既有決策，並修正 C3／異常結案／差額／八月對帳待辦與資料需求。例假／休息日按個人指定、偏好不區分日別及「加正式指定」均已回答，不再重問；只補八月逐人實際指定與核定資料。下方舊工作包、未實作／未審查敘述為歷史，後續日別與 C2b3–5 進度以該交接文件末段為準。本次僅文件整理，未改碼、未驗正式環境、未部署。

## 最新移交入口（2026-10-25）

使用者要求「工作移交給 claude」。請先讀 **docs/CLAUDE_HANDOFF_2026-10-25.md**，內含已核對版本、完整測試證據、正式班表唯讀結果、全部已確認政策、未完成能力與下一個工作包。使用者最新回答：例假／休息日由**個人班表指定**，不要再重問是否固定星期；待定位的是八月每人每日的實際指定標記與來源。目前仍正式計薪NO GO，本次只保存交接，不提前合併／部署。以下2026-10-24初始交接及作者敘述保留作歷史，狀態以最新移交文件為準。

## 最新獨立審查補充（2026-10-24）

portable交接後，cf1d746已在獨立副本重跑完整767 unit/API、85 Firestore/rules、85 Chromium E2E、typecheck/build與依賴稽核，全部通過。C2a fix／C2m／C2b已進行獨立審查，發現並修復來源漏讀、過期工日政策、無效來源誤ready、待核金額誤列已知及來源版本配對；完整薪資與畸形工作區間也補防御。各修復有紅綠回歸與交叉覆核；完整紀錄及最終驗證以 docs/PR14_INDEPENDENT_REVIEW_2026-10-24.md 為準，以下初始交接／作者結果保留作歷史，不等於當前未審狀態。

最終程式 d3ca818 完整驗證：832 unit/API（38檔）、87 真實 Firestore emulator/rules、85 Chromium E2E、typecheck、production build、依賴稽核全通過；manifest/source hash 與時間見上述獨立審查報告。之後只補文件，未變更已驗證程式。C2b WIP 與正式計薪 NO GO 仍保留。

使用者已回答時薪假日是否另有公司加給：「依適用法定基準」。兩條倍率疑問已對官方說明釐清：休息日出勤按4/3、5/3、8/3，不再加同時段1R；原約定工作日逢國假出勤8h內時薪總2R。適用日別、調移、工資組成與來源仍要核定。最後合計已確認「四捨五入到整數元」（final／precision 0／half-up），分段保留精確值；不覆蓋法定項目個別進位，未啟用正式政策或改既鎖薪資。以下歷史「mode未核」已由本段後續確認取代。

月中到職首月已確認全薪 × 在職曆日數 ÷ 當月實際總日數，對應既有 calendar-earned 候選；最後合計前不先捨入。固定全薪已確認「只有單一月薪金額」，不捏造固定津貼拆項；仍須核對逐人薪額／有效期與其他實際給付扣款。勞健保扣法另已澄清：「各項依法計算員工自付額」，不一律乘薪資比例；實際各人投保及計費證據仍待核對，C3 尚未完成，法源見獨立報告。2026-08 留停／當月復職已由使用者確認無個案，待正式名冊核對；其他月份留停折算未核定。C2b未完成來源與法遵、C3/D及正式八月全員核對仍未完成；**正式計薪NO GO，不合併或部署**。本輪只補政策文件，沒有正式資料操作、付款或真通知。

八月工時制度先答「有其他制度，需核對適用人員與正式紀錄」，後續排班說明為「依每個月來排的」。最新只確認按月排班，尚不足核定法定制度；不能認定變形／84-1已成立，也不套全員一般8/40。下一項定位八月完整班表與正式紀錄，核對每日安排、適用人員及有效期。初步雲端搜尋未找到可對應本案的紀錄，不代表不存在。OT 對非一般制度保持待核；正常項目候選仍有固定480分鐘限制，ready不等於制度驗證，外層正式月結維持硬阻擋。能力補核與後續最小需求見獨立審查報告；本次未改碼或啟用政策。

最新班表定位已完成：使用者確認在系統內，已在 2026-10-24 23:37:57 台北時間完成必要欄位的正式唯讀盤點。八月31份實際日文件、90班次、6位員工；前後各6日無缺，90班次均以ID對應且不含系統帳號。81筆跨度9h、9筆4h，不能將跨度當實際工作或自扣休息。日別／政策／主檔head與邊界月份覆核、八月班表版本均未取得新制紀錄；完整八月薪資仍未驗收。使用者已確認公司有區分例假／休息日，下一項取得八月具體規則、適用人員與紀錄位置，不再重問有無區分。詳 docs/PR13_AUGUST_ROSTER_AUDIT_2026-10-24.md；僅匿名統計、無原始個資落盤或正式寫入，不合併／部署。上方「只補政策文件」描述先前階段，正式班表讀取以此補充為準。

## 此次交接入口（2026-10-24）

此分支是本機來源 `dc35fde191f99fa294b20c0c64588c564ab6c910` 的完整 tracked snapshot，包含 C1、C2a 修復、C2m 與 C2b WIP。發布提交直接以原 PR #13 分支 `fix/attendance-payroll-consistency` 的 `13717ca8cffcb50209ac53fab9cb281714dae600` 為 parent；不發布本機其他分支歷史，不更動原 PR #13 head。發布 SHA 與本機來源 SHA 不同，程式與測試檔保持來源版本，此文件補上跨機接手說明。

```sh
git clone --branch handoff/pr13-c2b-portable-20261024 --single-branch https://github.com/ahnchen1983/chiayiyouthlabclock.git
cd chiayiyouthlabclock
git status --short --branch
```

接手從本文件及 `docs/PR13_BATCH_C2B.md`、`docs/PR13_BATCH_C2A_FIX.md`、`docs/PR13_BATCH_C2M.md` 開始；所有路徑相對 repo root，不依賴原機器。先重新核對 GitHub PR #13 與本交接分支，再按既有優先順序處理未驗項與修正；保留互動工具核准，未知政策向使用者詢問，不需另等一句「開始」。不得 merge、部署、寫正式資料、發真通知或支付；所有後續提交保留 `[skip netlify]`。

**C2b 仍是 WIP；766 單元/API 測試曾通過（35 files），不代表本次發布已重跑。最後版本 typecheck、build、Firestore emulator、E2E 未完整重跑。C2a 修復與 C2m 尚未完成獨立複核；以下歷史測試紀錄不等於獨立核准。正式計薪仍 NO GO。**

本次僅保存交接，沒有跑長測試或修改業務邏輯。現有 CI 只監聽 main 的 push／PR，本 Draft PR base 是 `fix/attendance-payroll-consistency`，可能不自動執行 CI；未跑不能當通過。`[skip netlify]` 用於跳過 Netlify 自動部署，不觸發手動部署。

以下保留來源交接紀錄；「本機／未發布」等措辭描述來源 checkpoint 當時狀態，以上方此次交接狀態為準。

# Claude 交接：PR #13 與未發布 C2b checkpoint

狀態：2026-10-24；使用者要求停止擴充、保存並交接。**不是正式發薪 READY。** 本文件可公開，不含正式人事資料、憑證或私密本機絕對路徑。PR： https://github.com/ahnchen1983/chiayiyouthlabclock/pull/13 。先讀當前 PR head、CI、comments 與工作樹狀態，不能用此文件舊 SHA 覆蓋同事更新。

## 版本與交接順序

|邏輯工作目錄／分支|本機 commit／base|狀態與搬移界線|
|---|---|---|
|attendance-c1-fix|908b202548990bdf17047c635d1575849e082463|已獨立複驗，publisher 負責發布；此工作者未重查最新遠端|
|獨立 C1 build-loader 修正|來源 6a8bf6dcd1f6b035e3a0802773caed792dbffb57；本樹等價 ae04781a1033b550cb1dbb49288e214c54a0bb78|標準 build 使用官方 runner，保留既有 CI；整合時避免重複搬移|
|attendance-c2a / fix/pr13-normal-pay-proration-c2a|21851cbd79f01a01687421094279d33207ebc311|正常薪資候選；需帶下列 C2a fix，不單獨視為驗收通過|
|attendance-c2a-fix / fix/pr13-workday-comp-source-c2a|11ec1142189265e260934af758c2d898ca03fc2c，base 21851cb；C2m 樹等價 3a0bdfb|跨夜分卡工日歸屬、terminal comp reservation 判定；已交獨立 review，結果由 parent 更新|
|attendance-c2m / fix/pr13-manual-termination-c2m|d414192bd7f7eaef8669d7e325bb42d1c267f323，業務 diff ae04781..d414192|17檔人工離職輸入／雙人覆核，已交 review；此 worker 未 push|
|attendance-c2b / fix/pr13-overtime-c2b|base d414192；pure engine 8b4cd75；後續 WIP commit 以 git log 查最新|僅本機，未 review／未發布。後續 WIP 包含接線與 engine 自查修正，不能只挑 8b4cd75 宣稱完成|

最後收到的遠端發布證據為 PR head 13717ca8cffcb50209ac53fab9cb281714dae600（B5b+fix）；C1 publisher 後續在整合 build fix。**這不是聲稱目前遠端仍停此 SHA**：parent/publisher 需補最新 head、CI 與實際包含批次，Claude 開工前重新只讀核對。不整棵覆蓋公開 sanitize 文件。

本機 commit 全含 `[skip netlify]`。PR title 保留 `[skip netlify]`；不使用 `[skip ci]`。前者只跳本次自動部署，不能當正式隔離保證。本 worker 無 push，publisher 統一處理分支與 PR。

## 已驗證 C2m 與 C2a fix

- C2m 全單元/API：731 passed／33 files。整合真 Firestore emulator 84 passed；最後補歷史版本／來源異常斷言後 5 passed、79 filtered。
- UI 同輪26 passed，最後離職檔8 passed；重疊不累加，共27不同相關案例；其餘57 UI本批未跑。typecheck、標準 npm run build、diff check通過。
- 中間 UI 22 pass/2 fail（可存取標籤）及 unit729 pass/1 fail（無效核准假單被月份過濾）均修正，保留測試，以上為最後結果。
- C2a fix 獨立708 unit/API通過。獨立 emulator 初次78 pass/1 fail（新測試漏 import），修後2 pass/77 filtered；C2m整合84全過包含此修正。不要把前次失敗隱藏或把 filtered 說成 pass。
- C2m人工明細差額可存，但非零差額不能作最終合法性核准。approved=recorded-inputs-only、not-paid、not-applied。已鎖月只建獨立調查案件，不改快照。詳 `docs/PR13_BATCH_C2M.md`。

## C2b WIP 現況：先做什麼

1. `utils/payroll/overtime.ts` 是候選 pure engine：核定工日、來源聯集、日別級距 exact rational、有效工資組成、日/週合規與給付分離。29個合成邊界案例已跑過。
2. `netlify/functions/utils/overtimePreview.ts` 接 server-loaded effective-master 政策與 confirmed work，不接受 client 薪額／proof。附加到 normalPayPreview，UI/CSV展示同一候選證據，不加進 netSalary／snapshot。API/emulator 與UI新增案例尚未跑，不能宣稱整合完成。
3. **目前缺口仍明示 BLOCKED**：完整跨月週工作來源 adapter、個人事假12h分類與主管核實外勤/出差投影、補休原日帳本逐段對帳、月46/54及三月138h、輪班/連續出勤法遵、例假超8h／超12h給付完整分類。不是全套OT引擎完成。月薪假日跨不同R只列待核，不能擅取首段定案。
4. policy schema `normalPay.overtime` 只接已有受核定的資料，尚無完整核定UI/持久來源建立流程。unknown wage components、daytype、240適用、特殊變形/84-1不推定。不能將 fixture 配置成正式制度。
5. C2m尚未把OT逐項差額正式採用：本WIP僅共享旁列候選，不假稱 manual reconciliation 已含完整OT。
6. 優先處理 C2a/C2m review 回饋並獨立 commit；然後審查 WIP 契約、來源完整性與候選分段（含來源變更/跨薪制/月邊界），跑新增 API/真 emulator/UI、完整 type/build 再決定可搬移增量。不得拿這次 checkpoint 當 reviewer approval。

C2b 本輪新增的 pure/API projection 定向測試35 passed；最後自查後啟動的完整單元結果見本文件末。typecheck 已通過一次，之後仍有小幅來源保留改動，最終需再跑。**未跑 C2b emulator、E2E、build**；使用者要求停擴充後未另啟長測試。既有 mock/inmemory 不代替正式資料驗收。

## 使用者已確認與仍待確認政策

- 每日8h，依已核實際工作，不以月總量沖掉逐日加班、不以班表裁切工作。
- 休息由主管核實；無固定午休自動扣除，休息期間受指揮工作需實際證據。
- 離職日期與離職當月薪資都人工輸入；來源逐項對帳／雙人覆核，不是任意手填即合法，也不覆已鎖月份。
- 金額最後合計才進位；通用 mode/increment未核，不擅自 HALF_UP/CEILING。保費各法定項目rounding不能被最後總額規則覆蓋。
- 補休依法32-1/施行細則22-2，個別選擇同意與期限、原日R待資料；不自動清零，亦不採永久免結清。福利假與法定補休分開。
- 無現成員工手冊，之後另擬草案，不能把草案當正式規則。
- 正式核對基準2026-08全體，含正兼職、當月到離職／留停。是回溯核對，不是生效版本啟用或允許改寫已結算。

## 剩餘 C3 / D / 正式驗收

C3：薪資 items、有效期、正常工資組成、法定工資基礎、保費級距身份生效日期／自提／核定零元與缺漏區分、各法定rounding、稅款與對帳；不使用gross固定比例保費。D：逐項人工差額合法性核定、核准調整案件、rollout/effectiveMonth、shadow compare與rollback。歷史snapshot不可重算覆寫；legacy無snapshot只標待核，不捏造原明細。

正式讀取尚未完成：實際deploy/backend project、受控employee/month唯讀入口及完整跨月相交證據須先確認，login可能寫計數／升級hash，不能當唯讀probe。不可將正式人事資料上傳repo/CI。八月真名冊／主檔／cards／申請／保費／歷史lock需實際驗證；mock不能取代。未完成必要政策、正式資料核對、獨立review與驗收，一律 NO GO。

安全限制：不merge/main、不部署、不寫production、不支付、不真通知／scheduler、不建立新憑證。附件production storage/scanner disabled，未配置fail closed；不假scan-pass、不發正式token。保留raw證據/history、月鎖、operationId與expectedRevision、防自核/本人scope。不要重試已拒動作或換通道繞過。

## 法源與測試入口

法律來源與適用版本見 `docs/PR13_BATCH_C2B.md`、`docs/PR13_BATCH_C2M.md`，程式註解保留法條與查詢日。法規資料庫本次LSA頁修正日2024-07-31；2026-10-24官方試算網站不能當已保存的8月歷史頁，不能直接複製現行網站全薪進位/最低薪資。4/3、5/3、8/3使用精確分數。公司可選政策未核仍阻擋。

正常開發指令：`npm test -- --configLoader runner`、`npm run typecheck`、標準 `npm run build`、`npm run test:e2e`。C1 build修正已進package/verify/Playwright，用 Vite官方 `--configLoader runner` 避免特定祖先路徑native loader阻塞，不改依賴、不skip測試。

真emulator只允許可拋棄 `demo-chiayi-payroll` 的 loopback8086/8087；會清空全部synthetic資料，先協調同port不可並跑。不要kill未知程序，不碰正式project。E2E只mock/測試後端，正式網路寫入禁止。

測試logs位於本機暫存，parent另提供絕對路徑；公開repo不需附host路徑或完整執行環境。保存的basename：c2m-delivery-unit.log、c2m-integrated-emulator.log、c2m-delivery-emulator.log、c2m-delivery-e2e.log、c2m-delivery-type.log、c2m-delivery-build.log；C2b：c2b-engine-tests.log、c2b-target.log、c2b-type.log、c2b-unit.log。

### 本輪最後實測與保存狀態

已啟動的完整單元/API測試正常收尾：**766 passed、35 files、0 failed**，49.24秒，`c2b-unit.log`。此結果含最後來源保留修正；不涵蓋新增Firestore/E2E案例。定向35測試及較早typecheck均通過，最後小改後typecheck/build/emulator/E2E未重跑。工作檔與本文件一併保存在最新 `[skip netlify]` WIP commit，提交後應是乾淨工作樹；使用 `git status`/`git log`核對。無丟棄stash、無push、無部署。

## Claude 接手第一輪（2026-10-24，基於 7078444）

已核對：PR #13 head 仍為 `13717ca`、Draft、未合併；PR #14 head `7078444`、base 為 PR #13 分支、77 檔、無 comment、無 CI check（如上所述 CI 只監聽 main）。

修正：`overtimePreview.ts` 拆 `approvalId`（reviewer+'@'+ISO時間）原用第一個 `@`；reviewer id 若含 `@` 會把時間拆壞而誤阻擋（fail closed，不會算錯金額）。改為最後一個 `@`，新增回歸測試（舊碼 1 fail，修後 pass）。

本輪於修正後重跑（單機，非 CI、非獨立 review）：

|項目|結果|
|---|---|
|`npm run typecheck`|通過|
|`npm test -- --configLoader runner`|767 passed／35 files|
|`npm run test:emulator:start`（demo-chiayi-payroll，loopback 8086）|85 passed／2 files|
|`npm run build`|通過（首次因本機 node_modules 舊、缺 tailwindcss 失敗；`npm ci` 依 lock 重裝後通過，非程式問題）|
|`npx playwright test`|85 passed（mock 後端）|

仍未完成、不得視為通過：C2a fix／C2m／C2b 獨立 review；第 52 行列出的 BLOCKED 來源 adapter 與法遵引擎；正式資料唯讀核對；CI 未在本分支執行。正式計薪仍 NO GO。

引擎自查待政策確認（未改程式）：時薪人員休息日 4/3、5/3、8/3 目前視為全額而非「原工資＋加給」，與月薪同一級距；時薪國定假日前 8h 採 2R。兩者需依核定制度或主管機關試算確認後才能定案。
