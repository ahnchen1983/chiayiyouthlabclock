import {withEmploymentAuthority} from './employmentAuthority';
import {effectiveMasterForMonth} from './effectiveMaster';
import { createHash } from 'node:crypto';
import type { PayrollReview } from '../../../types';
import { sanitizePayrollSnapshot } from './payrollSnapshot';
import { payrollReviewFields } from './payrollReviewValidation';

// A review confirms this employee's pay and employment basis for one month.
// Identity/contact edits do not silently replace or invalidate that decision.
const SOURCE_FIELDS = ['id', 'accountKind', 'position', 'status', 'hourlyRate', 'monthlySalary', 'laborPensionRate',
    'hireDate', 'resignDate', 'leaveOfAbsenceStart', 'leaveOfAbsenceEnd'] as const;
export const employeePayrollSourceKey = (employee: any): string => employee.legacyPayrollSourceKey || createHash('sha256').update(JSON.stringify(sanitizePayrollSnapshot(
    Object.fromEntries(SOURCE_FIELDS.map(field => [field, employee[field] ?? null])),
))).digest('hex');

export const payrollReviewDocumentId = (empId: string, yearMonth: string): string => `${empId}_${yearMonth}`;
export interface StoredPayrollReview {
    empId: string;
    yearMonth: string;
    employeeSourceKey: string;
    review: PayrollReview;
}
export const makeStoredPayrollReview = (employee: any, review: PayrollReview): StoredPayrollReview => ({
    empId: employee.id, yearMonth: review.yearMonth, employeeSourceKey: employeePayrollSourceKey(employee), review,
});

export const withMonthlyPayrollReview = (employee: any, yearMonth: string, stored: StoredPayrollReview | null, exists = stored !== null): any => {
    if (!exists) return { ...employee, payrollReview: employee.payrollReview?.yearMonth === yearMonth ? payrollReviewFields(employee.payrollReview) : null };
    // A present but invalid/stale month document must never fall back to a legacy
    // employee review, which may accidentally authorize a different pay basis.
    const valid = stored?.empId === employee.id && stored?.yearMonth === yearMonth && stored?.review?.yearMonth === yearMonth && stored?.employeeSourceKey === employeePayrollSourceKey(employee);
    return { ...employee, payrollReview: valid ? payrollReviewFields(stored.review) : null };
};

// Transaction reads are sequential so retries cannot be obscured by another
// in-flight query. Outside transactions callers may read their initial inputs in parallel.
export const loadMonthlyPayrollEmployees = async (employees: any[], yearMonth: string, database: any, transaction?: any): Promise<any[]> => {
    const result: any[] = [];
    for (const employee of employees) {
        const ref = database.collection('payrollReviews').doc(payrollReviewDocumentId(employee.id, yearMonth));
        const snapshot = transaction ? await transaction.get(ref) : await ref.get();
        const reviewed=withMonthlyPayrollReview(employee,yearMonth,snapshot.exists?snapshot.data() as StoredPayrollReview:null,snapshot.exists);const effective=await effectiveMasterForMonth(database,transaction,{...reviewed,legacyPayrollSourceKey:employeePayrollSourceKey(employee)},yearMonth,snapshot.exists?snapshot.data():null);if(effective.normalPayDays){const {compNormalPayEvidence}=await import('./compWorkflow');effective.normalPayCompEvidence=await compNormalPayEvidence(database,transaction,employee.id,yearMonth);const {loadInsuranceEvidence}=await import('./insuranceTimeline');const insurance=await loadInsuranceEvidence(database,transaction,employee.id);effective.insurancePeriods=insurance.periods;effective.insuranceSource=insurance.source;}result.push(await withEmploymentAuthority(database,transaction,effective));
    }
    return result;
};
