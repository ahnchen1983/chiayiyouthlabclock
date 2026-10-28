import React,{useEffect,useRef,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {UserRole} from '../types';
import {apiExplanationWorkflow,apiGetAllLeaveRequests,apiGetEmployeeLeaveRequests,type CaseExplanationWorkflow} from '../services/googleAppsScriptAPI';
import {useAnomalyOperation,type AnomalyIntent} from '../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from './AnomalyOperationRecovery';
export default function CaseExplanationPanel({caseId,caseRevision,onLeave,onChanged}:{caseId:string;caseRevision:number;onLeave:(explanationId?:string,leaveRequestId?:string)=>void;onChanged?:()=>void}){
 const {user}=useAuth(),op=useAnomalyOperation();const [w,setW]=useState<CaseExplanationWorkflow|null>(null),[text,setText]=useState(''),[reason,setReason]=useState(''),[prior,setPrior]=useState<any>(null),[leaveId,setLeaveId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const manager=user?.role===UserRole.Admin||user?.role===UserRole.SuperAdmin,own=w?.empId===user?.id;
 const load=async()=>{const token=++generation.current;setW(null);setPrior(null);setText('');try{const value=await apiExplanationWorkflow(caseId);if(token!==generation.current)return;if(value.caseId!==caseId)throw Error('case scope mismatch');setW(value);setError('');}catch{if(token===generation.current){setW(null);setError('獨立說明／假單來源無法讀取，不能假設已完成。');}}};
 useEffect(()=>{void load();return()=>{generation.current++;};},[caseId,caseRevision]);
 const base=()=>({caseId,expectedCaseRevision:w!.caseRevision,expectedEvidenceVersion:w!.evidenceVersion,operationId:crypto.randomUUID()});
 const send=async(intent:AnomalyIntent)=>{if(busy||op.busy||op.pending||op.blocked)return;setBusy(true);setError('');try{await op.attempt(intent);setPrior(null);setText('');setReason('');await load();onChanged?.();}catch{setError('版本、權限、鎖月或來源檢查未通過／結果未確認；請先核實原操作。');}finally{setBusy(false);}};
 const terminal=!!w&&['resolved','cancelled'].includes(w.caseStatus||'');
 const recoveryVerified=w?.sourceFreshness==='verified'&&w?.explanationInventoryStatus==='complete';
 const staleAccepted=(id:string)=>recoveryVerified&&w?.resubmittableAcceptedIds?.includes(id)===true;
 const replacement=(id:string)=>recoveryVerified&&w?.resubmittableReplacementIds?.includes(id)===true;
 const reviewable=(id:string)=>recoveryVerified&&w?.reviewableReplacementIds?.includes(id)===true;
 const disabled=busy||op.busy||!!op.pending||op.blocked||!w;
 return <section className="border rounded p-3 space-y-3" aria-label="獨立異常說明與追補假"><h4 className="font-semibold">獨立異常說明與追補假</h4><p>說明採納不等於假單核准、工作已核定或薪資扣款。追補假另走既有審核與分配覆核；未知政策、卡假重疊仍待核。</p>
  <AnomalyOperationRecovery onResolved={()=>{void load();onChanged?.();}}/>{error&&<p role="alert">{error}</p>}
  {terminal&&<p>案件仍維持結案狀態；替換說明不會重開案件。</p>}
  {own&&(!terminal||prior)&&<><label>異常說明內容<textarea aria-label="異常說明內容" className="block border w-full" maxLength={2000} value={text} disabled={disabled} onChange={e=>setText(e.target.value)}/></label><button type="button" disabled={disabled||text.trim().length<5} onClick={()=>void send({action:prior?'act-anomaly-explanation':'submit-anomaly-explanation',command:{...base(),reason:text.trim(),text:text.trim(),...(prior?{mode:'resubmit',explanationId:prior.id,expectedRevision:prior.revision}:{})}})}>{prior?'重送獨立說明新版本':'送出獨立異常說明'}</button>{prior&&<button type="button" disabled={disabled} onClick={()=>{setPrior(null);setText('');}}>取消說明編輯</button>}</>}
  <label>異常說明與假單操作理由<input className="block border w-full" value={reason} maxLength={2000} disabled={disabled} onChange={e=>setReason(e.target.value)}/></label>
  {w?.explanations.map(e=><article key={e.id} className="border-t pt-2 space-y-1 break-all"><p>{e.id} · v{e.revision} · {e.status}</p><p>{e.text}</p>{e.supersedesId&&<p>前版 {e.supersedesId}</p>}
   {manager&&!own&&e.status==='submitted'&&(!terminal||reviewable(e.id))&&(['request-info','accept','reject'] as const).map(mode=><button type="button" key={mode} disabled={disabled||reason.trim().length<5} onClick={()=>void send({action:'act-anomaly-explanation',command:{...base(),mode,explanationId:e.id,expectedRevision:e.revision,reason:reason.trim()}})}>{({'request-info':'要求說明補件',accept:'採納說明（不核准假單）',reject:'退回說明'})[mode]}</button>)}
   {own&&['submitted','needs-info'].includes(e.status)&&<button type="button" disabled={disabled||reason.trim().length<5} onClick={()=>void send({action:'act-anomaly-explanation',command:{...base(),mode:'cancel',explanationId:e.id,expectedRevision:e.revision,reason:reason.trim()}})}>撤回未採納說明</button>}
   {own&&['needs-info','rejected','cancelled'].includes(e.status)&&(!terminal||replacement(e.id))&&<button type="button" disabled={disabled} onClick={()=>{setPrior(e);setText(e.text);}}>補件重送說明</button>}
   {own&&e.status==='accepted'&&staleAccepted(e.id)&&<><p>原採納依據已失效，且新來源已核實。請明確填寫新說明，由另一位主管審核；原版與歷程保留。</p><button type="button" disabled={disabled} onClick={()=>{setPrior(e);setText('');}}>依新來源重送已失效說明</button></>}
   {own&&e.status==='accepted'&&!terminal&&!staleAccepted(e.id)&&<button type="button" disabled={disabled} onClick={()=>onLeave(e.id)}>依採納說明補送假單</button>}
   <details><summary>說明版本歷程</summary>{e.history.map(h=><p key={h.id}>{h.at} · {h.actor} · {h.from||'建立'} → {h.to}：{h.reason}</p>)}</details>
  </article>)}
  <h5>已關聯假單（核准不等於計薪完成）</h5>{w?.leaves.map(r=><div key={r.id} className="break-all"><p>{r.id} · {r.leaveType} · {r.startDate} – {r.endDate} · {r.status}</p><p>{r.reviewIssues?.join('／')||'舊資料政策與來源仍需核對'}</p><button type="button" onClick={()=>onLeave(undefined,r.id)}>開啟關聯假單</button></div>)}
  <label>既有假單識別<input className="block border w-full" value={leaveId} disabled={disabled} onChange={e=>setLeaveId(e.target.value)}/></label><button type="button" disabled={disabled||!leaveId.trim()||reason.trim().length<5} onClick={async()=>{try{const requests=manager?await apiGetAllLeaveRequests():await apiGetEmployeeLeaveRequests(user!.id),r=requests.find(r=>r.id===leaveId.trim()&&r.empId===w!.empId);if(!r)throw Error();await send({action:'link-case-leave',command:{...base(),leaveRequestId:r.id,expectedRevision:r.revision||0,reason:reason.trim()}});}catch{setError('找不到有權讀取的對應假單，未建立關聯。');}}}>關聯既有假單</button>
  <button type="button" disabled={busy} onClick={()=>void load()}>重新讀取獨立說明與假單</button>
 </section>;
}
