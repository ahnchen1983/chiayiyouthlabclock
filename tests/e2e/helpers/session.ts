import type { Page } from '@playwright/test';
import { UserRole } from '../../../types';

export const employeeUser = {
  id: 'EMP001',
  name: '測試員工',
  role: UserRole.Employee,
  position: '兼職人員' as const,
};

export const peerUser = {
  id: 'EMP002',
  name: '換班同事',
  role: UserRole.Employee,
  position: '兼職人員' as const,
};

export const adminUser = {
  id: 'ADMIN',
  name: '測試管理員',
  role: UserRole.SuperAdmin,
  position: '專責人員' as const,
};

export type E2EUser = typeof employeeUser | typeof peerUser | typeof adminUser;

export const seedSession = async (page: Page, user: E2EUser) => {
  await page.addInitScript(value => {
    window.sessionStorage.setItem('user', JSON.stringify(value));
  }, user);
};
