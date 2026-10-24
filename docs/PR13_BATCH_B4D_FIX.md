# B4d 獨立覆核修復

基準 d7cf775；本增量不含 B5a。

- 一般新版假單沒有 caseId 時，分配稽核事件省略選填欄位；不啟用 Firestore 全域 ignoreUndefinedProperties。原案件關聯、版本與 receipt 保留。
- 額度來源只有明確駁回、取消、已取代可排除；同假別且相交額度期間的 null、空白、未支援狀態一律 409 待覆核，不推定釋放或占用，不遷移舊值。無法判定來源期間亦阻擋。
- 合成人工基準：一般事假 13–14 核准後分配 60 分鐘應成功；已存在未知狀態 09–10 與另一 13–14 申請、年度額度 60 分鐘時，應拒絕新預占且零部分寫入。

回歸包含純 policy、實際 handler、真本機 Firestore emulator 一般／案件假單分配、取消／重送／重播與競爭交易。正式 policy、附件 storage/scanner、資料核對仍未完成，正式計薪 BLOCKED / NO GO；不讀寫正式資料、不發通知。

實跑：584/584 unit/API、59/59 Firestore emulator/rules、typecheck、production build、diff check 通過。此後端修復沒有另跑 UI E2E；原 B4d 的58案例與本批不可混稱同一輪。
