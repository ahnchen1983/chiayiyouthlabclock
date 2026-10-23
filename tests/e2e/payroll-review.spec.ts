import { expect, test } from '@playwright/test';
import { mockApi } from './helpers/apiMock';
import { employeeUser, seedSession } from './helpers/session';
const salary = {empId:employeeUser.id,name:employeeUser.name,position:'兼職人員',yearMonth:'2026-04',totalWorkDays:1,totalWorkHours:4,totalLeaveHours:0.5,leaveDetails:[],overtimeHours:0,baseSalary:806,overtimePay:0,grossSalary:806,laborInsurance:0,healthInsurance:0,laborPensionSelf:0,leaveDeduction:100.75,totalDeductions:100.75,netSalary:705.25,calculationStatus:'ready',reviewReasons:[]};
test('incomplete salary is visibly pending and cannot print as zero', async ({page})=>{
 await seedSession(page,employeeUser);await mockApi(page);
 await page.route('**/.netlify/functions/api',async route=>{if(route.request().postDataJSON().action==='get-employee-salary') return route.fulfill({json:{...salary,calculationStatus:'needs-review',netSalary:null,grossSalary:null,baseSalary:null,totalDeductions:null,totalWorkHours:null,reviewReasons:['實際工作與休息待核實']}});await route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:'薪資明細',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('實際工作與休息待核實');
 await expect(page.getByText('待覆核',{exact:true}).first()).toBeVisible();
 let message='';page.once('dialog',async d=>{message=d.message();await d.dismiss();});await page.getByRole('button',{name:'下載 / 列印薪資條'}).click();expect(message).toContain('待覆核');
});
test('salary screen and printable statement retain identical cents',async({page})=>{
 await seedSession(page,employeeUser);await mockApi(page);
 await page.route('**/.netlify/functions/api',async route=>{if(route.request().postDataJSON().action==='get-employee-salary')return route.fulfill({json:salary});await route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:'薪資明細',exact:true}).click();
 await expect(page.getByText('$705.25',{exact:true}).first()).toBeVisible();
 const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'下載 / 列印薪資條'}).click();
 await expect((await popup).locator('.net')).toContainText('$705.25');
});
