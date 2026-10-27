import {test,expect,type Page} from '@playwright/test';
import {seedSession,employeeUser,adminUser} from './helpers/session';
import {mockApi} from './helpers/apiMock';
// Synthetic mock backend only; dates are not a real roster.
const submitted=(extra:any={})=>({id:'EMP001_2026-08',empId:'EMP001',yearMonth:'2026-08',status:'submitted',revision:1,regularHolidays:['2026-08-02'],restDays:['2026-08-01'],warnings:['月內有連續7日沒有例假，請核對週期'],submittedBy:'EMP001',submittedAt:'2026-08-01T00:00:00Z',onBehalf:false,history:[{actor:'EMP001',at:'2026-08-01T00:00:00Z',to:'submitted',reason:null}],...extra});
async function setup(page:Page,admin:boolean,list:any[]=[]){const user=admin?adminUser:employeeUser;await seedSession(page,user as any);await mockApi(page,{user:user as any});const writes:any[]=[];
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();
  if(b.action==='get-my-staff-preference')return route.fulfill({json:{empId:user.id,blockedWeekdays:[],blockedDates:[],preferredDates:[]}});
  if(b.action==='get-daytype-designation')return route.fulfill({json:{empId:b.empId||user.id,yearMonth:b.yearMonth,designation:null,calendar:null,headRevision:0,canReview:false}});
  if(b.action==='list-daytype-designations')return route.fulfill({json:{yearMonth:b.yearMonth,designations:list}});
  if(['submit-daytype-designation','review-daytype-designation'].includes(b.action)){writes.push(b);return route.fulfill({json:{status:'submitted'}});}
  return route.fallback();});
 await page.goto('/');if(await page.getByRole('button',{name:'開啟選單'}).isVisible())await page.getByRole('button',{name:'開啟選單'}).click();
 await page.getByRole('button',{name:admin?'例假／休息日核定':'偏好設定',exact:true}).click();await page.getByLabel('月份').fill('2026-08');return writes;}
test('employee designates own 例假／休息日 for a month and a double click sends once',async({page})=>{const writes=await setup(page,false);
 await expect(page.getByText(/尚無核定日別，計薪日別待核/)).toBeVisible();
 await page.getByLabel('新增例假日期').fill('2026-08-02');await page.getByRole('button',{name:'加入例假'}).click();
 await expect(page.getByText(/未指定任何休息日/)).toBeVisible();
 await page.getByLabel('新增休息日日期').fill('2026-08-01');await page.getByRole('button',{name:'加入休息日'}).click();
 await page.getByRole('button',{name:'送出本月例假／休息日'}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({empId:'EMP001',yearMonth:'2026-08',regularHolidays:['2026-08-02'],restDays:['2026-08-01'],expectedRevision:0});expect(writes[0].approvedBy).toBeUndefined();});
test('same date cannot be both 例假 and 休息日',async({page})=>{await setup(page,false);for(const l of ['例假','休息日']){await page.getByLabel('新增'+l+'日期').fill('2026-08-03');await page.getByRole('button',{name:'加入'+l}).click();}
 await expect(page.getByRole('alert').filter({hasText:'同時是例假與休息日'})).toBeVisible();await expect(page.getByRole('button',{name:'送出本月例假／休息日'})).toBeDisabled();});
test('admin approval needs reason, remaining-normal confirmation and warning acknowledgement',async({page})=>{const writes=await setup(page,true,[submitted()]);const approve=page.getByRole('button',{name:'核定日別'});
 await expect(approve).toBeDisabled();await page.getByLabel('核定／退回原因（至少5字）').fill('已核對八月班表');await expect(approve).toBeDisabled();
 await page.getByLabel('我確認其餘未指定日期為一般工作日').check();await expect(approve).toBeDisabled();await page.getByLabel('我已核對上述法遵提醒').check();
 await page.getByLabel('新增國定假日日期').fill('2026-08-08');await page.getByRole('button',{name:'加入國定假日'}).click();await approve.click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'review-daytype-designation',empId:'EMP001',mode:'approve',expectedRevision:1,confirmRemainingNormal:true,acknowledgeWarnings:true,nationalHolidays:['2026-08-08']});});
test('an admin cannot approve their own designation',async({page})=>{await setup(page,true,[submitted({id:'ADMIN_2026-08',empId:'ADMIN',submittedBy:'ADMIN'})]);await expect(page.getByText(/需由另一位管理者核定/)).toBeVisible();await expect(page.getByRole('button',{name:'核定日別'})).toHaveCount(0);});
