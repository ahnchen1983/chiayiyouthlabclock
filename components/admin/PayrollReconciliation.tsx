import React,{useEffect,useRef,useState} from 'react';
import {UserRole} from '../../types';
import {useAuth} from '../../contexts/AuthContext';
import {APIError,getPayrollReconciliation} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {payrollItemIdentity,payrollItemIdentifier,payrollItemMonth} from '../../utils/payroll/items';

type Action='propose-payroll-reconciliation'|'review-payroll-reconciliation';
const states:Record<string,string>={proposed:'待獨立覆核',approved:'對帳證據已核定',returned:'已退回'};
const field='border rounded p-2 block w-full min-w-0',button='border rounded px-3 py-2 disabled:opacity-50';
const refs=(v:string)=>v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const refsOkay=(v:string)=>{const all=refs(v);return all.length>0&&all.length<=20&&all.every(payrollItemIdentifier)&&new Set(all).size===all.length;};
const reasonOkay=(v:string)=>v.trim().length>=5&&v.trim().length<=2000;
function rosterOkay(value:any,month:string,ready:boolean){
 if(!value||value.month!==month||!Array.isArray(value.employeeIds)||!Array.isArray(value.employees)||value.employeeIds.length!==value.employees.length||new Set(value.employeeIds).size!==value.employeeIds.length||new Set(value.employees.map((e:any)=>e?.empId)).size!==value.employees.length)throw Error('roster scope');
 for(const e of value.employees){
  if(!payrollItemIdentity(e.empId)||!value.employeeIds.includes(e.empId)||!(e.netSalary===null||typeof e.netSalary==='number'&&Number.isFinite(e.netSalary))||!['verified-recorded','needs-review'].includes(e.paymentStatus))throw Error('employee evidence');
  if(ready&&(e.netSalary===null||e.paymentStatus!=='verified-recorded'))throw Error('unresolved candidate');
  if(!ready&&(!Array.isArray(e.issues)||e.issues.some((i:any)=>typeof i!=='string')))throw Error('employee issues');
 }
 if(ready&&(!payrollItemIdentifier(value.sourceHash)||!payrollItemIdentifier(value.prerequisitesHash)))throw Error('source digest');
 if(!ready&&(!Array.isArray(value.issues)||value.issues.some((i:any)=>typeof i!=='string')))throw Error('assessment issues');
}
function Roster({value,ready=false}:{value:any;ready?:boolean}){
 return <div className="space-y-2 text-sm"><p>完整名冊：{value.employeeIds.length} 人</p>{ready&&<><p className="break-all">來源摘要：{value.sourceHash}</p><p className="break-all">前提證據摘要：{value.prerequisitesHash}</p></>}{value.issues?.map((issue:string,i:number)=><p key={i}>{issue}</p>)}{value.employees.length?value.employees.map((row:any)=><article key={row.empId} aria-label={'對帳員工 '+row.empId} className="border rounded p-3 space-y-1 min-w-0"><h4 className="font-semibold">員工 {row.empId}</h4><p>計算淨額：{row.netSalary===null?'待核實':row.netSalary}</p><p>實際付款證據：{row.paymentStatus==='verified-recorded'?'已核對既有給付紀錄':'尚待核實'}</p>{row.issues?.map((issue:string,i:number)=><p key={i}>{issue}</p>)}</article>):<p>目前名冊沒有員工；是否具備核定條件由伺服器確認。</p>}</div>;
}
function Version({value}:{value:any}){return <div className="space-y-2 text-sm"><p>操作人：{value.actor}；時間：{value.at}</p><p>來源識別：{value.sourceRefs.join('、')}；原因：{value.reason}</p><Roster value={value.candidate} ready/></div>;}
export default function PayrollReconciliation(){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id;
 const [month,setMonth]=useState(''),monthRef=useRef(''),generation=useRef(0),sending=useRef(false);
 const [bound,setBound]=useState<string|null>(null),[data,setData]=useState<any>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refreshRequired,setRefreshRequired]=useState(false),[message,setMessage]=useState('');
 const [sourceRefs,setSourceRefs]=useState(''),[reason,setReason]=useState(''),[reviewReason,setReviewReason]=useState('');
 const clear=()=>{setSourceRefs('');setReason('');setReviewReason('');};
 useEffect(()=>()=>{generation.current++;},[]);
 const change=(next:string)=>{monthRef.current=next;setMonth(next);generation.current++;setLoading(false);setBound(null);setData(null);setMessage('');setRefreshRequired(false);clear();};
 const load=async()=>{
  const target=monthRef.current;if(!payrollItemMonth(target)){setMessage('請選擇有效的對帳月份。');return;}
  const n=++generation.current;setLoading(true);setData(null);setBound(null);setMessage('');
  try{
   const value=await getPayrollReconciliation({month:target});if(n!==generation.current||target!==monthRef.current)return;
   if(value.month!==target||!Array.isArray(value.versions)||!Array.isArray(value.candidateIssues)||!Array.isArray(value.eligibleActions))throw Error('scope');
   if(value.candidate)rosterOkay(value.candidate,target,true);
   if(value.assessment)rosterOkay(value.assessment,target,false);
   for(const [index,v] of value.versions.entries()){
    if(v.month!==target||v.revision!==index+1||!Object.hasOwn(states,v.status)||!payrollItemIdentity(v.actor)||!Array.isArray(v.sourceRefs)||!v.sourceRefs.every(payrollItemIdentifier))throw Error('version');
    rosterOkay(v.candidate,target,true);
   }
   if(value.current&&(!value.versions.length||value.current.id!==value.versions.at(-1).id||value.current.revision!==value.versions.length||JSON.stringify(value.current)!==JSON.stringify(value.versions.at(-1))))throw Error('head');
   if(!value.current&&value.versions.length)throw Error('missing head');
   setData(value);setBound(target);setRefreshRequired(false);clear();
  }catch{if(n===generation.current)setMessage('對帳資料讀取失敗或名冊／歷程不一致，請重新查詢。');}
  finally{if(n===generation.current)setLoading(false);}
 };
 const current=data?.current,revision=current?.revision??0,manage=data?.canManage===true&&user?.role===UserRole.SuperAdmin;
 const subject=data?.candidate?.employeeIds?.includes(me)||current?.candidate?.employeeIds?.includes(me);
 const author=data?.versions?.some((v:any)=>v.status==='proposed'&&v.actor===me);
 const blocked=busy||loading||op.busy||!!op.pending||op.blocked||refreshRequired||!manage||!bound||bound!==month||!!subject;
 const canPropose=manage&&!subject&&data?.eligibleActions?.includes('propose-payroll-reconciliation')&&(!current||['approved','returned'].includes(current.status));
 const canReview=manage&&!subject&&!author&&data?.eligibleActions?.includes('review-payroll-reconciliation')&&current?.status==='proposed';
 const candidateReady=!!data?.candidate&&data.candidateIssues.length===0;
 const send=async(action:Action,extra:Record<string,unknown>)=>{
  if(blocked||sending.current||!bound)return;const target=bound;sending.current=true;setBusy(true);setMessage('');
  const command={caseId:'payroll-reconciliation:'+target,month:target,expectedRevision:revision,operationId:crypto.randomUUID(),...extra};
  try{await op.attempt({action,command});if(monthRef.current===target)await load();}
  catch(error){if(monthRef.current===target){if(error instanceof APIError&&[409,423].includes(error.status)){setRefreshRequired(true);setMessage('名冊、付款證據或來源版本已變更，請重新查詢後處理。');}else setMessage('操作結果未確認或未通過，請先核實原操作，不要另送相同內容。');}}
  finally{sending.current=false;setBusy(false);}
 };
 return <section className="p-4 max-w-4xl mx-auto space-y-4 min-w-0 break-words"><h2 className="text-xl font-bold">月薪資對帳</h2><p>逐人核對完整名冊、計薪前提與既有實際付款證據。任何缺漏或不一致都須先處理，不能以填寫核定原因消除。</p><p className="text-sm font-semibold">本頁只記錄對帳證據。核定不會付款或自動鎖月；正常鎖月仍須重新確認所有來源及核定版本有效。</p><AnomalyOperationRecovery onResolved={()=>void load()}/>
  <div className="flex flex-wrap gap-2 items-end"><label>對帳月份<input className={field} type="month" value={month} onChange={e=>change(e.target.value)}/></label><button type="button" className={button} disabled={loading} onClick={()=>void load()}>查詢月薪資對帳</button></div>
  {loading&&<p role="status">正在查詢完整名冊與付款證據。</p>}{message&&<p role="status">{message}</p>}
  {data&&bound&&<><p className="font-semibold">目前對帳月份：{bound}</p>{data.stale&&<p role="alert">已保存對帳版本的來源已變更，不能沿用核定；待覆核提案可先退回。</p>}
   <section aria-label="本月完整名冊與待辦" className="space-y-2"><h3 className="font-semibold">本月完整名冊與待辦</h3>{data.candidateIssues.map((issue:string,i:number)=><p key={i}>{issue}</p>)}{candidateReady?<><p>目前完整來源符合提出對帳條件，仍須獨立覆核。</p><Roster value={data.candidate} ready/></>:<><p>目前來源尚未完整，不可提出或核定月對帳。</p>{data.assessment?<Roster value={data.assessment}/>:<p>完整名冊評估尚未取得，不能視為無待辦。</p>}</>}</section>
   {current?<article className="border rounded p-3 space-y-2"><h3 className="font-semibold">對帳版本 {revision} · {states[current.status]}</h3><Version value={current}/>{current.status==='approved'&&<p>已核定此版本對帳證據；來源變更後須重新核對。</p>}</article>:<p>尚未提出本月對帳證據。</p>}
   {canPropose&&<fieldset disabled={blocked} className="border rounded p-3 space-y-2"><legend>提出月薪資對帳</legend><label className="block">月對帳來源識別（每行一筆）<textarea className={field} value={sourceRefs} onChange={e=>setSourceRefs(e.target.value)}/></label><label className="block">月對帳提案原因<textarea className={field} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="button" className={button} disabled={blocked||!candidateReady||!refsOkay(sourceRefs)||!reasonOkay(reason)} onClick={()=>{if(candidateReady&&refsOkay(sourceRefs)&&reasonOkay(reason))void send('propose-payroll-reconciliation',{sourceRefs:refs(sourceRefs),reason:reason.trim(),expectedCandidateHash:data.candidate.prerequisitesHash});}}>提出月對帳證據</button></fieldset>}
   {(subject||author)&&<p>本月薪資名冊內人員或任何歷史提案者不能獨立覆核本月對帳。</p>}
   {canReview&&<fieldset disabled={blocked} className="border rounded p-3 space-y-2"><legend>獨立覆核月對帳</legend><label className="block">月對帳覆核／退回原因<textarea className={field} maxLength={2000} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked||!candidateReady||data.stale!==false||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-reconciliation',{mode:'approve',reason:reviewReason.trim()})}>核定月對帳證據</button><button type="button" className={button} disabled={blocked||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-reconciliation',{mode:'return',reason:reviewReason.trim()})}>退回月對帳提案</button></div></fieldset>}
   <section aria-label="月薪資對帳歷史版本" className="space-y-2"><h3 className="font-semibold">月薪資對帳歷史版本（唯讀）</h3>{data.versions.map((v:any)=><details key={v.revision} className="border rounded p-3"><summary>版本 {v.revision} · {states[v.status]}</summary><Version value={v}/></details>)}</section>
  </>}
 </section>;
}
