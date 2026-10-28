import React, { useEffect, useState } from 'react';
import { contextDateMatches, type CaseFormContext } from '../../utils/caseFormContext';
import { apiGetMakeupRequests } from '../../services/googleAppsScriptAPI';
import type { ClockMakeupRequest } from '../../types';
import MakeupRequestActions from '../MakeupRequestActions';
export default function MakeupApprovalQueue({caseContext,requestId}:{caseContext?:CaseFormContext;requestId?:string}={}){
 const [list,setList]=useState<ClockMakeupRequest[]>([]),[filter,setFilter]=useState('pending'),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const load=async()=>{setLoading(true);try{setList(await apiGetMakeupRequests());setError('');}catch{setError('補卡申請載入失敗，不能當作沒有待審。');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 const scoped=list.filter(r=>(!requestId||r.id===requestId||r.supersedesRequestId===requestId)&&(!caseContext||r.empId===caseContext.empId&&contextDateMatches(caseContext,r.date)));
 const visible=filter==='pending'?scoped.filter(r=>['待審核','待補件'].includes(r.status)):scoped.filter(r=>!['待審核','待補件'].includes(r.status));
 return <div className="bg-white rounded p-4 space-y-4 yl-leave"><h1 className="text-2xl font-bold">補打卡審核</h1><p>核准後會寫入出勤紀錄。</p>
  {requestId&&<p className="break-all">指定申請：{requestId}</p>}
  <div className="yl-tabs flex gap-3"><button className={filter==='pending'?'yl-tab is-selected':'yl-tab'} onClick={()=>setFilter('pending')}>待簽核</button><button className={filter==='all'?'yl-tab is-selected':'yl-tab'} onClick={()=>setFilter('all')}>已處理</button><button disabled={loading} onClick={()=>void load()}>重新載入補卡清單</button></div>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">載入中…</p>}
  {visible.map(r=><article key={r.id} className="yl-request-card border rounded p-3 space-y-2 break-words"><p className="font-semibold">{r.name} · {r.date} · {r.type==='上班'?'補上班':r.type==='下班'?'補下班':'補上下班'}</p><p>{r.requestedClockIn||'—'} / {r.requestedClockOut||'—'}</p><p>{r.reason}</p><MakeupRequestActions request={r} onChanged={()=>void load()}/></article>)}
  {!loading&&!visible.length&&!error&&<p>這一段沒有申請。</p>}
 </div>;
}
