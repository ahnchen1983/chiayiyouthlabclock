import MakeupAttachmentPanel from './MakeupAttachmentPanel';
import { useMakeupOperation } from '../hooks/useMakeupOperation';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole, type ClockMakeupRequest } from '../types';
import { APIError, apiActMakeupRequest, apiGetMakeupRequestDetail } from '../services/googleAppsScriptAPI';
export default function MakeupRequestActions({request,onChanged,onResubmit}:{request:ClockMakeupRequest;onChanged:()=>void;onResubmit?:(r:ClockMakeupRequest)=>void}){
 const operation=useMakeupOperation();
 const {user}=useAuth();const own=user?.id===request.empId,manager=user?.role===UserRole.Admin||user?.role===UserRole.SuperAdmin;
 const [r,setR]=useState(request),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false),[uncertain,setUncertain]=useState(false);
 const gate=useRef(false);
 const matching=operation.pending?.kind==='act'&&operation.pending.command.requestId===r.id&&operation.pending.command.mode!=='resubmit'?operation.pending:null;
 const otherPending=!!operation.pending&&!matching;
 useEffect(()=>{if(matching){setReason(matching.command.reason);setUncertain(true);}else setUncertain(false);},[operation.pending]);
 useEffect(()=>{setR(request);if(!matching){setReason('');setStale(false);setUncertain(false);}},[request.id,request.revision,request.status]);
 const run=async(mode:'cancel'|'return'|'approve'|'reject')=>{
  if(gate.current||operation.blocked||otherPending||(stale&&!matching)||!reason.trim())return;gate.current=true;setBusy(true);setError('');
  const command=matching?.command||{requestId:r.id,mode,expectedRevision:r.revision??0,operationId:crypto.randomUUID(),reason:reason.trim()};
  try{const next=await operation.attempt({kind:'act',command}) as ClockMakeupRequest;setUncertain(false);setR(next);setReason('');onChanged();}
  catch(e){setError(e instanceof APIError&&[400,403,404,409,423].includes(e.status)?'無權限、版本已變或月份已鎖；請重新載入，不會自動覆寫。':'結果未確認，請重試原操作。');if(e instanceof APIError&&[400,403,404,409,423].includes(e.status)){if(!matching)setStale(true);}}
  finally{gate.current=false;setBusy(false);}
 };
 const refresh=async()=>{if(gate.current)return;gate.current=true;setBusy(true);try{setR(await apiGetMakeupRequestDetail(r.id));setStale(false);if(!matching)setReason('');setError('');}catch{setError('讀取失敗，不能假設已更新。');setStale(true);}finally{gate.current=false;setBusy(false);}};
 const active=['待審核','待補件'].includes(r.status);
 const statusLabel=r.status==='核准'?'已核准':r.status==='駁回'?'已退回':r.status==='已取消'?'已撤回':'待簽核';
 return <section className="space-y-2 text-sm" aria-label="申請處理">
  <p><span className="yl-badge">{statusLabel}</span></p>
  {manager&&!own&&r.status==='待審核'&&<p>核准後會寫入出勤紀錄</p>}
  {r.returnReason&&<p>退回補件：{r.returnReason}</p>}
  {error&&<p role="alert">{error}</p>}{(otherPending||operation.blocked)&&<p>另有未確認操作或暫存不可用，請先返回原申請核實；不能建立新操作。</p>}
  {(own&&active||manager&&!own&&r.status==='待審核')&&<label>操作原因<input className="w-full border rounded p-2" placeholder="請說明退回原因" value={reason} maxLength={2000} disabled={busy||operation.blocked||otherPending||stale||uncertain} onChange={e=>setReason(e.target.value)}/></label>}
  <div className="flex flex-wrap gap-2">
   {uncertain?<button disabled={busy} onClick={()=>matching&&void run(matching.command.mode as any)}>重試原操作</button>:<>
    {own&&active&&<button disabled={busy||operation.blocked||otherPending||stale||!reason.trim()} onClick={()=>void run('cancel')}>撤回</button>}
    {own&&onResubmit&&['待補件','駁回','已取消'].includes(r.status)&&<button disabled={busy||operation.blocked||otherPending||stale} onClick={()=>onResubmit(r)}>編輯並重送新版本</button>}
    {manager&&!own&&r.status==='待審核'&&<><button className="yl-primary-action" disabled={busy||operation.blocked||otherPending||stale||!reason.trim()} onClick={()=>void run('approve')}>核准</button><button disabled={busy||operation.blocked||otherPending||stale||!reason.trim()} onClick={()=>void run('return')}>退回</button></>}
   </>}
   <button disabled={busy} onClick={()=>void refresh()}>重新載入申請</button>
  </div>
  {manager&&own&&<p>本人申請不能自己審。</p>}
  {!!r.attachments?.length&&<MakeupAttachmentPanel requestId={r.id}/>}
  <details><summary>申請歷程</summary>{r.history?.length?r.history.map(h=><p key={h.id}>{h.reason}</p>):<p>還沒有處理紀錄。</p>}</details>
 </section>;
}
