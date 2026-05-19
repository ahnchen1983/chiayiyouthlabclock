import { expect, test } from '@playwright/test';
import { mockApi } from './helpers/apiMock';

test('employee can log in', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  await page.getByPlaceholder('帳號').fill('EMP001');
  await page.getByPlaceholder('密碼').fill('test-password');
  await page.getByRole('button', { name: '登入' }).click();

  await expect(page.getByText('員工後台')).toBeVisible();
  await expect(page.getByRole('button', { name: '打卡', exact: true })).toBeVisible();
});
