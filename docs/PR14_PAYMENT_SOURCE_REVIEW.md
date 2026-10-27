# C3b payment source evidence review — 2026-10-26

This is a bounded source and evidence-model review, not authorization to calculate new deductions, execute payment, activate policy, or rewrite historical payroll. The payment event `amount` remains the recorded **net transferred amount**. It must not be relabeled gross salary or used directly as a statutory tax/premium base.

## Verified official sources

- [Salary withholding rules](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0340013), amended 2024-12-31, effective 2025-01-01: Articles 2, 6 and 7 distinguish resident monthly salary from part-time/nonmonthly payment withholding. Employment label alone does not establish payment classification.
- [Supplementary premium collection rules](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060027), amended 2024-03-20: Article 2 identifies actual payment/transfer time; Article 3 identifies salary income; Article 4 includes category-2 salary exemption; Article 5 requires insurance-unit proof before receipt. Insurer-query confirmations have two-month validity. These provisions apply to the August 2026 review; actual payment-date facts still require evidence.
- [NHIA union proof explanation](https://www.nhi.gov.tw/ch/cp-3007-17808-3150-1.html) supports insurance-unit-issued enrollment proof. A label saying “insured elsewhere” does not establish liability or exemption.
- [NHIA premium formula](https://www.nhi.gov.tw/ch/cp-4516-74b0f-2613-1.html) gives the 2.11% rate effective from 2021-01-01. [Enforcement Rules Article 52](https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=52&pcode=L0060002) specifies whole-dollar half-up premium rounding.
- [Treasury collection rules Article 5](https://law-out.mof.gov.tw/LawContent.aspx?id=FL051526), amended 2012-08-17, discard fractions at tax collection. This review has not established the precise employee/payment-level income-tax rounding order, its interaction with exemption thresholds, or fractional salary placement in integer withholding-table bands.

## Current evidence contract

Each actual event retains identity, actual payment date, net transferred amount, source identifiers and a specific source locator. Multiple actual payments may reference distinct rows of the same statement; the service does not split an aggregate into invented events.

Union proof can additionally record `issuerRef`, `proofKind`, `providedAt`, and `queriedAt`. Accepted proof-kind labels are `insurance-unit-certificate`, `insurer-query`, and `unresolved`. Identifiers are metadata references, not raw documents, URLs, secrets or a substitute for authentic proof review.

Missing optional provenance remains recordable but yields `needs-review`. Supplied malformed metadata is rejected. A union certificate requires issuer/type evidence and proof supplied before payment. With only `paidOn`, a prior Taipei calendar date establishes ordering; same-day ordering remains unknown. Optional `paidAt` must be an explicit timestamp whose Taipei date matches `paidOn`; then `providedAt` must precede it strictly. No timestamp is inferred from a date. Insurer-query evidence remains `needs-review`: exact two-calendar-month validity boundaries have not been implemented, and a guessed 60-day expiry is prohibited.

Two-person approval records reviewed document facts only. It may retain unresolved or mismatched monthly reconciliation. Server assessments remain reproducible from immutable inventory/source versions. `ready-evidence` is not legal payroll readiness; formal eligibility remains blocked and no tax or premium amount is produced.

## Missing calculation prerequisites

A later source model must distinguish net transferred amount, gross salary income, income-tax base and supplementary-premium income. It needs sourced component allocations for taxable/exempt income, voluntary pension, actual payment scope and any exclusions; a single event covering a month does not itself prove equivalence to the current monthly taxable base. Payer/recipient, residency, payment classification, payment-date insurance eligibility and reviewed exemption applicability must also bind to the event.

Ordinary `other` insurance category plus a recorded `none` exemption assertion is not verified proof of statutory liability. Unknowns must remain unresolved. No new tax calculations or rounding assumptions are introduced by this evidence-quality expansion.

Validation status: synthetic regressions were added before implementation; no tests were executed by this worker. The integration owner must record actual test results on the final code.
