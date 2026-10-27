# C1 independent review fixes

基準 `ec0eab9`，獨立修復兩項 finding；不含 C2a 新計算器、正常薪資預覽或 rational 工具。

## P1：缺薪制仍由職稱推導

新 review-payroll-inputs 必須明示 payBasis；參與薪資者不得只核金額、工時、保費就推導薪制。系統帳號排除另有原因契約。已採主檔者覆核薪制必須與有效主檔一致；legacy 只接受已有明示 payBasis 的月覆核，不採職稱或 full/part 推導。舊 generic review 未含 payBasis 就 unknown/needs-review/null。既有不可變月結快照不重新計算。

覆核 UI 新增必選薪制，空值不預填；原月薪 fixture 加上明示合成 monthly，不刪原薪資斷言。原 8h＋職稱專責＋30000 薪額反例：缺薪制新覆核400零寫；歷史 generic review仍 null；明示 hourly 才得到1600。

## P2：已核復職被 legacy 離職日期覆蓋

共用 employmentAuthority：已核有效 timeline 優先，未涵蓋日期unknown、留停loa、非任職not-employed；沒有採用主檔時才檢查有效legacy起訖。日期包含到離當日；下一日才屬已離職。缺／錯日期不當active。

補休submit/approve、餘額與結清檢查、案件detector、薪資月份納入範圍共用此來源規則。移除submit在驗過有效主檔後又用legacy resignDate否決的第二道矛盾判定，並保留過去申請、版本變更、LOA、month guard等限制。已採主檔但未覆蓋本月不可回退猜legacy薪資；歷史snapshot讀取路徑不改。

反例：legacy 4/30離職、雙人核定5月復職，5/12使用60min可預占／核准；5月查餘額及scan不能因舊離職日產生離職結清。來源更版、LOA或未涵蓋日期仍阻擋。採新timeline後，舊留停申請缺有效版本套用證據不再以legacy欄位冒充已套用。

## 回歸與限制

新增11個unit/API／純函式／detector案例、2個真Firestore案例、1個UI案例。測試政策全部合成，正式資料零讀寫。正式gate仍BLOCKED，C2/C3/D與政策核定／正式八月核對仍未完成。不推送、不部署。

已完成：653 unit/API（31檔）、typecheck、production build、diff check 通過。真 emulator 與完整E2E仍在執行時先建立獨立修復commit供並行review；此commit不代表驗證全部完成，終態結果另行回報。log：`/tmp/c1fix-unit-complete.log`、`/tmp/c1fix-type-complete.log`、`/tmp/c1fix-build-complete.log`、`/tmp/c1fix-emulator.log`、`/tmp/c1fix-e2e.log`。
