import { expect, test } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { employeeUser, adminUser, seedSession } from './helpers/session';
// V1 route A: salaries are paid outside the system, so every in-system figure is a trial.
const salary = {empId:employeeUser.id,name:employeeUser.name,position:'兼職人員',yearMonth:'2026-04',totalWorkDays:1,totalWorkHours:4,totalLeaveHours:0,leaveDetails:[],overtimeHours:0,baseSalary:800,overtimePay:0,grossSalary:800,laborInsurance:0,healthInsurance:0,laborPensionSelf:0,leaveDeduction:0,totalDeductions:0,netSalary:800,calculationStatus:'ready',reviewReasons:[]};
test('employee salary page and printed payslip both say trial, not a payment basis',async({page})=>{
 await seedSession(page,employeeUser);await mockApi(page);
 await page.route('**/.netlify/functions/api',async route=>{if(route.request().postDataJSON().action==='get-employee-salary')return route.fulfill({json:salary});await route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:'薪資明細',exact:true}).click();
 await expect(page.getByRole('note')).toContainText('不作為發薪依據');
 const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'下載 / 列印薪資條'}).click();const slip=await popup;
 await expect(slip.locator('h1')).toContainText('試算');await expect(slip).toHaveTitle(/試算/);
});
test('admin salary calculation page shows the trial notice',async({page})=>{
 await seedSession(page,adminUser as any);await mockApi(page,{user:adminUser as any});await page.goto('/');
 if(await page.getByRole('button',{name:'開啟選單'}).isVisible())await page.getByRole('button',{name:'開啟選單'}).click();
 await page.getByRole('button',{name:'薪資計算',exact:true}).click();await expect(page.getByRole('note').filter({hasText:'不作為發薪依據'})).toBeVisible();
});
