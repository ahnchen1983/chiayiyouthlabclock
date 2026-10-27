# B5b 獨立修復：任職重驗與取得來源區間

基準 c370a4c，獨立修復不含 C1 業務實作。

1. 使用申請預占時保留 employmentEvidence；核准交易重新讀取員工到離職／留停，並比對來源版本。已離職、留停、未知或來源變更回409，原預占／request／ledger完整保留，不自動使用或結清。C1已核主檔存在時，以唯一有效active期間驗證，不從legacy覆蓋主檔；主檔變更需重新覆核。
2. 取得分鐘依實際 approvedIntervals 的時間先後選取，按區間及台北曆日拆成來源lot；requested起點只作完整來源追溯／月鎖，不當workStart或原工資日。每批保留選定區間、sourceClaim、原日metadata。這是來源日期，不等於自行判定法定跨夜歸屬。
3. 跨日來源需逐日 dayEvidence 明示一般／休息日及eligibleMinutes；未知保持pending-policy。不得將單一dayType套到多日。原日工資不完整或日期不符保持pending-payroll/null；不採最新時薪。
4. 一筆取得可能追加多個credit事件，來源claim逐段去重；FIFO按lot實際workStart。原OT申請月份與每取得來源月份的鎖定均保留。

合成基準：4/12使用60預占後離職改4/11，核准409、available60/reserved60/used0不變；4/1 23–4/2 02申請僅核4/2 01–02，取得來源開始01:00且原日4/2；23:30–24:00、00:30–01:00、01:30–02:00三段拆3批，使用45按首批30+次批15；跨日缺逐日分類不入帳。另驗legacy留停／C1主檔留停／主檔版本改變。

正式 gate 仍 BLOCKED / NO GO。沒有付款、正式資料或通知；政策與C2薪資引擎未完成。

實跑：622/622 unit/API、69/69真Firestore emulator/rules、4/4受影響Chromium UI、typecheck/build/diff check通過。其他63個UI案例本修復未重跑；不可與前版67全套混稱同輪。獨立review兩個handler與一個真emulator失敗案例已轉為通過，另加跨日真持久化案例。
