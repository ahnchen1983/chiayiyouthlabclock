import { expect, test } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { employeeUser, seedSession } from './helpers/session';
// Synthetic salary: untaken comp time settled at the original day's rate.
const salary={empId:employeeUser.id,name:employeeUser.name,position:'兼職人員',yearMonth:'2026-12',totalWorkDays:1,totalWorkHours:9,totalLeaveHours:0,leaveDetails:[],overtimeHours:1,baseSalary:1600,overtimePay:266.67,compSettlementPay:333.33,grossSalary:2200,laborInsurance:0,healthInsurance:0,laborPensionSelf:0,leaveDeduction:0,totalDeductions:0,netSalary:2200,calculationStatus:'ready',reviewReasons:[]};
test('salary detail and printed payslip show the comp settlement line',async({page})=>{
 await seedSession(page,employeeUser);await mockApi(page);
 await page.route('**/.netlify/functions/api',async route=>{if(route.request().postDataJSON().action==='get-employee-salary')return route.fulfill({json:salary});await route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:'薪資明細',exact:true}).click();
 await expect(page.getByText('補休結清',{exact:true})).toBeVisible();await expect(page.getByText('+$333.33')).toBeVisible();
 const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'下載 / 列印薪資條'}).click();const slip=await popup;await expect(slip.getByText('補休結清')).toBeVisible();
});
