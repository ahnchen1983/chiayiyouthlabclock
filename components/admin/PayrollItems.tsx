import React,{useEffect,useRef,useState} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {UserRole} from '../../types';
import {apiPayrollItemInventory} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {payrollItemIdentity,payrollItemMonth,validatePayrollItemInventory,validPayrollItemVersionHistory,type PayrollItemInventory,type PayrollItemInventoryVersion} from '../../utils/payroll/items';

type Scope={empId:string;month:string};
type Row={itemCode:string;kind:string;amount:string;from:string;to:string;sourceRefs:string;reason:string};
const blank=():Row=>({itemCode:'',kind:'',amount:'',from:'',to:'',sourceRefs:'',reason:''});
const references=(text:string)=>text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const same=(a:Scope|null,b:Scope)=>!!a&&a.empId===b.empId&&a.month===b.month;
const STATUS:Record<string,string>={proposed:'待另一位管理者核定',approved:'證據已核定',returned:'已退回'};
const control='border rounded p-2 block w-full min-w-0';
const button='border rounded px-3 py-2 disabled:opacity-50';
function InventoryView({value}:{value:PayrollItemInventory}){
 return <div className="space-y-2 text-sm break-words">
  <p>{value.mode==='none'?'已明示本月沒有其他薪資項目':'本月其他薪資項目證據'}</p>
  <p>來源：{Array.isArray(value.sourceRefs)?value.sourceRefs.join('、'):'待核實'}</p><p>盤點原因：{value.reason}</p>
  {Array.isArray(value.items)&&value.items.map((item,i)=><div key={i} className="border rounded p-2 space-y-1">
   <p>{item.itemCode} · {item.kind==='earning'?'應發項目':'扣項'} · 金額 {item.amount}</p><p>{item.from}–{item.to}</p><p>來源：{Array.isArray(item.sourceRefs)?item.sourceRefs.join('、'):'待核實'}</p><p>原因：{item.reason}</p>
  </div>)}
 </div>;
}
export default function PayrollItems(){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id;
 const [query,setQuery]=useState<Scope>({empId:'',month:''}),queryRef=useRef(query),ticket=useRef(0),sending=useRef(false);
 const [data,setData]=useState<any>(null),[bound,setBound]=useState<Scope|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [mode,setMode]=useState(''),[sourceRefs,setSourceRefs]=useState(''),[reason,setReason]=useState(''),[rows,setRows]=useState<Row[]>([blank()]),[reviewReason,setReviewReason]=useState('');
 useEffect(()=>()=>{ticket.current++;},[]);
 const changeQuery=(next:Scope)=>{queryRef.current=next;setQuery(next);ticket.current++;setLoading(false);setData(null);setBound(null);setMessage('');setMode('');setSourceRefs('');setReason('');setRows([blank()]);setReviewReason('');};
 const load=async()=>{
  const scope={...queryRef.current};if(!payrollItemIdentity(scope.empId)||!payrollItemMonth(scope.month)){setMessage('請填寫有效的員工編號與月份。');return;}
  const request=++ticket.current;setLoading(true);setData(null);setBound(null);setMessage('');
  try{
   const result=await apiPayrollItemInventory(scope.empId,scope.month);
   if(request!==ticket.current||!same(queryRef.current,scope))return;
   if(result.empId!==scope.empId||result.month!==scope.month||!Array.isArray(result.versions)||result.current&&(result.current.empId!==scope.empId||result.current.month!==scope.month))throw Error('scope mismatch');
   setData(result);setBound(scope);
  }catch{if(request===ticket.current){setData(null);setBound(null);setMessage('薪資項目讀取失敗或來源範圍不一致，請重新查詢核實。');}}
  finally{if(request===ticket.current)setLoading(false);}
 };
 const current:PayrollItemInventoryVersion|null=data?.current||null;
 const manage=!!data?.canManage&&user?.role===UserRole.SuperAdmin&&bound?.empId!==me;
 const revision=current?.revision??0;
 const historyValid=!current||validPayrollItemVersionHistory(current);
 const validTarget=!!bound&&same(bound,query)&&Number.isSafeInteger(revision)&&revision>=0&&historyValid;
 const blocked=busy||loading||op.busy||!!op.pending||op.blocked||!validTarget||!manage;
 const author=current?.proposedBy===me||Array.isArray(current?.history)&&current.history.some(h=>h.to==='proposed'&&h.actor===me);
 const mayPropose=manage&&(!current||['approved','returned'].includes(current.status));
 const mayReview=manage&&current?.status==='proposed'&&historyValid&&!author;
 const rowChange=(index:number,key:keyof Row,value:string)=>setRows(previous=>previous.map((r,i)=>i===index?{...r,[key]:value}:r));
 // Validate the form without converting decimal strings into floating point or
 // replacing an explicit zero. The server owns canonicalization and authority.
 const inventory=():PayrollItemInventory=>({empId:bound!.empId,month:bound!.month,mode:mode as 'none'|'items',sourceRefs:references(sourceRefs),reason:reason.trim(),items:mode==='items'?rows.map(r=>({itemCode:r.itemCode.trim(),kind:r.kind as 'earning'|'deduction',amount:r.amount.trim(),from:r.from,to:r.to,sourceRefs:references(r.sourceRefs),reason:r.reason.trim()})):[]});
 let formValid=false;try{if(bound){validatePayrollItemInventory(inventory());formValid=true;}}catch{/* Missing evidence is not a zero attestation. */}
 const send=async(action:'propose-payroll-item-inventory'|'review-payroll-item-inventory',extra:any)=>{
  if(sending.current||blocked||!bound)return;
  const scope={...bound};sending.current=true;setBusy(true);setMessage('');
  const command=JSON.parse(JSON.stringify({caseId:'payroll-items:'+scope.empId+':'+scope.month,expectedRevision:revision,operationId:crypto.randomUUID(),...extra}));
  try{await op.attempt({action,command});setReviewReason('');setReason('');await load();}
  catch{setMessage('操作未完成確認，請先核實原操作；版本、權限或鎖月衝突須重新查詢。');}
  finally{sending.current=false;setBusy(false);}
 };
 return <section className="p-4 max-w-4xl mx-auto space-y-4 min-w-0 break-words">
  <h2 className="text-xl font-bold">其他薪資項目</h2>
  <p className="text-sm">登錄本月其他應發或扣款的固定金額與來源；沒有其他項目也需明確盤點。請只填來源識別，不貼原始單據或個資。</p>
  <p className="text-sm font-semibold">核定只記錄證據，尚未採用計薪，也未付款。</p>
  <p className="text-sm">工資基礎、稅務、補充保費與扣款依據仍待核定，不能直接用這份清冊結薪。</p>
  <AnomalyOperationRecovery onResolved={()=>void load()}/>
  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
   <label className="text-sm min-w-0">項目員工編號<input className={control} value={query.empId} onChange={e=>changeQuery({...queryRef.current,empId:e.target.value.trim()})}/></label>
   <label className="text-sm min-w-0">項目月份<input type="month" className={control} value={query.month} onChange={e=>changeQuery({...queryRef.current,month:e.target.value})}/></label>
   <button type="button" className={button} disabled={loading} onClick={()=>void load()}>查詢薪資項目</button>
  </div>
  {loading&&<p role="status">正在查詢薪資項目。</p>}{message&&<p role="status" className="text-sm">{message}</p>}
  {data&&bound&&<>
   <p className="text-sm font-semibold">目前查詢：{bound.empId} · {bound.month}</p>
   {!current?<p>尚未提供本月項目清冊</p>:<article className="border rounded p-3 space-y-2"><h3 className="font-semibold">目前版本 {current.revision} · {STATUS[current.status]||'狀態待核實'}</h3><p className="text-sm">提出者：{current.proposedBy}；提出時間：{current.proposedAt}</p>{current.approvedBy&&<p className="text-sm">核定者：{current.approvedBy}；核定時間：{current.approvedAt}</p>}{current.inventory&&<InventoryView value={current.inventory}/>}</article>}
   {!historyValid&&<p role="alert">清冊歷程不完整，請核實來源後再操作。</p>}
   {mayPropose&&<fieldset className="border rounded p-3 space-y-3 min-w-0" disabled={blocked}><legend className="font-semibold">提出本月項目清冊</legend>
    <label className="text-sm block">本月項目聲明<select className={control} value={mode} onChange={e=>setMode(e.target.value)}><option value="">請選擇盤點結果</option><option value="none">確認本月沒有其他薪資項目</option><option value="items">有其他應發或扣款項目</option></select></label>
    <label className="text-sm block">清冊來源識別（每行一筆）<textarea className={control} value={sourceRefs} onChange={e=>setSourceRefs(e.target.value)}/></label>
    <label className="text-sm block">盤點原因（至少5字）<textarea className={control} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {mode==='items'&&<>{rows.map((r,i)=><fieldset key={i} className="border rounded p-2 space-y-2 min-w-0"><legend>項目 {i+1}</legend>
     <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm min-w-0">項目識別 {i+1}<input className={control} value={r.itemCode} onChange={e=>rowChange(i,'itemCode',e.target.value)}/></label>
      <label className="text-sm min-w-0">項目類型 {i+1}<select className={control} value={r.kind} onChange={e=>rowChange(i,'kind',e.target.value)}><option value="">請選擇</option><option value="earning">應發項目</option><option value="deduction">扣項</option></select></label>
      <label className="text-sm min-w-0">項目金額 {i+1}<input inputMode="decimal" className={control} value={r.amount} onChange={e=>rowChange(i,'amount',e.target.value)}/></label>
      <label className="text-sm min-w-0">項目起日 {i+1}<input type="date" className={control} value={r.from} onChange={e=>rowChange(i,'from',e.target.value)}/></label>
      <label className="text-sm min-w-0">項目迄日 {i+1}<input type="date" className={control} value={r.to} onChange={e=>rowChange(i,'to',e.target.value)}/></label>
     </div>
     <label className="text-sm block">項目來源識別 {i+1}<textarea className={control} value={r.sourceRefs} onChange={e=>rowChange(i,'sourceRefs',e.target.value)}/></label>
     <label className="text-sm block">項目原因 {i+1}<textarea className={control} maxLength={2000} value={r.reason} onChange={e=>rowChange(i,'reason',e.target.value)}/></label>
     <button type="button" className={button} disabled={blocked||rows.length===1} onClick={()=>setRows(previous=>previous.filter((_,n)=>n!==i))}>移除項目 {i+1}</button>
    </fieldset>)}<button type="button" className={button} disabled={blocked||rows.length>=100} onClick={()=>setRows(previous=>[...previous,blank()])}>新增項目</button></>}
    <button type="button" className={button+' bg-brand-blue-dark text-white'} disabled={blocked||!formValid} onClick={()=>{if(formValid)void send('propose-payroll-item-inventory',{inventory:inventory()});}}>送出項目清冊</button>
   </fieldset>}
   {current?.status==='proposed'&&(author||bound.empId===me)&&<p className="text-sm">本人資料或曾提出本月清冊者，不能核定或退回。</p>}
   {mayReview&&<fieldset className="border rounded p-3 space-y-2" disabled={blocked}><legend>核對本月清冊證據</legend>
    <label className="text-sm block">項目核定／退回原因<textarea className={control} maxLength={2000} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked||reviewReason.trim().length<5} onClick={()=>void send('review-payroll-item-inventory',{...bound,mode:'approve',reason:reviewReason.trim()})}>核定項目證據</button><button type="button" className={button} disabled={blocked||reviewReason.trim().length<5} onClick={()=>void send('review-payroll-item-inventory',{...bound,mode:'return',reason:reviewReason.trim()})}>退回項目清冊</button></div>
   </fieldset>}
   <section className="space-y-2"><h3 className="font-semibold">歷史版本（唯讀）</h3>{data.versions.length?data.versions.map((v:any,i:number)=><details key={v.versionId||i} className="border rounded p-3"><summary>版本 {v.revision} · {STATUS[v.status]||'狀態待核實'} · 提出者 {v.proposedBy}</summary>{v.inventory&&<InventoryView value={v.inventory}/>}<p className="text-sm">核定者：{v.approvedBy||'尚未核定'}；核定時間：{v.approvedAt||'尚未核定'}</p><ul className="text-xs space-y-1">{Array.isArray(v.history)&&v.history.map((h:any,n:number)=><li key={n}>{h.at} · {h.actor} · {STATUS[h.to]||'歷程待核實'} · {h.reason}</li>)}</ul></details>):<p className="text-sm">尚無歷史版本。</p>}</section>
  </>}
 </section>;
}
