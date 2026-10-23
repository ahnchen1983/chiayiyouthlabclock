import { expect, test } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { adminUser, employeeUser, seedSession } from './helpers/session';

test('overnight split work can record a break after midnight', async ({ page }) => {
    await seedSession(page, adminUser);
    await mockApi(page, { user: adminUser });
    let updateRequests = 0;
    let updatedIntervals: unknown;
    const record = {
        id: 'synthetic-overnight', empId: employeeUser.id, name: employeeUser.name,
        date: '2026-10-22', clockInTime: '22:00', clockOutTime: '06:00',
        clockInAt: '2026-10-22T22:00:00+08:00', clockOutAt: '2026-10-23T06:00:00+08:00',
        workHours: null, status: '正常', verificationMethod: 'IP', verificationData: 'synthetic',
    };
    await page.route('**/.netlify/functions/api', async route => {
        const body = route.request().postDataJSON();
        if (body.action === 'get-all-clock-records') return route.fulfill({ json: [record] });
        if (body.action === 'update-clock-record') { updateRequests++; updatedIntervals = body.workIntervals; return route.fulfill({ json: true }); }
        if (body.action === 'get-admin-overview') return route.fulfill({ json: {} });
        await route.fallback();
    });
    await page.goto('/');
    await page.getByRole('button', { name: '出勤紀錄', exact: true }).click();
    await page.getByTitle('修改打卡', { exact: true }).click();
    await page.getByRole('checkbox', { name: '我已核實以下實際工作時段（排除未工作休息）' }).check();
    await page.getByLabel('已核實工作時段').fill('22:00-02:00+1,03:00+1-06:00+1');
    let alert = '';
    page.once('dialog', async dialog => { alert = dialog.message(); await dialog.dismiss(); });
    await page.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(page.getByRole('heading', { name: '修改打卡紀錄', exact: true })).toBeHidden();
    expect(alert).toBe('');
    expect(updateRequests).toBe(1);
    expect(updatedIntervals).toEqual([{ start: 1320, end: 1560 }, { start: 1620, end: 1800 }]);
});
