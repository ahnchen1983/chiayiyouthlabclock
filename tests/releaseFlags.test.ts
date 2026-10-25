import {it,expect} from 'vitest';
import {policyPendingWorkflowsVisible,TRIAL_PAYROLL} from '../utils/releaseFlags';
it('V1 production build hides overtime/comp workflows unless explicitly opted in',()=>{expect(policyPendingWorkflowsVisible({})).toBe(false);expect(policyPendingWorkflowsVisible({VITE_SHOW_POLICY_PENDING_WORKFLOWS:'true'})).toBe(true);expect(policyPendingWorkflowsVisible({VITE_E2E:'true'})).toBe(true);expect(policyPendingWorkflowsVisible({VITE_SHOW_POLICY_PENDING_WORKFLOWS:'1'})).toBe(false);});
it('V1 keeps every in-system salary marked as a trial figure',()=>{expect(TRIAL_PAYROLL).toBe(true);});
