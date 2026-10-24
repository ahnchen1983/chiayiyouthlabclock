# B4a：補卡生命週期與案件持久關聯（合成驗證，非正式驗收）

基準 d887ed5（B3 修復等價樹）；本增量不包含 B4b 附件儲存、B4c 說明／追溯假單、B5 OT／comp。正式月結仍 BLOCKED，2026-08 全體正兼職與當月到離職／留停尚未正式核對。沒有 production 存取、真通知、scheduler、部署或歷史結算改寫。

## 契約與流程

- `submit-makeup-version`：本人新增，日期、補卡側、時間、詳細理由必填；多段需指定 card ID，跨夜使用含時區完整日期。從案件進入時由伺服器重新核對 employee、window、card anchor、case revision，不能信任客戶端 context。
- `act-makeup-request`：本人 cancel／resubmit；沿用既有 Admin／SuperAdmin scope 的非本人審核者 return／approve／reject。待審核→待補件／已取消／核准／駁回；待補件、駁回、已取消只能重送獨立新申請，舊版標已取代並保留原欄位。已核准不能取消。
- `link-case-request` 與 `get-case-request-links`：持久 caseRequestLinks 及 append-only caseRequestLinkEvents，穩定 case/request ID；解除標 inactive，不刪除。核准來源鏈不允許解除；取消／解除不會把案件變 clear 或消除薪資阻擋。重送在同交易複製新版本的有效案件關聯，舊關聯保留。
- `get-makeup-request-detail`：本人或現有管理 scope 讀取。新寫入要求 expectedRevision 與 operationId；相同命令重送回 receipt，內容改動拒絕。讀取 receipt 仍重新驗目前角色，不能藉過往管理權限取資料。
- makeupRequests 保留既有欄位，新增 schemaVersion、revision、版本前後鏈、history；makeupRequestEvents／makeupCommands 保存稽核及冪等結果。版本化請求禁止走舊 approve endpoint 迴避版本控制。舊 submit endpoint 保留相容，尚未提供舊客戶端 operationId 保證。
- 核准以同交易保存 attendanceRevisions before/after、parent、requestSourceKey 及 appliedEvidence；不把補卡等同實際工作核定。完整時間和單側 legacy HH:mm 在可確定同日／上班所屬日下相容；逆序、模糊跨夜拒絕，原卡證據保留在 revision。新 revision 帶 makeupNormalizationVersion=same-day-v1，由 makeupEvidence 共用函式重播驗證；舊 revision 未標記則維持原規則，不偽造新證據。
- 所有新寫入與舊拒絕入口共享 payroll revision gate、相關月份與跨月證據鎖。沒有更正已鎖月份或差額付款的捷徑。

## 使用者介面

沿用 ClockMakeupForm／MakeupApprovalQueue，新增共用 MakeupRequestActions、MakeupCaseLinks。顯示版本、待補件原因、來源／後版、歷程、關聯與明確操作原因。案件連結可開指定申請，員工不可自核；待補件不可直接核准。

useMakeupOperation 將未確認命令按登入主體保存在 tab sessionStorage，不存 token；GET、返回／重新載入不當作 mutation 成功，不自動重送，重試保留原 ID 和 payload。記憶體 gate 防快速連點。暫存不可用或另有未確認操作時阻擋新命令。關閉分頁／清除儲存、跨裝置回復仍需人工查證，尚無跨裝置 receipt 查詢 UI。

## 固定案例與人工基準

| 輸入／動作 | 人工明示預期／差額 | 證據 |
|---|---|---|
| SYNTH 4/1 下班補18:00，同 operationId 重送 | 一份 request、一個建立 event；改 payload 409，差額0重複事件 | payrollApi B4a、emulator |
| 待審→退回→重送19:00 | 舊18:00不覆寫，新 ID／新 revision／前後鏈；本人核准403 | payrollApi、UI |
| 09–17 legacy 卡補18:00 | 新09–18可解析，before仍17:00；工作核定清除，重核才計薪 | payrollApi |
| 補08:00造成逆序／跨夜卡只填18:00 | 409，無卡／申請部分變更 | payrollApi |
| cancel／unlink 或 resubmit 有關聯 | 原 case/raw 不變；舊 audit 保留，重送新增關聯；正式仍BLOCKED | payrollApi、emulator、UI |
| locked 月及4/30–5/1跨月 | 423，所有請求／卡／audit不部分寫入 | payrollApi、emulator |
| 同版本並行取消／退回、同 operation 並行重送／核准 | 競爭只有一份結果，stale409；duplicate無額外 revision | Firestore emulator |
| 成功但回應遺失，GET／refresh後 retry | 原 payload／ID，相同 receipt，無新意圖 | UI mock |
| 他人員工／card／stalecase／撤權receipt／直接Firebase存取 | 403／409 或 rules deny；不擴權 | API、rules |
| 390×844 手機、連點、指定關聯開啟 | 可操作無水平溢位；一次新提交、指向原 request | UI mock |

測試輸入均為合成；UI mock 不代表真 Firestore 或正式使用者資料。Emulator 的競爭鎖是測試 fixture，不豁免正式 preflight。

## 限制與後續

指定主管、申請期限、附件政策均維持 needs-configuration，不猜制度；目前僅沿用原管理角色範圍，未完成指定主管配置。附件、真通知／重試配送、OTcomp、差額調整及正式資料對帳未完成。關聯上限100、歷程200／request500KB、鎖月掃描證據500筆有明確拒絕，不做部分保存；大型正式資料需另做有界查詢／歸檔設計與效能驗證。新 API 不寫通知 outbox 或 delivery。政策缺口／正式 gate 不因本批解除。

## 本輪實跑結果

| 檢查 | 指令／結果 |
|---|---|
| Unit/API | `npm test -- --configLoader runner`：25 files，528 passed，0 failed |
| 真實本機 Firestore / rules | `FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator`：2 files，37 passed，0 failed；含五項 B4a transaction 案例與一項 rules 拒絕案例 |
| 瀏覽器 | `PLAYWRIGHT_BROWSERS_PATH=<local-cache> npm run test:e2e -- --workers=2`：40 passed，0 failed；含6項 B4a；合成 API mock，並非正式瀏覽器驗收 |
| 型別 / 打包 | `npm run typecheck`、`VITE_E2E=false npm run build -- --configLoader runner` 均 exit 0 |
| Diff | `git diff --cached --check` 通過 |

初輪曾有兩項 legacy 單側補正 API 失敗，以及一項預填 textarea 標籤識別 E2E 失敗；已修正並保留測試，最終上述全通過。來源正規化抽成共用且版本化後，528 unit/API、37 emulator、typecheck/build 再跑通過；40 E2E 在最終 UI 上通過，最後僅後端來源鏈修正，未重複跑無關 UI。新增測試包含核准 evidence 確實可驗證，不能只見 status=核准即算成功。

沒有測：正式資料、真通知、真附件、跨裝置回復、實際指定主管政策、production 規模／部署／端到端正式薪資對帳。結果只供本批獨立 code review；尚不代表正式發薪 ready。

## B4a 獨立 review 容量修正

原寫入未檢查 get-case-request-links 的100筆讀取上限，可能建立第101條後使UI無法讀取。現 submit／link／resubmit 在同一 payroll transaction、任何 request/link/event 寫入前，共用 assertLinkCapacity 檢查每案與每申請的保留唯一關聯 ID。active/inactive 均計數；unlink不移除歷史名額，relink與原 operation replay不重複占額。這是技術硬限制，並非公司附件／申請政策。

回歸包含 reviewer 三例（100次真 handler 建立，再試第101條）、每申請100條、滿容量unlink/relink與重送，以及真Firestore最後一個名額雙請求競爭。容量不足全部拒絕，沒有 request／history／link 部分寫入；GET仍可讀。UI未改，本次不重跑E2E；先前40項作者與reviewer6項結果不當成本輪重跑。

本修正實跑：533 unit/API（26 files）、38 emulator（2 files）全過，typecheck/build/diff check通過。正式 gate、通知與部署限制不變。
