# PR #13 第一階段：需求矩陣、資料流與分批計畫

盤點日期：2026-10-24。此文件是規格與現況差距，不是新功能完成報告或正式發薪許可。未修改業務程式、推送、合併、部署、建立credential、傳送通知或讀取正式人事資料；不得將下列合成結果當正式核對。

> 最新發布狀態：批次 A 已完成兩項 P1 修正與獨立複驗。正式資格固定 BLOCKED，試算完整度另以 trialStatus 表示。以下盤點與早期批次狀態保留作歷史證據；最新結果以 PR13_PREFLIGHT_BATCH_A.md 及 PR13_BATCH_A_PUBLICATION.md 為準。

## 版本與證據界線

- 實際文件工作目錄：隔離盤點副本；本機 HEAD `09e075fc0148a410d3f3b325f73729a787c41086`，tree `5d268d20b7da788eca689adc221d2154ecb44c04`。本輪僅新增本文件與去識別化測試log，不覆蓋該分支。
- 最新PR：<https://github.com/ahnchen1983/chiayiyouthlabclock/pull/13>，head **43251f09eb7a24098eee0ee09c093abb78c8392f**，draft=true、merged=false；標題仍含 `[skip netlify]`。main/base `84091c6108bbc6d55f47bca5455fc944b9a7f0cd`。本輪讀取一般留言與reviews均空；inline review comments亦空（已另查）。
- 最新head比昨天發布的ee54a6a多21個提交，40個檔案變更。不得從舊repair直接覆寫PR或推送；下一批應從上述最新head另開本機工作分支，開始前再核對head。
- 獨立只讀程式盤點副本：隔離唯讀副本，detached HEAD=43251f0。從public repo只讀fetch，不使用新憑證。未讀Codex sessions。該版未找到AGENTS.md或.agents技能目錄；測試指令以package.json、vitest.config.ts及scripts/verify-pr13.mjs為準。
- 本輪實跑舊repair：14 files / **257 passed、0 failed**。本輪實跑最新PR隔離副本：19 files / **386 passed、0 failed**，命令均為`npm test -- --configLoader runner`。log見`phase1-evidence/`。最新副本依鎖檔安裝依賴且禁用安裝腳本；離線安裝先因ENOTCACHED失敗，後正常安裝成功。未修改依賴版本。
- 最新遠端CI [39939660399](https://github.com/ahnchen1983/chiayiyouthlabclock/actions/runs/39939660399) completed/success，head=43251f0。`.github/workflows/ci.yml`呼叫verify:pr13；最新版既有文件記錄386程式/mock、16 emulator/rules、15瀏覽器及build通過。這些emulator/E2E/build數字是既有文件/CI證據，本輪沒有重跑，不等於正式環境成功。
- 2e5a64f引入覆核驗證，10d4b55引入表單，4fdbb30按月保存覆核並綁員工基準，998bdc9快照重播修正，2b59c20統一CI驗證循環，43251f0整理驗證限制。正式資料、網站runtime、公司規則與發薪差額均未核實。

## 狀態與來源索引

狀態可並列：**已完成**僅指該狹義程式能力有證據；**部分**＝有基礎但不滿足整項；**未實作**＝指定模型/API/UI未見；**待政策**＝不能補預設規則；**待正式資料驗證**＝不得靠mock替代。以下路徑/行號皆對應43251f0；不對應舊repair同名檔。

| 碼 | 現有來源/API/schema | 可追溯測試 |
|---|---|---|
| A | utils/attendance.ts；netlify/functions/utils/clockMutation.ts；types.ts:22 ClockRecord；api.ts update-clock-record約1852 | payrollRegression、workIntervalReview、pr13-payroll-review、pr13-overnight-review.spec |
| B | netlify/functions/api.ts:1873–1968 submit/approve-makeup-request；types.ts:187 ClockMakeupRequest；ClockMakeupForm、MakeupApprovalQueue | payrollApi、pr13-makeup-review |
| C | api.ts:912–977 submit/approve-leave；types.ts:101–145 LeaveType/LeaveRequest；LeaveRequestForm、LeaveApprovalQueue | calculations、payrollRegression、pr13-payroll-review、employee-leave.spec |
| D | api.ts:166 writeNotification、約1973 get/mark-notification；notifications、fcmTokens；NotificationBell | fcm.test；無持久重試outbox測試 |
| E | types.ts:58–89 ScheduleEvent/StaffShift；api update/apply-template/restore-schedule-version、shift-swap/open-shift；ScheduleManager | scheduleVersion、shiftSwap、staffPreferences、admin-schedule.spec |
| F | netlify/functions/utils/payroll.ts:73 calculateSalaryForEmployee，約144按position選薪制、~177逐日OT；types.ts:357 SalaryDetail | payrollRegression、pr13-payroll-review |
| G | api.ts:980/996/1016 get-payroll-review-inputs/review-payroll-inputs/review-leave-allocation；payrollReviewValidation.ts、payrollReviewStorage.ts；types.ts:474；PayrollReviewPanel.tsx | payrollApi、pr13-firestore-review、payroll-review-workflow.spec |
| H | api.ts:1385 lock-month、1419 unlock-month；monthGuard.ts、payrollSnapshot.ts；types.ts:392/496；payrollControl/monthLocks/payrollRuns | monthGuard、firestore-api.emulator、firestore-rules、pr13-firestore-review |
| I | api.ts:1039–1148 employee CRUD/password、1736起LOA；types.ts:148 Employee、2 UserRole；EmployeeManager/LOA表單 | selfServiceRequests、payrollApi；尚無完整effective-dated paymaster測試 |
| J | SalaryCalculation/MySalary、services/payslipPrint/attendancePrint、utils/format；api.ts:1284/1288 salary getters；MonthlyReport約1294 | payroll-review.spec、attendancePrint、csvMasking、monthlyReport |
| K | scripts/verify-pr13.mjs；firebase.test.json、vitest.emulator.config.ts、playwright.config.ts、CI | CI成功；本輪只跑單元/mock |

## 需求矩陣：2.x 出勤案件與通知

| 編號 | 子需求 | 狀態 | 目前證據與精確缺口／下一步 |
|---|---|---|---|
| 2.1.a | 每日與事件觸發，結合班表/raw卡/補卡/leave/comp/外勤出差/雇用期 | 部分 | A/C/E/F有即時計算與月度差異；無每日掃描scheduler、事件重算case或comp來源；雇用期未進完整逐日異常掃描。 |
| 2.1.b | 12異常分類，不因approved原因直接曠職扣薪 | 部分 | 詳下表2.1.01–12；F多用reviewReasons阻擋，不是可追蹤案件；禁止把無卡直接推成曠職。 |
| 2.1.c | 冪等案件id、員工/班表/card refs、事件時間、狀態 | 未實作 | 卡requestId冪等不等於案件冪等；擬建AttendanceCase與sourceVersion/key，重算不重複通知。 |
| 2.2.a | 補卡通知、日期/時間/reason/必要附件 | 部分 | B有日期、reason及時間欄位、補卡UI；submit未見附件規則/附件模型與缺卡自動通知。必要時間需依類型校驗，不僅reason/date。 |
| 2.2.b | 指定主管、approve/return/request-info/cancel/resubmit | 部分 | B僅Admin/SuperAdmin可核准/駁回，無指定主管及補件/撤回/重送狀態機。 |
| 2.2.c | 待申請/待審/核准/退回/取消；raw證據保留 | 部分 | B有待審/核准/駁回，核准改卡另存attendanceRevisions；需顯式raw event與correction lineage、完整轉移history。 |
| 2.2.d | pending阻月結；通知失敗重試不丟case | 未實作 | H計薪入口未載入makeupRequests；無持久outbox。已存在正常卡但仍pending補正不能僅靠缺卡檢查保護。 |
| 2.3.a | 異常說明/補請假與OT轉補休分離模型 | 未實作 | C能申請假但無獨立explanation/retroactive申請型別；無OT-to-comp ledger。 |
| 2.3.b | 有效期間、重疊、卡衝突；僅approved正式輸入、不雙扣 | 部分 | F/C已核准假按分配區間驗證，含跨月work/leave衝突；申請期間、補休等新模型仍缺。 |
| 2.3.c | actor/time/history、重送與核准更正可追溯 | 部分 | approvalDate/approver、auditLogs/revisions已有；未有全狀態不可變事件史及撤銷核准版本。 |
| 2.4.a | OT事前/事後申請、補申請提醒 | 未實作 | 無OT request API/schema/UI，不可用現有請假表單混代。 |
| 2.4.b | actual/requested/approved/statutory-paid分離 | 未實作／待政策 | F計算確認工作與OT，但無四層欄位及審批；缺申請不得抹去已確認工作。 |
| 2.4.c | 各日別不可單一倍率 | 部分／待政策 | G只容明確regularDates及tier；非一般日待覆核，沒有日別完整引擎。 |
| 2.5.a | 統一case中心涵蓋缺卡、遲早、未出勤、卡假、OT/comp、班表換班、paymaster缺漏、月結未解 | 未實作 | D通知Bell不是案件中心；G是月度薪資覆核，沒有統一owner/type/待辦路由。 |
| 2.5.b | owner/status/對象/通知時間結果/history/close reason | 部分 | D僅empId/type/read/createdAt/link；無送達嘗試、案件處理人、結案原因。 |
| 2.5.c | channel/timing/frequency/escalation配置 | 未實作／待政策 | 有FCM與站內通知但沒有重試佇列/頻率/升級規則。後續測試一律fake dispatcher，不實發。 |

### 2.1 的12種異常逐項核對

| ID | 異常 | 狀態／證據 | 驗收要求（尚非已實作） |
|---|---|---|---|
| 2.1.01 | 缺上班 | 部分 A/F，無效卡待覆核 | 建獨立case，核准補卡後才close；保留原缺值 |
| 2.1.02 | 缺下班 | 部分 A/B/F | 超過可配置截止時間只提醒不猜下班 |
| 2.1.03 | 整段無卡且無核准原因 | 部分 E/F/G schedule gaps | 核准假/免出勤可解釋；pending不可當approved，禁自動扣薪 |
| 2.1.04 | 遲到 | 部分 calculations/行政status | 按核准部分假/班段/寬限檢查，與計薪分鐘分離 |
| 2.1.05 | 早退 | 部分 calculations/行政status | 不用班表裁掉已確認工作；補件/解釋結案 |
| 2.1.06 | 工時差異 | 部分 F/G | raw/確認工作/班表/核准非到場工作差額分列 |
| 2.1.07 | 有卡無班 | 未實作案件；F可算已覆核工作 | 另建排班解釋case，不能因無班就刪工時 |
| 2.1.08 | 重複/順序錯/重疊 | 部分 A/F，已阻擋 | 跨record絕對時間、冪等case與來源鏈 |
| 2.1.09 | 跨夜錯日 | 部分 A/F | 完整timestamp、舊錯日待人工核；不自動改歷史workDate |
| 2.1.10 | 卡假重疊 | 已完成狹義衝突阻擋／案件未實作 F | 相鄰月也檢查；休息間核准假不誤判工作重疊 |
| 2.1.11 | 相關申請pending | 未實作統一阻擋 | 申請有效範圍與月關聯、lock前必須重新檢查 |
| 2.1.12 | 已批准未反映 | 部分 B原子補卡；未有偵測 | approved事件與實際輸入版本對帳，不能只看status |

## 需求矩陣：3.x 班表與工作時間

| 編號 | 子需求 | 狀態 | 來源／缺口 |
|---|---|---|---|
| 3.1.a | 員工班表、正兼職、休息、跨夜、分段 | 部分 E/A | shift有empId/from/to/endDateOffset；休息靠人工workIntervals，未有班制休息政策及休息工作認定模型。 |
| 3.1.b | 換班/代班/臨調、日別、有效期、核准與不可覆歷史版本 | 部分 E/H | 有swap/open shift/version snapshot與鎖月；未有每次調班完整有效期/日別/批准版本連結，未鎖dailySchedule仍可改。 |
| 3.2.a | 有效時間、整數分鐘、休息排除/休息中工作、多段去重 | 部分 A/F | 核准workIntervals可以表達，但不會自行判斷休息是否工作，需政策與表單提示。 |
| 3.2.b | 跨日歸屬、原卡/核准修正優先級 | 部分／待政策 A/B/G | 目前僅clock-in-date；修正留revisions，缺獨立raw event＋更正優先序政策。 |
| 3.2.c | 外勤公出差合併、同policy人工比對 | 部分／待政策 F/C | 非到場來源混在leave allocations；沒有人工逐item對照表。 |
| 3.3.a | 一般/休息/例假/國假/特殊/合法變形週期 | 部分／待政策 G | 只支援明示一般日；其餘不能計算，不等於支援全部日制。 |
| 3.3.b | 員工明確適用、unknown不得預設normal | 部分 G | regularDates＋employee基準綁定已有；需effective-dated workSystem/dayCalendar，不把每日8h套所有日別。 |
| 3.4.a | 外勤來源區間、一般work重疊、班表、正常與OT門檻 | 部分／待政策 F約130–180 | 來源為核准假分配、重疊會擋，但work/OT分鐘只取workIntervals，外勤分配目前走fraction pay，不進8h工作門檻。必須明確決策，不能當已正確。 |
| 3.4.b | 假/加班交叉核對、未知不當0 | 部分 F | 未分配/未知比例會擋；外勤與OT關聯未實作，需獨立非到場工作來源及政策。 |

## 需求矩陣：4.x 薪制與假別

| 編號 | 子需求 | 狀態 | 來源／缺口 |
|---|---|---|---|
| 4.1.a | employmentType與payBasis分離、薪資有效期、班/日制 | 未實作 F:144/I | position==專責人員即月薪，其餘時薪；無獨立payBasis與salary versions。 |
| 4.1.b | hire/exit/LOA/return、扣項 | 部分 I/G | 日期/status欄位及review失效已有；無有效期薪資帳本、通用扣項與區間折算。 |
| 4.2.a | 月薪完整月及中途到離/留停復職/調薪/生效日期 | 部分／待政策 F/I | monthly基本值仍整月baseRate，無分段折算；完整月fixture不是中途月驗收。 |
| 4.2.b | 核定折算方式、假/OT/allowance/deduction分列 | 部分／待政策 F/G/J | divisor需輸入、假及OT分列；中途月除數不得猜，津貼獎金等line items缺。 |
| 4.3.a | 時薪有效期、分鐘/休息/多段跨夜 | 部分 A/F/I | 已核定分鐘與多段跨夜可算；時薪只有目前值，缺歷史有效期與調薪切段。 |
| 4.3.b | 換班取消補登/日別OT/rounding/歷史 | 部分／待政策 E/F/H | 不以班表代actual，不免OT；鎖定快照保留，但日別引擎及未結月歷史費率不足。 |
| 4.4.a | 獨立OT module、日別/基礎/級距/外勤合併 | 未實作／待政策 F | inline普通日tier不是完整OT模組；需時間與金額輸出分離。 |
| 4.4.b | comp申請/批准/使用/餘額，政策版本有效期 | 未實作／待政策 | 無comp ledger，不得用LeaveType或剩餘時數代替可稽核借貸事件。 |
| 4.5.a | 假別可設定、paid ratio、計時與核准 | 部分 C/G | 固定LeaveType enum、按月fraction map與allocation；非可管理的effective policy catalog。 |
| 4.5.b | 非一般假分離，unknown不得default0 | 部分 F/G | 缺fraction會擋，狹義已完成；外勤仍同模型，補休/特殊假須分離。 |

## 需求矩陣：5.x 項目、保費與精度

| 編號 | 子需求 | 狀態 | 來源／缺口 |
|---|---|---|---|
| 5.1.a | item code/type、金額/公式、員工有效期、計算基礎 | 未實作 J/types SalaryDetail | 固定欄位不能表達通用津貼、獎金、稅、扣款與基礎納入規則。 |
| 5.1.b | 核准/來源對帳、required missing阻擋 | 未實作 | 建payItems與policy版本、typed inputs及approval，不用任意可執行公式。 |
| 5.2.a | 每人每月保費自提級距/身分/生效/基礎/核定來源/diff | 部分 G | 三個核定扣款數值與review人時間已有；無級距/身分/單據source/生效日與差額對帳欄。 |
| 5.2.b | missing / unreviewed / confirmed0 / explicit exemption分離 | 部分 G | 空值與明填0可分，0缺免扣原因/證據狀態；不能宣稱輸入0即正式核定免扣。 |
| 5.3.a | 分鐘、money中間精度、item與total rounding順序 | 部分／待政策 utils/format/F | 整數分鐘與0/2位選擇；JS Number及逐階round有固定順序，非完整公司可版本化政策。 |
| 5.3.b | 負數/零/小數、UI/API/export/payslip一致 | 部分 J | 有小數與null列印測試；負數adjustment、全部item跨格式一致性仍需測。 |

## 需求矩陣：6.x 預檢、明細與月結

| 編號 | 子需求 | 狀態 | 來源／缺口 |
|---|---|---|---|
| 6.1.a | 統一preflight：master、schedule/day、anomalies、pending、overlap、policy、保費/items、manualdiff | 部分 F/G/H | reasons與lock守門已有；不讀全部pending requests，無case/通用items/manualdiff，因此現有ready不等規格READY。 |
| 6.1.b | BLOCKED/NEEDS_REVIEW/READY enum相容，不只欄位存在 | 部分 F/types:357 | 現ready/needs-review/locked/legacy-review；擬映射blocked理由severity，保留舊API相容，前後端同一結果。 |
| 6.2.a | 逐人basic/regular/OT/leave/allowance/bonus/insurance/pension/tax/other/gross/deduction/net | 部分 J | 固定基本/OT/假/三保費/總額已有；regular來源細目、津貼獎金稅/其他缺。 |
| 6.2.b | source/policy追溯、人工逐item差額原因 | 部分 H/F | inputHash/snapshot/policyVersion已有，無逐item source refs與人工差額批准紀錄。 |
| 6.3.a | lock/snapshot含employee/schedule/card/leave/policy、version/actor/time/history | 已完成狹義／部分 H/G | 原子快照與hash/replay、lock actor/time已覆蓋；review歷史更新仍需不可變事件，當日政策完整性待補。 |
| 6.3.b | 更正走差額approval不覆原，legacy無快照待review | 部分 H | 禁unlock與legacy待review已完成；真正adjustment request/批准/差額快照未實作。 |
| 6.4.a | effectiveMonth、policyversion、適用員工/薪制、oldread/shadow compare | 未實作／部分 | locked舊讀路徑已有；無正式切換manifest、逐人新舊影子差額及批准gate。 |
| 6.4.b | rollback不改snapshot；deploy/rollback/datarestore分離 | 部分／未實作 | 不覆快照已有；無正式回復演練、備份還原清單與版本對照驗收。 |

## 需求矩陣：7.x 權限與報表

| 編號 | 子需求 | 狀態 | 來源／缺口 |
|---|---|---|---|
| 7.1.a | 名冊/systemaccount、eligiblepayroll、hire/exit/LOA薪異動 | 部分 I/G | 明示system-account及每月排除理由；eligibility不是完整生效期名冊。公開初始化已停用。 |
| 7.1.b | employee/manager/HR/admin scope、不可查他人薪資 | 部分 I/J | 現三級角色，個人salary getter限制本人或SuperAdmin；無HR角色、指定主管/team scope，其他action尚需逐一矩陣驗證。 |
| 7.2.a | 個人電子payslip月查明細、歷史一致、權限 | 部分 J/H | 個人月薪頁/列印與snapshot路徑已有；完整line items與新schema歷史相容仍待補。 |
| 7.3.a | 缺卡補卡/anomaly/leaveOTcomp pending/正兼工時 | 部分 B/C/J | 補卡隊列、月報/兼職工時已有；統一anomaly、OTcomp pending與跨來源一致報表缺。 |
| 7.3.b | 個薪全薪/insurance-item reconcile/preflight fail/history adjustment | 部分 J/H | 個薪全薪/部分reviewReasons可見；保費項目對帳、預檢失敗全集與差額歷史報表缺。數量/金額應引用正式run版本。 |

## 需求矩陣：8.x 正式資料與上線門檻

| 編號 | 子需求 | 狀態 | 來源／本輪界線 |
|---|---|---|---|
| 8.1.a | 正式名冊/職別薪制薪額/雇用期/班表日制 | 待正式資料驗證 | 本輪只辨識schema與存取方式，不讀正式員工列；所需欄位及最小範圍見下表。 |
| 8.1.b | 全cards含跨月/approval/保費自提/歷史lock與snapshot | 待正式資料驗證 | synthetic不可替代；不得把匯出資料放公開repo/CI。 |
| 8.2 | 12 testgroups每案input/人工基準/actual/diff/passfail | 部分／待政策／待正式資料驗證 | 見T01–T12；既有386通過只代表既有斷言，未完成本規格12組業務驗收。 |
| 8.3.a | 正式環境非mock、備份、PR/CI/deploy/site版本一致 | 待正式資料驗證 | PR/CI已核對；正式runtime/備份未核，不建立未隔離preview。 |
| 8.3.b | 逐item差額0或批准、所有必要policy核准、歷史不重寫 | 未實作驗收gate／待政策／待正式資料驗證 | 需要人工簽核及來源清冊，不能以CI成功放行。 |
| 8.3.c | healthcheck不造假attendance，任一缺NO GO | 未實作正式演練／待正式資料驗證 | 僅無寫入健康檢查與版本查核；任何缺項維持NO GO。本輪結論NO GO。 |

## 8.2 十二組驗收案例登錄（不是新增測試已通過）

每次執行需填：caseId、employee化名、來源版本/hash、policy版本與生效期、逐item人工基準及簽核人、實際output、diff、原因/批准人、PASS/FAIL/BLOCKED。正式對帳另存受限空間，不將姓名、帳戶、憑證、實際薪資附上公開PR。下表數值只用明示合成fixture；本輪不新增case執行，actual/diff不可捏造。

| ID / 對應需求 | 合成input／候選人工基準 | 現有coverage | 本輪actual / diff / 業務驗收狀態 |
|---|---|---|---|
| T01 月薪完整月 4.2 | 月薪30000、完整適用月份、無假/OT、明示保費0測試值；人工base/net=30000（需合成制度） | calculations/payrollRegression有月薪基礎與divisor guard，無完整正式名冊月對帳 | 未另跑本案例；差額未產生；未驗收 |
| T02 時薪多班 3.2/4.3 | 時薪200，09–12＋14–18已確認工作=420分鐘；正常日測試基準1400 | payrollRegression聯集/分鐘與payrollApi多session；386基線相關測試通過 | 沿用既有斷言，未新增逐item人工比較；差額未產生；部分 |
| T03 缺in/out 2.1/2.2 | 缺任一邊、含另日完整卡；應待覆核、不可fallback；補卡審批後重新計算 | payrollRegression、payrollApi、pr13-makeup-review | 基線相關斷言通過；案件/通知/pending gate未驗收 |
| T04 遲早未出勤 2.1 | 09–17班，09:15到16:30離；15分鐘核准假與無解釋兩組；不得直接扣曠職 | calculations行政status、schedule comparison；無全case狀態機 | 政策/人工判準待核，actual/diff未產生；BLOCKED |
| T05 approved leave overlap 2.3/4.5 | 工作09–13＋核准事假13–17：800；改全薪年假：1600；假12–17則衝突待核 | payrollRegression、pr13-payroll-review跨日假及休息不誤判 | 既有合成斷言通過；正式給薪比例未核、未逐item對帳 |
| T06 weekday OT 2.4/4.4 | 一般日10h＋次日6h；保留2h OT；時薪200、前2h倍率4/3只作明示fixture，候選3333.33 | payrollRegression逐日OT，pr13-payroll-review | 相應分鐘斷言通過；申請層/人工金額差額未執行；部分 |
| T07 休息/例假/國假 3.3/4.4 | 同8h工作配不同日別與適用員工；每日別由公司核定人工基準 | G未知非regular日阻擋；無三日別正確金額演算法 | actual=現設計待覆核；不能當日別計薪PASS；BLOCKED |
| T08 跨夜分段 3.2 | 22–翌02、翌03–06=420分鐘；另加翌02–10卡須衝突待核，跨月同規則 | workIntervalReview、pr13-overnight-review.spec、payrollRegression | 基線純函式覆蓋通過，E2E本輪未跑；跨夜歸屬政策待核 |
| T09 offsite/travel 3.4 | 現場6h＋核准公出4h、不重疊；人工是否10h且2h OT由政策確定 | 外勤enum/fraction與交集防重；不進work OT門檻 | 無合法已核人工基準；actual/diff未產生；BLOCKED，優先缺口 |
| T10 中途到離/LOA/調薪 4.1/4.2 | 15日到職或復職，16日起調薪；兩段有效薪資與班日資料 | selfServiceRequests/LOA及review過期測試；沒有分段折算 | 目前不足；禁止整月base率直接驗收；BLOCKED |
| T11 items/insurance 5.x | 津貼1000、核定保費來源、明示免扣0與missing比較、負向差額 | 三保費輸入與空值guard、formatMoney；無items/免扣原因來源帳本 | 基線只涵蓋固定欄位；正式來源及人工diff未提供；BLOCKED |
| T12 lock/snapshot/adjustment 6.3 | 鎖定1600後改現行rate，仍讀1600；兩次lock僅一份；更正差額獨立approved | H實際emulator既有證據、snapshot replay/容量測試；adjustment未建 | 本輪mock相關通過，emulator本輪未跑；前半部分、差額流程未驗收 |

## 架構、API與資料表盤點

目前為React/Vite前端 → services/googleAppsScriptAPI.ts相對路徑 `/.netlify/functions/api` → 單一Netlify action handler → Firebase Admin SDK/Firestore。前端名稱googleAppsScriptAPI不代表目前仍走Apps Script。Firestore client deny-all與Admin服務端權限必須分別驗證。

| 現有collection／型別 | 輸入與API | 目前輸出/UI | 下一階段需要而目前缺少 |
|---|---|---|---|
| employees / Employee | create/update/get；雇用/薪額/status/role | EmployeeManager | employmentType/payBasis分離、effective-dated paymaster、manager/HR scope、eligible期間 |
| dailySchedule/scheduleTemplate/scheduleVersions | update/apply/restore、swap/open shifts | ScheduleManager、版本/換班介面 | employee日制與休息政策、每次調整批准/有效版本鏈 |
| clockRecords/attendanceRevisions | clock-in/out、update-clock-record、makeup approval | ClockIn、MyRecords、AttendanceLog工作區間覆核 | append-only raw event＋revision projection優先級；完整case來源鏈 |
| makeupRequests | submit/list/approve（核准/駁回） | ClockMakeupForm、MakeupApprovalQueue | 附件、指定主管、退回補件/撤回/重送/待申請、outbox、pending preflight |
| leaveRequests/leaveOfAbsenceRequests | submit/approve、review-leave-allocation；LOA獨立 | Leave表單/queue、G分配表單 | anomaly explanation/retroactive request與comp/offsite獨立語義、有效規則 |
| payrollReviews / StoredPayrollReview | employee_month key、sourceKey綁基準 | PayrollReviewPanel（已存在） | policy有效期catalog、保費來源/免扣狀態、歷次覆核不可變history |
| payrollControl/monthLocks/payrollRuns | lock gate、snapshot normalized hash、舊run讀取 | SalaryCalculation鎖定、MySalary歷史 | 統一preflight/case/pending/items/manualdiff、adjustment ledger、release manifest |
| notifications/fcmTokens/auditLogs | writeNotification、FCM send、mark-read、audit | NotificationBell、audit頁 | notificationOutbox、attempt/result/owner/escalation、案件不因通知失敗遺失 |
| staffPreferences/openShifts/shiftSwapRequests | preference、claim/release、peer/admin approval | 偏好/開放班次/換班 | 每次有效日別/薪資影響證據關聯，沿用現有流程不重寫 |
| annual leave balance/snapshots | get-leave-balance與計算工具 | MyLeaveBalance | 補休與年假不混用；新補休ledger需申請/核准/使用/失效規則 |

建議新增schema僅為設計草案：AttendanceCase、CaseEvent、NotificationOutbox、WorkExplanationRequest、OvertimeRequest、CompTimeLedger、EmploymentPayVersion、WorkPolicyVersion、DayClassification、PayrollItemDefinition/Assignment、InsuranceAssessment、PayrollPreflight、PayrollLineItem、PayrollAdjustment、PayrollReleaseManifest。本輪沒有建立collection或migration。

### 使用者可見流程缺口

已存在：實際工作區間（含跨午夜休息）編輯、最高管理者月度政策/三保費表單、核准假分配、排班差異原因、跨月覆核保存、月結鎖定與薪資列印。不可再描述為只有engine完全沒表單。

仍缺：員工異常case入口、指定主管補件與通知重試可見狀態、加班/轉補休/補請假獨立表單、HR與主管scope、薪制有效期管理、保費證據/免扣原因、津貼/稅項管理、統一預檢及人工逐item差額、已結算更正批准、shadow compare和正式切換/回復儀表。應每批同交API＋UI＋權限＋測試，避免只交引擎。

## 正式環境辨識與最小資料核對設計（8.1/8.3）

- 程式前端Firebase projectId為 `chiayiyouthlabclock`，authDomain為 `chiayiyouthlabclock.firebaseapp.com`；這是程式設定，不證明當前網站/服務端真的指向該project。
- 後端firebaseAdmin.ts讀FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY。只記錄變數名稱；本輪不讀值、不檢索磁碟憑證或sessions。前端API相對網站origin。
- 先前GitHub metadata顯示Netlify site `chiayilabclock`；本輪沒有存取正式網站或Netlify runtime。未發現可用Netlify/Firebase/Firestore專用connector工具；GitHub可讀PR/CI/code，不能拿GitHub權限當DB授權。未配置新CLI/OAuth或token。
- 未開啟未隔離preview，`[skip netlify]`保留。該標記不是runtime隔離保證；正式讀取仍須核實後端project、網站head、讀取帳號scope及資料處理地點。
- 下一步由主對話取得既有授權read-only存取方式或受控匯出（若要新增登入/credential另問）；先定首月與員工範圍。個人身份、聯絡資料、銀行帳號與完整理由/附件不在初次算薪核對必需欄，不任意取出。

| 最小資料集合 | 必要欄位／取樣範圍 | 目的與保護 |
|---|---|---|
| 員工與薪制版本 | 受控映射ID、system-account/eligible、employment/payBasis、rate/monthly、有效期、hire/exit/LOA/return | 不讀姓名/電話/email/銀行；核對職別不是薪制，缺資料記missing |
| 班表日制 | 選定員工/月＋跨界班、shift refs、start/end/date/休息/dayType、policy與version/批准 | 核對適用日別與歷史版本，不只拿目前班表 |
| 原卡/更正 | 同範圍完整raw timestamps/timezone/id/requestId、workIntervals/review、revisions及補卡refs | 查跨月/重複/來源優先級；不得只導出已彙總hours |
| 假/補卡/外勤/OT/comp | 重疊範圍之start/end/type/status、approvalactor/time/version、allocation、ledger refs | pending也要納入預檢；附件只取必要存在/核准metadata，不先取內容 |
| items/保費 | item code、effective date、amount/base/納入基礎、核定source/status、級距/身分/自提/明示0原因 | 個資最小化；正式已核表與程式逐item比對，不用gross比例推算 |
| 月結與歷史 | 月/人/runId/hash/version/actor/time、stored line outputs、舊lock及snapshot存在性 | 讀舊已付基準、legacy缺資料待覆核；不修改、補造或重算覆寫 |
| 環境與備份metadata | deploy commit/build time/project identifier、只讀帳號scope、backup時間/範圍/restore演練紀錄 | 不取得secret值；不建立假打卡healthcheck，不把正式資料存CIartifact |

待正式資料驗證清冊可用欄位：checkId、來源系統/資料時間、範圍、欄位完整率、不可識別row count、hash、審閱者、差異與決策。對帳結果保留受限位置；公開PR只保留合成案例與彙總結果，不包含真實薪資、人名或可逆映射。

## 13項政策待確認（已確認每日8h／實際工時，不重問）

1. 正式啟用首月、涵蓋員工/薪制及例外範圍。
2. 員工適用日制與日曆：一般/休息/例假/國假/特殊/合法變形週期及核准來源。
3. 計薪休息、休息工作與提早到晚離開認定、跨夜歸屬。
4. 各日OT工資基礎、級距及事前/事後核准與法定應付的關係。
5. 加班轉補休選擇、換算/期限/批准/使用與期末處理。
6. 各假類給薪比例、計時單位及長期連續假/非一般假規則。
7. 月薪換算時薪除數及適用條件。
8. 中途到離、留停復職、調薪分段的月薪折算方式。
9. 外勤/公出/出差/遠端工作是否納正常工作與OT門檻、來源證據。
10. 薪資items、稅款/扣款、加班基礎納入條件及必填項目。
11. 分鐘與金額精度、item/total rounding順序、負數/0及差額處理。
12. 正式名冊/paymaster/保費級距身分與核定實額資料來源及負責人。
13. 覆核與差額批准人、職務分離、處理時限、歷史保留與正式切換簽核。

這些尚未核准，不建立默認法規倍率/除數或把缺值當0；本文件未另做法律查證，法律適用與公司選擇應分開核實。

## 有限批次、檔案責任與驗收

下列是待主對話協調的提案，不是本輪已授權連續實作。共同熱點`types.ts`、api.ts、services、package/lock、schema與migration由單一整合負責人持有；不得各批同時覆寫。先從43251f0或更新後核實的head建立工作分支，保留21筆後續成果；不cherry-pick舊repair整包。

| 批次/優先 | 有界交付與owned files（擬） | 不依賴政策可先做 | 驗收/退出條件 |
|---|---|---|---|
| A P0：預檢與案件契約 | 新utils/attendanceCases.ts、payrollPreflight.ts、tests對應；整合者types/API/PayrollReviewPanel | 12異常typed reasons、pending來源載入、case冪等/source refs、BLOCKED/NEEDS_REVIEW/READY mapping；不自動扣款 | 相同事件重算只一case；pending有效申請無法lock；approved解釋不直接曠職；source過期阻擋。先只實作case list＋月結block，不做全通知中心。 |
| B P1：補卡/說明狀態機＋outbox | 新utils/requestTransitions/outbox；ClockMakeupForm、MakeupApprovalQueue、NotificationBell；整合API/schema | 補件/撤回/重送、指定owner介面、append history、transactional outbox及fake dispatcher | 無權轉移403；核准原子寫入；通知失敗case不遺失、同id重送不重發；附件只驗規則/metadata，不接新外部儲存。 |
| C P0/P1：主檔與有效期 | EmployeeManager、PayrollReviewPanel；新payBasis/payVersions/insuranceAssessment與tests；整合schema | employmentType/payBasis分離、effective periods不得重疊、明示0與missing、政策catalog空白狀態 | 既有review可讀、薪資基準變更失效；無政策不READY；中途月先阻擋或明示待核，不能自動套整月。 |
| D P1：逐日/外勤/OTcomp/line items | 新workLedger/overtime/payrollItems；payroll.ts、MySalary/payslipPrint與synthetic fixtures | 架構與trace refs、money/time分離、未知日別阻擋、OT申請與工作事實分離 | 需政策1–11後才啟用計算；T01–T11逐item人工基準與差額為0或核准。可分D1工作來源、D2日別OT/comp、D3items，每小批獨立測試。 |
| E P0上線前：歷史差額與正式核對 | 新PayrollAdjustment/ReleaseManifest schema、review UI及報表、snapshot讀取相容；不改歷史run | adjustment狀態/引用oldRun、shadow output與版本比較、rollback文件模板 | T12完整；8.1真資料核對、8.3所有gate簽核、備份/還原/版本healthcheck；資料回復與程式rollback分開。任何缺項NO GO。 |

每批必跑受影響純函式/API、型別/build、涉及UI的E2E；修改交易/權限/鎖月時必跑現有emulator/rules與競爭測試。以最新verify:pr13作整合gate，不刪舊斷言換綠；新增case固定input/expected/policy/version並記actual diff。必要正式核對由另外受控唯讀流程完成，不進CI。沒有公司政策仍可完成A/B及C的結構與阻擋流程，但不能把D/E計薪規則標完成。

## 本輪結論與交接

- 最新PR的表單、按月review、emulator驗證與快照修正應保留；不可拿昨天repair當最新系統改。
- P0缺口：相關pending未統一阻結算、payBasis/有效期主檔、外勤門檻、完整preflight/人工差額、正式資料與release gate。P1：case/通知與補件、OT/comp、日別items與差額流程。
- 沒有新增業務功能。正式資料核對0筆、正式寫入0筆、通知0次；本輪沒有正式網站版本/備份/runtime隔離證據，仍NO GO正式計薪。
- 完成的程式測試是兩個明確版本的既有synthetic基線：257＋386（不可相加宣稱643個獨立案例）。新規格12組案例尚未完整實作/執行；本輪emulator/E2E/typecheck/build未重跑。
- 停在本規格文件，下一批需主對話決定範圍與owner；不自動推送、合併或展開全部階段。

## 批次 A 更新（2026-10-24，基於 PR 13 的 43251f0）

- 2.2／2.5／6.1 **部分**：現有待審假單（含外勤）、補卡、留停、換班，已納入統一 `evaluatePayrollMonth`；薪資讀取與月結交易共用。BLOCKED／NEEDS_REVIEW 相容既有 needs-review，未知資料不當零。仍沒有完整案件中心、退回補件／重送及可靠通知 outbox。
- 3.2／6.1 **部分**：沿用既有工時、缺卡、排班差異、重疊、政策及保費覆核原因；額外核對跨月申請與跨夜證據。沒有另行猜測休息／日別／外勤政策。
- 2.4／4.4／5.1／6.1 **未實作模型**：加班補休申請、必要薪資項目清單及人工差額批准，明列 preflight.gaps；不能宣稱這些檢查通過。READY 僅代表現有模型可結算，非正式發薪驗收。
- 6.3 **部分**：申請建立和月結使用同一 revision 交易閘門；已鎖月份拒絕新增影響該月的待審申請，提示差額覆核（該流程尚未實作）。既有快照與 legacy 行為保留，不覆寫歷史。
- 8.1 **待正式資料驗證／入口缺口**：未確認 production 實際 deploy 與後端 project；前端 project ID 不能推論後端。README 候選站與 Netlify project 名仍未配對。既有 get-payroll-review-inputs 及未鎖薪資讀取全量掃描員工、卡、假單，欠缺 employee/month 與完整跨月相交證據的純唯讀限定入口或受控 export。login 會寫失敗計數／可能升級 hash，不能當唯讀 probe。本批沒有讀 production。
- 8.2／8.3：本批僅合成回歸、隔離瀏覽器及 demo emulator；正式人工差額與部署一致性未驗收，正式上線仍 NO GO。實際指令／結果見 PR13_PREFLIGHT_BATCH_A.md。

### 正式核對範圍補充

使用者回答「八月」：依本輪年份記為 **2026-08 回溯核對基準**。使用者已確認包含全體正職、兼職及當月到職、離職、留停人員；名冊仍須逐筆核對雇用有效區間。這不是 effectiveMonth 啟用授權，不重算／覆寫八月已結算款；新版切換仍待政策、正式資料與人工差額驗收。本批固定合成四月案例保留，以免混淆為八月正式驗收。

### A 批次待 review 修正（靜態自查，尚未改程式）

`payrollPreflight.ts:101–113` 將缺少模型列入 gaps，但 `assertPayrollReady` 只檢查 status；`api.ts:1446–1447` 直接用它放行 lock-month。故本批的 scoped READY **不足以滿足正式月結條件**，即使451項既有測試通過也不能稱正式門檻已完成。6.1維持「部分／有阻擋缺口」，待獨立review統一修正。候選修法：試算完整度與 settlement eligibility 分離；必要能力缺失／適用性未核實必須阻擋正式lock，不能由client勾選略過或以空集合判定不適用。新的強制門檻須新增API／emulator回歸，保留可試算明細及既有鎖定快照讀取。

### A P1 修正批（待獨立複驗）

- 6.1：正式 preflight.status 與 trialStatus 分離。缺少必要模型／正式驗收時固定 BLOCKED；後端assert再次拒絕新lock，沒有自由文字／skip flag／config豁免。試算完整可保留1600等明細，但不能正式結算。原 snapshot／legacy 讀取保留。
- 2.1.12／2.2：核准補卡需 makeup-application-v1 套用證據（requestSourceKey、recordId、revisionId）、原子更正前後紀錄與父版本鏈。較新人工修正經鏈驗證可採用；缺證據、衝突或改動申請內容皆待覆核，不把核准時間比較當證明。補卡並不直接批准工作／休息分鐘。
- 未實作的必要模型仍未實作，因此目前所有新正式月結都被阻擋；後續須真正補齊，不可刪gaps解除門檻。B仍僅計畫，正式2026-08全員資料仍未驗收，不改歷史款。

### B3 增量（非正式驗收）

案件待辦 UI、本人說明、管理者指派／退回補件／來源重核結案、歷程及 sandbox 通知摘要已接現有 API，詳見 `PR13_BATCH_B3.md`。2.1/2.2/2.5/7.3 維持「部分」，不代表附件、OTcomp、完整取消重送或真通知已完成；6.1 正式 BLOCKED 保留。2026-08 全體正兼與當月到離職／留停正式資料尚未核對，不啟用 effectiveMonth 或改既有結算。


### B4a 增量（待獨立審查，非正式驗收）

- 2.2／2.5 **部分**：現有補卡 UI/API 增加本人取消、非本人管理者退回補件、重送獨立新版本，caseRequestLinks／事件與申請版本歷程持久保存；原卡與核准投影來源鏈保留。operationId＋expectedRevision、共享月鎖交易閘門、結果不明原意圖重試均有合成測試。詳見 `PR13_BATCH_B4A.md`。
- 2.2 **未實作／待政策**：附件儲存、指定主管配置、期限、真通知與跨裝置 receipt 恢復；不是完整申請驗收。
- 2.3／2.4／4.4 未因此完成：異常說明／追溯假單完整流程、OTcomp 與帳本仍另批。
- 6.1／6.3 正式 gate 保持 BLOCKED；取消／解除關聯不消除未解案件，不直接更正已鎖月份。8.1／8.3 仍未核正式資料、部署或 effectiveMonth；2026-08 全員回溯核對範圍不代表改寫結算授權。


### B4b 增量（可測程式；正式 storage/scanner 未配置）

2.2 **部分／待政策／待正式設定**：新增本人draft-bound附件metadata、上傳掃描契約、原子request綁定、私有授權短效下載、草稿邏輯撤除與稽核，接既有補卡UI。伺服器重算hash與內容型別，不信任client scan；缺adapter或政策fail closed，新版及舊提交入口皆不能繞過必附。測試只用合成bytes、fake storage/scanner及真Firestore metadata emulator；不宣稱已配置正式儲存或病毒掃描。技術硬上限不是公司已核數量／容量／保存期限。詳見 PR13_BATCH_B4B.md。

6.1／8.1／8.3：正式月結仍BLOCKED；真附件、正式IAM／儲存與掃描、保留期限、2026-08全體人員對帳均未驗收。B4c／B5未混入本批。僅發布至既有 Draft PR 供審查，未部署／寫production／發真通知，原正式站未改。


### B4c 增量：獨立說明／追補假（部分完成）

2.1／2.3／2.5：新增獨立版本化 anomalyExplanations、caseExplanationLinks、caseLeaveLinks；本人送說明、主管補件／採納／退回、新版重送，接受說明不代表工作或假單核准。追補假沿既有 leaveRequests 審核／分配、重新偵測 pending／approved-unapplied／卡假重疊。來源、鎖月、容量、權限及 replay 用真 handler 與本機 emulator 驗證；UI 沿用既有頁面。
2.2／2.3仍部分：完整假單取消／補件重送、有效期假別／餘額政策、假單附件與指定主管政策未實作，不以文字說明代替核准投影。2.4／comp 未納本批。
6.1／6.3：anomaly pending 納 preflight；正式 workflow gaps 未清除，月結仍 BLOCKED。immutable 說明事件／leave revisions 與原卡分離，已鎖月不能修改。
8.1／8.3：2026-08 全體正兼職及當月到離職／留停正式核對尚未執行。僅合成測試，不以 mock 代替正式驗收；無 production 存取／真通知／部署。細節與驗收見 PR13_BATCH_B4C.md。


### B4d 增量：假單生命周期及私有附件（可測程式）

2.2／2.3：補上本人未核取消、主管退回／要求補件、新版本重送與不可覆寫已核原版；legacy pending相容，新版附來源hash/revision/operation receipts，case與說明來源保留並沿B4cfix檢查。附件共用B4b核心但leave主體分離，正式adapter仍disabled。
4.5：最小有效期政策與明示額度預占結構；僅已核政策執行期限／額度，未知保持待設定，不用推定餘額阻擋或默認無限制。未提供正式政策管理與啟用。
6.1／6.3：pending/needs-info進preflight，cancelled/superseded原始歷史保留；跨月transaction guard與來源case重核維持，必要workflow gap未移除。已核更正／差額流程未完成，禁止直接取消已核或覆寫月結。
8.1／8.3：2026-08全體人員正式核對未執行，storage/scanner、真通知、公司政策與正式發薪仍NO GO。本批驗收與合成假設見PR13_BATCH_B4D.md。


### B5a 增量：加班申請（部分；不含補休／計薪）

2.4：獨立overtimeRequests、事前授權／事後申請、本人撤回及新版本、指定主管補件／完整／部分核准。actual/requested/approved/statutory payable分離；未申請或駁回不清除confirmedWork。工作來源版本改變需新版本，已核不能直接取消。指定審核政策未知不開放任意全員或自核。
2.1／2.5／6.1：沿12類detector記pending／approved-unapplied及超8h調查候選；preflight相同入口納入，sandbox outbox disabled且無正式scheduler。完整OT_COMP gap維持BLOCKED。
3.3／3.4／4.4：日別、外勤歸屬、法遵上限實質規則、支付倍率與補休帳本仍待B5b/C，不以本批approvedMinutes替代依法應計。8.1／8.3正式資料仍未核對，NO GO。詳見PR13_BATCH_B5A.md。
