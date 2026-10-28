import {test,expect,type Page} from '@playwright/test';
import {mockApi} from './helpers/apiMock';
import {seedSession,employeeUser,adminUser} from './helpers/session';
const bytes=Buffer.from('%PDF-1.4\nsynthetic attachment only\n%%EOF');
const file={name:'synthetic.pdf',mimeType:'application/pdf',buffer:bytes};
async function setup(page:Page,options:{disabled?:boolean;blockedScan?:boolean;abortUpload?:boolean;admin?:boolean;submitted?:boolean}={}){
 await seedSession(page,options.admin?adminUser:employeeUser);await mockApi(page,{user:options.admin?adminUser:employeeUser});
 let draft:any=null,items:any[]=[],aborted=false;const writes:any[]=[],receipts=new Map<string,any>();
 if(options.submitted)items=[{id:'A1',draftId:'D1',requestId:'M1',owner:employeeUser.id,name:'synthetic.pdf',mime:'application/pdf',size:bytes.length,sha256:'a'.repeat(64),status:'ready',uploadComplete:true,scan:{verdict:'clean',engine:'synthetic',version:'v1'},revision:3}];
 const request:any={id:'M1',empId:employeeUser.id,name:employeeUser.name,date:'2026-08-01',type:'下班',requestedClockOut:'18:00',recordId:'C1',reason:'合成已送附件申請',status:'待審核',schemaVersion:'makeup-request-v1',revision:1,history:[],attachments:items.map(m=>({id:m.id,revision:m.revision,sha256:m.sha256,mime:m.mime,size:m.size}))};
 await page.route('**/.netlify/functions/api',async route=>{
  const b=route.request().postDataJSON(),reply=(json:any)=>route.fulfill({json});
  if(b.action==='get-makeup-attachment-capability')return reply({enabled:!options.disabled,mode:options.disabled?'disabled':'test-adapter',reason:options.disabled?'私有儲存與安全掃描尚未配置，附件功能停用':'',productionConfigured:false,policy:options.disabled?null:{version:'synthetic-required-policy',required:true,maxFiles:2,maxBytes:1024,allowedMime:['application/pdf']},technicalLimits:{bytes:2097152,files:5,grantSeconds:60}});
  if(['get-employee-makeup-requests','get-makeup-requests'].includes(b.action))return reply(options.submitted?[request]:[]);
  if(b.action==='list-makeup-attachments')return reply({draft:b.draftId?draft:undefined,items});
  if(b.action==='create-makeup-attachment-draft'){writes.push(b);draft=draft||{id:'D1',date:b.date,revision:1,status:'draft'};return reply(draft);}
  if(b.action==='upload-makeup-attachment'){
   writes.push(b);if(receipts.has(b.operationId))return reply(receipts.get(b.operationId));
   const m={id:'A1',draftId:draft.id,requestId:null,owner:employeeUser.id,name:b.name,mime:b.mime,size:bytes.length,sha256:'a'.repeat(64),status:options.blockedScan?'rejected':'ready',uploadComplete:true,scan:{verdict:options.blockedScan?'blocked':'clean',engine:'synthetic-only',version:'v1'},revision:2};items=[m];draft.revision=2;receipts.set(b.operationId,m);
   if(options.abortUpload&&!aborted){aborted=true;return route.abort();}return reply(m);
  }
  if(b.action==='withdraw-makeup-attachment'){writes.push(b);items=items.map(m=>({...m,status:'removed',revision:3}));draft.revision=3;return reply(items[0]);}
  if(b.action==='submit-makeup-version'){writes.push(b);draft.status='submitted';return reply({...request,id:'M2'});}
  if(b.action==='issue-makeup-attachment-access'){writes.push(b);return reply({accessToken:'synthetic-in-memory-access',expiresAt:Date.now()+60000});}
  if(b.action==='download-makeup-attachment'){writes.push(b);return reply({name:'synthetic.pdf',mime:'application/pdf',size:bytes.length,contentBase64:bytes.toString('base64'),disposition:'attachment'});}
  return route.fallback();
 });
 await page.goto('/');if(options.admin)await page.getByRole('button',{name:'補打卡審核',exact:true}).click();else await page.getByRole('button',{name:'補打卡',exact:true}).click();return {writes};
}
const draft=async(page:Page)=>{await page.getByRole('button',{name:'建立私有附件草稿',exact:true}).click();await expect(page.getByText(/草稿 D1/)).toBeVisible();};
const upload=async(page:Page)=>{await page.getByLabel('選取私有附件').setInputFiles(file);await page.getByRole('button',{name:'上傳並安全掃描',exact:true}).click();};
test('unconfigured production capability disables upload and new submission without fake pass',async({page})=>{
 const {writes}=await setup(page,{disabled:true});await expect(page.getByText('私有儲存與安全掃描尚未配置，附件功能停用')).toBeVisible();await expect(page.getByRole('button',{name:'建立私有附件草稿',exact:true})).toBeDisabled();await page.getByLabel('上班時間（當日）',{exact:true}).fill('09:00');await page.getByLabel('申請理由',{exact:true}).fill('合成未配置不得提交');await expect(page.getByRole('button',{name:'送出申請',exact:true})).toBeDisabled();expect(writes).toHaveLength(0);
});
test('required clean attachment binds draft revision and double click uploads once',async({page})=>{
 const {writes}=await setup(page);await page.getByLabel('上班時間（當日）',{exact:true}).fill('09:00');await page.getByLabel('申請理由',{exact:true}).fill('合成必附申請理由');await expect(page.getByRole('button',{name:'送出申請',exact:true})).toBeDisabled();await draft(page);await page.getByLabel('選取私有附件').setInputFiles(file);await page.getByRole('button',{name:'上傳並安全掃描',exact:true}).dblclick();await expect(page.getByText('上傳 完成／掃描 clean')).toBeVisible();await page.getByRole('button',{name:'送出申請',exact:true}).click();await expect(page.getByRole('status')).toContainText('申請已送出');expect(writes.filter(w=>w.action==='upload-makeup-attachment')).toHaveLength(1);expect(writes.find(w=>w.action==='submit-makeup-version')).toMatchObject({attachmentDraftId:'D1',expectedAttachmentDraftRevision:2});
});
test('scan rejection and oversized file never enable required submission',async({page})=>{
 const {writes}=await setup(page,{blockedScan:true});await draft(page);await page.getByLabel('選取私有附件').setInputFiles({...file,buffer:Buffer.alloc(1025)});await page.getByRole('button',{name:'上傳並安全掃描',exact:true}).click();await expect(page.getByRole('alert')).toContainText('超過已核政策大小');expect(writes.filter(w=>w.action==='upload-makeup-attachment')).toHaveLength(0);await upload(page);await expect(page.getByText('上傳 完成／掃描 blocked')).toBeVisible();await expect(page.getByRole('button',{name:'送出申請',exact:true})).toBeDisabled();
});
test('unacknowledged upload survives reload without persisting bytes and retries exact ID after reselecting original',async({page})=>{
 const {writes}=await setup(page,{abortUpload:true});await draft(page);await upload(page);await expect(page.getByRole('button',{name:'重試原附件上傳',exact:true})).toBeVisible();const stored=await page.evaluate(()=>Object.values(sessionStorage).join(''));expect(stored).not.toContain(bytes.toString('base64'));await page.reload();await page.getByRole('button',{name:'補打卡',exact:true}).click();await expect(page.getByRole('button',{name:'重試原附件上傳',exact:true})).toBeDisabled();await page.getByLabel('選取私有附件').setInputFiles(file);await page.getByRole('button',{name:'重試原附件上傳',exact:true}).click();await expect(page.getByRole('button',{name:'重試原附件上傳',exact:true})).toHaveCount(0);const attempts=writes.filter(w=>w.action==='upload-makeup-attachment');expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
});
test('withdrawal needs reason and retains removed history while blocking required submission',async({page})=>{
 const {writes}=await setup(page);await draft(page);await upload(page);await expect(page.getByRole('button',{name:'撤除草稿附件 synthetic.pdf',exact:true})).toBeDisabled();await page.getByLabel('撤除附件原因').fill('合成誤選撤除理由');await page.getByRole('button',{name:'撤除草稿附件 synthetic.pdf',exact:true}).click();await expect(page.getByText(/synthetic.pdf.*removed/)).toBeVisible();await expect(page.getByRole('button',{name:'送出申請',exact:true})).toBeDisabled();expect(writes.find(w=>w.action==='withdraw-makeup-attachment')).toMatchObject({expectedRevision:2,expectedDraftRevision:2,reason:'合成誤選撤除理由'});
});
test('manager sees submitted private metadata and downloads through fresh access without removal control',async({page})=>{
 const {writes}=await setup(page,{admin:true,submitted:true});await expect(page.getByText(/synthetic.pdf.*ready/)).toBeVisible();await expect(page.getByRole('button',{name:/撤除草稿附件/})).toHaveCount(0);const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下載 synthetic.pdf',exact:true}).click();expect((await downloaded).suggestedFilename()).toBe('synthetic.pdf');expect(writes.map(w=>w.action)).toEqual(['issue-makeup-attachment-access','download-makeup-attachment']);
});
test('date mismatch retains draft and prevents linking to a different request date on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await draft(page);await upload(page);await page.getByLabel('補打卡日期',{exact:true}).fill('2026-08-02');await expect(page.getByText('附件草稿日期與申請不同，不可提交；保留原草稿或改回日期。')).toBeVisible();await expect(page.getByRole('button',{name:'送出申請',exact:true})).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
