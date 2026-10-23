import type { PayrollReview } from '../../../types';
import { LeaveType } from '../../../types';
import { validDate } from '../../../utils/attendance';

const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const reviewError = (message: string): never => { const error: any = new Error(message); error.statusCode = 400; throw error; };
const pick = (value: any, keys: string[]) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));

// Only these reviewed fields may enter the payroll UI/snapshot. Historic arbitrary
// employee fields and unrecognized review properties cannot carry contact data.
export const payrollReviewFields = (raw: any): any => {
    if (!object(raw)) return null;
    const review = pick(raw, ['yearMonth', 'participation', 'participationReason', 'reviewedBy', 'reviewedAt']);
    if (object(raw.policy)) review.policy = pick(raw.policy, ['version', 'hoursBasis', 'moneyDecimals', 'workDateRule', 'dailyRegularMinutes', 'regularDates', 'overtimeTiers', 'hourlyLeavePaidFraction', 'monthlyLeaveDeductionFraction', 'monthlyHourlyDivisor']);
    if (review.policy) {
        if (Array.isArray(raw.policy.overtimeTiers)) review.policy.overtimeTiers = raw.policy.overtimeTiers.map((tier: any) => pick(tier, ['minutes', 'numerator', 'denominator']));
        for (const field of ['hourlyLeavePaidFraction', 'monthlyLeaveDeductionFraction']) if (object(raw.policy[field])) review.policy[field] = pick(raw.policy[field], Object.values(LeaveType));
    }
    if (object(raw.insurance)) review.insurance = pick(raw.insurance, ['labor', 'health', 'pensionSelf']);
    if (Array.isArray(raw.scheduleExceptions)) review.scheduleExceptions = raw.scheduleExceptions.map((entry: any) => pick(entry, ['date', 'reason', 'sourceKey']));
    return review;
};

export const validatePayrollReview = (raw: any, employee: any, reviewer: string, at: string): PayrollReview => {
    if (!object(raw) || typeof raw.yearMonth !== 'string' || !monthPattern.test(raw.yearMonth)) reviewError('月份無效');
    if (raw.participation !== undefined && raw.participation !== 'system-account') reviewError('計薪參與身分無效');
    if (raw.participation === 'system-account') {
        if (!nonempty(raw.participationReason)) reviewError('排除計薪須明示非員工系統帳號原因');
        return { yearMonth: raw.yearMonth, participation: 'system-account', participationReason: raw.participationReason.trim(), reviewedBy: reviewer, reviewedAt: at } as PayrollReview;
    }
    const policy = raw.policy;
    if (!object(policy) || !nonempty(policy.version)) reviewError('須明示計薪政策版本');
    if (policy.hoursBasis !== 'actual' || policy.workDateRule !== 'clock-in-date' || policy.dailyRegularMinutes !== 480) reviewError('僅支援實際工時、上班日歸屬及每日 480 分鐘正常工時政策');
    if (policy.moneyDecimals !== 0 && policy.moneyDecimals !== 2) reviewError('金額精度須明示為 0 或 2 位');
    const inMonth = (date: any) => typeof date === 'string' && validDate(date) && date.startsWith(raw.yearMonth + '-');
    if (!Array.isArray(policy.regularDates) || !policy.regularDates.every(inMonth) || new Set(policy.regularDates).size !== policy.regularDates.length) reviewError('正常工作日須為本月有效且不重複的日期');
    if (!Array.isArray(policy.overtimeTiers) || policy.overtimeTiers.some((tier: any) => !object(tier) || !positive(tier.minutes) || !positive(tier.numerator) || !positive(tier.denominator))) reviewError('加班級距分鐘與倍率分子分母須為正數');
    for (const field of ['hourlyLeavePaidFraction', 'monthlyLeaveDeductionFraction']) {
        const fractions = policy[field];
        if (!object(fractions) || Object.entries(fractions).some(([type, fraction]) => !Object.values(LeaveType).includes(type as LeaveType) || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1)) reviewError('各假別給薪／扣薪比例須明示為 0 至 1');
    }
    if ((employee.position === '專責人員' || policy.monthlyHourlyDivisor !== undefined) && !positive(policy.monthlyHourlyDivisor)) reviewError('月薪換算時薪基準須為正數');
    const insurance = raw.insurance;
    if (!object(insurance) || ['labor', 'health', 'pensionSelf'].some(field => typeof insurance[field] !== 'number' || !Number.isFinite(insurance[field]) || insurance[field] < 0)) reviewError('須明示非負的勞保、健保及自提金額');
    if (raw.scheduleExceptions !== undefined && (!Array.isArray(raw.scheduleExceptions) || raw.scheduleExceptions.some((entry: any) => !object(entry) || !inMonth(entry.date) || !nonempty(entry.reason) || !nonempty(entry.sourceKey)))) reviewError('排班例外須明示本月有效日期、原因及證據識別');
    const review = payrollReviewFields(raw);
    // Whitelist every nested structure, including tiers and fraction map keys.
    review.policy.overtimeTiers = policy.overtimeTiers.map((tier: any) => pick(tier, ['minutes', 'numerator', 'denominator']));
    for (const field of ['hourlyLeavePaidFraction', 'monthlyLeaveDeductionFraction']) review.policy[field] = { ...policy[field] };
    return { ...review, reviewedBy: reviewer, reviewedAt: at } as PayrollReview;
};
