import { expect, test } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { employeeUser, seedSession } from './helpers/session';

test('employee can clock in and out', async ({ page }) => {
  await seedSession(page, employeeUser);
  await mockApi(page);
  await page.goto('/');

  await expect(page.getByText('即時打卡')).toBeVisible();
  await page.getByRole('button', { name: '上班打卡' }).click();
  await expect(page.getByText('上班打卡成功')).toBeVisible();
  await expect(page.getByText('09:00')).toBeVisible();

  await page.getByRole('button', { name: '下班打卡' }).click();
  await expect(page.getByText('下班打卡成功')).toBeVisible();
  await expect(page.getByText('18:00')).toBeVisible();
});
