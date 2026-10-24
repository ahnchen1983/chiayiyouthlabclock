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
 return <section className="space-y-2 text-sm" aria-label={`申請處理 ${r.id}`}>
  <p>申請 {r.id} · 版本 {r.revision??0} · {r.status}</p>
  {r.returnReason&&<p>退回補件：{r.returnReason}</p>}{r.supersedesRequestId&&<p className="break-all">前版：{r.supersedesRequestId}</p>}{r.supersededByRequestId&&<p className="break-all">後版：{r.supersededByRequestId}</p>}
  {error&&<p role="alert">{error}</p>}{(otherPending||operation.blocked)&&<p>另有未確認操作或暫存不可用，請先返回原申請核實；不能建立新操作。</p>}
  {(own&&active||manager&&!own&&r.status==='待審核')&&<label>操作原因<input className="w-full border rounded p-2" value={reason} maxLength={2000} disabled={busy||operation.blocked||otherPending||stale||uncertain} onChange={e=>setReason(e.target.value)}/></label>}
  <div className="flex flex-wrap gap-2">
   {uncertain?<button disabled={busy} onClick={()=>matching&&void run(matching.command.mode as any)}>重試原操作</button>:<>
    {own&&active&&<button disabled={busy||operation.blocked||otherPending||stale||!reason.trim()} onClick={()=>void run('cancel')}>取消未核申請</button>}
    {own&&onResubmit&&['待補件','駁回','已取消'].includes(r.status)&&<button disabled={busy||operation.blocked||otherPending||stale} onClick={()=>onResubmit(r)}>編輯並重送新版本</button>}
    {manager&&!own&&r.status==='待審核'&&(['return','approve','reject'] as const).map(mode=><button key={mode} disabled={busy||operation.blocked||otherPending||stale||!reason.trim()} onClick={()=>void run(mode)}>{({return:'退回補件',approve:'核准補卡',reject:'駁回補卡'})[mode]}</button>)}
   </>}
   <button disabled={busy} onClick={()=>void refresh()}>重新載入申請</button>
  </div>
  {manager&&own&&<p>本人申請不可自行審核；指定主管政策仍待設定。</p>}
  <details><summary>申請歷程</summary>{r.history?.length?r.history.map(h=><p key={h.id}>{h.at} · {h.actor} · {h.from||'建立'} → {h.to}：{h.reason}</p>):<p>舊資料無版本歷程，不捏造還原。</p>}</details>
 </section>;
}
