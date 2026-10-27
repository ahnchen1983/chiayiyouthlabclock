# 計薪政策版本建立與雙人核定（2026-10-26）

使用者決定先做此項（接手待辦第 0 項）。在此之前系統只讀取 `payrollPolicyVersions`，沒有建立或核定路徑。

## 做了什麼

- `netlify/functions/utils/payrollPolicyVersion.ts`：`list-payroll-policy-versions`、`propose-payroll-policy-version`、`review-payroll-policy-version`。一位管理者提出（適用員工、有效期間、「其他」假別給薪方式、原因），**另一位**管理者核定或退回；提案人不能核定。核定時建立不可覆寫的 `payrollPolicyVersions/{ppv_…}`，變更需另建新版本。操作識別重播保護（`payrollPolicyCommands`）。系統帳號不能列入適用員工。
- 政策內容由伺服器依已確認決策與法規產生（`buildNormalPayPolicy`），管理者不能改，避免填錯：一般 8/40、七日週期星期日起（2026-10-26 確認）、月中到職按在職曆日折算、最後合計整數元四捨五入、月薪 ÷240、特休全薪（勞基法第38條）、事假不給薪（請假規則第7條）、病假半薪（請假規則第4條）、留停不給薪。「其他」假別由提案人選全薪／半薪／不給薪，未決定則此類假單待核、不以 0 發給。
- 管理者畫面「計薪政策版本」：固定規則唯讀顯示、提出表單、待核定清單、已核定版本（含要填入薪資主檔「政策版本參照」的 ID）。

## 已知限制

- 病假半薪只適用一年內 30 日內的部分（請假規則第4條），超過部分的處理依假別額度流程，本批未另做跨年累計檢查。
- 核定者可以是適用員工之一：政策是規則而非個人金額；個人薪額仍由薪資主檔「不可核定本人」規則把關。

## 待使用者決定：八月回溯計算

薪資主檔目前規定「首次核定只能未來生效；歷史只能唯讀遷移預覽」（`effectiveMaster.assertFutureMaster`，見 `PR13_BATCH_C1.md`）。因此八月（已過去）的主檔無法用正常流程建立，系統也就無法正式算出八月薪資。政策版本本身允許任何期間，對帳時可以引用。需決定八月對帳的做法。

## 驗證

單元 9 例（伺服器產生的政策通過正常薪資驗證、雙人流程、重播、無效輸入）；真實 Firestore emulator：API 建立並核定政策 → 主檔引用 → 薪資正式金額 3467（最後整數元進位）；E2E 3 例。

`npm run verify:pr13`（commit `4acfb610b85b12e45c72ca1e9cdbd42c594198e6`，sourceHash `6a864ce025f54d5a5a0c6fa56c83e5b3efc57f05ff43307f17c3e90fa8a035a3`，manifest `.verification/pr13/2026-10-26T04-19-36-691Z/`）：audit、typecheck、unit/API 897、emulator 91、E2E 96、build 全部通過。未做獨立 review；未部署。
