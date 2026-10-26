import {test,expect,type Page} from '@playwright/test';
import {seedSession,adminUser,employeeUser} from './helpers/session';
import {mockApi} from './helpers/apiMock';
// Synthetic mock backend only.
const proposed=(proposedBy:string)=>({id:'ins_1',empId:employeeUser.id,status:'proposed',revision:1,changedMonths:['2026-08'],proposedBy,reason:'登錄八月投保資料',periods:[{from:'2026-08-01',to:'2026-12-31',laborInsured:true,laborSalary:29500,employmentInsured:true,healthInsuredHere:true,healthAmount:29500,healthDependants:1,pensionWage:30300,pensionSelfPercent:6}],history:[]});
async function setup(page:Page,versions:any[]=[]){await seedSession(page,adminUser);await mockApi(page,{user:adminUser});const writes:any[]=[];
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();
  if(b.action==='get-insurance-timeline')return route.fulfill({json:{empId:b.empId,headRevision:0,current:null,versions,canPropose:true}});
  if(['propose-insurance-timeline','review-insurance-timeline'].includes(b.action)){writes.push(b);return route.fulfill({json:{status:'ok'}});}
  return route.fallback();});
 await page.goto('/');if(await page.getByRole('button',{name:'開啟選單'}).isVisible())await page.getByRole('button',{name:'開啟選單'}).click();await page.getByRole('button',{name:'投保資料',exact:true}).click();
 await page.getByLabel('員工編號').fill(employeeUser.id);await page.getByRole('button',{name:'查詢投保資料'}).click();return writes;}
test('a proposal sends grades and flags, never premium amounts',async({page})=>{const writes=await setup(page);await expect(page.getByText(/尚未核定（主檔員工薪資會待核）/)).toBeVisible();
 await page.getByText('提出新的投保資料版本').click();await page.getByLabel('起日 1').fill('2026-08-01');await page.getByLabel('迄日 1').fill('2026-12-31');await page.getByLabel('健保眷屬人數 1').fill('1');await page.getByLabel('勞退月提繳工資 1').fill('30300');await page.getByLabel('勞退自提率% 1').fill('6');await page.getByLabel('提出原因（至少5字）').fill('登錄八月投保資料');
 await page.getByRole('button',{name:'送出投保資料提案'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].periods[0]).toMatchObject({laborSalary:29500,employmentInsured:true,healthAmount:29500,healthDependants:1,pensionWage:30300,pensionSelfPercent:6});expect(writes[0].labor).toBeUndefined();expect(writes[0].periods[0].premium).toBeUndefined();});
test('a different admin approves; the proposer cannot',async({page})=>{const writes=await setup(page,[proposed('OTHER_ADMIN')]);await page.getByLabel('核定／退回原因（至少5字）').fill('核對勞保局資料');await page.getByRole('button',{name:'核定投保資料'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'review-insurance-timeline',versionId:'ins_1',mode:'approve'});});
test('own proposal shows that another admin must approve',async({page})=>{await setup(page,[proposed(adminUser.id)]);await expect(page.getByText('本人資料或自己提出的版本需由另一位管理者核定。')).toBeVisible();await expect(page.getByRole('button',{name:'核定投保資料'})).toHaveCount(0);});
