import {createHash,randomBytes} from 'node:crypto';
import {UserRole} from '../../../types';
import {validDate} from '../../../utils/attendance';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';
import {getMakeupAttachmentRuntime,getLeaveAttachmentRuntime,ATTACHMENT_TECH_LIMITS,type AttachmentRuntime} from './makeupAttachmentRuntime';
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const validId=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/')&&!['.','..'].includes(v);
const ref=(db:any,col:string,key:string)=>{if(!validId(key))fail(400,'附件識別無效');return db.collection(col).doc(key);};
const read=async(db:any,tx:any,col:string,key:string)=>{const r=ref(db,col,key),s=await(tx?tx.get(r):r.get());if(!s.exists)fail(404,'附件資料不存在');return {...s.data(),id:s.id};};
const actor=async(db:any,tx:any,uid:string)=>{const a=await read(db,tx,'employees',uid);if(![UserRole.Employee,UserRole.Admin,UserRole.SuperAdmin].includes(a.role))fail(403,'無附件權限');return a;};
const own=(a:any,owner:string)=>{if(a.id!==owner)fail(403,'只能處理本人草稿');};
const scope=(a:any,owner:string)=>{if(a.id!==owner&&![UserRole.Admin,UserRole.SuperAdmin].includes(a.role))fail(403,'無權讀取此申請附件');};
const policy=(rt:AttachmentRuntime)=>{
 const p=rt.policy;
 if(!p?.approved||!p.version||typeof p.required!=='boolean'||!Number.isInteger(p.maxFiles)||p.maxFiles<1||p.maxFiles>ATTACHMENT_TECH_LIMITS.files||!Number.isInteger(p.maxBytes)||p.maxBytes<1||p.maxBytes>ATTACHMENT_TECH_LIMITS.bytes||!Array.isArray(p.allowedMime)||!p.allowedMime.length||p.allowedMime.some(m=>!['image/png','image/jpeg','application/pdf'].includes(m)))fail(503,'附件政策未核定，不能提交新版本');
 return p;
};
const enabled=(rt:AttachmentRuntime)=>{const p=policy(rt);if(rt.mode!=='test-adapter'||!rt.storage||!rt.scanner)fail(503,'私有儲存與安全掃描尚未配置，附件功能停用');return p;};
const cleanName=(v:any)=>{if(typeof v!=='string'||!v.trim()||v.length>100||/[\\/\x00-\x1f\x7f]/.test(v)||v.includes('..'))fail(400,'檔名無效');return v.trim();};
const decode=(s:any)=>{if(typeof s!=='string'||s.length>Math.ceil(ATTACHMENT_TECH_LIMITS.bytes/3)*4||!s.length||s.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))fail(400,'檔案編碼或大小無效');const b=Buffer.from(s,'base64');if(b.toString('base64')!==s||b.length>ATTACHMENT_TECH_LIMITS.bytes)fail(400,'檔案編碼或大小無效');return b;};
// Signature screening is not malware scanning. A separate scanner must also pass.
const sniff=(b:Buffer)=>{
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(b.length>=4&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217)return 'image/jpeg';
 if(b.length>=12&&b.subarray(0,5).toString()==='%PDF-'&&b.subarray(-32).toString().includes('%%EOF'))return 'application/pdf';
 return fail(400,'不支援或無法辨識的檔案內容');
};
const publicMeta=(m:any)=>({subjectType:m.subjectType||'makeup',subjectId:m.requestId||m.draftId,id:m.id,draftId:m.draftId,requestId:m.requestId,owner:m.owner,name:m.name,mime:m.mime,size:m.size,sha256:m.sha256,status:m.status,uploadComplete:m.uploadComplete,scan:m.scan,revision:m.revision,createdAt:m.createdAt,updatedAt:m.updatedAt});
const audit=(db:any,tx:any,m:any,uid:string,reason:string)=>tx.create(db.collection('makeupAttachmentEvents').doc(`${m.id}_${m.revision}`),{attachmentId:m.id,draftId:m.draftId,requestId:m.requestId,owner:m.owner,revision:m.revision,status:m.status,actor:uid,at:m.updatedAt,reason});
const save=(db:any,tx:any,m:any,uid:string,reason:string)=>{tx.set(ref(db,'makeupAttachments',m.id),{...m,subjectType:db.attachmentSubject||'makeup',subjectId:m.requestId||m.draftId});audit(db,tx,m,uid,reason);};
const all=async(db:any,tx:any,draftId:string)=>{const s=await tx.get(db.collection('makeupAttachments').where('draftId','==',draftId).limit(51));if(s.size>50)fail(409,'附件歷程容量超限，未部分處理');return s.docs.map((d:any)=>({...d.data(),id:d.id}));};
const checkReady=(m:any)=>{if(m.status!=='ready'||m.uploadComplete!==true||m.scan?.verdict!=='clean'||!m.scan.engine||!m.scan.version||m.scan.hash!==m.sha256||m.scan.mime!==m.mime)fail(409,'附件未完成上傳或尚未通過掃描');};
export const ATTACHMENT_ACTIONS=['get-makeup-attachment-capability','create-makeup-attachment-draft','list-makeup-attachments','upload-makeup-attachment','withdraw-makeup-attachment','issue-makeup-attachment-access','download-makeup-attachment'] as const;
/** Reads first; caller invokes commit only after all other transaction reads/guards. */
export async function prepareAttachmentSubmission(db:any,tx:any,uid:string,data:any,requestId:string,date:string,subject:'makeup'|'leave'='makeup'){
 db=subjectDb(db,subject);const rt=subject==='leave'?getLeaveAttachmentRuntime():getMakeupAttachmentRuntime(),p=policy(rt);
 if(!data.attachmentDraftId){if(p.required)fail(409,'此政策要求附件，請完成上傳與掃描');return {fields:{attachmentPolicyVersion:p.version,attachments:[]},commit:()=>{}};}
 enabled(rt);const d=await read(db,tx,'makeupAttachmentDrafts',data.attachmentDraftId);own({id:uid},d.owner);
 if(d.status!=='draft'||d.date!==date||d.policyVersion!==p.version||d.revision!==data.expectedAttachmentDraftRevision)fail(409,'附件草稿版本／日期已變更');
 const items=(await all(db,tx,d.id)).filter(m=>m.status!=='removed');
 if(!items.length&&p.required||items.length>p.maxFiles)fail(409,'附件數量不符已核政策');
 for(const m of items){if(m.owner!==uid||m.requestId||m.policyVersion!==p.version||m.size>p.maxBytes||!p.allowedMime.includes(m.mime))fail(409,'附件來源或政策版本不符');checkReady(m);}
 await assertTransactionMonths(db,tx,[date.slice(0,7)]);
 const at=new Date().toISOString();
 return {fields:{attachmentPolicyVersion:p.version,attachments:items.map(m=>({id:m.id,revision:m.revision+1,sha256:m.sha256,mime:m.mime,size:m.size}))},commit:()=>{
  tx.update(ref(db,'makeupAttachmentDrafts',d.id),{status:'submitted',requestId,revision:d.revision+1,updatedAt:at});
  for(const m of items)save(db,tx,{...m,requestId,revision:m.revision+1,updatedAt:at},uid,'綁定私有申請附件');
 }};
}
export async function assertRequestAttachmentEvidence(db:any,tx:any,request:any,subject:'makeup'|'leave'='makeup'){
 db=subjectDb(db,subject);if(!request.attachmentPolicyVersion&&!request.attachments)return; // Legacy stays explicitly unverified, never manufactures attachment evidence.
 if(!Array.isArray(request.attachments))fail(409,'附件證據不完整');
 for(const e of request.attachments){const m=await read(db,tx,'makeupAttachments',e.id);checkReady(m);if(m.requestId!==request.id||m.owner!==request.empId||m.policyVersion!==request.attachmentPolicyVersion||m.revision!==e.revision||m.sha256!==e.sha256||m.mime!==e.mime||m.size!==e.size)fail(409,'附件來源鏈不一致');}
}
export async function handleMakeupAttachmentAction(db:any,uid:string,action:string,data:any,subject:'makeup'|'leave'='makeup'){
 db=subjectDb(db,subject);if(data.subjectType&&data.subjectType!==subject)fail(400,'附件主體型別不符');if(['owner','storageKey','url','hash','sha256','scan','scanState','status','uploadComplete','requestId','actor'].some(k=>k in data))fail(400,'不可提交伺服器擁有的附件欄位');
 const rt=subject==='leave'?getLeaveAttachmentRuntime():getMakeupAttachmentRuntime();
 if(action==='get-makeup-attachment-capability'){
  await actor(db,null,uid);let reason='';try{enabled(rt);}catch(e:any){reason=e.message;}
  return {enabled:!reason,mode:rt.mode,reason,policy:rt.policy?{version:rt.policy.version,required:rt.policy.required,maxFiles:rt.policy.maxFiles,maxBytes:rt.policy.maxBytes,allowedMime:rt.policy.allowedMime}:null,technicalLimits:ATTACHMENT_TECH_LIMITS,productionConfigured:false};
 }
 if(action==='list-makeup-attachments'){
  const a=await actor(db,null,uid);
  if(data.draftId){const d=await read(db,null,'makeupAttachmentDrafts',data.draftId);own(a,d.owner);const items=await db.collection('makeupAttachments').where('draftId','==',d.id).limit(51).get();if(items.size>50)fail(409,'附件歷程容量超限');return {draft:{id:d.id,date:d.date,status:d.status,revision:d.revision},items:items.docs.map((s:any)=>publicMeta({...s.data(),id:s.id}))};}
  const r=await read(db,null,'makeupRequests',data.makeupRequestId);scope(a,r.empId);
  const items=[];for(const e of r.attachments||[]){const m=await read(db,null,'makeupAttachments',e.id);if(m.requestId!==r.id||m.owner!==r.empId)fail(409,'附件來源不一致');items.push(publicMeta(m));}return {items,legacyUnverified:!r.attachmentPolicyVersion};
 }
 const p=enabled(rt);
 if(action==='create-makeup-attachment-draft'){
  if(!validId(data.operationId)||!validDate(data.date))fail(400,'草稿日期與操作識別必填');
  const key='draft_'+hash(JSON.stringify(subject==='makeup'?[uid,data.operationId]:[subject,uid,data.operationId]));return runPayrollMutation(db,[data.date.slice(0,7)],async tx=>{
   await actor(db,tx,uid);const r=ref(db,'makeupAttachmentDrafts',key),s=await tx.get(r);
   if(s.exists){const d=s.data();if(d.owner!==uid||d.date!==data.date)fail(409,'草稿操作內容不符');return {id:key,revision:d.revision,status:d.status,date:d.date};}
   const at=new Date().toISOString(),d={id:key,subjectType:subject,subjectId:key,owner:uid,date:data.date,status:'draft',revision:1,policyVersion:p.version,createdAt:at,updatedAt:at};tx.create(r,d);return {id:key,revision:1,status:'draft',date:d.date};
  });
 }
 if(action==='upload-makeup-attachment'){
  if(!validId(data.operationId))fail(400,'上傳操作識別必填');const name=cleanName(data.name),bytes=decode(data.contentBase64),mime=sniff(bytes),sha256=hash(bytes);
  if(mime!==data.mime||!p.allowedMime.includes(mime)||bytes.length>p.maxBytes)fail(400,'內容型別或大小不符政策');
  const ext=mime==='image/png'?/\.png$/i:mime==='image/jpeg'?/\.jpe?g$/i:/\.pdf$/i;if(!ext.test(name))fail(400,'檔名副檔名與內容不符');
  const key='attachment_'+hash(JSON.stringify(subject==='makeup'?[uid,data.operationId]:[subject,uid,data.operationId])),intentHash=hash(JSON.stringify([data.draftId,name,mime,sha256]));
  const reserved=await runPayrollMutation(db,[],async tx=>{
   const a=await actor(db,tx,uid),d=await read(db,tx,'makeupAttachmentDrafts',data.draftId);own(a,d.owner);
   const r=ref(db,'makeupAttachments',key),old=await tx.get(r);await assertTransactionMonths(db,tx,[d.date.slice(0,7)]);
   if(old.exists){const m={...old.data(),id:old.id};if(m.intentHash!==intentHash||m.owner!==uid)fail(409,'上傳識別內容不符');if(d.status!=='draft'||m.status==='removed')fail(409,'草稿已提交或附件已撤除');return m;}
   if(d.status!=='draft'||d.revision!==data.expectedDraftRevision||d.policyVersion!==p.version)fail(409,'草稿版本或政策已變更');
   const items=await all(db,tx,d.id);if(items.filter(m=>m.status!=='removed').length>=p.maxFiles||items.length>=50)fail(409,'附件數量達上限');
   const at=new Date().toISOString(),m={id:key,draftId:d.id,requestId:null,owner:uid,name,mime,size:bytes.length,sha256,storageKey:hash(key+':'+sha256),intentHash,policyVersion:p.version,status:'uploading',uploadComplete:false,scan:null,revision:1,createdAt:at,updatedAt:at};
   save(db,tx,m,uid,'開始上傳');tx.update(ref(db,'makeupAttachmentDrafts',d.id),{revision:d.revision+1,updatedAt:at});return m;
  });
  if(['ready','rejected'].includes(reserved.status))return publicMeta(reserved);
  let scan:any=null,uploaded=false;
  try{await rt.storage!.putImmutable(reserved.storageKey,bytes,sha256);const stored=await rt.storage!.read(reserved.storageKey);if(hash(stored)!==sha256)throw Error('integrity');uploaded=true;scan=await rt.scanner!.scan(stored);}catch{scan={verdict:'error',mime,engine:'unavailable',version:'unavailable'};}
  const clean=scan?.verdict==='clean'&&scan.mime===mime&&typeof scan.engine==='string'&&!!scan.engine&&typeof scan.version==='string'&&!!scan.version;
  return runPayrollMutation(db,[],async tx=>{
   const a=await actor(db,tx,uid),d=await read(db,tx,'makeupAttachmentDrafts',reserved.draftId),m=await read(db,tx,'makeupAttachments',key);own(a,d.owner);await assertTransactionMonths(db,tx,[d.date.slice(0,7)]);
   if(d.status!=='draft'||m.status==='removed')fail(409,'草稿已提交或附件已撤除');if(['ready','rejected'].includes(m.status))return publicMeta(m);
   const at=new Date().toISOString(),next={...m,uploadComplete:uploaded,status:clean?'ready':scan?.verdict==='blocked'?'rejected':'upload-failed',scan:{verdict:clean?'clean':scan?.verdict==='blocked'?'blocked':'error',mime,engine:clean?scan.engine:'unverified',version:clean?scan.version:'unverified',hash:sha256,at},revision:m.revision+1,updatedAt:at};save(db,tx,next,uid,clean?'上傳與掃描完成':'附件未通過安全處理');return publicMeta(next);
  });
 }
 if(action==='withdraw-makeup-attachment'){
  if(!validId(data.operationId)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>500)fail(400,'撤除原因與操作識別必填');if(!p.draftWithdrawalAllowed)fail(503,'草稿撤除政策尚未核定');
  return runPayrollMutation(db,[],async tx=>{
   const a=await actor(db,tx,uid),m=await read(db,tx,'makeupAttachments',data.attachmentId),d=await read(db,tx,'makeupAttachmentDrafts',m.draftId);own(a,d.owner);await assertTransactionMonths(db,tx,[d.date.slice(0,7)]);
   if(m.removalOperationId===data.operationId){if(m.removalReason!==data.reason)fail(409,'撤除操作內容不符');return publicMeta(m);}
   if(d.status!=='draft'||m.requestId||m.revision!==data.expectedRevision||d.revision!==data.expectedDraftRevision||m.status==='removed')fail(409,'僅未送草稿可撤除，版本必須一致');
   const at=new Date().toISOString(),next={...m,status:'removed',removalOperationId:data.operationId,removalReason:data.reason,revision:m.revision+1,updatedAt:at};save(db,tx,next,uid,data.reason);tx.update(ref(db,'makeupAttachmentDrafts',d.id),{revision:d.revision+1,updatedAt:at});return publicMeta(next);
  }); // Logical removal only: no retention policy means no physical deletion.
 }
 const authorize=async(tx:any,m:any,a:any)=>{if(m.requestId){const r=await read(db,tx,'makeupRequests',m.requestId);scope(a,r.empId);if(m.owner!==r.empId||!r.attachments?.some((e:any)=>e.id===m.id&&e.sha256===m.sha256&&e.revision===m.revision))fail(409,'附件未綁定此申請');}else{const d=await read(db,tx,'makeupAttachmentDrafts',m.draftId);own(a,d.owner);if(d.status!=='draft')fail(409,'草稿狀態不符');}checkReady(m);};
 if(action==='issue-makeup-attachment-access'){
  const token=randomBytes(32).toString('hex');return db.runTransaction(async(tx:any)=>{
   const a=await actor(db,tx,uid),m=await read(db,tx,'makeupAttachments',data.attachmentId);await authorize(tx,m,a);
   const expiresAt=Date.now()+ATTACHMENT_TECH_LIMITS.grantSeconds*1000;tx.create(ref(db,'makeupAttachmentAccess',hash(token)),{uid,attachmentId:m.id,revision:m.revision,hash:m.sha256,expiresAt,consumed:false});return {accessToken:token,expiresAt};
  });
 }
 if(action==='download-makeup-attachment'){
  if(typeof data.accessToken!=='string'||!/^[a-f0-9]{64}$/.test(data.accessToken))fail(400,'短效存取識別無效');
  const m=await db.runTransaction(async(tx:any)=>{
   const a=await actor(db,tx,uid),g=await read(db,tx,'makeupAttachmentAccess',hash(data.accessToken));if(g.uid!==uid||g.consumed||g.expiresAt<=Date.now())fail(403,'存取已失效');const m=await read(db,tx,'makeupAttachments',g.attachmentId);await authorize(tx,m,a);if(m.revision!==g.revision||m.sha256!==g.hash)fail(409,'附件版本已變更');tx.update(ref(db,'makeupAttachmentAccess',g.id),{consumed:true});return m;
  });
  let bytes:Buffer;try{bytes=await rt.storage!.read(m.storageKey);}catch{fail(503,'私有檔案暫時無法讀取');}
  if(hash(bytes!)!==m.sha256||bytes!.length!==m.size||sniff(bytes!)!==m.mime)fail(409,'私有檔案完整性檢查未通過');
  return {name:m.name,mime:m.mime,size:m.size,contentBase64:bytes!.toString('base64'),disposition:'attachment'};
 }
 return fail(400,'未知附件操作');
}

function subjectDb(db:any,subject:'makeup'|'leave'){if(subject==='makeup')return db;return {attachmentSubject:'leave',collection:(name:string)=>db.collection(name==='makeupRequests'?'leaveRequests':name.startsWith('makeupAttachment')?name.replace('makeupAttachment','leaveAttachment'):name),runTransaction:(fn:any)=>db.runTransaction(fn)};}
export const LEAVE_ATTACHMENT_ACTIONS=ATTACHMENT_ACTIONS.map(a=>a.replace('makeup','leave'));
export const handleLeaveAttachmentAction=(db:any,uid:string,action:string,data:any)=>handleMakeupAttachmentAction(db,uid,action.replace('leave','makeup'),{...data,...(data.leaveRequestId?{makeupRequestId:data.leaveRequestId}:{})},'leave');
