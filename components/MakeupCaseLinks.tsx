import React, { useEffect, useState } from 'react';
import { apiGetCaseRequestLinks, apiGetMakeupRequestDetail, type MakeupCaseContext } from '../services/googleAppsScriptAPI';
import { useMakeupOperation, type MakeupOperation } from '../hooks/useMakeupOperation';
export default function MakeupCaseLinks({caseId,caseRevision,onOpen}:{caseId:string;caseRevision:number;onOpen:(requestId:string)=>void}){
 const operation=useMakeupOperation();const [context,setContext]=useState<MakeupCaseContext|null>(null),[requestId,setRequestId]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const matching=operation.pending?.kind==='link'&&operation.pending.command.caseId===caseId?operation.pending:null;
 const otherPending=!!operation.pending&&!matching;
 const load=async()=>{try{setContext(await apiGetCaseRequestLinks(caseId));setError('');}catch{setContext(null);setError('案件關聯讀取失敗；不能當作無關聯。');}};
 useEffect(()=>{void load();},[caseId,caseRevision]);
 useEffect(()=>{if(matching){setRequestId(matching.command.requestId);setReason(matching.command.reason);}},[operation.pending]);
 const change=async(mode:'link'|'unlink',target=requestId)=>{
  if(busy||operation.busy||operation.blocked||otherPending||!context||!reason.trim())return;setBusy(true);setError('');
  try{
   let intent:MakeupOperation;
   if(matching)intent=matching;
   else{const r=await apiGetMakeupRequestDetail(target);intent={kind:'link',command:{caseId,requestId:target,mode,expectedRevision:r.revision??0,expectedCaseRevision:context.caseRevision,expectedLinkRevision:context.links.find(l=>l.requestId===target)?.revision??0,operationId:crypto.randomUUID(),reason:reason.trim()}};}
   await operation.attempt(intent);setReason('');setRequestId('');await load();
  }catch{setError('關聯未完成或結果未確認；保留原操作時只能重試，版本／月鎖／來源錯誤須重新核對。');}finally{setBusy(false);}
 };
 return <section className="border rounded p-3 space-y-2" aria-label="補卡申請關聯"><h4 className="font-semibold">補卡申請關聯</h4><p>關聯或解除不會修改原卡、申請核准或案件判定；已核准來源鏈不能解除。</p>
  {error&&<p role="alert">{error}</p>}{(otherPending||operation.blocked)&&<p>另有未確認補卡操作，請返回原申請核實。</p>}
  {context?.links.map(l=><div key={l.id} className="break-all"><p>{l.requestId} · {l.state==='active'?'有效關聯':'已解除（保留歷程）'} · 版本 {l.revision}</p><p>{l.actor} · {l.at}：{l.reason}</p><button onClick={()=>onOpen(l.requestId)}>開啟關聯申請 {l.requestId.slice(-8)}</button>{l.state==='active'&&<button disabled={busy||operation.blocked||!!operation.pending||!reason.trim()} onClick={()=>void change('unlink',l.requestId)}>解除此關聯</button>}</div>)}
  {context&&!context.links.length&&<p>尚無持久關聯。</p>}
  <details><summary>關聯歷程</summary>{context?.history?.map((h,i)=><p key={i}>{h.at} · {h.actor} · {h.requestId} v{h.revision} · {h.state}：{h.reason}</p>)}{context?.historyComplete===false&&<p>歷程超過顯示上限，不能當作完整紀錄。</p>}</details>
  <label>既有補卡申請 ID<input className="block w-full border p-2" value={requestId} disabled={busy||!!operation.pending||operation.blocked} onChange={e=>setRequestId(e.target.value)}/></label>
  <label>關聯處理原因<input className="block w-full border p-2" value={reason} maxLength={2000} disabled={busy||!!operation.pending||operation.blocked} onChange={e=>setReason(e.target.value)}/></label>
  <button disabled={busy||otherPending||operation.blocked||!context||!requestId.trim()||!reason.trim()} onClick={()=>void change('link')}>{matching?'重試原關聯操作':'關聯既有補卡申請'}</button><button disabled={busy} onClick={()=>void load()}>重新載入關聯</button>
 </section>;
}
