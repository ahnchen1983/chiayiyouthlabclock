import MakeupAttachmentPanel,{type AttachmentSelection} from '../MakeupAttachmentPanel';
import { useAuth } from '../../contexts/AuthContext';
import { type CaseFormContext, contextDateMatches } from '../../utils/caseFormContext';
import { useMakeupOperation, type MakeupOperation } from '../../hooks/useMakeupOperation';
import React, { useEffect, useRef, useState } from 'react';
import { taipeiDate } from '../../utils/attendance';
import { APIError, apiActMakeupRequest, apiGetCaseRequestLinks, apiGetEmployeeMakeupRequests, apiGetMakeupRequestDetail, apiSubmitMakeupVersion, type MakeupCaseContext, type MakeupDraft } from '../../services/googleAppsScriptAPI';
import type { ClockMakeupRequest } from '../../types';
import MakeupRequestActions from '../MakeupRequestActions';
const taipeiInput=(value?:string|null)=>value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19):'';
export default function ClockMakeupForm({caseContext,requestId}:{caseContext?:CaseFormContext;requestId?:string}={}){
 const {user}=useAuth();const operation=useMakeupOperation();
 const [linkContext,setLinkContext]=useState<MakeupCaseContext|null>(null);
 const [date,setDate]=useState(caseContext?caseContext.date||'':taipeiDate()),[type,setType]=useState<'上班'|'下班'|'上下班'>('上班');
 const [clockIn,setClockIn]=useState(''),[clockOut,setClockOut]=useState(''),[inAt,setInAt]=useState(''),[outAt,setOutAt]=useState(''),[recordId,setRecordId]=useState(caseContext?.recordId||''),[reason,setReason]=useState('');
 const [history,setHistory]=useState<ClockMakeupRequest[]>([]),[prior,setPrior]=useState<ClockMakeupRequest|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[stale,setStale]=useState(false),[uncertain,setUncertain]=useState(false);
 const gate=useRef(false);
 const [attachmentSelection,setAttachmentSelection]=useState<AttachmentSelection>({ready:false}),[attachmentReset,setAttachmentReset]=useState(0);
 const matching=operation.pending&&(operation.pending.kind==='submit'&&(!caseContext||operation.pending.command.caseId===caseContext.caseId)||operation.pending.kind==='act'&&operation.pending.command.mode==='resubmit'&&(!caseContext||operation.pending.contextCaseId===caseContext.caseId))?operation.pending:null;
 const otherPending=!!operation.pending&&!matching;
 useEffect(()=>{if(matching){const p=matching.command;const d=matching.kind==='act'?matching.command.patch!:matching.command;setDate(d.date);setType(d.type);setRecordId(d.recordId||'');setReason(p.reason);setClockIn(d.requestedClockIn||'');setClockOut(d.requestedClockOut||'');setInAt(taipeiInput(d.requestedClockInAt));setOutAt(taipeiInput(d.requestedClockOutAt));setUncertain(true);}else setUncertain(false);},[operation.pending]);
 useEffect(()=>{if(caseContext)apiGetCaseRequestLinks(caseContext.caseId).then(setLinkContext).catch(()=>setError('案件關聯範圍未能讀取，暫不能送出。'));},[caseContext?.caseId]);
 const load=async()=>{try{const rows=await apiGetEmployeeMakeupRequests();setHistory(rows.sort((a,b)=>(b.requestDate||'').localeCompare(a.requestDate||'')));}catch{setError('申請紀錄讀取失敗，請重試。');}};
 useEffect(()=>{void load();},[]);
 const edit=(r:ClockMakeupRequest)=>{setPrior(r);setDate(r.date);setType(r.type);setClockIn(r.requestedClockIn||'');setClockOut(r.requestedClockOut||'');setInAt(taipeiInput(r.requestedClockInAt));setOutAt(taipeiInput(r.requestedClockOutAt));setRecordId(r.recordId||'');setReason(r.reason);setStale(false);setUncertain(false);setError('');};
 const submit=async()=>{
  if(!matching&&!attachmentSelection.ready||gate.current||operation.blocked||otherPending||(stale&&!matching)||reason.trim().length<5||caseContext&&!linkContext)return;
  if(caseContext&&(caseContext.empId!==user?.id||!contextDateMatches(caseContext,date))){setError('案件員工或日期不符，請核對範圍');return;}gate.current=true;setBusy(true);setError('');setNotice('');
  const draft:MakeupDraft={...(attachmentSelection.attachmentDraftId?{attachmentDraftId:attachmentSelection.attachmentDraftId,expectedAttachmentDraftRevision:attachmentSelection.expectedAttachmentDraftRevision}:{}),date,type,reason:reason.trim(),...(recordId?{recordId}:{}),...(type!=='下班'?(inAt?{requestedClockInAt:inAt+(inAt.length===16?':00':'')+'+08:00'}:{requestedClockIn:clockIn}):{}),...(type!=='上班'?(outAt?{requestedClockOutAt:outAt+(outAt.length===16?':00':'')+'+08:00'}:{requestedClockOut:clockOut}):{})};
  const intent:MakeupOperation=matching||(prior?{kind:'act' as const,...(caseContext?{contextCaseId:caseContext.caseId}:{}),command:{requestId:prior.id,expectedRevision:prior.revision??0,mode:'resubmit' as const,operationId:crypto.randomUUID(),reason:draft.reason,patch:draft}}:{kind:'submit' as const,command:{...draft,operationId:crypto.randomUUID(),...(caseContext?{caseId:caseContext.caseId,expectedCaseRevision:linkContext!.caseRevision}:{})}});

  try{const saved=await operation.attempt(intent);setUncertain(false);setPrior(null);setReason('');setClockIn('');setClockOut('');setInAt('');setOutAt('');setAttachmentReset(v=>v+1);setNotice('申請已送出，請等待主管審核');void saved;await load();}
  catch(e){if(e instanceof APIError&&[400,403,404,409,423].includes(e.status)){if(!matching)setStale(true);setError('時間／權限／版本或鎖月檢查未通過；請重新核對，不會覆寫舊版。');}else setError('結果未確認，請重試原申請，勿另外重複提交。');}
  finally{gate.current=false;setBusy(false);}
 };
 const reload=async()=>{await load();if(matching)return;if(prior){try{edit(await apiGetMakeupRequestDetail(prior.id));}catch{setError('原版本無法重新讀取。');}}else if(!caseContext){setStale(false);}else setError('案件版本請返回案件重新載入；不自動略過版本檢查。');};
 return <div className="p-4 bg-white rounded space-y-4 min-w-0 break-words yl-leave">
  <h1 className="text-2xl font-bold">補打卡申請</h1>
  <p className="text-sm">忘了打卡可在這裡補登，主管確認後才會寫入出勤。</p>
  {caseContext&&<p>時間請自己填，不會自動帶入。</p>}
  {requestId&&<p className="break-all">指定申請：{requestId}（見紀錄）</p>}
  {(otherPending||operation.blocked)&&<p role="alert">另有未確認操作或暫存不可用，請回原申請核實。不要關閉分頁或清除資料後重送。</p>}
  {matching&&<p>保留原申請識別，重新載入不代表成功；只能重試原內容。</p>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <form className="space-y-3 border rounded p-3" onSubmit={e=>{e.preventDefault();void submit();}}>
   <h2>{prior?'更正這筆':'新增申請'}</h2>
   <fieldset disabled={busy||operation.blocked||otherPending||uncertain||stale} className="grid gap-3 sm:grid-cols-2">
    <label>補打卡日期<input className="block w-full border p-2" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>補打卡類型<select className="block w-full border p-2" value={type} onChange={e=>setType(e.target.value as any)}><option value="上班">補上班</option><option value="下班">補下班</option><option value="上下班">補上下班</option></select></label>
    {caseContext&&<label className="sm:col-span-2">打卡紀錄 ID（多段時必須指定）<input className="block w-full border p-2" value={recordId} maxLength={150} onChange={e=>setRecordId(e.target.value)}/></label>}
    {type!=='下班'&&<label>上班時間（當日）<input className="block w-full border p-2" type="time" value={clockIn} disabled={!!inAt} onChange={e=>setClockIn(e.target.value)}/></label>}
    {caseContext&&type!=='下班'&&<label>完整上班日期時間（台北）<input className="block w-full border p-2" type="datetime-local" step="1" value={inAt} onChange={e=>setInAt(e.target.value)}/></label>}
    {type!=='上班'&&<label>下班時間（當日）<input className="block w-full border p-2" type="time" value={clockOut} disabled={!!outAt} onChange={e=>setClockOut(e.target.value)}/></label>}
    {caseContext&&type!=='上班'&&<label>完整下班日期時間（跨夜必填，台北）<input className="block w-full border p-2" type="datetime-local" step="1" value={outAt} onChange={e=>setOutAt(e.target.value)}/></label>}
    <label className="sm:col-span-2">申請理由<textarea aria-label="申請理由" className="block w-full border p-2" required minLength={5} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   </fieldset>
   <MakeupAttachmentPanel date={date} onSelection={setAttachmentSelection} resetKey={attachmentReset} disabled={busy||!!operation.pending}/>
   <button className="rounded border p-2 disabled:opacity-50" disabled={!matching&&!attachmentSelection.ready||busy||operation.blocked||otherPending||(stale&&!matching)||reason.trim().length<5||!!caseContext&&!linkContext}>{uncertain?'重試原申請':prior?'送出新版本':'送出申請'}</button>
   {prior&&<button type="button" disabled={busy||uncertain} onClick={()=>{setPrior(null);setReason('');setStale(false);}}>取消重送編輯</button>}
  </form>
  <button disabled={busy} onClick={()=>void reload()}>重新載入申請紀錄</button>
  <h2 className="font-bold">我的紀錄</h2>
  {history.filter(r=>!requestId||r.id===requestId||r.supersedesRequestId===requestId).map(r=><article key={r.id} className="yl-request-card border rounded p-3 break-words space-y-2"><p>{r.date} · {r.type==='上班'?'補上班':r.type==='下班'?'補下班':'補上下班'} · {r.requestedClockIn||'—'} / {r.requestedClockOut||'—'}</p><p>{r.reason}</p><MakeupRequestActions request={r} onChanged={()=>void load()} onResubmit={operation.pending?undefined:edit}/></article>)}
  {!history.length&&<p>尚無申請紀錄。</p>}
 </div>;
}
