# C2a 獨立修復：工日歸屬與補休終態

基準21851cb，僅C2a calculator／可信來源adapter／補休projection與回歸，沒有C2m。

P1：兩張核准卡20:00–23:30、翌日00:30–06:00原先READY1800且extra=0。現在多日期工作若缺工日歸屬來源，amount=null、needs-review，保留候選1800與全部540分鐘；不以間隔長短或自然日猜測同／不同工日。缺mapping的跨多日資料保守待核，不只挑午夜附近幾小時，沒有gap魔數。

可測明示配置為已核有效政策normalPay.workdayAssignments：sourceId、sourceVersion（原卡key＋完整已核工作區間＋覆核actor/time的hash）、workApprovalId、start/end絕對分鐘、workdayId、workdayDate。只有可信effective-master載入的已核policy可提供，adapter必須比對目前卡來源與工作覆核、完整區間；重複／過期／部分配置待核，卡上client自帶workday不被讀取。每個proof保留policy version/reviewer/time。**沒有新增正式寫入入口或mapping預設值／UI；C2b仍需完成核定工日配置流程與法遵分類。**

合成同一工日配置：540分鐘按同group合計，正常480分鐘候選1600、額外60分鐘待C2b；不同工日且有明確核定來源：210+330分鐘，正常候選1800。同曆日多工日、identity/date衝突、失效proof不可ready。後者不是跨日法遵或加班全面核定，最終薪資仍BLOCKED。細則17跨曆日合併規則及其他法遵限制作為C2b前提，不能把card／休息斷點當新8小時額度。

P2：真實reject/cancel handler完成後，source projection不再把終態當pending；不產生給薪分鐘，必須確認folded ledger無殘留reservation或debit。未釋放預占、unknown、needs-info仍待核。原工作、其他申請／政策block不移除，projection不改DB；同一reject/cancel重播只有一筆release。

測試含pure正反例、真API有／無來源配置與過期proof、Firestore兩項原重現／來源變更，所有policy僅合成。技術測試不是正式八月驗收，未push/deploy/改歷史結算。

驗證：完整unit/API 708 passed；最終proof更新後三檔109 passed（重疊不累加）。typecheck及runner build通過。完整Firestore/rules首輪78 passed、1 failed（新測試缺clockSourceKey import，非產品斷言）；修正import及完整工作來源hash後原兩項review案例2 passed、77 filtered，未宣稱79項同輪全綠。沒有新增UI流程，本fix未重跑E2E。所有命令／輸出保留本機日誌；正式資料仍未測。
