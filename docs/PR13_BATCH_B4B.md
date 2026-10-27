# B4b：私有補卡附件可測程式（正式環境停用）

本批接在 B4a 容量修復之後；不包含 B4c 追溯假單／說明、B5 OTcomp、正式雲端儲存設定或掃描服務。正式計薪仍 BLOCKED／NO GO，2026-08 全體正兼職及當月到離職／留停正式資料仍未核對。

## 正式停用邊界

`makeupAttachmentRuntime.ts` 的實際 runtime 固定 `{mode:'disabled',policy:null}`，沒有環境變數開關、憑證、bucket、公開 URL 或 dummy clean scanner。測試由 Vitest 注入 `tests/fixtures/makeupAttachments.ts` 的記憶體 storage 與明確合成 scanner；未配置或掃描錯誤一律不通過。檔頭檢查只做型別篩選，不能宣稱病毒偵測。

**公司必附政策未知不等同可省略。** 新版本提交與舊 submit-makeup-request 都需已核附件政策；預設未配置時拒絕新申請提交，UI明示阻擋。舊入口不接受附件參照，需使用版本化入口。既有已提交申請不重設、不補造附件／掃描證據；其歷史政策未驗收仍受既有正式 gate 阻擋。

技術硬上限為單檔2 MiB、最多5個有效附件、短效存取60秒；不是已核公司政策。fixture明示政策版本 synthetic-policy-v1、最多2檔／每檔1024 bytes、PDF、可撤除草稿；不作為 production 預設。草稿歷史最多50份metadata，超限拒絕，不截斷稽核。

## Schema／API／權限

| 入口 | 資料與驗證 |
|---|---|
| get-makeup-attachment-capability | 已登入角色讀取停用原因、政策與技術上限；productionConfigured=false |
| create-makeup-attachment-draft | 本人、日期、operationId；同操作同日期冪等；draft revision／policyVersion，受月鎖 |
| upload-makeup-attachment | 綁定本人draft，expectedDraftRevision／operationId；伺服器解碼、檢查硬上限、檔頭與政策MIME、名稱／副檔名、重新計算SHA256；client不能指定key/hash/scan/status/owner |
| list-makeup-attachments | 草稿僅本人；已提交附件按既有員工／管理scope，確認request來源，不回傳storageKey或URL |
| withdraw-makeup-attachment | 僅本人未送草稿，reason、雙revision與operationId；邏輯撤除，保留metadata/event/bytes。已提交不可撤除，不直接硬刪 |
| issue-makeup-attachment-access | 每次重新查目前角色、owner/request來源及ready證據，建立短效principal-bound grant；無公開URL、沒有正式storage token |
| download-makeup-attachment | 經認證API提交短效識別，重查權限／版本／雜湊／當前ready，交易消耗一次；讀bytes後再次驗hash/size/MIME，以附件資料回傳，不直接開外部網址 |

資料集合：makeupAttachmentDrafts（owner/date/status/revision/policy）、makeupAttachments（draft/request/owner/name/mime/size/sha256/uploadComplete/scan/status/version與私有storageKey）、makeupAttachmentEvents（append稽核）、makeupAttachmentAccess（只存隨機存取識別的hash，綁principal／版本／expiry／consumed）。Firestore client rules仍全deny；後端API逐次檢查權限。沒有新增跨租戶權限模型或擴大既有管理角色scope。

上傳流程：交易保留metadata／名額→private putImmutable及read-back integrity→獨立scanner→交易完成。storage故障、掃描error保留失敗狀態，可用相同操作與檔案重試；blocked verdict不可變成dummy pass。兩個相同操作競爭不重建物件或事件。掃描中撤除／提交／鎖月會重新驗證，不復活舊附件或部分綁定。

補卡 submit/resubmit 與附件綁定使用同一 payroll transaction。準備階段只讀，待全數月鎖、case容量、版本、政策及所有附件complete/clean通過後才寫request＋draft submitted＋attachment requestId／immutable引用。附件不能跨request引用；核准時再次驗附件metadata來源、版本、hash和scan linkage。前版附件留在前版，不默默挪給新申請。

## 既有 UI 接入

沿用補卡表單與審核列，共用 `MakeupAttachmentPanel`。展示停用／政策／上傳與掃描狀態；本人可建草稿、選檔、上傳、重試、提供原因撤除。管理者僅在既有scope讀已提交附件，沒有草稿撤除按鈕。下載需先換短效存取，再透過認證API取得bytes，瀏覽器使用一次性local Blob並撤銷；不存token、不分享公開連結。附件API回應明確 no-store／no-cache／nosniff；隨機短效識別只留hash，不把原識別寫入日誌或session。

tab session journal只保留draft／操作ID／檔名大小與本地摘要，不存檔案內容或access token。unknown outcome不因GET／返回／refresh就清除：需重選同一檔案、用原ID原內容重試；不自動重送。草稿日期不符不能提交。保留草稿並解除選取不刪server資料；完整跨裝置草稿管理／歷史列表仍未提供。清除tab儲存後需受控核實，不能宣稱自動恢復。

## 合成案例與明示預期

| 案例 | 人工預期 | 驗證層 |
|---|---|---|
| runtime未配置／政策未知 | capability disabled、新提交503；無request／物件 | unit/API、unmocked runtime、UI |
| PDF bytes配image/png、路徑檔名、偽造hash/scan/key、外部URL、超大 | 拒絕且storage writes=0 | API |
| 重複同ID上傳／改內容沿用ID | 一個immutable object；改內容409 | API、Firestore metadata concurrency、UI double click |
| scanner blocked/error或缺adapter | 不可submit；error原ID可retry，無dummy clean | API、UI |
| 正在scan時submit | 409、無request；clean後一次原子綁定 | emulator＋fake scanner |
| 正在scan時withdraw | removed保留；scan完成不能復活／下載 | emulator＋fake scanner |
| 一檔policy最後名額雙上傳 | 一200一409；只有一reservation/object | emulator＋fake storage |
| 草稿他人／跨request／政策換版／scanhash被改 | 403／409，不能核准寫card | API |
| 已提交／已核准附件撤除 | 409；原來源與bytes保留 | API、UI角色反例 |
| grant被他人用／過期／使用兩次／角色撤回 | 403；並行最多一次200；hash不符409 | API、emulator＋fake storage |
| 鎖月 | draft／upload／withdraw／submit拒絕無部分寫入 | API與既有shared-gate emulator |
| unknown upload＋refresh／手機日期更改 | 原ID重選原檔才重試，session無bytes；日期不符阻提交且無水平溢位 | UI mock |

## 尚未完成，不能稱正式可用

沒有配置或測試 production storage、真正malware scanner、雲端IAM／Storage Rules、簽名下載服務、保留期限／法律留存／清除流程、正式負載／rate limits、完整跨裝置草稿恢復、真附件與正式員工資料。沒有自動刪bytes或清除過期grant排程；無政策前保留資料但拒絕撤除後下載。正式adapter還需獨立核實私有存取、immutable寫入、掃描可信度、故障補償與容量／效能，不能把inmemory通過當正式通過。


## 版本與驗證記錄

B4a容量修復獨立在474013f；本工作樹接入等價6815462，本批diff以6815462為基準，沒有修改原B4a-fix目錄或發遠端。

全套unit/API曾在瀏覽器同跑時，兩個100次連續handler容量案例超過原5秒時限。保留全部案例與斷言，這些有界容量案例明確設60秒上限後重跑；不是刪除案例換取綠燈。正式runtime另有未mock測試，確認沒有policy/storage/scanner或憑證。既有API測試以明示synthetic optional policy維持其原範圍，不能當正式政策核定。

| 本輪實跑 | 結果 |
|---|---|
| `npm test -- --configLoader runner` | 27 files，556 passed，0 failed |
| `FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 FIREBASE_PROJECT_ID=demo-chiayi-payroll npm run test:emulator` | 2 files，43 passed，0 failed；實際Firestore metadata/rules，bytes與scanner為fake，非Storage emulator |
| `PLAYWRIGHT_BROWSERS_PATH=<local-cache> npm run test:e2e -- --workers=2` | 47 passed，0 failed；包含7個附件UI案例，全部synthetic mock APIs |
| `npm run typecheck` / `VITE_E2E=false npm run build -- --configLoader runner` | exit0 |
| `git diff --cached --check` | 通過 |

47項E2E在最終UI上跑過，後續僅後端政策／cache response／員工ID與冪等key補強；最後再次完整跑556 unit/API、43 metadata emulator、typecheck/build通過。沒有重複累加前輪數字。沒有正式資料／真檔案／真正病毒掃描／正式Storage或下載憑證驗收，仍NO GO。
