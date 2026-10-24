# 批次 A 發布至 Draft PR 的範圍與證據

PR：<https://github.com/ahnchen1983/chiayiyouthlabclock/pull/13>。發布基底 `43251f09eb7a24098eee0ee09c093abb78c8392f`；審核來源 `2a8d85994d8d73da4f61e052227e5d55a92d8332` 與 `05dd3bc9d7aff54ae0bebfb8cc476e5a5bfe8d9b`。

這是同一 PR 的增量改善，保留既有程式、CI 與 Draft 狀態。公開版本只新增已審核 A 程式/合成測試與公開文件整理，不包含 B 計畫、B 實作、正式資料或本機私有路徑。GitHub 建立提交的 SHA 可以不同於本機來源；發布以完整 tree 與相對基底的檔案差異核對，不把不同 SHA 說成同一提交。

## 行為

- 現有待審假單/外勤、補卡、留停及換班納入共用預檢；申請建立與正式月結共用交易閘門。
- 正式 preflight.status 與 trialStatus 分開。必需模型與驗收尚缺，全部新正式月結 BLOCKED/409，沒有 client/config 豁免；試算完整時可以顯示合成金額，不能轉成正式 run/lock。
- 核准補卡需伺服器原子建立的 request hash、revision、actor/time、before/after及父鏈證據；未套用、證據缺失或來源鏈破損均待覆核。後續合法更正可追溯，重複核准不增加 revision，客戶端不能指定證據。
- 既有已結算快照保持唯讀，live費率或申請改動不觸發重算；不解鎖覆寫。

## 分開記錄的驗證執行

| 執行 | 結果與界線 |
| --- | --- |
| 作者對來源 05dd3bc 的驗證 | 425 單元/mock API、22 真實 Firestore emulator/rules、16 Chromium E2E 通過；typecheck/build 通過。皆合成資料與 demo emulator。 |
| 獨立複驗同一來源 | 435 單元/mock API 通過＝作者425＋獨立10個handler邊界案例；另有38項定向執行，與435重疊，不另相加。兩項P1均關閉。 |
| 獨立複驗的正式gate | 沒有mock assertPayrollReady，明確斷言非mock；完整試算、偽造豁免均409，memory DB前後完全一致。既有機制測試的trial gate stub不代表正式資格獲准。 |
| 獨立複驗限制 | 未另跑真emulator/E2E/typecheck/build；未將作者執行結果當作獨立實測。 |
| 本次遠端提交 | GitHub CI 對實際遠端 head 另跑既有 verify:pr13；以該次 workflow 終態及附件為準，不沿用舊 head 的綠燈。 |

425與435是重疊的不同執行，不能加總為不同案例數。所有公開案例均為合成資料，不是實際員工薪資或正式政策。

## 業務與發布限制

仍為 Draft，保留 `[skip netlify]`，不合併 main、不啟動 preview、不手動呼叫 build hook、不部署正式站。一般 GitHub CI 不跳過。

正式發薪 **NO GO**：必要薪資項目、加班補休、人工差額批准及完整案件模型/驗收未完成；本次沒有宣稱全規格完成。後續工作需另行審查，不在 A 中混入。

2026-08 全體員工是使用者指定的回溯核對範圍。尚未讀取正式資料；不是 effectiveMonth 啟用授權，不重算或覆寫八月已結算款。
