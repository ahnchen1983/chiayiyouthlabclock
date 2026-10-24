# C1 薪資／任職有效期主檔

本批沿用 B5b，新增主檔版本與試算來源保護；不實作C2部分月／日別加班算法或C3保費items。正式gate維持BLOCKED，無production資料或部署。

## 有界順序／owned files

C1：effectiveMaster/masterWorkflow、主檔timeline UI、既有PayrollReviewPanel版本綁定、payrollReviewStorage及payroll讀取、相應API/types/測試。C2再做部分月、日別與rounding；C3薪資items及保費核對，未改順序。

## 資料與權限

- payrollMasterVersions：提案完整timeline，涵蓋期間必須連續、不重疊；每段明示 employmentState、employmentType、payBasis、amount、policyVersionId、dayTypeCalendarId。
- payrollMasterHeads：一個active版本指標／revision；交易核定後新增payrollMasterActivations。舊approved版本不可修改，已生效日期前綴不可追溯變更。
- payrollMasterCommands：同操作識別／內容重播，交易共用month guard。提案只能未來生效；已結算與過去不藉新版本重算。
- get-payroll-master：本人只看已核版本與本人legacy預覽；最高管理者可看指定員工提案。一般主管無他人薪資權限。
- propose/review-payroll-master：沿既有最高管理者權限；核定不得為提案者或薪資本人，必須另一位既有授權者。未配置第二位授權者時不能核定，不自動建立grants。
- payrollPolicyVersions/dayTypeCalendars 為可信已核來源參照，本批沒有任意自核這些政策的入口；缺漏／未核／逐日unknown阻擋試算。

## 試算與legacy

人員類別不決定薪制；明示full-time/hourly及part-time/monthly都可儲存。多段到離／留停／復職／調薪完整保留，C1不猜折算公式，月份內非單一active基準就不給整月薪資。日薪亦待C2。新有效主檔需本月覆核綁定精確masterVersion；stale UI不能盲目核定新版本。既有薪資覆核UI傳送並校驗版本。

無新主檔的legacy不自行猜生效日；遷移預覽payBasis/employmentType/effectiveFrom為null待核。既有已明示 payBasis、工時／保費月覆核的完整月基線保留唯讀相容；缺 payBasis 的 generic review 不可由職稱推導，未覆核或月中到離／留停仍待核。舊update-employee對所有員工的legacy薪資與雇用欄位改為唯讀，不可繞過版本流程；未變欄位仍可隨身份表單送出，不會清空既有覆核。新建員工由server標記需有效主檔，不能借legacy推導薪制；client不能偽造effective欄位；身份／聯絡等既有流程保留。

每次變更要帶入完整時間軸並比較既有前綴；未核提案不生效。退回後建立新提案，舊紀錄不刪除。既有accountKind不可透過新版本追溯改類別；人員改系統帳號需獨立流程，本批不自動轉換零薪員工。

## 人工基準與未完成

明確 hourly200、已核8小時、同一完整有效月的trial仍1600；full-time不強迫月薪。月中hire/exit/LOA/rejoin/raise只保留分段與needs-review，baseSalary/net為null而非整月薪額或0。跨日的日別參照仍是資料，不宣稱C2法定歸屬已完成。

正式政策資料核定UI、政策版本管理全流程、部分月折算、日別OT、items／保費、正式八月全體核對、上線切換與歷史差額流程均未完成。主檔核定UI與tests都是本機synthetic，不代表真員工薪資已核定。歷史snapshot不覆寫。

## 合成核對案例（不是正式八月資料）

| 輸入 | 明示人工基準／程式斷言 | 證據 |
|---|---|---|
| 正職＋時薪200，完整5月，已核8h | trial基本薪1600、差額0；人員類別不改薪制 | effectiveMaster.test：fully covered explicit hourly |
| 兼職＋月薪30000／定期契約＋日薪 | 主檔可保存明示組合；日薪算法仍待C2 | employment/pay basis參數案例 |
| 5月分段到職、留停、復職調薪32000、離職 | 保留31日來源；部分月結果null待核，不給整月30000 | full timeline案例 |
| 期間缺口／交疊／薪制空白 | 409、零部分寫入 | 三個驗證案例 |
| 相同operation重播／兩提案競爭核定 | 同一receipt；一個head activation；過期提案409 | unit及真Firestore競爭案例 |
| 5月鎖定，6月才調薪 | 保留5月時間軸和snapshot；可提出及核定6月延伸 | locked historical prefix案例 |
| UI覆核未附最新masterVersion | 409；帶一致版本才能記錄月覆核 | stale UI案例 |
| 未採新主檔者直接改legacy時薪 | 409且原值不變；僅身份異動可送未變薪資欄位 | legacy read-only案例 |
| 新增員工偽造masterRequired=false | server仍標true；缺有效主檔薪資為null待核 | new personnel案例 |

本批新增20個unit/API案例、4個真Firestore案例、4個mock UI E2E案例。既有來源異動測試仍保留：舊API改薪改為409；以明示測試內out-of-band來源異動繼續驗證舊覆核失效，未刪除原保護斷言。

日別參照與舊月覆核 regularDates 若衝突，trial亦待核，不能把休息日透過舊欄位當一般工作日。

## 重跑方式與限制

基準為 `6d54856f6c74b7c1979c9f773fd293dbe2d8b9b8`（B5b fix `40dd9f1` 的等價 cherry-pick）；本批 diff 不包含 B5b 修復本身。使用 repository 的 npm scripts：

```sh
npm test -- --configLoader runner --maxWorkers=2
npm run typecheck
VITE_E2E=false npm run build -- --configLoader runner
FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator
PLAYWRIGHT_BROWSERS_PATH=/tmp/clock-repair-browsers npm run test:e2e -- --workers=2
```

Emulator 僅供可清除的本機 demo project；測試會清空合成資料，不能指向正式專案。E2E 使用 mock API，不能代表部署後端整合或正式資料驗收。政策／日曆核定資料目前只有受信任測試 fixture，未提供正式寫入管理流程。舊頁面的薪資／雇用編輯已改為版本流程提示，不可借身份更新直接修改那些舊欄位。

## 本批驗證結果

- Unit/API：30檔、642 passed、0 failed（含新增20案例）。
- 真Firestore emulator/rules：2檔、73 passed、0 failed（含新增4個C1交易案例）。
- 完整Playwright mock API E2E：71 passed、0 failed（含新增4個C1 UI案例），6.1分鐘。
- typecheck、production bundle build、git diff --check：通過。
- 最後的日別衝突純計算guard由642案例覆蓋；同輪emulator已啟動後才補入此guard，未重跑未變更的交易案例。UI整輪以最後UI版本執行。
- 正式資料、正式部署／通知、政策核定管理入口、C2/C3、實際員工人工對帳：未測／未完成，NO GO。

本機log：`/tmp/c1-unit-delivery.log`、`/tmp/c1-type-delivery.log`、`/tmp/c1-build-delivery.log`、`/tmp/c1-emulator-complete.log`、`/tmp/c1-e2e-complete.log`。所有資料為合成；本批沒有正式查詢、寫入或發布。

C1獨立review兩項修復與更新證據見 PR13_BATCH_C1_FIX.md；其薪制與任職來源契約優先於原批次說明。
