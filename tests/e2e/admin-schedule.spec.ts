import { expect, test } from '@playwright/test';
import { mockApi, scheduleDate } from './helpers/apiMock';
import { adminUser, seedSession } from './helpers/session';

test('admin sees staff preference warning in schedule modal', async ({ page }) => {
  let updated = false;
  await seedSession(page, adminUser);
  await mockApi(page, { user: adminUser, onUpdateSchedule: () => { updated = true; } });
  await page.goto('/');

  await page.getByRole('button', { name: '排班管理' }).click();
  await page.getByText(scheduleDate.slice(-2).replace(/^0/, ''), { exact: true }).click();
  await expect(page.getByText(new RegExp(`編輯 ${scheduleDate}`))).toBeVisible();
  await expect(page.getByText('偏好不上班')).toBeVisible();

  await page.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(page.getByText(new RegExp(`編輯 ${scheduleDate}`))).toBeHidden();
  expect(updated).toBe(true);
});
