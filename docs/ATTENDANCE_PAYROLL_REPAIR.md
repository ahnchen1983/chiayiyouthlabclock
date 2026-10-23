# 本機修復交接（2026-10-23）

> 本檔以下保留原 PR 發布時的交接紀錄；覆核 UI、月份保存與檢測流程已於後續修復更新。最新狀態以 `docs/PR13_REPAIR_LOOP.md` 及 `docs/PR13_VERIFICATION_2026-10-23.md` 為準。原有測試數字與尚未實作描述不是最新結論。

## 工作位置與邊界

這是原系統的獨立本機 clone：`<repair-checkout>`，分支 `fix/attendance-payroll-consistency`，基於遠端 main `84091c6108bbc6d55f47bca5455fc944b9a7f0cd`。不是原 checkout 的 worktree，因此原 repo 的 `git worktree list` 不會列出這裡。本機原 checkout HEAD 仍為 `8f4a2ff4fb030f0ebcf3866cc048684621e3355f`，乾淨；其 `new/` 與展示 repo 未修改。

僅本機修復與合成測試；沒有 push、部署、合併 main、Library 上傳、production credential 使用或正式 DB 操作。此分支尚未上線，既有已付薪資未變動。

## 已落實

- 所有當日/月選擇使用台北日期；新卡保存完整 UTC timestamp 和台北 workDate。可有多個 sessions；重送 requestId 冪等；下班可找到前日未完成上班卡。缺上班卡/多個未閉合卡不猜測配對，要求補卡。
- `utils/attendance.ts` 保存打卡跨度與已覆核工作區間兩者。實際工作以整數分鐘及區間聯集計算，不裁切至班表；原始卡修改會使覆核失效。舊 HH:mm 跨夜不自動加24h，缺卡/無效時間回傳null與待覆核原因。
- 依使用者確認的每日480分鐘及實際工作逐日計算，不以10+6h沖銷前一天延長工時。只有 reviewer 明確列入的 regularDates 與級距可算加班；其他日別不套公式。班表保留作缺卡核對，不再當出勤或薪資fallback。
- 時薪由已確認工作＋有薪假構成，不再對未計入的事假重扣。假單需按日人工覆核 allocations；重複/重疊、跨月未分配、缺卡、政策/保費未確認時不能結算。月薪基準、請假比例及已申報保費沒有自行推定。
- 新增月底快照 `payrollRuns`：個人完整結果、非機密計算輸入、版本、inputHash。和monthLock在同一交易提交；讀已鎖月份取原快照。舊月鎖沒有快照回傳legacy-review與null金額，不捏造已結算明細。禁止解鎖覆寫或重新結算歷史run；差額流程未在本批實作。
- 所有主要薪資相關修改（班表/套模板/重置/回溯/換班/開放班次/請假核准/補卡/改卡/留停核准）使用同一交易gate與月鎖；跨月查所有涉及月份。大型清空與快照超限採整批拒絕，避免部分寫入。補卡核准與卡修改原子提交，重複審核冪等，修訂前後另存attendanceRevisions。
- 員工與主管出勤都以同一resolved record顯示覆核工時；未知顯示待覆核，不回退stored workHours。薪資畫面和薪資條共用貨幣格式，CSV保留同一數值；待覆核薪資禁止匯出/列印結算檔。出勤編輯新增下班日期與可填多段的工作覆核欄位。

## 覆核資料契約（無正式資料遷移）

- ClockRecord新增 `clockInAt/clockOutAt`；`workIntervals:[{start,end}]` 是該台北workDate午夜起的整數分鐘，隔日可超過1440。`workReview` 綁定sourceKey與reviewer。不能只自行更新workHours。
- `update-clock-record` 接收完整timestamp和workIntervals。管理頁可填 `09:00-12:00,14:00-18:00`；跨夜如 `22:00-06:00+1`。勾選覆核才確認實際工作；未勾選保留待覆核。
- `review-payroll-inputs` 僅SuperAdmin可呼叫，包含empId、review。review必須標明yearMonth、policy.version、hoursBasis=actual、dailyRegularMinutes=480、workDateRule、regularDates、overtimeTiers（分子/分母）、各假別給薪/扣薪比例、monthlyHourlyDivisor（若月薪）、moneyDecimals（0或2）及實際保費金額。伺服器寫入reviewer與時間。**這不是預設法規或保費表**；任何未知項目維持待覆核。
- `review-leave-allocation` 僅管理者可呼叫，對已核准假單提供每天from/to/minutes。假別/連續假政策仍由承辦確認，不能把自然跨度默認為工作時數。
- 目前僅建出勤工作區間覆核UI；月度政策/保費與假單分配的專用表單未建，使用上述有權限保護的API契約。未設定時正式算薪會被阻擋；部署前需先完成公司政策與受控操作流程驗收。

## 測試與重跑

`tests/fixtures/payrollV2.ts` 是固定合成資料與明示制度版本；不代表全員薪制。新增純函式回歸35項、API記憶體整合31項。既有93項所在3份測試保留；舊斷言的更動理由：不再把排班當出勤、已核定實際工作不被班表裁切、延後四捨五入、不從gross固定百分比推定保費、未核定打卡跨度不標加班。其他原有測試也一起執行。

```sh
npm ci --ignore-scripts
npm test -- --configLoader runner
npm run typecheck
npm run build -- --configLoader runner
# 瀏覽器只用mock API，helper阻擋所有HTTPS外連
PLAYWRIGHT_BROWSERS_PATH=/tmp/clock-repair-browsers npm run test:e2e -- --workers=2
```

Vitest使用獨立config，不載入Vite的env設定。runner是此執行環境的config loader；原bundle loader曾無輸出等待而中止。Playwright使用本機build+preview，避免dev server依賴預打包逾時。**一般build和E2E build不可並行**，兩者共用dist而VITE_E2E不同；最後需再跑一般build，這不會部署。

API整合測試完整mock firebaseAdmin與token，不使用service account或網路。它驗證handler流程、交易提交/回滾與鎖定入口，但不能證明實際Firestore在競爭條件下的重試與吞吐；本批未跑Firebase emulator/rules suite或負載測試。

## 待確認／明確未完成

1. 已確認每日8h與實際工時；午休/休息、提早到晚離開的工作認定、跨夜歸屬、日別/級距、各假別給薪、月薪除數、金額round規則與保費個人資料仍待公司確認。普通日級距只在合成fixture或明確review下適用。
2. 不是全功能薪資引擎：休息日/例假/國定假日、週工時/跨月週的完整法規分類尚未實作；未覆核日期阻擋結算。regularDates必須由承辦核實，不可整月無差別勾選。
3. 待覆核舊資料沒有自動遷移、回算或補發；有UTC錯日、缺卡/重複卡、跨夜不明的資料需個案核實。保留原始卡與結算證據。
4. 月快照目前單一文件，超過800KB拒絕；全清空超過450筆拒絕。本批不引入分批結算協調系統。
5. 本批暫停歷史解鎖覆寫及員工硬刪除，避免歷史薪資身份遺失；後續應另建差額審批，不直接改已付款。
6. 出勤狀態仍是行政提示；部分請假/跨夜的遲到早退精細規則未全部重設，不把徽章當薪資依據。已核實工作區間才是薪資來源。

## 最後驗證結果

2026-10-23 在此獨立 clone 重跑：Vitest **14 files / 251 passed、0 failed**；`tsc --noEmit` exit 0；正式模式 Vite build exit 0；Playwright Chromium **7 passed、0 failed**（35.5s）。可重跑命令見上；本機原始輸出在 `docs/repair-evidence/`。E2E 完成後再建置一般模式，避免留下測試模式 dist。`git diff --check` 通過，原 checkout 仍乾淨。

建置警告：既有 `/index.css` 不存在、E2E 的 NO_COLOR/FORCE_COLOR 同時設定；未造成失敗。未測：Firestore emulator/rules、真實交易競爭與負載、正式後端、公司政策與操作流程驗收。因此通過本機測試不表示可以直接上線結算。

核對原checkout乾淨、分支基準；檢查所有salary getter使用同一快照路徑；檢查金額null不格式成0；檢查補卡重送/清空/跨月及月鎖漏口；核對snapshot不含員工password；所有修改限制在repair。未向任何服務寫入或上傳本次成果。

## 獨立審查修正

- 部分班段缺卡亦阻擋結算；以原始出勤跨度或核准假單檢查班段證據完整性，不把班表加進薪資。若已核實缺勤／免出勤，SuperAdmin 的月度 review 可附 `scheduleExceptions:[{date,reason,sourceKey}]`；sourceKey 必須由 `scheduleEvidenceKey(shifts, dayRecords, dayLeaves)` 對當前資料生成，資料變動會失效。尚無專用差異覆核 UI，不得用例外掩蓋未調查漏卡。
- 先以絕對分鐘檢查不同 workDate（含相鄰月份）重疊，衝突阻擋月結；knownWorkMinutes 亦以絕對聯集去重，不擅自決定跨日加班歸屬。月結讀取跨月卡作驗證與快照證據。
- 請假分配在 API 及計算器雙層檢查核准起訖、核准總 hours、重疊和整數分鐘，無法用分配延長核准假單。
- 新初始化系統 ADMIN 明示 `accountKind=system-account`；既有未分類管理帳號仍待確認，可由 SuperAdmin 對該月設定 review.participation=system-account 及 participationReason。絕不依薪資零或管理者角色自動排除真員工，亦不自動改正式舊資料。測試已移除2099到職日替代法。
- 審查後增加13項回歸（純函式6、API7），含跨月鎖定拒絕、例外失效及零薪真員工不可結算。

## 後續 P1：月結快照容量邊界

獨立複驗確認前4項已關閉後，發現全歷史卡會耗盡月快照800KB。此補丁只將 `lock-month` 的計算與快照共同輸入限制為本月計薪員工、本月workDate與前月最後一天／次月第一天。完整邊界卡仍保存，以證明跨月衝突檢查用過的證據；符合現有每筆最多24h且起點須在workDate內的驗證約束。如日後允許更長卡段，必須同步擴大證據範圍。

新增3項記憶體API回歸：1000筆無關舊卡仍可結算1600且舊卡保留；前後邊界完整卡保留且排除非計薪員工；真正超800KB的當月證據仍回409且無monthLock、run或gate部分寫入。沒有刪除或修改任何DB舊紀錄。交易仍讀取clockRecords集合；本補丁解決快照容量，未另做索引／查詢效能改造。

本補丁驗證：14檔254項全部通過、0失敗；typecheck/build exit 0；受影響薪資E2E 2 passed、0 failed（24.9s）。前批其餘5項E2E本次未重跑；Firestore emulator／真實併發與正式環境仍未測。證據見 `docs/repair-evidence/bounded-*.log`。

## 安全初始化後續修正

先前自動建立系統ADMIN的描述已被本次安全修正取代：公開初始化停用，不自建任何可登入帳號。既有系統帳號分類契約與當月覆核流程保留；不重設既有帳號。見 SECURE_FIRST_RUN.md。新增3項mock安全回歸，全套257項通過；typecheck/build通過。
