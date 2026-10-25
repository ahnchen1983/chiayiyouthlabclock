import React from 'react';
import { TRIAL_PAYROLL, TRIAL_PAYROLL_NOTICE } from '../utils/releaseFlags';
const TrialPayrollBanner: React.FC = () => TRIAL_PAYROLL ? (
    <p role="note" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{TRIAL_PAYROLL_NOTICE}</p>
) : null;
export default TrialPayrollBanner;
