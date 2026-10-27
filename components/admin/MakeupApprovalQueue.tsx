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
 const visible=filter==='pending'?scoped.filter(r=>['待審核','待補件'].includes(r.status)):scoped;
 return <div className="bg-white rounded p-4 space-y-4"><h1 className="text-2xl font-bold">補打卡審核</h1><p>指定主管與期限政策待設定，沿用既有管理角色；不可自核本人申請。核准須檢查來源鏈，案件不自動結案。</p>
  {requestId&&<p className="break-all">指定申請：{requestId}</p>}
  <div className="flex gap-3"><button onClick={()=>setFilter('pending')}>待審核／待補件</button><button onClick={()=>setFilter('all')}>全部</button><button disabled={loading} onClick={()=>void load()}>重新載入補卡清單</button></div>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">載入中…</p>}
  {visible.map(r=><article key={r.id} className="border rounded p-3 space-y-2 break-words"><p>{r.name}（{r.empId}） · {r.date} · {r.type}</p><p>{r.requestedClockInAt||r.requestedClockIn||'—'} / {r.requestedClockOutAt||r.requestedClockOut||'—'}</p><p>{r.reason}</p><MakeupRequestActions request={r} onChanged={()=>void load()}/></article>)}
  {!loading&&!visible.length&&!error&&<p>此範圍無申請，不代表案件或計薪已驗證完成。</p>}
 </div>;
}
