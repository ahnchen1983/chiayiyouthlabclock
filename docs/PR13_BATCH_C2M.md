# C2m 人工離職輸入與雙人覆核

原基準 C2a `21851cbd79f01a01687421094279d33207ebc311`；本批獨立diff基準為 `ae04781a1033b550cb1dbb49288e214c54a0bb78`，已先接C2a獨立fix等價3a0bdfb與build-loader等價ae04781（來源6a8bf6d）。本批實作人工離職日期、逐項薪資登錄、來源差額及雙人輸入覆核，**不是付款、不是完整法定薪資認證，也不採用到正式薪資引擎**。沒有正式資料讀寫、政策啟用、部署或通知。C2b/C3/D未完成，formal gate仍BLOCKED。

## 可操作流程與契約

最高管理者於既有薪資明細視窗開啟「人工離職薪資覆核」；本人薪資頁只看自己的已核紀錄。人工日期、金額、應發／扣項／核定實發及精度皆需明選，無預設金額類別、無自動捨入。來源試算為server從C1有效主檔、月覆核、原卡／已核工作、假、補休及申請／案件證據重建；不能由client帶入trial、actor或核准狀態。

- `get-termination-settlement`：employee/month限定讀取；最高管理者查他人、員工只本人已核紀錄；普通主管不得看他人薪資。
- `get-termination-settlement-version`：按employee/month/draft/revision讀不可變歷史；管理者可由歷程查看舊值，員工僅本人已核版本，不拿目前值重算歷史。
- `save-termination-draft`：建立draft或修改draft/rejected；每次新revision均另存不可變版本。
- `submit-termination-draft`：draft→pending；來源變更需重存；來源／金額缺口可送審供調查，但不得approve。
- `review-termination-draft`：第二位最高管理者approve/reject；不能是當事員工、建立／任何歷史編輯／送審者。原來源hash變更不得批准；允許退回後重新保存，保留所有舊版本。
- `open-termination-adjustment`：已鎖月份只能建立獨立pending-review差額案件，保留原lock hash／payrollRun參照；不改原snapshot、工資或名冊。案件後續差額金額核定／付款仍未提供。

`terminationSettlementDrafts`為目前狀態，`terminationSettlementVersions`保留每版完整人工明細、來源比較、before/after可回查、actor/server time/reason/history；`terminationSettlementCommands`保存actor+operationId收據；`terminationAdjustmentCases`獨立保存歷史調查案件。schemaVersion固定v1。每月100份、單份100歷程/項、700KB為技術保護，不是公司人資制度；超限交易零部分寫入。

所有寫入在共用payrollControl transaction，真正審核重讀角色、任職及來源。expectedRevision拒絕競爭覆寫，operationId重播不增版本；client偽造proof／approvedBy無效。私有Firestore collections維持client deny。GET不清除未知寫入，UI切頁回來保留原payload與operationId再重試。

## 差額、人工核定及法律界線

本批逐項可比範圍：C2a正常項目與已有核定月保費來源。人工每項保存amount/sourceCode/reason、trialExact及delta分子分母；應發、扣項、人工實發分開。精度明示TWD整元或至二位，不隱藏ceil/half-up。實發需與人工逐項合計精確相等。

來源缺失、未核保費、未列必要項、未知項、非零差額、待核申請／出勤案件、離職日期與C1核定任職時間軸不一致：保留draft/pending及原因，不能靠文字或approve按鈕消除。日期不符應先走既有主檔雙人核定流程；本表不偷偷改resignDate。已生效／歷史主檔更正限制仍有效。

**本批不提供非零差額的最終合法性核定引擎。** 加給、稅款、法定日別加班、補休到期工資與保費特殊規則未整合者仍待C2b/C3/D。可先保存人工資料及差額供覆核；不可把有差額的手填總額當正式可付款。即使零差額雙人核定approved，也僅代表recorded-inputs-only，paymentStatus=not-paid、applicationStatus=not-applied，preflight仍阻擋正式採用。

法源（查證日2026-10-24）：[勞基法22](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=22&pcode=N0030001)全額、[23](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=23&pcode=N0030001)明細／清冊五年、[細則9](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=9&pcode=N0030002)終止結清、[14-1](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=14-1&pcode=N0030002)給付／合法扣項／實發明細。audit與雙人控制是本系統設計，不稱法條逐字規定這些欄位；pending不代表雇主可無限延遲給付。final round stage已確認，但通用mode未核，保費法定項目規則獨立，沿C2a來源註解。

## 合成驗收基準

fixture `terminationSeed`：僅合成，月薪31000、8/1–15有效任職、8/16起已核not-employed；明示曆日策略31000×15/31=15000；三保費各自來源明示0；人工應發15000、扣項0、實發15000，逐項delta=0。這不是公司正式制度或八月真資料。

測試覆蓋：建立→送審→第二人核定、不自核、員工／一般主管反例、來源變更退回重送、重播／競爭／容量、缺值／錯類別／精度／單一總額拒絕、差額／未知保費／日期不符待核、locked僅新差額案件及原快照不變；UI來源／差額、無預設、連點、未知重試、手機、錯誤重讀。最終執行結果於交付回報，mock不代替emulator或正式核對。

## 最終驗證與可重跑命令

- `npm test -- --configLoader runner`：33 files，**731 passed、0 failed**（C2a fix基準708＋本批23）。
- `npm run typecheck`、標準 `npm run build`：通過。標準build已由獨立build-loader commit ae04781統一runner；沒有額外改依賴或CI斷言。
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator`：整合版**84 passed**。最後來源異常／歷史版本斷言更新後 `-- -t C2m` **5 passed、79 filtered**。只用可拋棄demo資料。
- Playwright termination-settlement、normal-pay-preview、payroll-master、payroll-review、payroll-review-workflow：同輪**26 passed**；新增歷史檢視後離職檔**8 passed**。共27個不同相關案例通過，重疊不累加；其餘57個UI案例本批未重跑。
- 首輪UI 22 passed／2 failed為下拉標籤包含選項文字，已補明確可存取名稱，原斷言保留。中間整合unit 729 passed／1 failed抓到無效已核假單被篩出月份；已改保留未知來源阻核，最終731全過。
- C2a獨立修復、C2m及build-loader分commit；不把舊公開文件sanitize回退。正式資料、實際付款／通知、部署、正式政策設定與C2b/C3/D皆未執行／未完成，NO GO。

## 2026-10-24 獨立審查修復

獨立重現 P1：缺／無效日期卡被來源查詢排除，送審後新增仍可能保持 hash 並批准人工輸入記錄；P2：真實 attendanceRevisions 無頂層 empId，合法補卡鏈遭漏讀。已改只盤點目標員工，未知日期留於 hash 與阻核理由，依選定 recordId 讀取真實鏈並驗歸屬。技術清冊上限 10000、相關月來源／更正鏈各 1000，超限拒絕、非人資政策。合成正確行為先紅後綠，另加兩項真 SDK 原流程重現並交整合驗證。結果見 docs/PR14_INDEPENDENT_REVIEW_2026-10-24.md；approved 仍只記錄人工輸入，正式採用及付款維持 BLOCKED。
