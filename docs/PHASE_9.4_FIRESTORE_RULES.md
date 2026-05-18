# Phase 9.4 — Firestore Rules 嚴格化工單

> **狀態：** 規劃完成，待實作
> **負責切票：** Claude（規劃）
> **負責實作：** Codex
> **預估工期：** 半天
> **對應 Roadmap：** Phase 9.4
> **對應 SDD 議題：** D9-4 (a)「Firestore client 全 deny，所有讀寫只走後端 API」
> **依賴：** 無

---

## 1. 目標

目前 repo 根目錄**沒有 `firestore.rules`** — Firebase 專案套用預設 rules（30 天後過期 / 全 open）。一旦過期或被誤改成 `allow read, write: if true;`，前端任何登入 user（甚至未登入）都能直接 `db.collection('employees').get()` dump 全公司資料。

**架構決策 D9-4 (a)：Firestore client 全 deny，所有讀寫只走後端 API。**

理由：
1. 後端 Netlify Functions 用 **service account（Firebase Admin SDK）**，繞過 rules 直接讀寫
2. 前端 `services/firebaseConfig.ts` 註解已說明「Firestore 已移除」— 前端只用 `getAuth()` 換 Custom Token
3. 既有架構 (`services/googleAppsScriptAPI.ts` 全程 fetch API) **已不存在**前端直接 Firestore 操作
4. 即使未來開發者誤寫，rules 會立即攔截 — 安全閘門

### 量化目標

| 指標 | 現況 | 目標 |
|------|------|------|
| `firestore.rules` | 不存在 | 存在（全 deny） |
| `firebase.json` / `.firebaserc` | 不存在 | 存在 |
| Rules 單元測試 | 0 | ≥ 6 |
| Vitest 總數 | 104 | ≥ 110 |

---

## 2. 改動範圍

| 檔案 | 動作 |
|------|------|
| `firestore.rules` | **新增** — 全 deny |
| `firebase.json` | **新增** |
| `firestore.indexes.json` | **新增** — 2 個 composite index |
| `.firebaserc` | **新增** |
| `tests/firestore-rules.test.ts` | **新增** — ≥ 6 個 |
| `package.json` | 加 2 個 script + `@firebase/rules-unit-testing` devDep |
| `README.md` | 加「Firestore Rules 部署」段 |

**不要動：**
- `netlify/functions/api.ts`（後端走 service account，rules 不影響）
- `services/firebaseConfig.ts`（前端只用 Auth）
- `contexts/AuthContext.tsx`、`vite.config.ts`、既有 104 測試

---

## 3. 實作規格

### 3.1 `firestore.rules`（新檔，repo 根目錄）

```
rules_version = '2';

// ============================================================
// Phase 9.4 — Firestore Rules 嚴格化策略
// D9-4 (a)：Firestore client 全 deny，所有讀寫只走後端 API
//
// 影響：
// 1. 前端即使用 signInWithCustomToken 登入 Firebase Auth，
//    仍無法直接 db.collection(...).get() — 全部 deny
// 2. 後端 Netlify Functions 透過 firebase-admin（service account）
//    存取 Firestore，**繞過 rules**，API 仍能正常讀寫
// 3. 前端所有資料操作必須 fetch('/.netlify/functions/api')
// ============================================================

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**為何不寫 `allow read: if request.auth != null;`？**
那會讓任何登入 user 直接 dump `employees` 全表（含密碼雜湊、薪資、Email、電話）— 等同沒鎖。**只能全 deny。**

### 3.2 `firebase.json`（新檔）

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

> 不放 `hosting` / `functions` — 本專案 hosting 用 Netlify。

### 3.3 `firestore.indexes.json`（新檔）

從 `api.ts` 反推：

```json
{
  "indexes": [
    {
      "collectionGroup": "clockRecords",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "empId", "order": "ASCENDING" },
        { "fieldPath": "date",  "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "empId", "order": "ASCENDING" },
        { "fieldPath": "read",  "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

### 3.4 `.firebaserc`（新檔）

```json
{
  "projects": {
    "default": "chiayiyouthlabclock"
  }
}
```

> Project ID 從 `services/firebaseConfig.ts` 取得。若上線環境不同，部署前改這個檔。

### 3.5 `package.json` 改動

```bash
npm i -D @firebase/rules-unit-testing
```

> **不**加 `firebase-tools`（拖大 node_modules，用 npx 即可）

```json
{
  "scripts": {
    "test": "vitest run --exclude tests/firestore-rules.test.ts",
    "test:all": "vitest run",
    "firebase:rules:test": "vitest run tests/firestore-rules.test.ts",
    "firebase:rules:deploy": "npx firebase-tools deploy --only firestore:rules"
  }
}
```

> **本工單採排除策略**：`npm test` 預設**不**含 rules test（避免 CI 因 Java 環境 fail），rules test 用 `npm run firebase:rules:test` 獨立跑。

### 3.6 `tests/firestore-rules.test.ts`（新檔）

使用 `@firebase/rules-unit-testing`（會啟動 Firestore emulator，**需 Java 11+**）。

至少 6 個案例：

1. 未認證 client 讀 `employees` → deny
2. 已認證一般 user 讀 `employees` → deny（即使有 auth.uid）
3. 已認證一般 user 讀自己的 `clockRecords` → deny（v2 全 deny）
4. 未認證 client 寫 `monthLocks` → deny
5. 已認證 SuperAdmin 直接寫 `auditLogs` → deny（即使是 SuperAdmin）
6. service account（`withSecurityRulesDisabled`）讀寫所有 collection → allow
7. 未來新增 collection（如 `staffPreferences`、`totpSecrets`）→ deny（wildcard 覆蓋）

完整測試碼參考工單原稿。

### 3.7 README.md 補段

```markdown
## Firestore Rules 部署（Phase 9.4）

本專案 Firestore rules 採「**client 全 deny**」策略 — 所有資料讀寫必須走後端 API。
前端任何 `db.collection(...).get()` 都會被 Firebase 拒絕，僅後端 service account
（Firebase Admin SDK）能繞過 rules 操作資料。

### 本機測試 rules

```bash
# 需先安裝 Java 11+（macOS：brew install openjdk@17）
npm run firebase:rules:test
```

### 部署 rules 到 production

```bash
npx firebase-tools login     # 第一次需先登入
npm run firebase:rules:deploy

# 同時部署 indexes
npx firebase-tools deploy --only firestore:indexes
```

> ⚠️ **警告：任何前端程式碼直接讀寫 Firestore 都會被 deny。**
> 所有資料操作必須透過 `services/googleAppsScriptAPI.ts` 的 fetch 呼叫
> `/.netlify/functions/api`，由後端用 service account 操作 Firestore。
```

---

## 4. 驗收條件

### 4.1 量化

| # | 命令 | 期望 |
|---|------|------|
| 1 | `npm run typecheck` | 0 錯誤 |
| 2 | `npm test` | 104 既有測試全綠（不含 rules test） |
| 3 | `npm run firebase:rules:test` | ≥ 6 個 rules 測試全綠 |
| 4 | `npm run build` | 無新增 warning |

### 4.2 程式碼審查

- [ ] `firestore.rules` 第一行 `rules_version = '2';`
- [ ] 用 `match /{document=**} { allow read, write: if false; }`
- [ ] **沒有任何 `request.auth != null` 例外**
- [ ] `firebase.json` 指向 rules + indexes
- [ ] `.firebaserc` default project 為 `chiayiyouthlabclock`
- [ ] `firestore.indexes.json` 含 2 個 composite index
- [ ] `@firebase/rules-unit-testing` 為 devDep（**不**加 `firebase-tools`）
- [ ] `test` script 排除 rules test
- [ ] README 含部署說明 + 警告語

### 4.3 手動驗收（上線者執行，**不是 Codex 責任**）

| # | 步驟 | 期望 |
|---|------|------|
| 1 | `git pull` 後 `npm i` | `@firebase/rules-unit-testing` 安裝完成 |
| 2 | `npm run firebase:rules:test` | 6 個測試全綠 |
| 3 | `npx firebase-tools login` | 登入成功 |
| 4 | `npm run firebase:rules:deploy` | `✔ Deploy complete!` |
| 5 | Firebase Console > Firestore > Rules | 看到 v2 全 deny |
| 6 | 前端正式環境登入打卡 | 正常（走 API） |
| 7 | Console 跑 `firebase.firestore().collection('employees').get()` | **被拒**，`Missing or insufficient permissions` |
| 8 | `npx firebase-tools deploy --only firestore:indexes` | 部署成功 |

### 4.4 部署前安全檢查（**必做**）

```bash
# 在 repo 根目錄跑：
grep -rn "db\.collection\(\|firestore()\|getFirestore()\|firebase/firestore" \
  --include="*.ts" --include="*.tsx" \
  components/ services/ contexts/ App.tsx index.tsx
```

**期望結果：無任何 match。** 若有，**先改為走 API**，**再**部署 rules。

> 規劃時已 grep 確認：前端原始碼**無**任何直接 Firestore 操作。

---

## 5. Commit message 模板

```
feat(security): enforce Firestore client-side deny-all rules (Phase 9.4)

- Add firestore.rules with rules_version = '2' and wildcard deny-all
  (no exceptions — all reads/writes must go through backend API)
- Add firebase.json pointing to rules + indexes
- Add firestore.indexes.json with 2 composite indexes:
    clockRecords(empId, date)
    notifications(empId, read)
- Add .firebaserc with default project = chiayiyouthlabclock
- Add @firebase/rules-unit-testing as devDependency
- Add tests/firestore-rules.test.ts — 7 rules tests (6 deny + 1 admin allow)
- Add scripts: firebase:rules:test, firebase:rules:deploy
- Update test script to exclude rules test from default CI
  (rules test requires Java/Firestore emulator)
- README: rules deployment instructions + security warning
- D9-4 (a): client deny-all, backend service account is the only path

Note: backend (firebaseAdmin.ts) uses service account — Admin SDK
bypasses Firestore rules by design.

Deployment is ops responsibility. See README for
`npm run firebase:rules:deploy`.
```

---

## 6. 不要越界做的事

| ❌ 不要 | 原因 |
|--------|------|
| 加 `if request.auth != null` 例外 | **嚴重資安漏洞** — 任何登入 user 可 dump employees |
| 加 `firebase-tools` 為 devDep | 80MB+ 拖大；用 npx |
| 自動執行 `firebase deploy` | 會動到 production，由上線者執行 |
| 改 `api.ts` 或 `firebaseAdmin.ts` | rules 不影響後端 |
| 改 `firebaseConfig.ts`（前端） | 保持現狀 |
| 改既有 104 測試 | rules test 為新增 |
| rules test 加入 `npm test` 預設 | 需 Java + emulator，CI 可能跑不起 |
| 改 `vite.config.ts` | 不需 |
| 順便加細粒度 rules | follow-up（§ 8） |
| Commit service account 金鑰 | 嚴禁；從 Netlify env 讀 |
| 加沒用到的 index | 只加 api.ts 反推的 2 個 |

---

## 7. 完工回報格式

```
Phase 9.4 驗收結果（Codex）

| 項目 | 工單目標 | 實測結果 |
|------|----------|----------|
| typecheck | 0 錯誤 | __ |
| npm test（既有 104） | 全綠 | __ |
| firebase:rules:test | ≥ 6 個綠 | __ |
| build 警告 | 無 | __ |
| firestore.rules 全 deny | 是 | __ |
| indexes 含 2 個 | 是 | __ |
| @firebase/rules-unit-testing 安裝 | 是 | __ |
| firebase-tools **未**加入 | 是 | __ |
| README 含部署說明 | 是 | __ |

新增測試：firestore-rules.test.ts ___ 個案例

部署前 grep 檢查：
- 前端有直接 Firestore 操作？ [ ] 無 [ ] 有：__

備註：
- Java 版本：__（需 11+）
- Firestore emulator 下載：[ ] 成功 [ ] 失敗：__
```

**上線者另外回報（部署後）：**

```
Phase 9.4 部署結果（ahnchen）

| 項目 | 結果 |
|------|------|
| firebase login | [ ] 成功 |
| firebase:rules:deploy | [ ] 成功 |
| Firebase Console 顯示新 rules | [ ] 是 |
| 前端 console 嘗試 db.collection().get() | [ ] 被拒 [ ] 通過（**資安問題！**） |
| 既有打卡功能正常 | [ ] 是 |
| firestore:indexes 部署 | [ ] 成功 / skip / 失敗 |
```

---

## 8. 後續可能 follow-up

| Phase | 工項 |
|-------|------|
| 9.5 | Custom Claims 整合（role 寫入 token claim） |
| 9.6 | 細粒度 rules（員工可讀自己的 notifications，仍 deny 敏感表） |
| 9.7 | Rules CI 整合（GitHub Actions + setup-java） |
| 9.8 | Rules 部署自動化（main push 後自動 deploy） |
| 9.9 | Firestore Cloud Audit Logs（BigQuery 分析） |
| 10.x | App Check（防 reverse engineering） |
