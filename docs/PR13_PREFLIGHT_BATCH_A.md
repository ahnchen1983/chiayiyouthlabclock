> **最新修正說明：下列初版 scoped READY 可月結行為已被獨立 review 判定不符規格，後續 P1 修正已封鎖所有新正式月結。請以本文末「P1 修正批」為準；初版紀錄保留供追溯。**

# 批次 A：統一月結預檢與待審申請保護

基準：PR #13 `43251f09eb7a24098eee0ee09c093abb78c8392f`。分支 `fix/pr13-preflight-batch-a`。只本機修復，保留原 repair、原 checkout 及 PR 分支；不部署、不發送實際通知、不讀寫正式人事資料。

> 最新狀態：下列初版 READY／現有模型可結算敘述只記錄修正前行為。P1 修正後，正式月結資格一律 BLOCKED，無設定豁免；trialStatus 僅表示試算完整度。兩項 P1 已獨立複驗關閉，准予進入 PR 審查，不代表正式發薪許可。

## 有限批次順序

A 統一 preflight／現有申請阻擋 → B 案件狀態與通知 outbox → C 薪資主檔有效期 → D 工作來源與日別政策 → E 差額批准與正式唯讀對帳。本次只實作 A 的現有模型，不創建後續模型。

## 變更及 ownership

- `netlify/functions/utils/payrollPreflight.ts`：統一 READY／NEEDS_REVIEW／BLOCKED，沿用既有算薪與覆核原因；以實際區間判斷四種申請是否影響選定月份。未載入集合、無法識別歸屬、未知狀態保守阻擋；明確終止狀態不再因 pending 阻擋。
- `netlify/functions/api.ts`：薪資讀取與 lock-month 共用入口，後端交易重新預檢。假單、補卡、留停、換班建立使用同一 revision gate，避免新 pending 與月結競態。已鎖月份返回 423，不更改快照。
- `types.ts`、`components/PayrollReviewNotice.tsx`：新增可追溯 source/sourceId 與模型缺口；既有 calculationStatus 保持相容，主管與員工共用提示。待核金額 null，已確認分鐘保留。原結算按鈕與匯出使用 needs-review 保護。
- `tests/payrollPreflight.test.ts`、`tests/payrollApi.test.ts`、`tests/firestore-api.emulator.test.ts`、`tests/e2e/payroll-review-workflow.spec.ts`：純函式、mock API、真正 SDK/emulator 交易與 UI 分層回歸。
- 需求矩陣 `PR13_PHASE1_REQUIREMENTS_2026-10-24.md`：附本批狀態與 8.1 正式唯讀入口缺口。

## 固定合成案例與人工基準

所有員工為 SYNTH；月份 2026-04；基準卡 09–17、已覆核 480 分鐘、明示時薪 200、明示保費 0 與 fixture 政策（不是正式公司政策）。

|案例|輸入|人工預期／差額判斷|自動驗證位置|
|---|---|---|---|
|PF01|完整已覆核 480 分鐘，四集合已讀且空|READY（限現有模型），1600，差額 0|payrollPreflight|
|PF02–03|同上＋待審假單／補卡／留停／換班雙方|BLOCKED，金額 null，不是 0；已知 480 分鐘保留|純函式＋API|
|PF04/10/11/16|集合缺失、未知 status、壞日期、無歸屬|BLOCKED，不可靜默忽略|payrollPreflight|
|PF05–06|已核准／駁回補卡、無關員工／月份|不因 pending 阻擋，1600 差額 0；仍須算薪覆核|payrollPreflight|
|PF07–09|缺 policy／insurance、缺卡或排班差異、重疊卡|NEEDS_REVIEW，金額 null|payrollPreflight|
|PF12–15/19|月底跨夜卡＋次月假單；上月補卡完整或舊時間跨入本月；開放留停；恰午夜結束|前四種 BLOCKED；午夜不相交可 READY|payrollPreflight|
|PF17–18|空計薪名冊；私有理由與聯絡資訊|空名冊 BLOCKED；issue 穩定且不含理由／聯絡資訊|payrollPreflight|
|API atomic|待審時呼叫真正 lock-month 入口|409，無部分 run/lock/gate 寫入；駁回後可結算1600|payrollApi／emulator|
|競態|同時送補卡與月結，兩種呼叫順序|只能一方成功；另一方409或423；單一 revision，無部分寫入|Firestore emulator|
|既有快照|鎖後修改 live 申請|讀取原1600快照不重算|payrollApi|
|畫面|BLOCKED → 申請處理後 READY|先顯示原因並停用結算，後恢復按鈕；仍顯示非正式發薪許可|Chromium E2E|

## 已知界線／下一批

READY 只代表現有模型的月結門檻；`preflight.gaps` 永遠列出尚無模型的加班補休申請、必要薪資項目、人工差額批准、完整出勤案件、正式對帳。這些功能不是已通過，也不是空集合＝零。未核政策、保費、工時等既有模型仍阻結算。正式發薪 NO GO。

已批准但未反映輸入的完整案件偵測、通知重試／關閉原因、差額補發表單尚缺。本批不聲稱完成使用者 2.1–8.3 全規格。人工差額及必要項目需下一批先建立 schema／覆核流程，不能靠本批 READY 證明其不存在。已鎖月份申請目前只拒絕並指示差額覆核，尚無可操作差額表單。

現有主檔／工時／申請集合仍全量讀取，新交易保護也讀全部 monthLocks、cards、schedule；大資料量延遲、交易大小與吞吐未驗證，下一批須設計 employee/month 及完整跨月相交查詢，不能刪減必要證據。UI 查詢不是同一讀取快照；真正 lock-month 在交易內重新讀取檢查，UI READY 可能在結算時轉409。

正式日別、休息、跨夜歸屬、外勤門檻、月薪折算、稅款／項目與正式保費尚待確認；僅每日8小時與依實際工時已確認。正式環境、唯讀對帳入口、實際資料與人工差額尚未驗收。無 production credential 或資料參與測試。

## 驗證結果

- `npm test -- --configLoader runner`：20 files、416 passed、0 failed；較基準386新增30項（23純函式＋7 API）。PF19曾重現 READY 錯放行，修正後完整重跑通過。
- `npm run typecheck`：通過。
- Chromium：`PLAYWRIGHT_BROWSERS_PATH=<isolated-browser-cache> npm run test:e2e -- --workers=1`，16 passed、0 failed（原15＋新1）。第一次雙 worker 有4 failed（timeout）、2 interrupted、8未跑、2 passed；讀取證據後單 worker 全套通過，未改 timeout／斷言。保留首次失敗結果，不將初次失敗抹除。
- `VITE_E2E=false npm run build -- --configLoader runner`：通過。
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8086 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator`：2 files、19 passed、0 failed（基準16＋新3）。真正 Firestore SDK、原子交易、競態及 rules；非 in-memory。官方 CLI 第一次停在 jar 下載、第二次停在啟動等待，均中止；改直接執行同一官方 v1.20.2 jar（loopback/demo/rules）後完整通過。Java 21 為暫存官方 Temurin，已比對官方 SHA256。未變更專案依賴或持久登入設定。
- `git diff --check`：通過。最終可執行測試合計451 passed、0 failed（416＋19＋16）；不計 typecheck/build 為測試案例。
- 合成驗證輸入、預期、實際結果由測試 assert 固定；上述表格案例最終均符合人工明示基準，差額0（阻擋案例為狀態／null驗證，不虛構數字差額）。
- 正式資料驗收、實際通知、負載／容量：未測；不能以以上合成結果取代。

使用者指定2026-08全體員工回溯核對，尚未讀取正式資料；沒有啟用 effectiveMonth 或改歷史款。

## P1 修正批（已通過獨立複驗）

正式preflight.status固定BLOCKED（必要能力尚缺）；trialStatus獨立呈現既有試算完整度。assertPayrollReady再次檢查必需能力，沒有runtime豁免設定或自由文字跳過。UI關閉正式結算按鈕；API409且不寫run/lock/revision。原先已有的snapshot讀取路徑保留。此行為會暫時阻擋全部新正式月結，是刻意保護，不是宣稱必要模型已完成。

核准補卡改以不可變attendanceRevisions作套用證據：申請內容hash、套用revision、effective card投影pointer、parentRevisionId、actor/time、before/after。核准、有效投影及revision同一交易提交；重複核准不新增revision。後續合法人工修正沿父鏈驗證；核准18:00後合法更正17:00可保留，不盲目覆回18:00。只有核准欄位、缺revision、申請內容改動、actor不符、來源鏈斷裂均待覆核。舊raw來源保存在首筆revision.before且後續不更新該revision；clockRecords是既有有效投影，沿用架構，未宣稱新增不可變原始打卡event store。核准補卡仍清空工作覆核，不能把打卡跨度直接當工作。

測試分界：既有快照容量、重播與交易競態測試保留，於測試檔用mock隔離「正式資格」邊界，以試算完整度驅動快照機制；它們不代表正式月結獲准，也沒有production可用的bypass。新增describe使用真實assertPayrollReady驗證完整fixture仍409/零寫入，包含emulator實測；新增補卡核准併發、重複、鎖月rollback、原始證據保留、新人工修正與破壞來源鏈案例。所有舊測試仍執行；原PF05核准直接通過的舊bug斷言改為待覆核，不刪除。

限制：其他核准來源（非補卡）的完整落實證據仍待B；所有申請／revision仍全量讀，容量與效能未驗收。正式八月資料、必要項目／人工差額／OTcomp／案件模型未完成；不允許正式發薪。

最終結果：21 files／425 unit+mock API passed；2 files／22 Firestore emulator+rules passed；16 Chromium E2E passed。總463 passed、0 failed；typecheck、正式Vite build、git diff --check通過。基準A為416+19+16，本輪新增9單元/API與3emulator案例；原核准無證據案例保留並修正預期。初跑曾因trial聚合引用正式status、合成舊卡單邊timestamp缺完整in而失敗；修正聚合、在明示人工更正案例提供完整in/out後重跑全套通過，沒有調整timeout、跳過測試或刪斷言。

重跑指令與環境沿用本文；emulator直接使用官方jar，限定loopback/demo，通知provider為fake。日誌在本機暫存：p1-unit-final.log、p1-emulator-tests.log、p1-e2e.log、p1-typecheck-final.log、p1-build-final.log。未執行正式資料／部署／實際通知測試。既有快照交易案例的測試資格stub僅限測試檔，務必與新增真實正式門檻回歸分開閱讀。
