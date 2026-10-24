import { caseFormContext } from '../utils/caseFormContext';
import { readPendingCaseOperation, savePendingCaseOperation, clearPendingCaseOperation } from '../services/pendingCaseOperation';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import { taipeiDate } from '../utils/attendance';
import { APIError, apiActAttendanceCase, apiGetAttendanceCase, apiListAttendanceCases } from '../services/googleAppsScriptAPI';
import { caseStatuses, caseTypes, notificationStates, type CaseCommand, type CaseDetail, type CasePage, type CaseQuery, type CaseStatus, type CaseType } from '../services/attendanceCaseContract';
const Makeup = lazy(() => import('./employee/ClockMakeupForm'));
const Leave = lazy(() => import('./employee/LeaveRequestForm'));
const MakeupReview = lazy(() => import('./admin/MakeupApprovalQueue'));
const LeaveReview = lazy(() => import('./admin/LeaveApprovalQueue'));
const button='rounded border px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed';
const field='block w-full rounded border p-2 bg-white';
const date=(minutes:number)=>new Date(minutes*60000).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const errorText=(e:unknown)=> e instanceof APIError ? ({403:'無權存取或處理此案件。',404:'案件不存在，請返回列表重新查詢。',409:'案件或來源已變動／仍待核實。請重新載入後檢查，再決定是否送出。',423:'相關月份已鎖定，不能修改案件。',400:'輸入不符規則，請重新載入並檢查原因與負責人。'}[e.status]||'伺服器暫時無法處理；操作結果可能未確認。') : '連線失敗；操作結果可能未確認。請使用原操作重試，避免重複送出。';

export default function AttendanceCaseCenter(){
 const {user}=useAuth();
 const manager=user?.role===UserRole.Admin||user?.role===UserRole.SuperAdmin;
 const [empId,setEmpId]=useState(user?.id||'');
 const [month,setMonth]=useState(taipeiDate(new Date()).slice(0,7));
 const [status,setStatus]=useState<CaseStatus|''>('');const [type,setType]=useState<CaseType|''>('');
 const [query,setQuery]=useState<CaseQuery|null>(null);const [page,setPage]=useState<CasePage|null>(null);
 const [cursors,setCursors]=useState<(string|undefined)[]>([undefined]);
 const [detail,setDetail]=useState<CaseDetail|null>(null);const [selectedId,setSelectedId]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);const busyRef=useRef(false);const generation=useRef(0);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const [stale,setStale]=useState(false);
 const [mode,setMode]=useState<CaseCommand['mode']>('explain');const [reason,setReason]=useState('');const [owner,setOwner]=useState('');
 const pending=useRef<CaseCommand|null>(null);const [uncertain,setUncertain]=useState(false);
 const [storageError,setStorageError]=useState(false);
 useEffect(()=>{try{const saved=readPendingCaseOperation(user!.id);if(saved){pending.current=saved;setUncertain(true);setMode(saved.mode);setReason(saved.reason);setOwner(saved.owner||'');}}catch{setStorageError(true);}},[user?.id]);
 const [related,setRelated]=useState<'makeup'|'leave'|null>(null);
 useEffect(()=>()=>{generation.current++;},[]);
 const start=()=>{if(busyRef.current)return null;busyRef.current=true;setBusy(true);setError('');setNotice('');return ++generation.current;};
 const finish=(g:number)=>{if(generation.current===g){busyRef.current=false;setBusy(false);}};
 const resetCommand=()=>{setStale(false);if(pending.current){setUncertain(true);setMode(pending.current.mode);setReason(pending.current.reason);setOwner(pending.current.owner||'');return;}setUncertain(false);setReason('');setOwner('');setMode('explain');};
 const confirmed=()=>{try{clearPendingCaseOperation(user!.id);pending.current=null;setUncertain(false);}catch{setStorageError(true);}};
 const loadList=async(q:CaseQuery,stack:(string|undefined)[]=[undefined])=>{
  const g=start();if(g===null)return;setDetail(null);setSelectedId(null);resetCommand();
  // Retain failed query/cursor for an exact read retry; never show an old page as new results.
  setQuery(q);setCursors(stack);setPage(null);
  try{const result=await apiListAttendanceCases({...q,afterId:stack.at(-1)});if(generation.current===g)setPage(result);}
  catch(e){if(generation.current===g)setError(errorText(e));}finally{finish(g);}
 };
 const loadDetail=async(id:string)=>{
  const g=start();if(g===null)return;setSelectedId(id);setDetail(null);
  try{const result=await apiGetAttendanceCase(id);if(generation.current===g){setDetail(result);resetCommand();}}
  catch(e){if(generation.current===g)setError(errorText(e));}finally{finish(g);}
 };
 const send=async()=>{
  if(!detail||storageError||(pending.current&&pending.current.caseId!==detail.id)||(stale&&!pending.current)||(!pending.current&&(!reason.trim()||(mode==='assign'&&!owner.trim()))))return;
  const g=start();if(g===null)return;
  const retrying=!!pending.current;
  const command=pending.current||{caseId:detail.id,mode,operationId:crypto.randomUUID(),reason:reason.trim(),...(mode==='assign'?{owner:owner.trim()}:{}),expectedRevision:detail.revision,expectedEvidenceVersion:detail.expectedEvidenceVersion};
  try{savePendingCaseOperation(user!.id,command);}catch{setStorageError(true);setError('無法保存操作識別，本次未送出；請先處理瀏覽器儲存問題。');finish(g);return;}
  pending.current=command;setUncertain(true);
  try{
   await apiActAttendanceCase(command);
   // A confirmed write is never retried merely because the follow-up GET failed.
   confirmed();setStale(true);setReason('');
   setNotice('操作已受理；案件狀態不代表正式月結已放行。');
   const current=await apiGetAttendanceCase(detail.id);
   if(generation.current===g){setDetail(current);resetCommand();}
  }catch(e){if(generation.current===g){setError(errorText(e));if(!retrying&&e instanceof APIError&&[400,403,404,409,423].includes(e.status)){confirmed();setStale(true);}}}
  finally{finish(g);}
 };
 const back=()=>{setRelated(null);if(query)void loadList(query,cursors);};
 const context=detail?caseFormContext(detail):undefined;
 const closed=detail&&['resolved','cancelled'].includes(detail.status);
 const queryDirty=query&&(query.empId!==(manager?empId.trim():user?.id)||query.yearMonth!==month||(query.status||'')!==status||(query.type||'')!==type);
 return <section className="mx-auto max-w-4xl space-y-4" aria-label="異常待辦中心">
  <h2 className="text-2xl font-bold">出勤異常待辦</h2>
  <p className="rounded bg-amber-50 p-3 text-sm">異常是待核實的差異，不直接判定曠職或扣薪。正式月結仍 BLOCKED；完整加班／補休流程未提供，政策待設定。</p>
  {storageError&&<p role="alert">操作暫存無法確認，已停止新寫入。請保留此分頁交由支援核實，勿清除資料後盲目重送。</p>}
  {uncertain&&pending.current&&<div className="rounded border p-3"><p>仍有未確認操作。讀取或切頁不代表操作成功，原識別與內容會保留；不會自動重送。請勿關閉分頁或清除瀏覽器資料；換裝置前須先查證結果。</p><button className={button} disabled={busy} onClick={()=>void loadDetail(pending.current!.caseId)}>返回未確認案件</button></div>}
  {related ? <>
   <button className={button} onClick={()=>setRelated(null)}>返回案件詳情</button>
   <p className="text-sm">沿用既有{manager?'審核':'申請'}流程；帶入案件員工與可確定日期，時間仍須核實，不自動核准。完成後請返回案件並重新載入，必要時由管理者重核來源。</p>
   <p className="break-all">案件 {context?.caseId} · 員工 {context?.empId} · {context&&date(context.start)} – {context&&date(context.end)}（台北）；{context?.date?'案件日期 '+context.date:'日期未能確定，請明確選擇'}</p>
   <Suspense fallback={<p role="status">載入既有表單…</p>}>
    {related==='makeup'?(manager?<MakeupReview caseContext={context}/>:<Makeup caseContext={context}/>):(manager?<LeaveReview caseContext={context}/>:<Leave caseContext={context}/>)}
   </Suspense>
  </> : <>
  {!selectedId&&<form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void loadList({empId:manager?empId.trim():user!.id,yearMonth:month,...(status?{status}:{}),...(type?{type}:{})});}}>
   {manager?<label>員工編號<input className={field} value={empId} required maxLength={150} onChange={e=>setEmpId(e.target.value)} disabled={busy}/></label>:<p>本人：{user?.name}（{user?.id}）</p>}
   <label>案件月份<input className={field} type="month" value={month} required onChange={e=>setMonth(e.target.value)} disabled={busy}/></label>
   <label>案件狀態<select className={field} value={status} onChange={e=>setStatus(e.target.value as CaseStatus|'')} disabled={busy}><option value="">全部狀態</option>{Object.entries(caseStatuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label>異常類別<select className={field} value={type} onChange={e=>setType(e.target.value as CaseType|'')} disabled={busy}><option value="">全部類別</option>{Object.entries(caseTypes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <button className={button} disabled={busy}>查詢案件</button>
  </form>}
  {busy&&<p role="status">處理中…</p>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<div role="alert" className="rounded bg-red-50 p-3"><p>{error}</p>{!selectedId&&query&&<button className={button} disabled={busy} onClick={()=>void loadList(query,cursors)}>重試查詢</button>}</div>}
  {selectedId&&<div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={back}>返回案件列表</button><button className={button} disabled={busy} onClick={()=>void loadDetail(selectedId)}>重新載入案件</button></div>}
  {!selectedId&&page&&<>
   <p className="text-sm">查詢：{query?.empId}／{query?.yearMonth}，第 {cursors.length} 頁，每頁最多 50 筆。{queryDirty?'篩選已變更，請按查詢套用。':''}</p>
   {!page.cases.length&&<p>此篩選沒有案件；這不代表出勤已完整驗證或可正式月結。</p>}
   <ul className="space-y-3">{page.cases.map(c=><li key={c.id} className="rounded border bg-white p-4 break-words"><p className="font-semibold">{caseTypes[c.type]} · {caseStatuses[c.status]}</p><p>{date(c.window.start)} – {date(c.window.end)}（台北）</p><p>負責人：{c.owner||'待指派'}</p><p>{c.reason}</p><button className={button} disabled={busy} onClick={()=>void loadDetail(c.id)}>查看案件 {c.id.slice(-8)}</button></li>)}</ul>
   <div className="flex gap-2"><button className={button} disabled={busy||cursors.length===1} onClick={()=>query&&void loadList(query,cursors.slice(0,-1))}>上一頁</button><button className={button} disabled={busy||!page.nextCursor} onClick={()=>query&&void loadList(query,[...cursors,page.nextCursor!])}>下一頁</button></div>
  </>}
  {detail&&<article className="space-y-4 rounded border bg-white p-4 break-words">
   <h3 className="text-xl font-bold">{caseTypes[detail.type]} · {caseStatuses[detail.status]}</h3>
   <p className="text-xs break-all">案件 {detail.id} · 版本 {detail.revision}</p>
   <p>員工 {detail.empId} · 負責人 {detail.owner||'待指派'}</p>
   <p>{date(detail.window.start)} – {date(detail.window.end)}（台北）</p>
   <p>來源判定：{detail.outcome==='unknown'?'資料或政策未完整':detail.outcome==='finding'?'仍有差異':'已具清除證據'}</p><p>{detail.reason}</p>
   <p className="text-sm">原始卡與完整核准證據不在此摘要中；申請待審及已核准未反映仍需各來源核實，說明不等於核准。</p>
   <div className="flex flex-wrap gap-2"><button className={button} disabled={busy||uncertain} onClick={()=>setRelated('makeup')}>{manager?'前往補打卡審核':'前往補打卡申請'}</button><button className={button} disabled={busy||uncertain} onClick={()=>setRelated('leave')}>{manager?'前往請假／外勤審核':'前往請假／外勤申請'}</button></div>
   <div className="rounded bg-gray-50 p-3"><h4 className="font-semibold">通知狀態（Sandbox，非真實送達）</h4><p>真實通知與排程未啟用；本頁只讀狀態，不能重送推播。</p>{detail.notifications? <><ul>{Object.entries(detail.notifications.counts).map(([k,n])=><li key={k}>{notificationStates[k]||'未確認'}：{n}</li>)}</ul>{!Object.keys(detail.notifications.counts).length&&<p>無通知紀錄，不能視為已送達。</p>}{!detail.notifications.complete&&<p>通知摘要超出上限，結果不完整。</p>}</>:<p>通知狀態尚未取得。</p>}</div>
   {(manager||!closed||uncertain)&&(!pending.current||pending.current.caseId===detail.id)&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void send();}}>
    <h4 className="font-semibold">{manager?'管理者處理':'提交本人說明'}</h4>
    {manager&&<label>處理方式<select className={field} value={mode} disabled={busy||uncertain||stale} onChange={e=>setMode(e.target.value as CaseCommand['mode'])}>
     <option value="explain" disabled={!!closed}>補充說明</option><option value="assign">指派負責人</option><option value="request-info" disabled={!!closed}>退回補件／要求說明</option><option value="resolve" disabled={!!closed}>重核來源並結案</option><option value="reopen" disabled={!closed}>重核來源並重開</option>
    </select></label>}
    {mode==='assign'&&<label>負責人管理員編號<input className={field} value={owner} maxLength={150} required disabled={busy||uncertain||stale} onChange={e=>setOwner(e.target.value)}/></label>}
    <label>處理原因／說明<textarea className={field} value={reason} required maxLength={2000} disabled={busy||uncertain||stale} onChange={e=>setReason(e.target.value)}/></label>
    <p className="text-sm">原因必填。退回補件只改案件狀態，不駁回既有申請；結案由伺服器重核來源，未知或未解差異不可自行清除。</p>
    <div className="flex gap-2"><button className={button} disabled={busy||storageError||(stale&&!uncertain)||(uncertain&&pending.current?.caseId!==detail.id)||(!uncertain&&(!reason.trim()||(mode==='assign'&&!owner.trim())))|| (!!closed&&mode==='explain'&&!uncertain)}>{uncertain?'重試原操作':'送出處理'}</button><button type="button" className={button} disabled={busy||uncertain} onClick={()=>{setReason('');setOwner('');}}>取消編輯</button></div>
    {stale&&<p>請先重新載入案件；不會自動覆蓋其他人的變更或自動重送。</p>}
   </form>}
   <h4 className="font-semibold">處理歷程</h4><ol className="space-y-2">{detail.history.map(h=><li key={h.id} className="border-l-2 pl-3"><p>版本 {h.revision} · {h.actor} · {new Date(h.at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}（台北）</p><p>{h.from?caseStatuses[h.from]:'建立'} → {caseStatuses[h.to]}</p><p>{h.reason}</p></li>)}</ol>
  </article>}
  </>}
 </section>;
}
