# C2a：正常薪資與有效期分段試算

## 最新公司政策確認（2026-10-24）

使用者後續已確認「最後合計、四捨五入到整數元」，對應 final／precision 0／half-up，中間分段不先捨入。下文歷史「模式／增量未回答」由此補充取代。月中到職首月另已確認：全薪 × 在職曆日數 ÷ 當月實際總日數，對應既有 calendar-earned 候選策略；不先將此項捨入再扣款。下方其他折算對照仍僅合成例子，不能延伸為離職或留停的公司規則。

法定項目個別進位仍獨立；使用者所述「再扣依比例的勞健保」尚待釐清，兩者不能逕用薪資在職比例：勞保依投保日數／30日基準，健保原則按月歸屬，法源見獨立報告。尚未核定正式政策版本／生效月份，不套用到已鎖薪資。留停折算仍待確認，離職月份維持人工輸入／雙人覆核。最終整合驗證及未完成範圍見 docs/PR14_INDEPENDENT_REVIEW_2026-10-24.md。本次僅補文件，未修改已驗證程式。

基準 C1 fix 等價 `8be8527`（獨立修復 `908b202`）。只做正常項目試算，不實作 C2b 日別加班或 C3 保費／薪資items／完整淨薪整合；正式 gate 維持 BLOCKED，歷史 snapshot 讀取路徑不變。本批沒有正式政策設定或八月上線切換。

## 有限策略與精度

- `utils/payroll/normalPay.ts`：逐日有效主檔（人員類別不推導薪制）、完整日期相交的已核實際工作、已核假分配、已套用補休 debit。保留 employee/date/minutes/payVersion/policy/source 與未捨入分數。
- 月薪只接受明示 `calendar-earned` 或 `calendar-base-minus-30-unpaid-days`；後者以全月薪按曆日分配的基準，扣未在職日的 1/30。到離日 inclusive、休息日 calendar-paid、完整月 contract-amount 必須明示。**這些是假設可測策略，不是公司的正式約定。**
- 留停使用獨立 daily-base-fraction，不借到離職公式；零薪、負數與未知是不同情況。負合計不能默認為員工欠款，轉待核。
- 月中調薪沿每日期薪額與版本；跨日／跨月工作以明示 taipei-calendar policy 作候選估值分段，沒有班表裁切；跨日工時分類須合併，C2a不將零時重置門檻，回needs-review，金額null待C2b。超過每日480分鐘或非一般日工作保留 extraWorkMinutes，法定加班金額為null待C2b，不能解讀為免付。
- 時薪工作、paid leave、paid comp 分項；同時段有交集一律待核，不能雙給。月薪假扣款有明示除數與比例，補休不重複加到月薪。
- `rational.ts` 使用 BigInt 有理數；JSON 保留分子／分母字串。rounding 白名單為 per-item/final、0/2位、half-up/half-even/toward-zero；需要核定版本／actor／time。無 eval，不把二進位浮點結果反覆 round。

## 來源／API／UI

`effectiveMasterForMonth` 轉接可信 policy/day calendar；nested normalPay 看似核定也不能蓋掉外層未核、scope 或主檔版本缺漏。`compNormalPayEvidence` 純讀取核准使用、唯一 debit、原加班來源與任職版本，失效就待核，不改帳本。請假必須有核准及 allocation 覆核 actor/time；只有歷史 status 字串不足。

`SalaryDetail.normalPayPreview` 是共同 API 結果。管理者與本人既有薪資頁顯示同一分段，CSV 直接序列化該結果，不重新計算或四捨五入。下載標題及內容明示「非結算」。既有正式薪資匯出／列印仍受 needs-review gate，不能拿此預覽發薪。

本批沒有新增寫入 API；原有月鎖／snapshot 不重算、不回填。正常項目 ready 只代表該有限範圍來源與政策完整，**整份薪資仍 needs-review**，總額／淨薪不能拿舊單一薪額算法冒充完整結果。

## 人工 golden 基準（全部合成）

| 案例 | 人工公式／預期 |
|---|---|
| 31或28日完整月 | 月薪30000，精確30000/1 |
| 8/16到職，曆日策略 | 30000×16/31＝15483.87 |
| 2/15到職，28日月 | 30000×14/28＝15000 |
| 8/16到職，明示30日扣未在職 | 30000－30000×15/30＝15000 |
| 8/15離職 inclusive | 30000×15/31＝14516.13 |
| 留停10日再復職 | 獨立曆日留停比例，30000×21/31＝20322.58 |
| 8/16調薪30000→33000 | (30000×15＋33000×16)/31＝31548.39 |
| 跨午夜一小時200＋一小時250 | 候選精確估值450，各日來源保留；可付金額null，跨日分類待C2b |
| 時薪6h工作＋2h半薪假 | 1200＋200＝1400，無二次缺勤扣款 |
| 月薪1h不給薪假＋1h補休 | 30000－30000/240＝29875，補休不額外加錢 |
| rounding順序 | 31個日項目各round＝29999.94；最後才round＝30000 |
| 重疊、缺policy、缺rounding、非一般日、額外工作 | 待核／金額null，不能默認0 |

固定案例在 `tests/fixtures/normalPay.ts`、`tests/normalPay.test.ts`。既有C1完整時薪基線測試改為檢查缺新政策時不得給完整薪資；另新增帶完整合成normal policy的API案例驗證1600預覽與最終net=null。

## 未完成與依賴

C2b：日別／週期／法遵與支付義務、OT來源級距、外勤及補休到期原日工資整合。C3：items、保費級距與扣項、完整gross/net精度。D：人工逐項差額、版本rollout、歷史差額流程。公司正式折算、留停、休息跨夜、rounding等政策仍未核定；正式2026-08全體資料與部署環境尚未驗收，NO GO。

時薪整月沒有已核工作／給薪來源時，API不能把空資料當作已核零工時；零工時正式確認流程尚未提供，維持待核。

## 使用者新政策紀錄（2026-10-24；尚非完整正式政策版本）

- 已確認進位階段為**最後合計**：API預覽拒絕per-item政策；final策略各分段只保留精確值，不先產生分項捨入額。模式／增量（例如四捨五入整元或無條件進位）尚未回答，未核不得ready。工具中的per-item只保留合成差異測試，不作公司可啟用策略。已核保費官方金額是獨立來源，C2a不重算保費。
- 休息由主管負責：沿既有主管覆核工作／休息的server actor/time/source evidence，不預設午休或自動扣時間。
- 最新澄清：離職日期與離職當月核定薪資都人工輸入；沒有核定折算公式。上表離職折算僅合成比較，API遇離職月份保持待核，不能以試算取代人工核定。人工輸入／雙人覆核／逐項差額持久流程尚未實作；本批不新增寫入入口。
- 「補休沒有過期」先前意向已由「依法規」澄清：法定加班補休依32-1及細則22-2期限結清，並非到期歸零；與公司額外福利分制度，個別同意／年度／期間實際資料仍缺，維持legal-policy-review BLOCKED。本批不刪時數、不自動付款、不把法定來源設為永久免結清。
- 員工手冊未有，草案另批管理；不把本文件當正式規章。既有已鎖資料不覆寫，也未建立正式policy configuration。

## 官方來源與適用界線（查證日2026-10-24）

- 勞基法[22條](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=22&pcode=N0030001)全額、[23條](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=23&pcode=N0030001)明細與清冊五年；細則[9條](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=9&pcode=N0030002)終止結清、[14-1條](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=14-1&pcode=N0030002)各給付／合法扣項／實發。人工總額不取代來源明細，待覆核不代表可無限延後付款；actor/reason/before-after是本系統設計保障，不宣稱法條逐字指定。
- 細則[17條](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=17&pcode=N0030002)跨二曆日正常工作應合併：估值切日不是每日工時重新歸零；跨夜及跨月保留完整來源，C2b分類未完成就不可ready。合成10h連續跨夜、兩卡相接、同卡跨夜休息都有阻擋回歸。
- 官方[月薪試算器程式](https://calcr2.mol.gov.tw/js/zhHantTW/monthly.js)加給工資合計使用ceil，僅此工具範圍，非整份淨薪通用法律；此查日不是已驗證2026-08歷史版本。目前未找到可據以設定所有實發款的通用round mode條文，因此保留待核，不能寫成「法律無規範」。[勞動部倍率說明](https://www.mol.gov.tw/1607/1632/1640/63139/)之4/3、5/3不得縮成1.33、1.66，C2b將用精確分數。
- [勞保局說明第4點](https://www.bli.gov.tw/0006443.html)及[健保細則52條](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=52&pcode=L0060002)有項目專屬進位規則（含健保分配特例）；公司final-stage不覆蓋法定項目方式。C2a不處理保費，C3保留來源核定金額及該項規則版本。
- 補休依[勞基法32-1](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=32-1&pcode=N0030001)、[細則22-2](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=22-2&pcode=N0030002)：個別選擇同意、原加班來源、順序及期限結清；不新增正式期限設定或自動付款。

## 人工離職核定下一個必要入口（未實作，不宣稱本批完成）

獨立versioned紀錄需含employee/month、人工離職日期、金額及scope(normal/gross/net)、各來源項目、輸入者/覆核者/server time、reason/history、source版本與程式同scope試算差額。缺金額不是0；不同scope或不完整試算不能強算差額。雙人覆核、operation receipt、來源過期及月鎖交易守護須完成後才可接採用。核定不是合法性自動保證，不能直接改employment主檔或已鎖snapshot。按本輪「只補文註與正確分流」限制，這些寫入流程保留下一批，不以單一手填總額替代薪資明細。

## 本批驗證（合成資料，不是正式驗收）

- `npm test -- --configLoader runner`：32 files、696 tests passed，0 failed。含C1基準653及本批43個新增案例。
- `npm run typecheck`、`npm run build -- --configLoader runner`：pass。
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator`：77 passed，0 failed；只清理demo emulator合成資料。
- Playwright normal-pay-preview、payroll-master、payroll-review、payroll-review-workflow：19 passed，0 failed。未將其餘57個UI案例宣稱本批已重跑。
- 初次沙箱emulator連線EPERM（69 failed、8 skipped），UI server bind EPERM；經限定loopback測試權限後重跑上述通過。一般config loader停在啟動階段的單元/build命令已中止，改runner loader，沒有刪測試或用skip規避。
- 正式2026-08資料核對、未完成人工離職核定寫入流程、C2b/C3/D及正式環境隔離：未測／未完成，仍NO GO。沒有push/deploy或真通知。

C2a獨立review修復：分卡且跨午夜休息不能規避工日分配待核；只有綁定目前已核工作來源的可信政策workdayAssignments才分組正常分鐘，無配置不以自然日重置480。已駁回／取消補休使用且預占已釋放，不再誤列pending；未知／帳本不一致仍阻擋。見PR13_BATCH_C2A_FIX.md，未新增正式mapping UI，正式gate不變。
