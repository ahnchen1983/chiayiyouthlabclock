import React from 'react';
import type { SalaryDetail } from '../types';
export const PayrollReviewNotice = ({ salary }: { salary: SalaryDetail }) => salary.calculationStatus === 'needs-review' || salary.calculationStatus === 'legacy-review' ? (
    <div role="status" className="my-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>{salary.calculationStatus === 'legacy-review' ? '歷史月結待覆核：沒有個人薪資快照' : '薪資尚未完成覆核，不能結算'}</strong>
        <ul>{salary.reviewReasons?.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p>已確認工作 {((salary.knownWorkMinutes || 0) / 60).toFixed(2)} 小時；待核實部分不當作零薪資。</p>
    </div>
) : null;
