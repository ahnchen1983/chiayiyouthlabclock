import { expect, test } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { employeeUser, seedSession } from './helpers/session';

const tomorrowAt = (hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
};

test('employee can submit leave request', async ({ page }) => {
  await seedSession(page, employeeUser);
  await mockApi(page);
  await page.goto('/');

  await page.getByRole('button', { name: '請假申請' }).click();
  await expect(page.getByText('本年度事假剩餘')).toBeVisible();
  await page.locator('#startDate').fill(tomorrowAt(9));
  await page.locator('#endDate').fill(tomorrowAt(13));
  await page.locator('#reason').fill('E2E 測試請假');
  await page.getByRole('button', { name: '送出申請' }).click();

  await expect(page.getByText('請假申請已成功送出')).toBeVisible();
});
