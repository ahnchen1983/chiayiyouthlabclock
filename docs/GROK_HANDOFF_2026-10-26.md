# Grok bot 接手交接：出勤與薪資系統（2026-10-26）

本輪已依使用者要求停止擴充，完成當前集中驗收後交接。接手者先讀此文件、[完成矩陣](PR14_COMPLETION_MATRIX_2026-10-26.md)、[操作指南](PR14_OPERATOR_FLOW.md)及[最終整合驗收](PR14_FINAL_INTEGRATION_2026-10-26.md)，再讀適用的AGENTS.md／技能規則。沒有授權自行聯繫其他bot、分享帳號或移交憑證。

## 專案、分支及目標

- Repo：https://github.com/ahnchen1983/chiayiyouthlabclock
- PR #14：https://github.com/ahnchen1983/chiayiyouthlabclock/pull/14 ，保持 **Draft**。
- 發布分支：`handoff/pr13-c2b-portable-20261024`。
- PR base：`fix/attendance-payroll-consistency`，`13717ca8cffcb50209ac53fab9cb281714dae600`，tree `71a2b66007dbe619fe47d6a574a3947338debce4`。PR13及main未由本輪改動。
- 目標沿用既有需求：核實出勤、可追溯薪資與法定扣項、支付證據、D差額獨立覆核及調整、正常鎖月與保留歷史；不是重新設計系統。
- 最新工作方式：**先把有限範圍的整體開發與主流程接通，再集中測試，集中修復實際缺陷**。不要每寫一小環節就重跑單元/API/emulator/E2E或重審已關閉問題；不要為追全綠開無止境循環。必要的缺陷回歸仍須保留，不降低斷言或跳過guard。

## 版本與來源對照

|身份|commit|tree|程式source SHA-256|
|---|---|---|---|
|最後確認的遠端發布基底|`9e16cd21c28c608fafebce55ae5e2700cdd48597`|`5734418f31dfda58d614c7f5af1834d1e12f977e`|`9a5ecafcd719e38d309bf10e1691668209b9f1f234b4e2c781a2175d4a7c18a7`|
|上一份已驗交付文件檢查點|`e50cd2ee53b359e250efe38806e1e80550a548d1`|`e0c1cb9d85e06a58c988634300c466e4f690f801`|`828bbbffa5f65f16d65df8d8ac6f1e8e6c4e826e3f84fc1747e3275a08bfe0be`|
|本輪最終受測程式|`c30f786cec9d3b0fc2ec79ce8d9c87a6bd0b5431`|`f4cfa3c17e68c1a6c2799a3aa37eef6ddca4d8b1`|`8702952e9cb0790a86ad510c8f0fe5b03ddc74270afafcb094dcd0ea62f7c2eb`|

上一份e50為文件提交，程式受測commit為e8053d75a842cf86131e9b7ecec3e48615a18ae4。新交接文件會形成受測程式之後的**文件提交**；該最終commit/tree的精確值在同包 `inventory.json` 的 `head`／`tree` 及交付回報，不把文件提交說成另跑測試。其程式source hash必須與上表本輪一致。

遠端可能在交付後由授權發布者前進。開始編輯／發布前再次確認遠端HEAD及tree；不能因本機祖先鏈不同而覆蓋較新工作。增量bundle以9e16cd21為基底，包含完整changed-files、changes.patch、SHA-256／大小清冊與驗證摘要。使用既有GitHub連接器、expected-head lease、非force更新；不要直接把本機舊祖先鏈重複推入。先前本機CLI身份yuncidigital2018已403，**不要重試該push路徑、重新驗證身份或擴權**。

## 本機位置與工作狀態

- 原開發repo：`/Users/ahnchen/Documents/Codex/2026-10-26/task/chiayiyouthlabclock`
- 本機分支：`codex/pr14-mainflow-20261026`
- 本輪固定受測副本：`/tmp/pr14-completion-final-4`
- 本輪manifest：`/tmp/pr14-completion-final-4/.verification/pr13/2026-10-26T14-47-25-694Z/manifest.json`
- 整輪外層log：`/tmp/pr14-completion-final-4.log`
- 交付產物目錄：`/Users/ahnchen/Documents/Codex/2026-10-26/task/delivery`
- 交付會提交全部本輪程式與交接文件，並在回報前核實repo未提交狀態。以最終交付回報和 `git status --short` 為準；若接手時出現新變更，先保留與辨識，不能reset/stash/delete。

Documents路徑曾使工具協調停滯，等同來源的 `/tmp` 隔離副本可正常跑。後段曾發生exec-server斷線；恢復後先讀回確認寫入未執行才補寫。主機load一度32.60造成瀏覽器變慢，後來恢復；未殺其他使用者／不明程序，未調高timeout。若再卡住，先讀當前stage/log時間，不啟動重複suite。不要繞過先前程序檢視權限拒絕。

## 已完成／未完成矩陣

|項目|目前工程|正式資料或未涵蓋邊界|
|---|---|---|
|主檔、計薪政策、個人日別|有效期與雙人核定、正常工資、週界／加班／補休來源、整月來源一致性|真實適用人員、薪額、日期與授權仍要逐人核實；future-only保留|
|出勤與工時|整月掃描、異常說明／處理／結案來源新鮮度、核實工作到月／三月工時來源與正式預檢|不能把班表跨度、偏好或場館休館當已核實工時／日別；特殊制度未知仍待核|
|C3a|勞保與就保獨立、健保離散級距、員工自付額與自提、投保來源版本|實際身份、投保級距、眷口與期間需要證明|
|C3b|115官方印製表與表外精確整數分支、既有扣繳方法、逐次兼職分配與補充保費、免扣證據|角分薪資／公式結果、負計稅基礎及未確認門檻順序仍待核；不推定免稅或非居住者自提稅基|
|其他薪資項目|清冊、六類處理證據、兩人核定；固定應稅給付／有授權的固定稅後扣款接共同計算、D與薪資單|影響正常工資基礎、特殊免稅／獎金等不是這兩類的別名，須具體性質及來源後實作相應recipe|
|實際支付與D|支付事件／資格證明、分配、逐項比較、覆核與獨立採納；D拒絕與已核定現金／扣項矛盾的手填值|真實支付事實仍須提供；非零已知差異可覆核，不當成已付清|
|非零調整|提出→獨立覆核→另行採納→不可變調整分錄與累計帳本，薪資單顯示獨立摘要|不執行銀行付款、不自動追扣；補發／追回依據和實際執行另行核實|
|正常鎖月|完整名冊、出勤／工時／政策／項目／零D採納及實際支付均核實後，獨立月對帳核定解開對應guard，再建立不可變run|缺證據或來源變更仍BLOCKED；需合適獨立管理者，不能為測試創正式權限|
|歷史差額更正|完整原快照的契約薪率修正由同引擎計算，獨立覆核採用，歷史D明示選版本，接非零帳本；保留原run／現金|不是缺失歷史資料重建器。原支付分配重綁、額外項目重分類、補休原工資、工作／日別／制度更正等adapter仍未涵蓋，不能用永久gate宣稱已完成|
|八月真實對帳|通用流程與合成驗收完成；已有歷史證據方案文件|仍需決定獨立歷史證據集或外部報告，取得真實資料保存／使用授權及缺件；不放寬future-only回填|

## 本輪與先前實際驗證

本輪標準結果：**passed**。開始／結束UTC：`2026-10-26T14:47:25.797Z`／`2026-10-26T15:03:50.996Z`。同輪已取得通過數：unit/API 1711、emulator 117、E2E 251。數量不能與其他輪次相加。

|階段|實際結果|秒數|
|---|---|---|
| production-dependency-audit | 通過 | 3.89 |
| typecheck | 通過 | 11.751 |
| unit-api | 通過 | 58.994 |
| firestore-emulator | 通過 | 279.75 |
| browser | 通過 | 618.417 |
| production-build | 通過 | 11.804 |

本輪marker：`PR13_EMULATOR_TESTS_COMPLETED:2026-10-26T14-47-25-694Z`；實際存在：**True**。成功必須同時有實際執行數、該輪marker及命令成功，不能只看FirebaseCLI exit0或舊檔。CI沒有執行不算通過。正式依賴audit的high/critical門檻通過仍有8項moderate，未做破壞性audit fix。

保留歷程：

- e8053d7舊完整同輪1559／112／187通過；不套用新功能。
- 021db68：unit/API 1705通過、3失敗。修正不支援歷史補休結構進計算器的例外；修正兩項捨入fixture算術，未改既定算法。
- e2cb961：新增待核envelope型別令typecheck失敗；補型別後恢復，該輪沒有跑測試。
- e264c92：unit/API1708通過；emulator116通過、1失敗，沒有成功marker。另行集中E2E244通過、7失敗（兩組select的可存取標籤）。
- c30f786必要修復回歸：typecheck、3檔70項unit/API、2檔23項E2E通過，再跑本輪完整驗證。這些是定向結果，不能加進同輪總數。

目前已確認缺陷修復：未支援歷史來源在計算前保留待核；D提案／核定／採納與調整消費端共享已核定實際支付一致性；歷史薪率與項目選單補明確aria-label。完整失敗／恢復細節見最終整合報告。若上方本輪不是passed，必須先查看對應失敗log並如實交接，不宣稱全部通過。

## 已確認政策：不要重新訪談

- 週起始日星期日（0）。
- 個人日別走正式指定及另一人核定；偏好及場館營運／休館不等於個人日別。
- 實際工作與休息由主管核實，不能自扣一小時休息、按班表裁切已工作時間或以月總量抵逐日加班。
- 月中到職：全薪×在職曆日／當月實際曆日；月薪只有單一約定金額，不捏造固定津貼拆項。
- 最後合計half-up到整數元，分段保留精確值；法定項目個別進位保留。
- 離職日期與離職月薪資走人工輸入及覆核；不自動猜金額。
- 八月2026全體受薪正兼職，純系統帳號排除，受薪高權限帳號不能排除；八月無留停／當月復職已回答。
- 假日按適用法定基準，制度、日別與授權要有真實來源；按月排班不等於已成立變形工時／84-1。

不能猜：逐人主檔及日別、投保與稅務身份、項目合法性／免稅、實際支付、回復日期／資格證明時序、過去的制度授權、八月歷史保存採用方案及未確認角分規則。未知資料不能變0或ready。

## 環境與重跑命令

受測工具：Node24.22.1、Java21.0.13、FirebaseCLI15.9.1。既有工具目錄：`/tmp/pr14-tools/node-v24.22.1-darwin-x64/bin`、`/tmp/pr14-tools/jdk-21.0.13+9/Contents/Home`、`/tmp/pr14-tools/firebase/node_modules/.bin`。依賴已存在於原repo node_modules，隔離副本只連結該依賴目錄。

**不要在可能載入.env的原工作目錄直接跑Vite／測試。** 建立新的隔離目錄，從指定commit以明確允許的檔案清單匯出（排除.env及tests/snap），保留原工作變更；不要整份遞迴複製。已有受測副本可唯讀查看。若需新的完整驗收，先看package.json及scripts/verify-pr13.mjs，確認測試只用demo與loopback。

在隔離副本執行：

```sh
env -u FIREBASE_TOKEN -u GOOGLE_APPLICATION_CREDENTIALS \
  XDG_CONFIG_HOME=/tmp/pr14-tools/config \
  FIREBASE_EMULATORS_PATH=/tmp/pr14-tools/emulators \
  JAVA_HOME=/tmp/pr14-tools/jdk-21.0.13+9/Contents/Home \
  PATH=/tmp/pr14-tools/node-v24.22.1-darwin-x64/bin:/tmp/pr14-tools/jdk-21.0.13+9/Contents/Home/bin:/tmp/pr14-tools/firebase/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  FIREBASE_CLI_DISABLE_MOTD=1 FIREBASE_PROJECT_ID=demo-chiayi-payroll \
  PR13_BROWSER_WORKERS=1 npm run verify:pr13
```

標準順序：audit:prod→typecheck→unit/API→真實emulator→E2E→build→source一致性。Emulator config僅127.0.0.1:8086（驗證guard另接受8087），project固定demo-chiayi-payroll；測試會清空該demo emulator，不得指到正式資料庫。單一emulator/browser lane，既有30秒test／20秒hook timeout不放寬。

必要回歸命令（僅有對應修正時使用，不是每步開發必跑）：

```sh
npm test -- --configLoader runner tests/payrollDifference.test.ts tests/payrollComparisonSource.test.ts tests/historicalPayrollCorrection.test.ts
npm run test:e2e -- tests/e2e/historical-payroll-correction.spec.ts tests/e2e/payroll-item-execution.spec.ts --workers=1
```

上述命令同樣在隔離目錄及指定Node PATH下執行。保留失敗log與受測來源，不中斷正常前進的suite，不把不同來源數量拼成一個成功結果。

## 下一步與不可越過的界線

1. 對照交付bundle inventory的base/head/tree/source hash與遠端狀態，保留較新的本機或遠端變更；確認當前完整驗收結果，而非只讀舊PR描述。
2. 若本輪有剩餘失敗，只修具體根因並做必要回歸；不新增無關制度或功能，不跳測消guard。
3. 讓授權人決定真實八月歷史證據保存／採用方式，列逐人缺件並補核實來源。對具體尚未支援更正種類，再以有限adapter設計處理，不能假裝薪率修正已涵蓋全部歷史重建。
4. 只有另獲明確上線授權後，才討論部署、正式政策啟用與正式資料驗收；這份交接沒有該授權。

**禁止讀寫、搬移、刪除或提交 `.env`／`tests/snap/`；禁止reset/stash/delete使用者變更；禁止merge、部署、手動hook、正式資料寫入、正式政策啟用、歷史薪資覆寫、銀行付款、自動追扣、真通知或排程啟用。不得建立憑證、擴權、重試被拒的本機push或擅自聯繫Grok。**

交付完本輪即停止開發，由使用者持文件接手。
