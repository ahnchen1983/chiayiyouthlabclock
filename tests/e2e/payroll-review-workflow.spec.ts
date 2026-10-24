import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { adminUser, seedSession } from './helpers/session';
import { employee, month, review } from '../fixtures/payrollV2';
import { LeaveStatus, LeaveType, UserRole } from '../../types';

const readySalary = { empId: employee.id, name: employee.name, position: '兼職人員', yearMonth: month,
    totalWorkDays: 1, totalWorkHours: 8, totalLeaveHours: 0, leaveDetails: [], overtimeHours: 0,
    baseSalary: 1600, overtimePay: 0, grossSalary: 1600, laborInsurance: 0, healthInsurance: 0, laborPensionSelf: 0,
    leaveDeduction: 0, totalDeductions: 0, netSalary: 1600, calculationStatus: 'ready', reviewReasons: [], policyVersion: review.policy.version };

const setup = async (page: Page, { locked = false, leave = null as any, role = UserRole.SuperAdmin, savedReview = undefined as any, gaps = [] as any[] } = {}) => {
    const user = { ...adminUser, role };
    await seedSession(page, user as any); await mockApi(page, { user: user as any });
    let reviewBody: any, allocationBody: any;
    let monthLocked = locked;
    let lockHeld = false;
    let lockRequested = false;
    let releaseLock: (() => void) | undefined;
    const monthlyReviews = new Map<string, any>(savedReview ? [[savedReview.yearMonth, savedReview]] : []);
    let release: (() => void) | undefined;
    let hold = false;
    await page.route('**/.netlify/functions/api', async route => {
        const body = route.request().postDataJSON();
        if (body.action === 'get-all-salary-details') return route.fulfill({ json: [{ ...readySalary, yearMonth: body.yearMonth, calculationStatus: monthLocked ? 'locked' : 'ready' }] });
        if (body.action === 'get-month-lock') return route.fulfill({ json: monthLocked ? { yearMonth: body.yearMonth, lockedByName: '合成覆核者', lockedAt: review.reviewedAt, payrollRunId: 'synthetic' } : null });
        if (body.action === 'lock-month') {
            lockRequested = true;
            if (lockHeld) await new Promise<void>(resolve => { releaseLock = resolve; });
            monthLocked = true;
            return route.fulfill({ json: { yearMonth: body.yearMonth, lockedByName: '合成覆核者', lockedAt: review.reviewedAt, payrollRunId: 'synthetic' } });
        }
        if (body.action === 'get-payroll-review-inputs') return route.fulfill({ json: { employees: [{ ...employee, employeeSourceKey: 'synthetic-employee-basis', payrollReview: monthlyReviews.get(body.yearMonth), role: UserRole.Employee, status: '在職', hireDate: '2026-01-01' }], leaves: leave ? [leave] : [], scheduleGaps: gaps, locked } });
        if (body.action === 'review-payroll-inputs') {
            reviewBody = body;
            if (hold) await new Promise<void>(resolve => { release = resolve; });
            savedReview = { ...body.review, reviewedBy: user.id, reviewedAt: review.reviewedAt };
            monthlyReviews.set(body.review.yearMonth, savedReview);
            return route.fulfill({ json: true });
        }
        if (body.action === 'review-leave-allocation') {
            allocationBody = body; leave = { ...leave, payrollAllocations: body.allocations };
            return route.fulfill({ json: true });
        }
        await route.fallback();
    });
    await page.goto('/');
    if (role === UserRole.SuperAdmin) {
        await page.getByRole('button', { name: '薪資計算', exact: true }).click();
        await page.getByLabel('薪資月份').fill(month);
    }
    return { getReview: () => reviewBody, getAllocation: () => allocationBody, holdSave: () => { hold = true; }, releaseSave: () => release?.(), holdLock: () => { lockHeld = true; }, getLockRequested: () => lockRequested, releaseLock: () => releaseLock?.() };
};

test('explicit policy submission preserves cents and blocks month locking during save', async ({ page }) => {
    const state = await setup(page);
    await page.getByRole('button', { name: '覆核計薪資料', exact: true }).click();
    await expect(page.getByLabel('政策版本／依據')).toHaveValue('');
    await expect(page.getByRole('button', { name: '儲存計薪覆核', exact: true })).toBeDisabled();
    await page.getByLabel('政策版本／依據').fill('synthetic-reviewed-policy');
    await page.getByLabel('結算金額精度', { exact: true }).selectOption('2');
    await page.getByLabel(`一般工作日 ${month}-01`, { exact: true }).check();
    await page.getByLabel('特休給薪比例', { exact: true }).fill('100');
    await page.getByLabel('勞保自付額', { exact: true }).fill('123.25');
    await page.getByLabel('健保自付額', { exact: true }).fill('0');
    await page.getByLabel('勞退自提額', { exact: true }).fill('0');
    await page.getByRole('button', { name: '新增加班級距', exact: true }).click();
    await page.getByLabel('加班級距 1 分鐘', { exact: true }).fill('120');
    await page.getByLabel('加班級距 1 倍率分子', { exact: true }).fill('4');
    await page.getByLabel('加班級距 1 倍率分母', { exact: true }).fill('3');
    await page.getByRole('checkbox', { name: '我已逐項核對本月公司政策、一般工作日與個人保費', exact: true }).check();
    state.holdSave();
    await page.getByRole('button', { name: '儲存計薪覆核', exact: true }).click();
    await expect.poll(() => state.getReview()).toBeTruthy();
    await expect(page.getByLabel('薪資月份')).toBeDisabled();
    await expect(page.getByRole('button', { name: /結算並鎖定/ })).toBeDisabled();
    state.releaseSave();
    await expect(page.getByRole('status').filter({ hasText: '計薪覆核已儲存' })).toBeVisible();
    expect(state.getReview().review).toMatchObject({ yearMonth: month, policy: { version: 'synthetic-reviewed-policy', regularDates: [`${month}-01`], moneyDecimals: 2, hourlyLeavePaidFraction: { [LeaveType.Annual]: 1 }, overtimeTiers: [{ minutes: 120, numerator: 4, denominator: 3 }] }, insurance: { labor: 123.25, health: 0, pensionSelf: 0 } });
    expect(state.getReview().review).not.toHaveProperty('reviewedBy');
    expect(state.getReview().expectedEmployeeSourceKey).toBe('synthetic-employee-basis');
    await expect(page.getByLabel('薪資月份')).toBeEnabled();
    await page.screenshot({ path: 'test-results/payroll-review-panel-bottom.png' });
    await page.getByRole('heading', { name: `${month} 計薪資料覆核`, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/payroll-review-panel-top.png' });
});

test('overnight approved leave can be allocated exactly across midnight', async ({ page }) => {
    const leave = { id: 'MIDNIGHT', empId: employee.id, name: employee.name, leaveType: LeaveType.Annual, status: LeaveStatus.Approved,
        startDate: `${month}-01T22:00`, endDate: `${month}-02T02:00`, hours: 4, reason: 'synthetic approved leave', requestDate: `${month}-01` };
    const state = await setup(page, { leave });
    await page.getByRole('button', { name: '覆核計薪資料', exact: true }).click();
    await page.getByLabel('請假日期 1', { exact: true }).fill(`${month}-01`);
    await page.getByLabel('請假開始 1', { exact: true }).fill('22:00');
    await page.getByLabel('請假結束 1', { exact: true }).fill('24:00');
    await page.getByRole('button', { name: '新增請假時段', exact: true }).click();
    await page.getByLabel('請假日期 2', { exact: true }).fill(`${month}-02`);
    await page.getByLabel('請假開始 2', { exact: true }).fill('00:00');
    await page.getByLabel('請假結束 2', { exact: true }).fill('02:00');
    await page.getByRole('checkbox', { name: '我已核對核准假單與逐日時段', exact: true }).check();
    await page.getByRole('button', { name: '儲存請假時段', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '請假時段已儲存' })).toBeVisible();
    expect(state.getAllocation()).toMatchObject({ requestId: 'MIDNIGHT', allocations: [{ date: `${month}-01`, from: '22:00', to: '24:00', minutes: 120 }, { date: `${month}-02`, from: '00:00', to: '02:00', minutes: 120 }] });
});

test('a confirmed schedule gap is submitted with its current evidence key', async ({ page }) => {
    const state = await setup(page, { savedReview: review, gaps: [{ empId: employee.id, date: `${month}-01`, sourceKey: 'synthetic-current-evidence', scheduledMinutes: 480, coveredMinutes: 180 }] });
    await page.getByRole('button', { name: '覆核計薪資料', exact: true }).click();
    await page.getByLabel(`排班差異原因 ${month}-01`, { exact: true }).fill('已確認下午未出勤，不補算班表工時');
    await page.getByLabel(`確認排班差異 ${month}-01`, { exact: true }).check();
    await page.getByRole('checkbox', { name: '我已逐項核對本月公司政策、一般工作日與個人保費', exact: true }).check();
    await page.getByRole('button', { name: '儲存計薪覆核', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '計薪覆核已儲存' })).toBeVisible();
    expect(state.getReview().review.scheduleExceptions).toEqual([{ date: `${month}-01`, reason: '已確認下午未出勤，不補算班表工時', sourceKey: 'synthetic-current-evidence' }]);
});

test('locked month is read-only and ordinary admin has no policy editor', async ({ page }) => {
    await setup(page, { locked: true, savedReview: review });
    await page.getByRole('button', { name: '覆核計薪資料', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '本月已鎖定' })).toBeVisible();
    await expect(page.getByLabel('政策版本／依據')).toBeDisabled();
    await expect(page.getByRole('button', { name: '儲存計薪覆核', exact: true })).toBeDisabled();
});

test('ordinary admin cannot open the policy editor', async ({ page }) => {
    await setup(page, { role: UserRole.Admin });
    await expect(page.getByRole('button', { name: '薪資計算', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '覆核計薪資料', exact: true })).toHaveCount(0);
});

test('reviewing another month preserves the previous month form and scope', async ({ page }) => {
    const state = await setup(page, { savedReview: review });
    await page.getByRole('button', { name: '覆核計薪資料', exact: true }).click();
    await expect(page.getByLabel('政策版本／依據')).toHaveValue(review.policy.version);
    await page.getByLabel('薪資月份').fill('2026-05');
    await expect(page.getByLabel('政策版本／依據')).toHaveValue('');
    await page.getByRole('checkbox', { name: '本月為非受薪系統帳號，排除計薪', exact: true }).check();
    await page.getByLabel('排除原因', { exact: true }).fill('合成測試帳號五月不參與計薪');
    await page.getByRole('checkbox', { name: '我已確認此帳號本月不參與計薪及排除原因', exact: true }).check();
    await page.getByRole('button', { name: '儲存計薪覆核', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '計薪覆核已儲存' })).toBeVisible();
    expect(state.getReview().review.yearMonth).toBe('2026-05');
    await page.getByLabel('薪資月份').fill(month);
    await expect(page.getByLabel('政策版本／依據')).toHaveValue(review.policy.version);
    await expect(page.getByRole('checkbox', { name: '本月為非受薪系統帳號，排除計薪', exact: true })).not.toBeChecked();
});

test('same-page settlement immediately makes the mounted review form read-only', async ({ page }) => {
    const state = await setup(page, { savedReview: review });
    await page.getByRole('button', { name: '覆核計薪資料', exact: true }).click();
    await expect(page.getByLabel('政策版本／依據')).toBeEnabled();
    state.holdLock();
    page.once('dialog', async dialog => { await dialog.accept(); });
    await page.getByRole('button', { name: /結算並鎖定/ }).click();
    await expect.poll(() => state.getLockRequested()).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: '本月正在結算' })).toBeVisible();
    await expect(page.getByLabel('政策版本／依據')).toBeDisabled();
    page.once('dialog', async dialog => { await dialog.accept(); });
    state.releaseLock();
    await expect(page.getByRole('status').filter({ hasText: '本月已鎖定' })).toBeVisible();
    await expect(page.getByLabel('政策版本／依據')).toBeDisabled();
    await expect(page.getByRole('button', { name: '儲存計薪覆核', exact: true })).toBeDisabled();
});

test('pending resolution restores trial completeness but formal settlement stays blocked', async ({ page }) => {
    await setup(page);
    let blocked = true;
    await page.route('**/.netlify/functions/api', async route => {
        const body = route.request().postDataJSON();
        if (body.action !== 'get-all-salary-details') return route.fallback();
        return route.fulfill({ json: [{ ...readySalary,
            calculationStatus: blocked ? 'needs-review' : 'ready',
            reviewReasons: blocked ? ['補卡 SYNTH-PENDING 待處理，不能月結'] : [],
            preflight: { status: 'BLOCKED', trialStatus: blocked ? 'BLOCKED' : 'READY', scope: 'existing-models', version: 'preflight-v1', issues: [], gaps: ['OT_COMP_REQUEST_MODEL'] },
        }] });
    });
    await page.getByLabel('薪資月份').fill('2026-05');
    await expect(page.getByRole('status').filter({ hasText: '月結預檢：BLOCKED' })).toBeVisible();
    await expect(page.getByText('補卡 SYNTH-PENDING 待處理，不能月結', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /結算並鎖定/ })).toBeDisabled();
    blocked = false;
    await page.getByLabel('薪資月份').fill(month);
    await expect(page.getByRole('status').filter({ hasText: '試算完整度：READY' })).toBeVisible();
    await expect(page.getByRole('button', { name: /結算並鎖定/ })).toBeDisabled();
    await expect(page.getByText(/READY 不代表已核准正式發薪/)).toBeVisible();
});
