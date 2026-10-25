/** V1 release scope (docs/RELEASE_PLAN_V1_2026-10-25.md, route A). Actual salaries
 * are calculated outside the system, so every in-system amount is a trial figure.
 * Flip TRIAL_PAYROLL only after August reconciliation and an explicit go decision.
 */
export const TRIAL_PAYROLL = true;
export const TRIAL_PAYROLL_NOTICE = '薪資試算中：本頁金額僅供核對，不作為發薪依據；實際薪資以人事另行核算為準。';
/** Overtime requests and the comp ledger stay inert until their policies are
 * approved, so V1 hides them. E2E builds and an explicit opt-in still show them. */
export const policyPendingWorkflowsVisible = (env: { VITE_E2E?: string; VITE_SHOW_POLICY_PENDING_WORKFLOWS?: string } = (import.meta as any).env || {}) =>
    env.VITE_E2E === 'true' || env.VITE_SHOW_POLICY_PENDING_WORKFLOWS === 'true';
