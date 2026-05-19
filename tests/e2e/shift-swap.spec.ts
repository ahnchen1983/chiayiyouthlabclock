import { expect, test } from '@playwright/test';
import { mockApi, scheduleDate } from './helpers/apiMock';
import { employeeUser, seedSession } from './helpers/session';

test('employee can view shift swap list', async ({ page }) => {
  await seedSession(page, employeeUser);
  await mockApi(page);
  await page.goto('/');

  await page.getByRole('button', { name: '換班' }).click();

  await expect(page.getByRole('heading', { name: '換班申請' })).toBeVisible();
  await expect(page.getByText(`${scheduleDate} ⇄ 換班同事 ${scheduleDate}`)).toBeVisible();
  await expect(page.getByText('等對方確認')).toBeVisible();
});
