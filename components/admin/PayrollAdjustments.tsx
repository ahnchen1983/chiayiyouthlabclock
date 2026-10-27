import React,{useEffect,useRef,useState} from 'react';
import {UserRole} from '../../types';
import {useAuth} from '../../contexts/AuthContext';
import {APIError,getPayrollAdjustment} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {payrollItemIdentity,payrollItemMonth,payrollItemIdentifier} from '../../utils/payroll/items';
import {validateAdjustmentAmounts,type AdjustmentAmounts} from '../../utils/payroll/adjustment';

type Query={scope:'current'|'historical';empId:string;month:string};
type Action='propose-payroll-adjustment'|'review-payroll-adjustment'|'adopt-payroll-adjustment'|'apply-payroll-adjustment';
const states:Record<string,string>={proposed:'待獨立覆核',reviewed:'已覆核',returned:'已退回',adopted:'已採納，尚未入帳',applied:'已記錄調整分錄'};
const labels:Record<string,string>={normal:'正常工資',overtime:'加班費','comp-settlement':'補休結清','insurance:labor':'勞保','insurance:employment':'就保','insurance:health':'健保','insurance:pension-self':'勞退自提','tax:income':'所得稅扣繳','health:supplementary':'補充保費','insurance:labor-employment':'原記錄勞就保合計','pension:self':'原記錄勞退自提',leave:'原記錄請假扣款'};
const field='border rounded p-2 block w-full min-w-0',button='border rounded px-3 py-2 disabled:opacity-50';
const same=(a:any,b:Query)=>a?.scope===b.scope&&a?.empId===b.empId&&a?.month===b.month;
const refs=(value:string)=>value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
const reasonOkay=(v:string)=>v.trim().length>=5&&v.trim().length<=2000;
const refsOkay=(v:string)=>{const all=refs(v);return all.length>0&&all.length<=20&&all.every(payrollItemIdentifier)&&new Set(all).size===all.length;};
const signed=(value:string)=>value==='0'||value.startsWith('-')?value:'+'+value;
const validRef=(v:any)=>v&&payrollItemIdentifier(v.id)&&Number.isSafeInteger(v.revision)&&v.revision>0&&payrollItemIdentifier(v.evidenceVersion);
function validProjection(p:any){
 if(!p)throw Error('missing projection');
 for(const key of ['baseline','target','cumulativeAdjustments','accountedTarget','outstanding'])validateAdjustmentAmounts(p[key]);
 if(typeof p.recordedActualNet!=='string'||p.recordedActualNet!==p.baseline.net||p.paymentStatus!=='not-paid'||p.automaticWageDeduction!==false)throw Error('invalid projection');
}
function Amounts({title,value,delta=false}:{title:string;value:AdjustmentAmounts;delta?:boolean}){
 return <section className="border rounded p-3 space-y-1 text-sm min-w-0" aria-label={title}><h4 className="font-semibold">{title}</h4>{value.lines.map(line=><p key={line.code}>{labels[line.code]||line.code} · {line.kind==='earning'?'應發':'扣項'}：{delta?signed(line.amount):line.amount}</p>)}<p className="font-semibold">淨額：{delta?signed(value.net):value.net}</p></section>;
}
function Projection({value,lastSnapshot=false}:{value:any;lastSnapshot?:boolean}){
 return <div className="space-y-2">{lastSnapshot&&<p className="text-sm">以下目標與餘額僅為上次入帳來源快照，尚未重新核對目前應付金額。</p>}<div className="grid sm:grid-cols-2 gap-2"><Amounts title="凍結實發證據基準" value={value.baseline}/><Amounts title={lastSnapshot?'上次入帳目標快照':'本次不可變計算目標'} value={value.target}/><Amounts title="累計已入帳調整" value={value.cumulativeAdjustments} delta/><Amounts title="基準加已入帳調整" value={value.accountedTarget}/></div><Amounts title={lastSnapshot?'上次入帳來源快照餘額':'尚待入帳差額（目標減已核算金額）'} value={value.outstanding} delta/><p className="text-sm">原記錄實發淨額：{value.recordedActualNet}。已入帳金額是核算紀錄，未代表新增實際轉帳。</p></div>;
}
function Version({value}:{value:any}){
 return <div className="space-y-2 text-sm"><p>操作人：{value.actor}；時間：{value.at}</p><p>入帳月份：{value.postingMonth}；比較版本：{value.comparisonRef.id} / {value.comparisonRef.revision}</p><p>來源識別：{value.sourceRefs.join('、')}；原因：{value.reason}</p><Projection value={value.projection}/></div>;
}
export default function PayrollAdjustments(){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id;
 const [query,setQuery]=useState<Query>({scope:'current',empId:'',month:''}),queryRef=useRef(query),generation=useRef(0),sending=useRef(false);
 const [bound,setBound]=useState<Query|null>(null),[data,setData]=useState<any>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refreshRequired,setRefreshRequired]=useState(false),[message,setMessage]=useState('');
 const [postingMonth,setPostingMonth]=useState(''),[sourceRefs,setSourceRefs]=useState(''),[reason,setReason]=useState(''),[reviewReason,setReviewReason]=useState(''),[adoptReason,setAdoptReason]=useState(''),[applyReason,setApplyReason]=useState('');
 const clear=()=>{setPostingMonth('');setSourceRefs('');setReason('');setReviewReason('');setAdoptReason('');setApplyReason('');};
 useEffect(()=>()=>{generation.current++;},[]);
 const change=(next:Query)=>{queryRef.current=next;setQuery(next);generation.current++;setLoading(false);setData(null);setBound(null);setRefreshRequired(false);setMessage('');clear();};
 const load=async()=>{
  const scope={...queryRef.current};if(!payrollItemIdentity(scope.empId)||!payrollItemMonth(scope.month)){setMessage('請填寫有效的員工編號與月份。');return;}
  const n=++generation.current;setLoading(true);setData(null);setBound(null);setMessage('');
  try{
   const value=await getPayrollAdjustment(scope);if(n!==generation.current||!same(queryRef.current,scope))return;
   if(!same(value,scope)||!Array.isArray(value.versions)||!Array.isArray(value.runs)||!Array.isArray(value.eligibleActions)||!Array.isArray(value.candidateIssues))throw Error('scope');
   const versions=[...value.versions,...(value.current?[value.current]:[])];
   for(const v of versions){
    if(!same(v,scope)||!Number.isSafeInteger(v.revision)||v.revision<1||!Object.hasOwn(states,v.status)||!payrollItemMonth(v.postingMonth)||!validRef(v.comparisonRef)||!Array.isArray(v.sourceRefs)||!v.sourceRefs.every(payrollItemIdentifier))throw Error('version');
    validateAdjustmentAmounts(v.baseline);validateAdjustmentAmounts(v.target);validProjection(v.projection);
   }
   if(value.canManage&&value.versions.some((v:any,i:number)=>v.revision!==i+1)||value.current&&!value.versions.some((v:any)=>v.id===value.current.id&&v.revision===value.current.revision&&v.status===value.current.status))throw Error('history');
   value.runs.forEach((r:any,i:number)=>{if(!same(r,scope)||r.sequence!==i+1||!payrollItemMonth(r.postingMonth))throw Error('run');validateAdjustmentAmounts(r.amounts);});
   if(value.projection)validProjection(value.projection);
   if(value.candidate){if(!validRef(value.candidate.comparisonRef))throw Error('comparison');validateAdjustmentAmounts(value.candidate.baseline);validateAdjustmentAmounts(value.candidate.target);validProjection(value.candidate.projection);}
   setData(value);setBound(scope);setRefreshRequired(false);clear();
  }catch{if(n===generation.current)setMessage('調整資料讀取失敗或來源範圍不一致，請重新查詢。');}
  finally{if(n===generation.current)setLoading(false);}
 };
 const current=data?.current,revision=current?.revision??0,manage=data?.canManage===true&&user?.role===UserRole.SuperAdmin&&bound?.empId!==me;
 const author=data?.versions?.some((v:any)=>v.status==='proposed'&&v.actor===me||v.sourceAuthors?.includes(me));
 const allowed=(action:Action)=>manage&&data?.eligibleActions?.includes(action);
 const blocked=busy||loading||op.busy||!!op.pending||op.blocked||refreshRequired||!bound||!same(bound,query)||!manage;
 const canPropose=allowed('propose-payroll-adjustment')&&(!current||['returned','applied'].includes(current.status));
 const canReview=allowed('review-payroll-adjustment')&&!author&&current?.status==='proposed';
 const canAdopt=allowed('adopt-payroll-adjustment')&&!author&&current?.status==='reviewed';
 const canApply=allowed('apply-payroll-adjustment')&&!author&&current?.status==='adopted';
 const candidateReady=!!data?.candidate&&data?.candidateIssues?.length===0;
 const sourceReady=candidateReady&&data?.stale===false;
 const proposalOkay=candidateReady&&payrollItemMonth(postingMonth)&&refsOkay(sourceRefs)&&reasonOkay(reason);
 const send=async(action:Action,extra:Record<string,unknown>)=>{
  if(sending.current||blocked||!bound)return;
  const scope={...bound};sending.current=true;setBusy(true);setMessage('');
  const command={caseId:'payroll-adjustment:'+scope.scope+':'+scope.empId+':'+scope.month,...scope,expectedRevision:revision,operationId:crypto.randomUUID(),...extra};
  try{await op.attempt({action,command});if(same(queryRef.current,scope))await load();}
  catch(error){if(same(queryRef.current,scope)){if(error instanceof APIError&&[409,423].includes(error.status)){setRefreshRequired(true);setMessage('來源、版本或月份鎖定狀態已變更，請重新查詢後處理。');}else setMessage('操作結果未確認或未通過，請先核實原操作，不要另送相同內容。');}}
  finally{sending.current=false;setBusy(false);}
 };
 return <section className="p-4 max-w-4xl mx-auto space-y-4 min-w-0 break-words"><h2 className="text-xl font-bold">薪資調整</h2><p>以已覆核的逐項差額建立獨立調整紀錄；金額由伺服器來源計算，這裡只填入帳月份及依據。</p><p className="text-sm font-semibold">調整分錄與實際付款分開。負數差額不會自動從以後工資扣除；原始鎖月快照保留，正式計薪門檻仍適用。</p><AnomalyOperationRecovery onResolved={()=>void load()}/>
  <div className="grid sm:grid-cols-2 gap-2"><label>調整來源範圍<select className={field} value={query.scope} onChange={e=>change({...queryRef.current,scope:e.target.value as Query['scope']})}><option value="current">目前月份比較</option><option value="historical">歷史鎖月比較</option></select></label><label>調整員工編號<input className={field} value={query.empId} onChange={e=>change({...queryRef.current,empId:e.target.value.trim()})}/></label><label>調整歸屬月份<input className={field} type="month" value={query.month} onChange={e=>change({...queryRef.current,month:e.target.value})}/></label><button type="button" className={button} disabled={loading} onClick={()=>void load()}>查詢薪資調整</button></div>
  {loading&&<p role="status">正在查詢調整來源。</p>}{message&&<p role="status">{message}</p>}
  {data&&bound&&<><p>目前查詢：{bound.scope==='historical'?'歷史鎖月':'目前月份'} · {bound.empId} · {bound.month}</p>{data.stale&&<p role="alert">比較來源已變更，不能覆核、採納或入帳；待覆核提案可先退回。</p>}{data.candidateIssues.map((issue:string,i:number)=><p key={i} className="text-sm">{issue}</p>)}
   {data.candidate&&<section aria-label="目前已覆核比較" className="space-y-2"><h3 className="font-semibold">目前已覆核比較（唯讀）</h3><p>比較識別：{data.candidate.comparisonRef.id}；版本：{data.candidate.comparisonRef.revision}</p><Projection value={data.candidate.projection}/></section>}
   {current?<article className="border rounded p-3 space-y-2"><h3 className="font-semibold">調整版本 {revision} · {states[current.status]}</h3><Version value={current}/>{current.status==='applied'&&<p>已記錄獨立調整分錄，尚未新增實際付款。</p>}</article>:<p>尚無調整提案。</p>}
   {canPropose&&<fieldset disabled={blocked} className="border rounded p-3 space-y-2 min-w-0"><legend>提出薪資調整</legend>{!candidateReady&&<p>尚無可用的已覆核比較，請先完成差額證據核對。</p>}<label className="block">調整入帳月份<input className={field} type="month" value={postingMonth} onChange={e=>setPostingMonth(e.target.value)}/></label><p className="text-sm">請依核定安排明確選擇月份；伺服器會再次檢查月份鎖定。</p><label className="block">調整來源識別（每行一筆）<textarea className={field} value={sourceRefs} onChange={e=>setSourceRefs(e.target.value)}/></label><label className="block">調整提案原因<textarea className={field} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="button" className={button} disabled={blocked||!proposalOkay} onClick={()=>{if(proposalOkay)void send('propose-payroll-adjustment',{postingMonth,comparisonRef:{...data.candidate.comparisonRef},sourceRefs:refs(sourceRefs),reason:reason.trim()});}}>提出調整提案</button></fieldset>}
   {current&&(author||bound.empId===me)&&<p>本人資料或歷史提案者不能覆核、採納或入帳。</p>}
   {canReview&&<fieldset disabled={blocked} className="border rounded p-3 space-y-2"><legend>獨立覆核調整</legend><label className="block">調整覆核／退回原因<textarea className={field} maxLength={2000} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked||!sourceReady||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-adjustment',{mode:'approve',reason:reviewReason.trim()})}>核定調整證據</button><button type="button" className={button} disabled={blocked||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-adjustment',{mode:'return',reason:reviewReason.trim()})}>退回調整提案</button></div></fieldset>}
   {canAdopt&&<fieldset disabled={blocked} className="border rounded p-3 space-y-2"><legend>另外採納調整</legend><label className="block">調整採納原因<textarea className={field} maxLength={2000} value={adoptReason} onChange={e=>setAdoptReason(e.target.value)}/></label><button type="button" className={button} disabled={blocked||!sourceReady||!reasonOkay(adoptReason)} onClick={()=>void send('adopt-payroll-adjustment',{reason:adoptReason.trim()})}>採納已覆核調整</button></fieldset>}
   {canApply&&<fieldset disabled={blocked} className="border rounded p-3 space-y-2"><legend>另外記錄調整分錄</legend><p>入帳月份：{current.postingMonth}。此操作只新增獨立分錄，不是銀行付款。</p><label className="block">調整入帳原因<textarea className={field} maxLength={2000} value={applyReason} onChange={e=>setApplyReason(e.target.value)}/></label><button type="button" className={button} disabled={blocked||!sourceReady||!reasonOkay(applyReason)} onClick={()=>void send('apply-payroll-adjustment',{reason:applyReason.trim()})}>記錄調整分錄</button></fieldset>}
   <section aria-label="薪資調整帳本" className="space-y-2"><h3 className="font-semibold">已入帳調整帳本（唯讀）</h3>{data.projection&&<Projection value={data.projection} lastSnapshot={data.targetFreshness!=='current-reviewed-source'}/>} {data.runs.length?data.runs.map((run:any)=><details key={run.id} className="border rounded p-3"><summary>分錄 {run.sequence} · 入帳月份 {run.postingMonth}</summary><p className="text-sm">記錄人：{run.actor}；時間：{run.at}</p><Amounts title="本筆調整" value={run.amounts} delta/></details>):<p>尚無已入帳調整分錄。</p>}</section>
   <section aria-label="薪資調整歷史版本" className="space-y-2"><h3 className="font-semibold">薪資調整歷史版本（唯讀）</h3>{data.versions.map((v:any)=><details key={v.revision} className="border rounded p-3"><summary>版本 {v.revision} · {states[v.status]}</summary><Version value={v}/></details>)}</section>
  </>}
 </section>;
}
