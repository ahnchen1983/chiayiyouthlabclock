import React from 'react';
import type { SalaryDetail } from '../types';
export const PayrollReviewNotice = ({ salary }: { salary: SalaryDetail }) => {
    const pending = salary.calculationStatus === 'needs-review' || salary.calculationStatus === 'legacy-review';
    if (!pending && !salary.preflight) return null;
    return <div role="status" className="my-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {salary.preflight && <strong>月結預檢：{salary.preflight.status}（正式結算）</strong>}
        {salary.preflight && <p>試算完整度：{salary.preflight.trialStatus || '未確認'}；必要能力未完成，正式月結已由後端阻擋。</p>}
        {pending && <>
            <p>{salary.calculationStatus === 'legacy-review' ? '歷史月結待覆核：沒有個人薪資快照' : '薪資尚未完成覆核，不能結算'}</p>
            <ul>{salary.reviewReasons?.map(reason => <li key={reason}>{reason}</li>)}</ul>
            <p>已確認工作 {((salary.knownWorkMinutes || 0) / 60).toFixed(2)} 小時；待核實部分不當作零薪資。</p>
        </>}
        {!!salary.preflight?.gaps.length && <p>此預檢尚不涵蓋加班補休申請、必要薪資項目、人工差額批准及完整異常案件；正式資料尚須核對。READY 不代表已核准正式發薪。</p>}
    </div>;
};
