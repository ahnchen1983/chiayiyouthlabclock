import React,{useEffect,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {LeaveStatus,type LeaveRequest} from '../types';
import {apiExplanationWorkflow,type CaseExplanationWorkflow} from '../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../hooks/useAnomalyOperation';
export default function CaseLeaveReviewActions({request,onChanged}:{request:LeaveRequest;onChanged:()=>void}){
 const {user}=useAuth(),op=useAnomalyOperation();const [w,setW]=useState<CaseExplanationWorkflow|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{try{setW(await apiExplanationWorkflow(request.caseId!));setError('');}catch{setW(null);setError('案件來源讀取失敗，不能核准。');}};useEffect(()=>{void load();},[request.id,request.revision]);
 const send=async(mode:'approve'|'reject')=>{if(busy||!w||op.pending||op.blocked)return;setBusy(true);try{await op.attempt({action:'review-case-leave',command:{caseId:request.caseId!,expectedCaseRevision:w.caseRevision,expectedEvidenceVersion:w.evidenceVersion,leaveRequestId:request.id,expectedRevision:request.revision,operationId:crypto.randomUUID(),mode,reason:reason.trim()}});onChanged();}catch{setError('版本、來源、權限或鎖月檢查未通過／結果未確認，請核對原操作。');}finally{setBusy(false);}};
 return <section aria-label={'追補假審核 '+request.id} className="border p-3 space-y-2"><p>追補假版本 {request.revision}；僅核准假單事實，不自動核定計薪比例、外勤工時或消除卡假重疊。</p><p>{request.reviewIssues?.join('／')}</p>{error&&<p role="alert">{error}</p>}
  {request.status===LeaveStatus.Pending&&user?.id!==request.empId&&<><label>追補假審核原因<input className="block border w-full" value={reason} maxLength={2000} disabled={busy||!!op.pending} onChange={e=>setReason(e.target.value)}/></label><button type="button" disabled={busy||op.busy||!!op.pending||op.blocked||!w||reason.trim().length<5} onClick={()=>void send('approve')}>核准追補假（仍須計薪覆核）</button><button type="button" disabled={busy||op.busy||!!op.pending||op.blocked||!w||reason.trim().length<5} onClick={()=>void send('reject')}>駁回追補假</button></>}
  {user?.id===request.empId&&<p>本人不能自行審核。</p>}
  <button type="button" disabled={busy} onClick={()=>void load()}>重新讀取追補來源</button><details><summary>假單來源歷程</summary>{request.history?.map(h=><p key={h.id}>{h.at} · {h.actor} · {h.from||'建立'} → {h.to}：{h.reason}</p>)}</details>
 </section>;
}
