import {test,expect,type Page} from '@playwright/test';
import {seedSession,adminUser,employeeUser} from './helpers/session';
import {mockApi} from './helpers/apiMock';
// Synthetic mock backend only.
const proposal=(proposedBy:string)=>({id:'ppp_1',status:'proposed',revision:1,employeeIds:[employeeUser.id],from:'2026-08-01',to:'2026-12-31',otherLeave:null,proposedBy,reason:'建立八月起計薪政策',history:[]});
async function setup(page:Page,proposals:any[]=[]){await seedSession(page,adminUser);await mockApi(page,{user:adminUser});const writes:any[]=[];
 await page.route('**/.netlify/functions/api',async route=>{const b=route.request().postDataJSON();
  if(b.action==='list-payroll-policy-versions')return route.fulfill({json:{versions:[],proposals}});
  if(b.action==='get-all-employees')return route.fulfill({json:[{id:employeeUser.id,name:employeeUser.name,role:employeeUser.role}]});
  if(['propose-payroll-policy-version','review-payroll-policy-version'].includes(b.action)){writes.push(b);return route.fulfill({json:{status:'ok'}});}
  return route.fallback();});
 await page.goto('/');if(await page.getByRole('button',{name:'開啟選單'}).isVisible())await page.getByRole('button',{name:'開啟選單'}).click();await page.getByRole('button',{name:'計薪政策版本',exact:true}).click();return writes;}
test('fixed rules are shown read-only and a proposal sends only scope fields',async({page})=>{const writes=await setup(page);await expect(page.getByText('星期日至星期六')).toBeVisible();await expect(page.getByText('只在最後合計四捨五入到整數元')).toBeVisible();
 await page.getByText('提出新政策版本').click();await page.getByLabel(new RegExp(employeeUser.name)).check();await page.getByLabel('生效起日').fill('2026-08-01');await page.getByLabel('生效迄日').fill('2026-12-31');await page.getByLabel('提出原因（至少5字）').first().fill('建立八月起計薪政策');
 await page.getByRole('button',{name:'送出政策提案'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'propose-payroll-policy-version',employeeIds:[employeeUser.id],from:'2026-08-01',to:'2026-12-31',otherLeave:null});expect(writes[0].normalPay).toBeUndefined();expect(writes[0].rounding).toBeUndefined();});
test('a different admin approves a pending proposal',async({page})=>{const writes=await setup(page,[proposal('OTHER_ADMIN')]);await page.getByLabel('核定／退回原因（至少5字）').fill('核對計薪政策');await page.getByRole('button',{name:'核定政策版本'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'review-payroll-policy-version',proposalId:'ppp_1',expectedRevision:1,mode:'approve'});});
test('the proposer sees that another admin must approve',async({page})=>{await setup(page,[proposal(adminUser.id)]);await expect(page.getByText('自己提出的政策需由另一位管理者核定。')).toBeVisible();await expect(page.getByRole('button',{name:'核定政策版本'})).toHaveCount(0);});
