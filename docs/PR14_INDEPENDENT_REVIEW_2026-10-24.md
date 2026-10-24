# PR14 獨立審查、修復與驗證

日期：2026-10-24（台北時間）。接手基準：本機 `cf1d7461619345efa1ebccf169e8625f1905af30`；當時遠端 PR14 為 `7078444597a406d12b44bf8a6573ba77f84333ff`，Draft、base 為 PR13 的 `fix/attendance-payroll-consistency`。PR13 head 為 `13717ca8cffcb50209ac53fab9cb281714dae600`，Draft、未合併。

本輪以獨立隔離副本重建 lock 檔依賴，僅使用合成資料、demo-chiayi-payroll 本機模擬器及 mock 瀏覽器。沒有存取正式資料、通知、付款、政策啟用或部署；原工作目錄未追蹤的測試資料未讀寫。此輪審查不能取代 C2b 未完成功能與 C3/D 正式驗收。

## 獨立審查發現與修復

| 範圍 | 嚴重度 | 原問題及具體結果 | 修復 |
| --- | --- | --- | --- |
| C2m 來源讀取 | P1 | 同員工卡缺少／無效日期時被日期查詢漏掉；送審後新增卡，來源 hash 不變，第二人仍能批准人工輸入記錄 | 只盤點目標員工；未知日期留在 hash 與阻核理由，核准時重新讀取 |
| C2m 更正鏈 | P2 | 真實 attendanceRevisions 只有 recordId 與 before/after.empId，誤查頂層 empId，合法補卡遭誤擋 | 依本月／邊界選定卡的 recordId 分批讀取真實更正鏈，核對員工歸屬 |
| C2a 工日政策 | P2 | 8/1–15 政策可用其 mapping 授權 8/20–21 工作，正常候選誤 ready | 保留外層政策版本、員工與有效範圍，按實際區間核對 |
| C2a 假單 | P2 | 無效核准假單期間因 NaN 月份比較被略過，正常候選誤 ready | 終態先排除，非終態先驗日期與順序，再篩月份 |
| C2a 覆核證據 | P2 | 無效 reviewedAt 被拼成非空 approvalId，正常候選誤 ready | 建立工作／假單 interval 前驗證 actor 與有效覆核時間 |
| C2b 整日加給 | P2 | 月薪假日跨 R200/R300 時雖列待核，首段 1600 仍列為已知；9 小時例子已知合計錯列 2000 | 全工日基礎不明時整日項 exact=null；可確定的逐段 OT400 仍保留，不推定整日基礎 |
| C2b 版本證據 | P2 | sourceIds 與 sourceVersions 各自排序，A/B 交換來源版本後結果相同 | 同 tuple 排序並保留配對；UI/CSV沿用同一證據 |
| 完整薪資呼叫端 | P2 | date 缺失或非字串會在 startsWith/slice 拋例外；單純修正常預覽仍未保護完整呼叫端 | 未知日期保留待核、已知工時仍可觀察，無法核定總工時及薪資時回 null |
| 共用出勤來源 | P2 | 既存 workIntervals 含 null／undefined 元素時，讀取 i.start 會讓薪資及正常預覽拋例外 | 元素先驗證形狀，畸形來源回待核；合法區間及明示零工作區間保持原行為 |

P1 是人工來源覆核錯誤，不表示已付款或正式薪資門檻已被繞過。法定加給候選仍固定 formalEligibility=BLOCKED、payableAmount=null；C2m approved 仍為 recorded-inputs-only、not-applied、not-paid。沒有以本輪修復移除上述 gate。

每批先加正確行為測試並確認舊碼失敗，再修正；不是只依作者既有測試判定通過。C2a/C2m/C2b 分工互相隔離，修復再由其他審查者與整合者交叉核對。

技術容量：C2m 單員工來源清冊最多 10,000 筆，相關月來源／更正鏈各最多 1,000 筆，超限整筆拒絕；這些是資源保護，不是公司人資規則。清冊不查全體員工或全庫更正紀錄。

## 使用者政策確認與法源核對

使用者本輪明確回答時薪休息日／國定假日有無額外公司加給：「依適用法定基準」。因此沒有另設高於法定標準的公司加給；不能把法定基準降為任選倍率，也不把核定日別或正常工資組成省略。

同輪後續確認最後合計的規則為「四捨五入到整數元」：對應 stage=final、precision=0、mode=half-up；中間分段保留精確值。這是公司最後合計的規則，不覆蓋法定項目個別規定，也不是已建立正式政策版本、核定生效月份或允許重算已鎖薪資。此次只補政策紀錄，未修改程式或正式設定。

1. 時薪休息日出勤，前 2 小時按 R×4/3、第 3–8 小時 R×5/3、第 9–12 小時 R×8/3 計算該次出勤工資。不能再對相同時數一律疊加另一份 R。臺中市政府勞工局官方問答第一篇 Q3 以 R198、1/6/10 小時列 264／1848／3564，提供可重現基準；第二篇 Q1 亦列 3 小時 858。
2. 時薪人員於原約定工作日適逢國定假日出勤，前 8 小時的出勤時薪加倍，總額按 2R 計；若另處已列相同時段 1R，不可再把 2R 當額外項重複加總。原無出勤義務、合法調移或與休息日／例假相遇，須先依實際核定日別認定。
3. 月薪中的假日照給工資與另加的假日出勤工資須分列；公司不另加給不代表可省略法定義務。此輪未改動既有法定倍率，僅消除「由公司任選是否另加 1 倍」的誤解。

查證日為 2026-10-24，當前官方說明不是 2026-08 個別契約、日別或付款的歷史封存。仍須核實當時適用事實。

- 勞動部按時計酬及休息日工資說明：<https://www.mol.gov.tw/1607/28690/2282/2284/2290/7170/>。
- 臺中市政府勞工局官方問答（第一篇 Q3、第二篇 Q1）：<https://www.labor.taichung.gov.tw/media/1351846/%E5%8B%9E%E5%8B%95%E5%9F%BA%E6%BA%96%E6%B3%95%E4%BF%AE%E6%AD%A3%E6%A1%88%E5%B8%B8%E8%A6%8B%E5%95%8F%E7%AD%94%E9%9B%861141125.pdf>。
- 臺北市政府勞動局 2026-10-21 國定假日出勤說明：<https://bola.gov.taipei/News_Content.aspx?n=098B457D83590D7F&s=02B3D4D8A7F75CE3&sms=72544237BBE4C5F6>。
- 勞動部國定假日及調移說明：<https://www.mol.gov.tw/1607/28690/2282/2284/2290/7154/>。

## 驗證紀錄

接手基準 cf1d746 的獨立完整驗證通過：767 單元/API（35 檔）、85 Firestore/rules、85 Chromium E2E、typecheck、production build、production dependency audit。瀏覽器使用 mock、Firestore 僅可拋棄 demo 專案；這不是正式資料端到端驗收。

第一輪修復整合版 822 單元/API（37 檔）、87 Firestore/rules、85 Chromium E2E、typecheck、production build 及依賴稽核均通過。其後補上共用工作區間元素形狀防禦，並對最終程式版本再次執行完整驗證：

| 項目 | 最終結果 |
| --- | --- |
| 單元/API | 832 passed，38 檔 |
| 真實 Firestore emulator/rules | 87 passed，2 檔，僅 demo-chiayi-payroll |
| Chromium E2E | 85 passed，合成 API mock |
| typecheck／production build／production dependency audit | 全部通過 |

驗證程式提交：`d3ca818f32a983d0746ac53ad374dd68a71ae288`。同輪 manifest 為 `.verification/pr13/2026-10-24T14-53-33-058Z/manifest.json`，source hash 為 `ef6d762bf08cae254a5ad7b62b4864409aacf8eeec535aad30b98a22b0b94d34`；2026-10-24 台北時間 22:53:33 開始、22:56:59 完成，六個步驟 exit code 均為 0。驗證期間 HEAD 與程式來源沒有變更，後續僅補交接文件；不同 run 的重疊案例不加總。完整 log/manifest 為本機證據，未聲稱 GitHub CI 執行成功。

## 正式計薪狀態

仍為 NO GO。最後合計的方式與精度已確認，正式政策版本／生效月份及法定項目的個別進位仍須核對。月中到職及留停折算尚未核定；離職月份沿既有人工輸入與覆核，不以測試公式取代。跨月完整週工作來源、事假 12h 與外勤／出差專用投影、補休原日帳本對帳、月 46/54h 與三個月 138h、輪班／連續出勤、例假超時給付、C3/D、rollout、正式 2026-08 全員來源與人工對帳尚未完成。維持 Draft、[skip netlify]；本輪不合併 PR13 或 PR14、不部署、不觸發真通知或付款。

PR14 的 base 仍為 PR13 分支，既有 CI 只監聽 main，檢查為空不能當 CI 通過。上述通過均須以本機 manifest／source hash 證據辨識；沒有改 CI 工作流或偽稱遠端 CI 成功。
