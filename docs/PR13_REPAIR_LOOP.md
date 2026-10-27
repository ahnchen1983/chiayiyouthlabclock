# PR13 修復與核實循環

日期：2026-10-23。整合分支：`codex/pr13-repair-loop`。來源 PR #13：`ee54a6a`。

## 循環與完成門檻

1. 重現：先保留會失敗的行為測試，記錄輸入、預期、實際結果。
2. 修復：僅改負責的模組，保留來源證據、月鎖、權限及未知資料待覆核。
3. 檢測：針對原反例、正常對照、跨日跨月、錯誤輸入及權限重跑。
4. 整合：分支提交後由整合者合併，跑全部單元/API/瀏覽器測試與建置。
5. 核實：不同實作者複查；使用實際 Firestore emulator 驗證寫入與競爭結果。
6. 若發現新問題，回到步驟 1；只有無未解決 P1/P2、測試全過且證據對應最終提交，才標記程式修復完成。

程式驗證、公司政策確認、正式資料覆核與正式部署分別記錄。未確認政策不得套入假設值；不自動回算歷史已付薪資。

## 工作分配與衝突檢查

| 分支 | 可修改（owned） | 其餘分類 |
| --- | --- | --- |
| codex/pr13-payroll-fix | netlify/functions/utils/payroll.ts；tests/payrollRegression.test.ts；tests/pr13-payroll-review.test.ts | 其他程式 read-only；型別/API/文件變更 report-only |
| codex/pr13-backend-fix | netlify/functions/api.ts；netlify/functions/utils/payrollSnapshot.ts；netlify/functions/utils/payrollReviewValidation.ts；tests/payrollApi.test.ts；tests/pr13-firestore-review.test.ts；tests/pr13-makeup-review.test.ts | 其他程式 read-only；型別/前端/文件變更 report-only |
| codex/pr13-emulator-check | tests/firestore-api.emulator.test.ts；vitest.emulator.config.ts；firebase.test.json | 所有正式程式 read-only；套件/scripts/文件變更 report-only |
| 整合者 | 前端、services/googleAppsScriptAPI.ts、types.ts、utils/attendance.ts、package.json、scripts、文件、E2E | 代理 owned 檔待合併後才修改 |

派工前確認：owned 無交集；package/lock/schema/deploy 文件由整合者持有；代理分支不 push、不部署。合併順序：計薪 → 後端 → emulator → 前端整合 → 獨立複查。

## 必須關閉的缺陷

- [x] 跨夜工作與翌日/跨月有薪假重疊不可重複結算。
- [x] 快照無 undefined，實際 SDK/Firestore 寫入通過，hash 對應實存輸入。
- [x] 跨午夜休息的多段工作可以輸入與儲存。
- [x] 多段打卡的補卡單可以駁回，出勤卡不變。
- [x] 提供月度政策/保費與核准假單分配的覆核畫面，保留權限與月鎖保護。
- [x] 實際 emulator 驗證月結快照與月鎖/修改併發，既有 rules 測試可明確執行。
- [x] 全套測試、型別、正式建置與獨立審查通過。

## 初始重現

原有 257 項 Vitest、7 項 E2E 通過，但新增 4 個反例失敗。重現測試已提交 `66da280`。主工作目錄的 `.env` 與 `tests/snap/` 保持原狀；隔離測試不讀取其資料。

## 最新狀態

程式修復循環已完成並核實：386 項程式/API、16 項 emulator/rules、15 項瀏覽器、型別、正式建置與正式依賴高/嚴重門檻全部通過。後續獨立複查發現的跨月覆蓋、過期表單、午夜時段、資料庫競態及快照重播等問題均有反例與回歸。

受測提交 `f5caeb1`；完整來源雜湊、限制與證據位置見 `docs/PR13_VERIFICATION_2026-10-23.md`。執行 `npm run verify:pr13` 可重跑，CI 同步執行並上傳證據。正式政策與員工資料仍須由授權管理者在覆核畫面確認；程式通過不等於已核定正式發薪。
