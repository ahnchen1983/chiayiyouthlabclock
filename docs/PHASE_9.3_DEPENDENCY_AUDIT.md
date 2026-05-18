# Phase 9.3 — npm 供應鏈 audit + CI gate 工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 0.5 天
> **對應 Roadmap：** Phase 9.3
> **依賴：** Phase 7.4 既有 CI 已建立
> **客戶決策：** D9-3 (a) — `npm audit --audit-level=high`

---

## 1. 目標

目前 `package.json` 直接相依 7 個 runtime 套件，加上 transitive 超過 800 個。一旦其中任一爆出 CVE，**沒有任何自動化機制**可察覺。本工單建立「供應鏈三層防線」：

1. **CI gate**：每次 PR / push 跑 `npm audit`，high / critical 直接 fail
2. **Dependabot**：每週一自動掃，minor/patch group 成單一 PR
3. **SECURITY.md**：建立漏洞責任揭露窗口

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| CI npm audit | ❌ | ✅（high / critical fail） |
| Dependabot | ❌ | ✅（npm + github-actions weekly） |
| SECURITY.md | ❌ | ✅ |
| package.json audit script | ❌ | ✅（`audit:prod` + `audit:report`） |
| Vitest | 104 | 104（不變動） |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `.github/workflows/ci.yml` | **改** — build step 之後加 audit step |
| `.github/dependabot.yml` | **新增** |
| `SECURITY.md` | **新增**（repo 根目錄） |
| `package.json` | **改** — 加 `audit:prod` + `audit:report` |
| `README.md` | 補「資安回報」段 |

**不要動：** 既有 104 測試、`vite.config.ts`、`tsconfig.json`、既有 CI step、業務程式碼、`package-lock.json`（主動編輯）。

---

## 3. 實作規格

### 3.1 `.github/workflows/ci.yml`（追加 audit step）

在現有 `Production build (Vite)` step 之後加：

```yaml
      # Phase 9.3 — 供應鏈漏洞掃描（high / critical fail）
      - name: npm audit (production only, fail on high / critical)
        run: npm audit --audit-level=high --omit=dev

      # Phase 9.3 — moderate / low 只 warn（不阻擋 build）
      - name: npm audit (full report, advisory only)
        if: always()
        continue-on-error: true
        run: npm audit --omit=dev || true
```

**設計重點：**
- 兩個 audit step：第一個嚴格 gate（high+ fail）；第二個寬鬆 advisory（`continue-on-error`）
- `--omit=dev`：dev tools 的 CVE 通常不影響 production bundle
- 放在 build 之後：audit fail 不阻擋 build / test 結果可見

### 3.2 `.github/dependabot.yml`（新檔）

```yaml
version: 2

updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Taipei"
    open-pull-requests-limit: 5
    reviewers:
      - "ahnchen1983"
    assignees:
      - "ahnchen1983"
    labels:
      - "dependencies"
      - "automated"
    commit-message:
      prefix: "chore(deps)"
      include: "scope"
    groups:
      runtime-minor-patch:
        applies-to: version-updates
        update-types:
          - "minor"
          - "patch"
        exclude-patterns:
          - "@types/*"
          - "typescript"
          - "vite"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Taipei"
    open-pull-requests-limit: 3
    reviewers:
      - "ahnchen1983"
    assignees:
      - "ahnchen1983"
    labels:
      - "dependencies"
      - "github-actions"
    commit-message:
      prefix: "chore(ci)"
      include: "scope"
```

**設計重點：**
- weekly 不是 daily（避免 PR 洪水）
- group `runtime-minor-patch`：minor/patch 合併為單一 PR，CI 一次跑、一次 merge
- `@types/*` / `typescript` / `vite` 排除 group → 獨立 PR 由人工 review
- major 升級不在 group 內，預設 Dependabot 給獨立 PR
- 監視 `github-actions` ecosystem：避免 actions 被釘在過時版本

### 3.3 `SECURITY.md`（新檔）

完整模板（含「支援版本」、「漏洞回報窗口」、「我們的承諾」、「嚴重度標準 CVSS 3.1」、「範圍」、「致謝榜」、「法律聲明」）。

**核心要點：**
- 回報窗口：`ahnchen@yuncidigital.com`
- 信件主旨：`[SECURITY] <漏洞簡述>`
- SLA：48h 初步回覆、7d 驗證、嚴重漏洞 7d 修補、中低 30d
- 嚴重度標準：CVSS 3.1
- 致謝榜（暫無，期待第一位）

完整內容見工單原稿（約 100 行 Markdown）。

### 3.4 `package.json`（追加 2 個 script）

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "audit:prod": "npm audit --audit-level=high --omit=dev",
    "audit:report": "npm audit --json > audit-report.json"
  }
}
```

> `audit-report.json` 應加入 `.gitignore`（若 Codex 發現 .gitignore 沒有此 entry，可加並寫進 commit message）。

### 3.5 README.md 補段

```markdown
## 資安回報

如發現本系統有資安漏洞，請依 [SECURITY.md](./SECURITY.md) 所述方式回報至
`ahnchen@yuncidigital.com`，**請勿在 GitHub Issue 公開回報細節**。

我們承諾 48 小時內回覆，依嚴重度於 7–30 天內部署修補。

## 自動化資安檢查

| 機制 | 觸發 | 行為 |
|------|------|------|
| GitHub Actions `npm audit` | PR / push to main | high / critical CVE 阻擋 merge |
| Dependabot（npm） | 每週一 09:00 | 自動 PR minor/patch 升級 |
| Dependabot（github-actions） | 每週一 09:00 | 監視 CI actions 版本 |

```bash
npm run audit:prod    # 與 CI 同步的 production-only 掃描
npm run audit:report  # 產出全量 JSON 報告
```
```

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | 104 全綠（不變動） |
| 3 | `npm run build` | 無 warning |
| 4 | `npm run audit:prod` | exit 0（無 high/critical） |
| 5 | `npm run audit:report` | 產出合法 JSON |

### 4.2 First Run 處理（重要！）

第一次跑 `npm run audit:prod` **可能直接掛掉**（既有 deps 已有 high CVE）。處理順序：

1. 跑 `npm audit --omit=dev` 看完整清單
2. 若 high+：`npm audit fix` → `npm update <pkg>` 升 minor
3. 若 major 才能修：**不在本工單升 major**，commit message 註記，Dependabot 後續處理
4. 確認 `package-lock.json` 更新後一併 commit

**禁止：** 為了過 audit 而 `npm uninstall` runtime 套件。

### 4.3 程式碼審查

- [ ] `ci.yml` 既有 4 個 step 順序內容**完全不變**
- [ ] 新 audit step 在 build 之後
- [ ] 嚴格 audit 用 `--audit-level=high --omit=dev`
- [ ] 寬鬆 audit 有 `continue-on-error: true`
- [ ] `dependabot.yml` npm group `runtime-minor-patch` 排除 `@types/*` / `typescript` / `vite`
- [ ] `dependabot.yml` reviewers/assignees 都是 `ahnchen1983`
- [ ] `SECURITY.md` 在 repo 根目錄
- [ ] `SECURITY.md` 含 email、48h SLA、CVSS 表、致謝榜

### 4.4 手動煙霧測試

| # | 步驟 | 期望 |
|---|------|------|
| 1 | 本機跑 `npm run audit:prod` | exit 0 |
| 2 | 本機跑 `npm run audit:report` | 產出合法 JSON |
| 3 | 開測試 branch、加 `"lodash": "4.17.20"`（已知 CVE-2021-23337）、推 PR | CI audit step **fail**；PR 紅勾叉 |
| 4 | 還原測試 branch、不 merge、刪除 | repo 維持乾淨 |
| 5 | GitHub Settings > Security > Code security | Dependabot 顯示「Custom config」並偵測到 `.github/dependabot.yml` |

> § 4.4 第 3 項是關鍵驗證，回報請附 CI fail 截圖或 log。

---

## 5. Commit message 模板

建議拆 2 個 commit：

### Commit 1（核心）

```
chore(security): add npm audit CI gate and Dependabot config (Phase 9.3)

- ci.yml: add `npm audit --audit-level=high --omit=dev` step after build
- .github/dependabot.yml: weekly Monday 09:00 Asia/Taipei
  - npm: group minor/patch; exclude @types/*, typescript, vite
  - github-actions: monitor actions/checkout, setup-node
- package.json: add audit:prod and audit:report scripts
- D9-3 (a): high + critical fail; moderate / low warn

Manual verification:
- npm run audit:prod → 0 high/critical
- Throw-away PR with lodash@4.17.20 → CI blocked as expected
- 104 Vitest tests still green
```

### Commit 2（文件）

```
docs(security): add SECURITY.md and README disclosure section (Phase 9.3)

- SECURITY.md (new):
  - Disclosure: ahnchen@yuncidigital.com
  - SLA: 48h ack, 7d triage, 7d/30d patch by severity
  - CVSS 3.1 severity rubric
  - Hall of Fame (empty)
- README.md: add 資安回報 + 自動化資安檢查 sections
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 改既有 CI step（typecheck / test / build）順序 | Phase 7.4 已驗證 |
| 改 `vite.config.ts` | 與 audit 無關 |
| 新增 Vitest 測試 | 本票為 CI / 文件改動 |
| 升 major 版本 | 交給 Dependabot 開獨立 PR |
| 拿掉 `--omit=dev` | dev tools CVE 假警報多 |
| 改 `--audit-level=high` 為 moderate | D9-3 (a) 拍板 high |
| 整合 Snyk / Semgrep / CodeQL | follow-up |
| `npm audit` 放在 install 後 / typecheck 前 | audit fail 會擋掉所有後續，PR 作者拿不到 build 結果 |
| 動 production deps（除非為修 CVE） | 修了限縮必要範圍，commit message 解釋 |
| SECURITY.md 放在 `docs/` | 慣例放 repo 根目錄（GitHub 自動偵測） |
| 在 SECURITY.md 寫死任何漏洞細節 | 政策文件，不放具體漏洞 |

---

## 7. 完工回報格式

```
Phase 9.3 驗收結果

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| Vitest | 104 全綠 | __ |
| build 警告 | 無 | __ |
| npm run audit:prod | exit 0 | __ |
| audit:report 產 JSON | 是 | __ |
| ci.yml audit step | 2 個 | __ |
| dependabot.yml ecosystem | npm + github-actions | __ |
| SECURITY.md | repo 根目錄 | __ |
| README 資安回報區塊 | 有 | __ |

First Run audit fix（如有）：
- 升級的套件：__
- 升級原因：__

故意引入 CVE 驗證（§ 4.4 第 3 項）：
- CVE 套件版本：__
- CI fail 確認：[ ] 是
- 測試 branch 已刪除：[ ] 是

備註：
```

---

## 8. 後續可能 follow-up

| 項目 | 估時 |
|------|------|
| Snyk 整合 | 0.5 d |
| Semgrep SAST | 1 d |
| CodeQL | 0.5 d |
| SBOM 自動產出（CycloneDX） | 0.5 d |
| License scanner | 0.5 d |
| GitHub 安全功能全開 | 0.25 d |
| `auditLogs` 整合 CI 結果 | 1 d |
