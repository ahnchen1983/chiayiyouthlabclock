import React,{useEffect,useRef,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {subjectAttachmentAPI,APIError,apiAttachmentCapability,apiAttachmentDraft,apiListAttachments,apiUploadAttachment,apiWithdrawAttachment,apiAttachmentAccess,apiDownloadAttachment,type MakeupAttachment,type MakeupAttachmentCapability} from '../services/googleAppsScriptAPI';
export interface AttachmentSelection {ready:boolean;attachmentDraftId?:string;expectedAttachmentDraftRevision?:number}
type Draft={id:string;date:string;revision:number;status:string};
type Intent={kind:'create';date:string;operationId:string}|{kind:'upload';draftId:string;expectedDraftRevision:number;operationId:string;name:string;mime:string;size:number;digest:string}|{kind:'withdraw';attachmentId:string;expectedRevision:number;expectedDraftRevision:number;operationId:string;reason:string};
type Journal={draft?:Draft;intent?:Intent};
const digest=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
const base64=(bytes:ArrayBuffer)=>{let s='';for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s);};
export default function MakeupAttachmentPanel({date,requestId,onSelection,resetKey=0,disabled=false,subjectType='makeup'}:{subjectType?:'makeup'|'leave';date?:string;requestId?:string;onSelection?:(s:AttachmentSelection)=>void;resetKey?:number;disabled?:boolean}){
 const {user}=useAuth();const api=subjectAttachmentAPI(subjectType);const key=subjectType+'-private-draft-v1:'+user!.id;
 const [cap,setCap]=useState<MakeupAttachmentCapability|null>(null),[journal,setJournal]=useState<Journal>({}),[items,setItems]=useState<MakeupAttachment[]>([]),[file,setFile]=useState<File|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[storageBlocked,setStorageBlocked]=useState(false),[loaded,setLoaded]=useState(false);
 const gate=useRef(false),initialReset=useRef(resetKey),selection=useRef(onSelection);selection.current=onSelection;
 const save=(j:Journal)=>{try{sessionStorage.setItem(key,JSON.stringify(j));setJournal(j);}catch{setStorageBlocked(true);throw Error('操作識別無法保存，本次不送出');}};
 const load=async(j=journal)=>{const result=await api.list(requestId?{makeupRequestId:requestId}:{draftId:j.draft!.id});setItems(result.items);if(!requestId&&result.draft)save({...j,draft:result.draft});setLoaded(true);return result;};
 useEffect(()=>{api.capability().then(setCap).catch(()=>setError('附件設定讀取失敗，不能當作無需附件。'));if(requestId){void load().catch(()=>setError('附件清單讀取失敗'));return;}try{const raw=sessionStorage.getItem(key);if(raw){const j=JSON.parse(raw);if(typeof j!=='object'||j===null||j.draft&&typeof j.draft.id!=='string'||j.intent&&!['create','upload','withdraw'].includes(j.intent.kind))throw Error('invalid');setJournal(j);if(j.draft)void load(j).catch(()=>setError('草稿讀取失敗，請核對原操作。'));else setLoaded(true);}else setLoaded(true);}catch{setStorageBlocked(true);setError('草稿暫存無法讀取；請先核實原操作，勿清除後重送。');}},[requestId,user?.id]);
 useEffect(()=>{if(initialReset.current===resetKey)return;initialReset.current=resetKey;save({});setItems([]);setFile(null);setLoaded(true);},[resetKey]);
 const active=items.filter(m=>m.status!=='removed'),ready=!!cap?.enabled&&loaded&&!busy&&!storageBlocked&&!journal.intent&&(!journal.draft||journal.draft.status==='draft'&&journal.draft.date===date)&&active.every(m=>m.status==='ready'&&m.uploadComplete&&m.scan?.verdict==='clean')&&(!cap.policy?.required||active.length>0);
 useEffect(()=>{selection.current?.({ready,...(journal.draft?{attachmentDraftId:journal.draft.id,expectedAttachmentDraftRevision:journal.draft.revision}:{})});},[ready,journal.draft?.id,journal.draft?.revision]);
 const perform=async(proposed:Intent)=>{
  if(gate.current||disabled||storageBlocked||!cap?.enabled)return;gate.current=true;setBusy(true);setError('');const retry=!!journal.intent;
  try{
   let bytes:ArrayBuffer|undefined;const intent=journal.intent||proposed;
   if(intent.kind==='upload'){
    if(!file)throw Error('請重新選取原檔案；不保存檔案內容或自動重送。');bytes=await file.arrayBuffer();if(bytes.byteLength!==intent.size||await digest(bytes)!==intent.digest||file.name!==intent.name||file.type!==intent.mime)throw Error('重試必須選取相同檔案，不能沿用操作識別換檔。');
   }
   save({...journal,intent});
   if(intent.kind==='create'){const d=await api.draft(intent.date,intent.operationId);save({draft:d});setItems([]);setLoaded(true);}
   else if(intent.kind==='upload'){
    await api.upload({draftId:intent.draftId,expectedDraftRevision:intent.expectedDraftRevision,operationId:intent.operationId,name:intent.name,mime:intent.mime,contentBase64:base64(bytes!)});
    const next={draft:journal.draft};save(next);setFile(null);await load(next);
   }else{await api.withdraw(intent);const next={draft:journal.draft};save(next);setReason('');await load(next);}
  }catch(e){if(!retry&&e instanceof APIError&&[400,403,404,409,423,503].includes(e.status))save({draft:journal.draft});setError(e instanceof APIError?'附件操作遭拒或狀態有變，請重新讀取；保留的原操作只能原樣重試。':e instanceof Error?e.message:'操作結果未確認，請重試原操作。');}
  finally{gate.current=false;setBusy(false);}
 };
 const upload=async()=>{if(gate.current||!file||!journal.draft)return;if(file.size>(cap?.policy?.maxBytes||0)){setError('超過已核政策大小，未上傳');return;}const b=await file.arrayBuffer();void perform({kind:'upload',draftId:journal.draft.id,expectedDraftRevision:journal.draft.revision,operationId:crypto.randomUUID(),name:file.name,mime:file.type,size:file.size,digest:await digest(b)});};
 const download=async(id:string)=>{if(gate.current||!cap?.enabled)return;gate.current=true;setBusy(true);try{const grant=await api.access(id),r=await api.download(grant.accessToken),binary=atob(r.contentBase64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=r.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setError('附件下載被拒或短效存取失效，請重新核對。');}finally{gate.current=false;setBusy(false);}};
 return <section aria-label={subjectType==='leave'?'私有假單附件':'私有補卡附件'} className="border rounded p-3 space-y-2 min-w-0 break-words">
  <h3 className="font-semibold">{subjectType==='leave'?'私有假單附件':'私有補卡附件'}</h3>
  <p>{cap?.enabled?'僅合成測試 adapter；正式儲存與掃描未配置。':cap?.reason||'正在核對附件設定…'}</p>
  <p>附件政策、數量／容量與保存期限需核定；未通過上傳與安全掃描不能提交。撤除草稿保留稽核與原檔，不代表永久刪除。</p>
  {cap?.policy&&<p>政策版本 {cap.policy.version} · {cap.policy.required?'必須附檔':'可不附檔'} · 最多 {cap.policy.maxFiles} 檔／每檔 {cap.policy.maxBytes} bytes</p>}
  {error&&<p role="alert">{error}</p>}{storageBlocked&&<p role="alert">暫存不可用，禁止新操作。</p>}
  {journal.intent&&<p>原附件操作結果未確認，GET不代表成功；請原樣重試。重新整理後需重選同一檔案，檔案內容不存入暫存。</p>}
  {journal.draft&&<p className="break-all">草稿 {journal.draft.id} · {journal.draft.date} · v{journal.draft.revision} · {journal.draft.status}</p>}
  {!requestId&&<>
   {!journal.draft&&<button type="button" disabled={disabled||busy||storageBlocked||!cap?.enabled||!date||!!journal.intent&&journal.intent.kind!=='create'} onClick={()=>void perform({kind:'create',date:date!,operationId:crypto.randomUUID()})}>{journal.intent?'重試原草稿建立':'建立私有附件草稿'}</button>}
   {journal.draft&&<>
    {journal.draft.date!==date&&<p role="alert">附件草稿日期與申請不同，不可提交；保留原草稿或改回日期。</p>}
    <label>選取私有附件<input type="file" accept={cap?.policy?.allowedMime.join(',')} disabled={disabled||busy||!cap?.enabled||journal.draft.status!=='draft'} onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
    <button type="button" disabled={disabled||busy||storageBlocked||!cap?.enabled||!file||journal.draft.status!=='draft'||!!journal.intent&&journal.intent.kind!=='upload'} onClick={()=>void upload()}>{journal.intent?.kind==='upload'?'重試原附件上傳':'上傳並安全掃描'}</button>
    <label>撤除附件原因<input value={reason} maxLength={500} disabled={disabled||busy||!!journal.intent} onChange={e=>setReason(e.target.value)}/></label>
    {journal.intent?.kind==='withdraw'&&<button type="button" disabled={disabled||busy} onClick={()=>void perform(journal.intent!)}>重試原撤除</button>}
    <button type="button" disabled={disabled||busy||!!journal.intent} onClick={()=>{save({});setItems([]);setFile(null);setLoaded(true);}}>保留草稿並解除選取</button>
   </>}
  </>}
  {items.map(m=><div key={m.id} className="border-t py-2"><p>{m.name} · {m.size} bytes · {m.mime} · {m.status} · v{m.revision}</p><p>上傳 {m.uploadComplete?'完成':'未完成'}／掃描 {m.scan?.verdict||'未完成'}</p><button type="button" disabled={busy||!cap?.enabled||m.status!=='ready'} onClick={()=>void download(m.id)}>下載 {m.name}</button>{!requestId&&!m.requestId&&m.status!=='removed'&&<button type="button" disabled={disabled||busy||!!journal.intent||!reason.trim()||!cap?.enabled} onClick={()=>void perform({kind:'withdraw',attachmentId:m.id,expectedRevision:m.revision,expectedDraftRevision:journal.draft!.revision,operationId:crypto.randomUUID(),reason:reason.trim()})}>撤除草稿附件 {m.name}</button>}</div>)}
  {(journal.draft||requestId)&&<button type="button" disabled={busy} onClick={()=>void load().catch(()=>setError('附件清單讀取失敗，不自動清除原操作。'))}>重新讀取附件狀態</button>}
 </section>;
}
