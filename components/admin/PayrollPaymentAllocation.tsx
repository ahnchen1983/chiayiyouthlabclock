import React,{useEffect,useRef,useState} from 'react';
import {UserRole} from '../../types';
import {useAuth} from '../../contexts/AuthContext';
import {APIError,apiPayrollPaymentAllocation} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {payrollItemIdentity,payrollItemMonth} from '../../utils/payroll/items';
import {validatePaymentAllocation} from '../../utils/payroll/paymentAllocation';

type Scope={empId:string;month:string};
type AmountRow={code:string;amount:string};
type EventRow={paymentEventId:string;earnings:AmountRow[];otherDeductions:AmountRow[];taxExemptOvertime:string;pensionSelf:string;actualIncomeTax:string;actualSupplementaryPremium:string;sourceRefs:string;reason:string};
const field='border rounded p-2 block w-full min-w-0',button='border rounded px-3 py-2 disabled:opacity-50';
const statuses:Record<string,string>={proposed:'待獨立覆核',approved:'金額分配證據已核定',returned:'已退回'};
const labels:Record<string,string>={normal:'正常薪資',overtime:'加班給付','comp-settlement':'補休結清','insurance:labor':'勞保','insurance:employment':'就保','insurance:health':'健保'};
const label=(code:string)=>labels[code]||code;
const refs=(value:string)=>value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
const same=(a:Scope|null|undefined,b:Scope)=>a?.empId===b.empId&&a?.month===b.month;
const reasonOkay=(v:string)=>v.trim().length>=5&&v.trim().length<=2000;
const display=(value:unknown)=>value===null||value===undefined?'待核實':String(value);
const validHistory=(v:any)=>Number.isSafeInteger(v?.revision)&&v.revision>0&&Array.isArray(v.history)&&v.history.length===v.revision&&v.history.every((h:any,i:number)=>h?.revision===i+1&&typeof h.actor==='string'&&h.actor&&Object.prototype.hasOwnProperty.call(statuses,h.to))&&v.history.at(-1)?.to===v.status;
function Assessment({value}:{value:any}){
 if(!value)return <p>尚無伺服器分配評估。</p>;
 return <div className="space-y-2 text-sm"><p>評估狀態：{value.status==='ready-calculation'?'已完成本範圍計算，仍非正式結算':'尚待核實'}。核定是來源與分配證據，並非已付款或正式結算。</p>{value.issues?.map((issue:string,i:number)=><p key={i}>{issue}</p>)}{value.eventResults?.map((e:any)=><article key={e.paymentEventId} className="border rounded p-2 space-y-1"><h4>事件 {e.paymentEventId} 核對</h4><p>分配應發：{display(e.allocatedGross)}；應稅基礎：{display(e.taxableBase)}；補充保費基礎：{display(e.supplementaryBase)}</p><p>實際扣繳所得稅：{display(e.actualIncomeTax)}；計算所得稅義務：{display(e.calculatedIncomeTax)}；差異：{display(e.differences?.incomeTax)}</p><p>實際扣繳補充保費：{display(e.actualSupplementaryPremium)}；計算補充保費義務：{display(e.calculatedSupplementaryPremium)}；差異：{display(e.differences?.supplementaryPremium)}</p><p>實際轉帳淨額：{display(e.cashPaid)}；核算淨額：{display(e.expectedNet)}；淨額差異：{display(e.differences?.net)}</p>{e.issues?.map((issue:string,i:number)=><p key={i}>{issue}</p>)}</article>)}</div>;
}
function RecordView({record}:{record:any}){
 return <div className="space-y-2 text-sm"><p>提出者：{record.proposedBy}；提出時間：{record.proposedAt}</p><p>分配來源：{record.allocation.sourceRefs.join('、')}；說明：{record.allocation.reason}</p>{record.allocation.events.map((e:any)=><article key={e.paymentEventId} className="border rounded p-2 space-y-1"><h4>原給付事件 {e.paymentEventId}</h4><p>應發分配：{e.earnings.map((r:any)=>`${label(r.code)} ${r.amount}`).join('；')}</p><p>免稅加班金額：{e.taxExemptOvertime}；勞退自提：{e.pensionSelf}</p><p>其他扣項：{e.otherDeductions.map((r:any)=>`${label(r.code)} ${r.amount}`).join('；')||'來源無其他扣項'}</p><p>實際扣繳所得稅：{e.actualIncomeTax}；實際扣繳補充保費：{e.actualSupplementaryPremium}</p><p>來源：{e.sourceRefs.join('、')}；說明：{e.reason}</p></article>)}{record.reviewedBy&&<p>覆核者：{record.reviewedBy}；覆核時間：{record.reviewedAt}</p>}<Assessment value={record.assessment}/></div>;
}
export default function PayrollPaymentAllocation(){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id;
 const [query,setQuery]=useState<Scope>({empId:'',month:''}),queryRef=useRef(query),generation=useRef(0),sending=useRef(false);
 const [bound,setBound]=useState<Scope|null>(null),[data,setData]=useState<any>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refreshRequired,setRefreshRequired]=useState(false),[message,setMessage]=useState('');
 const [rows,setRows]=useState<EventRow[]>([]),[sourceRefs,setSourceRefs]=useState(''),[reason,setReason]=useState(''),[reviewReason,setReviewReason]=useState('');
 const clear=()=>{setRows([]);setSourceRefs('');setReason('');setReviewReason('');};
 useEffect(()=>()=>{generation.current++;},[]);
 const changeQuery=(scope:Scope)=>{queryRef.current=scope;setQuery(scope);generation.current++;setLoading(false);setData(null);setBound(null);setRefreshRequired(false);setMessage('');clear();};
 const load=async()=>{
  const scope={...queryRef.current};if(!payrollItemIdentity(scope.empId)||!payrollItemMonth(scope.month)){setMessage('請填寫有效的員工編號與月份。');return;}
  const n=++generation.current;setLoading(true);setData(null);setBound(null);setMessage('');
  try{
   const value=await apiPayrollPaymentAllocation(scope);
   if(n!==generation.current||!same(queryRef.current,scope))return;
   if(!same(value,scope)||!Array.isArray(value.versions))throw Error('scope');
   for(const v of [...value.versions,...(value.current?[value.current]:[])])if(!same(v,scope)||!same(validatePaymentAllocation(v.allocation),scope)||!validHistory(v))throw Error('history');
   if(value.sourceAvailable){
    if(!same(value.source,scope)||!same(value.paymentInventory,scope)||!Array.isArray(value.source.earnings)||!Array.isArray(value.source.otherDeductions)||!Array.isArray(value.paymentInventory.events))throw Error('source');
    const events=value.paymentInventory.events,earnings=value.source.earnings,deductions=value.source.otherDeductions;
    if(new Set(events.map((e:any)=>e.id)).size!==events.length||events.some((e:any)=>!payrollItemIdentity(e.id))||[earnings,deductions].some(items=>new Set(items.map((i:any)=>i.code)).size!==items.length||items.some((i:any)=>typeof i.code!=='string'||!i.code)))throw Error('identity');
   }
   setData(value);setBound(scope);setRefreshRequired(false);clear();
   if(value.sourceAvailable)setRows(value.paymentInventory.events.map((e:any)=>({paymentEventId:e.id,earnings:value.source.earnings.map((s:any)=>({code:s.code,amount:''})),otherDeductions:value.source.otherDeductions.map((s:any)=>({code:s.code,amount:''})),taxExemptOvertime:'',pensionSelf:'',actualIncomeTax:'',actualSupplementaryPremium:'',sourceRefs:'',reason:''})));
  }catch{if(n===generation.current)setMessage('分配資料讀取失敗或來源範圍不一致，請重新查詢。');}finally{if(n===generation.current)setLoading(false);}
 };
 const current=data?.current,revision=current?.revision??0,manage=!!data?.canManage&&user?.role===UserRole.SuperAdmin&&bound?.empId!==me;
 const author=current?.proposedBy===me||current?.history?.some((h:any)=>h.to==='proposed'&&h.actor===me);
 const blocked=busy||loading||op.busy||!!op.pending||op.blocked||refreshRequired||!manage||!bound||!same(bound,query)||!Number.isSafeInteger(revision)||revision<0||current&&!validHistory(current);
 const canPropose=manage&&(!current||['approved','returned'].includes(current.status)),canReview=manage&&!author&&current?.status==='proposed';
 const allocation=()=>validatePaymentAllocation({...bound,sourceRefs:refs(sourceRefs),reason:reason.trim(),events:rows.map(e=>({...e,sourceRefs:refs(e.sourceRefs),reason:e.reason.trim()}))});
 let valid=false;try{allocation();valid=data?.sourceAvailable===true&&(rows.length>0||data?.paymentInventory?.mode==='none');}catch{/* Blank is distinct from an explicit zero. */}
 const change=(index:number,key:keyof EventRow,value:string)=>setRows(all=>all.map((row,i)=>i===index?{...row,[key]:value}:row));
 const changeAmount=(index:number,kind:'earnings'|'otherDeductions',code:string,amount:string)=>setRows(all=>all.map((row,i)=>i===index?{...row,[kind]:row[kind].map(v=>v.code===code?{...v,amount}:v)}:row));
 const send=async(action:'propose-payroll-payment-allocation'|'review-payroll-payment-allocation',extra:any)=>{
  if(sending.current||blocked||!bound)return;sending.current=true;setBusy(true);setMessage('');
  try{await op.attempt({action,command:{caseId:'payroll-payment-allocation:'+bound.empId+':'+bound.month,...bound,expectedRevision:revision,operationId:crypto.randomUUID(),...extra}});await load();}
  catch(error){if(error instanceof APIError&&error.status===409){setRefreshRequired(true);setMessage('來源或版本已變更，請重新查詢；待核提案需先退回再重提。');}else setMessage('操作結果未確認或未通過，請先核實原操作，不要另送相同內容。');}
  finally{sending.current=false;setBusy(false);}
 };
 return <section className="p-4 max-w-4xl mx-auto space-y-4 min-w-0 break-words"><h2 className="text-xl font-bold">給付金額分配</h2><p>將已核定給付事件與本月來源金額逐項對應。每格須明確填寫，沒有分配也請填0。此處不新增、拆分或改動給付事件。</p><p className="font-semibold text-sm">實際扣款與計算義務分開核對；證據核定不會付款、套用薪資或解除正式結算門檻。</p><AnomalyOperationRecovery onResolved={()=>void load()}/>
 <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end"><label className="min-w-0">分配員工編號<input className={field} value={query.empId} onChange={e=>changeQuery({...queryRef.current,empId:e.target.value.trim()})}/></label><label className="min-w-0">分配歸屬月份<input className={field} type="month" value={query.month} onChange={e=>changeQuery({...queryRef.current,month:e.target.value})}/></label><button type="button" className={button} disabled={loading} onClick={()=>void load()}>查詢給付分配</button></div>
 {loading&&<p role="status">正在查詢分配來源。</p>}{message&&<p role="status">{message}</p>}
 {data&&bound&&<><p>目前查詢：{bound.empId} · {bound.month}</p>{manage&&!data.sourceAvailable&&<p role="alert">缺少已核定給付事件或稅費前來源，不能提出或核定分配。若給付證據綁定的來源已變更，請先在給付證據核對重新提出並覆核，不能在此自動改綁。</p>}{data.sourceIssues?.map((issue:string,i:number)=><p key={i}>{issue}</p>)}{data.source?.issues?.map((issue:string,i:number)=><p key={i}>{issue}</p>)}{current&&data.stale&&<p role="alert">給付事件或計薪來源已變更。{current.status==='proposed'?'請先退回舊提案，再依目前來源重提。':'請依目前來源提出新版本。'}</p>}
 {current?<article className="border rounded p-3 space-y-2"><h3>目前版本 {revision} · {statuses[current.status]}</h3><RecordView record={current}/></article>:<p>尚無可顯示的分配版本。</p>}
 {manage&&data.sourceAvailable&&<section className="border rounded p-3 space-y-1"><h3>伺服器稅費前來源（唯讀）</h3>{data.source.earnings.map((s:any)=><p key={s.code}>{label(s.code)}：{display(s.amount)}</p>)}<p>免稅加班來源：{display(data.source.taxExemptOvertime?.amount)}；勞退自提來源：{display(data.source.pensionSelf?.amount)}</p>{data.source.otherDeductions.map((s:any)=><p key={s.code}>{label(s.code)}：{display(s.amount)}</p>)}<p className="text-sm">來源仍待核實時可登錄證據，不能把已填資料當成稅費核定。</p></section>}
 {canPropose&&<fieldset disabled={!!blocked||!data.sourceAvailable} className="border rounded p-3 space-y-3 min-w-0"><legend>提出逐筆分配</legend>{rows.length===0&&<p>已核定清冊沒有給付事件；僅可記錄明示無事件的分配證據，仍須填寫來源與原因。</p>}{rows.map((row,index)=>{const event=data.paymentInventory.events.find((e:any)=>e.id===row.paymentEventId);return <fieldset key={row.paymentEventId} className="border rounded p-3 space-y-2 min-w-0"><legend>給付事件 {row.paymentEventId}</legend><p>實際給付日：{event?.paidOn}；已記錄轉帳淨額：{display(event?.amount)}；單據列：{event?.evidenceLocator}</p>
 {row.earnings.map(r=><label key={r.code} className="block">事件 {row.paymentEventId} {label(r.code)} 分配金額<input className={field} inputMode="decimal" value={r.amount} onChange={e=>changeAmount(index,'earnings',r.code,e.target.value)}/></label>)}
 {([['taxExemptOvertime','免稅加班分配金額'],['pensionSelf','勞退自提分配金額']] as const).map(([key,title])=><label key={key} className="block">事件 {row.paymentEventId} {title}<input className={field} inputMode="decimal" value={row[key]} onChange={e=>change(index,key,e.target.value)}/></label>)}
 {row.otherDeductions.map(r=><label key={r.code} className="block">事件 {row.paymentEventId} {label(r.code)} 扣項分配<input className={field} inputMode="decimal" value={r.amount} onChange={e=>changeAmount(index,'otherDeductions',r.code,e.target.value)}/></label>)}
 {([['actualIncomeTax','實際扣繳所得稅'],['actualSupplementaryPremium','實際扣繳補充保費']] as const).map(([key,title])=><label key={key} className="block">事件 {row.paymentEventId} {title}<input className={field} inputMode="decimal" value={row[key]} onChange={e=>change(index,key,e.target.value)}/></label>)}<p className="text-sm">填寫單據實際扣款；計算義務與差異由伺服器另外列示，未知不當0。</p>
 <label className="block">事件 {row.paymentEventId} 分配來源識別（每行一筆）<textarea className={field} value={row.sourceRefs} onChange={e=>change(index,'sourceRefs',e.target.value)}/></label><label className="block">事件 {row.paymentEventId} 分配依據<textarea className={field} maxLength={2000} value={row.reason} onChange={e=>change(index,'reason',e.target.value)}/></label></fieldset>;})}
 <label className="block">整份分配來源識別（每行一筆）<textarea className={field} value={sourceRefs} onChange={e=>setSourceRefs(e.target.value)}/></label><label className="block">分配提案原因<textarea className={field} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="button" className={button} disabled={!!blocked||!valid} onClick={()=>{if(valid)void send('propose-payroll-payment-allocation',{allocation:allocation(),reason:reason.trim()});}}>提出給付分配</button></fieldset>}
 {current&&(author||bound.empId===me)&&<p>本人或本月任何歷史提案者不能覆核此分配。</p>}{canReview&&<fieldset disabled={!!blocked} className="border rounded p-3 space-y-2"><legend>獨立覆核分配證據</legend><label className="block">分配覆核／退回原因<textarea className={field} maxLength={2000} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!!blocked||!data.sourceAvailable||data.stale||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-payment-allocation',{mode:'approve',reason:reviewReason.trim()})}>核定分配證據</button><button type="button" className={button} disabled={!!blocked||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-payment-allocation',{mode:'return',reason:reviewReason.trim()})}>退回分配提案</button></div></fieldset>}
 <section aria-label="給付分配歷史版本" className="space-y-2"><h3>給付分配歷史版本（唯讀）</h3>{data.versions.map((v:any)=><details key={v.revision} className="border rounded p-3"><summary>版本 {v.revision} · {statuses[v.status]}</summary><RecordView record={v}/><ul className="text-xs space-y-1">{v.history.map((h:any)=><li key={h.revision}>{h.at} · {h.actor} · {statuses[h.to]} · {h.reason}</li>)}</ul></details>)}</section></>}
 </section>;
}
