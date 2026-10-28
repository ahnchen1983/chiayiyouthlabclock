import React,{useEffect,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {UserRole} from '../types';
import {apiOvertimeCompPolicy} from '../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../hooks/useAnomalyOperation';
const STATUS:Record<string,string>={'awaiting-employee':'待員工同意','awaiting-approval':'待另一位管理者核定',approved:'已核定',returned:'已退回'};
// LSA Art.32-1: the employee chooses comp per overtime; this arrangement only
// fixes reviewers, effective period and the statutory deadline (year-end).
export default function OvertimeCompPolicyPanel({empId}:{empId:string}){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id,manager=[UserRole.Admin,UserRole.SuperAdmin].includes(user!.role);
 const [data,setData]=useState<any>(null),[reviewers,setReviewers]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[reason,setReason]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{try{setData(await apiOvertimeCompPolicy(empId));setMsg('');}catch{setData(null);setMsg('加班／補休政策讀取失敗或無權限。');}};
 useEffect(()=>{void load();},[empId]);
 const p=data?.proposal,blocked=busy||op.busy||!!op.pending||op.blocked||!data;
 const send=async(action:'propose-overtime-comp-policy'|'agree-overtime-comp-policy'|'review-overtime-comp-policy',extra:any={})=>{setBusy(true);try{await op.attempt({action,command:{caseId:'overtime-comp-policy:'+empId,empId,operationId:crypto.randomUUID(),expectedRevision:p?.revision||0,...extra}});setReason('');await load();}catch{setMsg('操作未通過或結果未知（版本變更、權限）；請重新讀取核實。');}finally{setBusy(false);}};
 return <section className="border rounded p-3 space-y-2 break-words"><h3 className="font-semibold">加班／補休政策</h3>
  <p className="text-sm text-gray-600">平日延長工時與休息日工作可依員工選擇按 1:1 轉補休（勞基法第32條之1）；補休期限為加班當年 12/31（特休曆年制，施行細則第22條之2），到期或離職未休依原加班日標準發給工資。例假、國定假日出勤不適用。</p>
  {data?.current?<p className="text-sm">目前生效：{data.current.effectiveFrom}–{data.current.effectiveTo}</p>:<p className="text-sm">尚未核定，加班改補休暫不可用。</p>}
  {p&&<p className="text-sm">提案：{STATUS[p.status]||p.status} · {p.effectiveFrom}–{p.effectiveTo}</p>}
  {p?.status==='awaiting-employee'&&empId===me&&<button type="button" disabled={blocked} onClick={()=>void send('agree-overtime-comp-policy')} className="px-3 py-1 rounded bg-brand-blue-dark text-white disabled:opacity-50">我同意此加班／補休安排</button>}
  {manager&&empId!==me&&<>
   {p&&['awaiting-employee','awaiting-approval'].includes(p.status)&&p.proposedBy!==me&&<div className="space-y-1"><label className="block text-sm">核定／退回原因（至少5字）<textarea className="border block w-full" value={reason} disabled={blocked} onChange={e=>setReason(e.target.value)}/></label>
    <div className="flex gap-2"><button type="button" disabled={blocked||reason.trim().length<5||p.status!=='awaiting-approval'} onClick={()=>void send('review-overtime-comp-policy',{mode:'approve',reason:reason.trim()})} className="px-3 py-1 rounded bg-green-700 text-white disabled:opacity-50">核定政策</button><button type="button" disabled={blocked||reason.trim().length<5} onClick={()=>void send('review-overtime-comp-policy',{mode:'return',reason:reason.trim()})} className="px-3 py-1 rounded border disabled:opacity-50">退回</button></div>
    {p.status==='awaiting-employee'&&<p className="text-xs text-gray-500">員工同意後才能核定。</p>}</div>}
   {p&&p.proposedBy===me&&['awaiting-employee','awaiting-approval'].includes(p.status)&&<p className="text-xs text-gray-500">自己提出的政策需由另一位管理者核定。</p>}
   <details><summary className="text-sm">提出新政策</summary><div className="grid gap-2 sm:grid-cols-2 mt-2">
    <label className="text-sm">覆核人員工編號（逗號分隔）<input className="border block w-full" value={reviewers} disabled={blocked} onChange={e=>setReviewers(e.target.value)}/></label>
    <label className="text-sm">生效起日<input type="date" className="border block" value={from} disabled={blocked} onChange={e=>setFrom(e.target.value)}/></label>
    <label className="text-sm">生效迄日<input type="date" className="border block" value={to} disabled={blocked} onChange={e=>setTo(e.target.value)}/></label>
    <label className="text-sm sm:col-span-2">提出原因（至少5字）<textarea className="border block w-full" value={reason} disabled={blocked} onChange={e=>setReason(e.target.value)}/></label></div>
    <button type="button" disabled={blocked||!reviewers.trim()||!from||!to||reason.trim().length<5} onClick={()=>void send('propose-overtime-comp-policy',{reviewerIds:reviewers.split(',').map(s=>s.trim()).filter(Boolean),effectiveFrom:from,effectiveTo:to,reason:reason.trim()})} className="mt-2 px-3 py-1 rounded bg-brand-blue-dark text-white disabled:opacity-50">送出政策提案</button></details>
  </>}
  {msg&&<p role="status" className="text-sm">{msg}</p>}
 </section>;
}
