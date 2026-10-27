import React,{useEffect,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {apiDayTypeDesignation,apiDayTypeDesignations} from '../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from './AnomalyOperationRecovery';
import {designationWarnings,monthDates} from '../utils/dayTypeDesignation';
const thisMonth=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,7);
const STATUS:Record<string,string>={submitted:'待核定',approved:'已核定',returned:'已退回'};
// Each person designates monthly 例假／休息日; a different admin approves it into
// the dated calendar used by payroll. Undesignated dates are never assumed rest.
function DateList({label,month,value,onChange,disabled}:{label:string;month:string;value:string[];onChange:(v:string[])=>void;disabled:boolean}){
 const [d,setD]=useState(''),days=monthDates(month);
 return <fieldset className="border rounded p-3"><legend className="font-semibold">{label}</legend><div className="flex gap-2 flex-wrap"><label className="sr-only" htmlFor={label+'-add'}>新增{label}日期</label><input id={label+'-add'} type="date" min={days[0]} max={days[days.length-1]} value={d} disabled={disabled} onChange={e=>setD(e.target.value)} className="border rounded px-2"/><button type="button" disabled={disabled||!d||value.includes(d)||!d.startsWith(month+'-')} onClick={()=>{onChange([...value,d].sort());setD('');}} className="px-3 rounded border">加入{label}</button></div>
 <ul className="flex flex-wrap gap-2 mt-2">{value.map(x=><li key={x} className="border rounded px-2">{x}<button type="button" aria-label={`移除${label} ${x}`} disabled={disabled} onClick={()=>onChange(value.filter(v=>v!==x))} className="ml-1">×</button></li>)}</ul><p className="text-xs text-gray-500">共 {value.length} 日</p></fieldset>;
}
function Editor({empId,month,mine,onDone}:{empId:string;month:string;mine:boolean;onDone:()=>void}){
 const op=useAnomalyOperation(),[data,setData]=useState<any>(null),[regular,setRegular]=useState<string[]>([]),[rest,setRest]=useState<string[]>([]),[reason,setReason]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{try{const r=await apiDayTypeDesignation(month,mine?undefined:empId);setData(r);const src=r.designation;setRegular(src?.regularHolidays||[]);setRest(src?.restDays||[]);setMsg('');}catch{setData(null);setMsg('日別指定讀取失敗或無權限。');}};
 useEffect(()=>{void load();},[empId,month]);
 const blocked=busy||op.busy||!!op.pending||op.blocked||!data,overlap=regular.filter(d=>rest.includes(d)),warnings=designationWarnings(month,regular,rest);
 const submit=async()=>{if(blocked)return;setBusy(true);try{await op.attempt({action:'submit-daytype-designation',command:{caseId:'daytype:'+empId+':'+month,empId,yearMonth:month,regularHolidays:regular,restDays:rest,expectedRevision:data.designation?.revision||0,operationId:crypto.randomUUID(),...(reason.trim()?{reason:reason.trim()}:{})}});setReason('');setMsg('已送出，待另一位管理者核定。');await load();onDone();}catch{setMsg('送出未通過或結果未知（版本變更、鎖月或權限）；請重新讀取核實。');}finally{setBusy(false);}};
 const last=data?.designation?.history?.[data.designation.history.length-1];
 return <div className="space-y-3"><AnomalyOperationRecovery onResolved={()=>void load()}/>
  {data&&<p className="text-sm">目前生效：{data.calendar?`已核定（${data.calendar.approvedBy}，${data.calendar.approvedAt.slice(0,10)}）`:'尚無核定日別，計薪日別待核'}；指定狀態：{data.designation?STATUS[data.designation.status]||data.designation.status:'未送出'}{data.designation?.status==='returned'&&last?.reason?`（退回原因：${last.reason}）`:''}</p>}
  <div className="grid gap-3 sm:grid-cols-2"><DateList label="例假" month={month} value={regular} onChange={setRegular} disabled={blocked}/><DateList label="休息日" month={month} value={rest} onChange={setRest} disabled={blocked}/></div>
  {overlap.length>0&&<p role="alert" className="text-red-600 text-sm">{overlap[0]} 同時是例假與休息日，請擇一。</p>}
  {warnings.map(w=><p key={w} className="text-amber-700 text-sm">⚠️ {w}</p>)}
  {!mine&&<label className="block text-sm">代為補錄原因（至少5字）<textarea className="border block w-full" value={reason} disabled={blocked} onChange={e=>setReason(e.target.value)}/></label>}
  {msg&&<p className="text-sm" role="status">{msg}</p>}
  <button type="button" disabled={blocked||overlap.length>0||(!mine&&reason.trim().length<5)} onClick={()=>void submit()} className="px-4 py-2 rounded bg-brand-blue-dark text-white disabled:opacity-50">{mine?'送出本月例假／休息日':'代為送出日別指定'}</button>
 </div>;
}
function ReviewItem({d,me,onDone}:{d:any;me:string;onDone:()=>void}){
 const op=useAnomalyOperation(),[national,setNational]=useState<string[]>([]),[reason,setReason]=useState(''),[confirm,setConfirm]=useState(false),[ack,setAck]=useState(false),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const own=d.empId===me||d.submittedBy===me,blocked=busy||op.busy||!!op.pending||op.blocked||own;
 const send=async(mode:'approve'|'return')=>{setBusy(true);try{await op.attempt({action:'review-daytype-designation',command:{caseId:'daytype:'+d.empId+':'+d.yearMonth,empId:d.empId,yearMonth:d.yearMonth,expectedRevision:d.revision,operationId:crypto.randomUUID(),mode,reason:reason.trim(),...(mode==='approve'?{nationalHolidays:national,confirmRemainingNormal:confirm,acknowledgeWarnings:ack}:{})}});onDone();}catch{setMsg('核定未通過或結果未知；請重新讀取核實。');}finally{setBusy(false);}};
 return <article className="border rounded p-3 space-y-2 break-words"><p className="font-semibold">{d.empId} · {STATUS[d.status]||d.status} · v{d.revision}{d.onBehalf?` · 由 ${d.submittedBy} 代為補錄`:''}</p><p className="text-sm">例假：{d.regularHolidays.join('、')||'無'}</p><p className="text-sm">休息日：{d.restDays.join('、')||'無'}</p>
  {d.warnings.map((w:string)=><p key={w} className="text-amber-700 text-sm">⚠️ {w}</p>)}
  {d.status==='submitted'&&(own?<p className="text-sm text-gray-500">本人日別或自己送出的指定，需由另一位管理者核定。</p>:<>
   <DateList label="國定假日" month={d.yearMonth} value={national} onChange={setNational} disabled={blocked}/>
   <label className="block text-sm"><input type="checkbox" checked={confirm} disabled={blocked} onChange={e=>setConfirm(e.target.checked)}/> 我確認其餘未指定日期為一般工作日</label>
   {d.warnings.length>0&&<label className="block text-sm"><input type="checkbox" checked={ack} disabled={blocked} onChange={e=>setAck(e.target.checked)}/> 我已核對上述法遵提醒</label>}
   <label className="block text-sm">核定／退回原因（至少5字）<textarea className="border block w-full" value={reason} disabled={blocked} onChange={e=>setReason(e.target.value)}/></label>
   <div className="flex gap-2"><button type="button" disabled={blocked||reason.trim().length<5||!confirm||(d.warnings.length>0&&!ack)} onClick={()=>void send('approve')} className="px-3 py-1 rounded bg-green-700 text-white disabled:opacity-50">核定日別</button><button type="button" disabled={blocked||reason.trim().length<5} onClick={()=>void send('return')} className="px-3 py-1 rounded border disabled:opacity-50">退回</button></div></>)}
  {msg&&<p role="alert" className="text-sm text-red-600">{msg}</p>}
  <details><summary className="text-sm">歷程</summary>{d.history.map((h:any,i:number)=><p key={i} className="text-xs">{h.at} · {h.actor} · {h.to}{h.reason?'：'+h.reason:''}</p>)}</details></article>;
}
export default function DayTypeDesignationPanel({mode}:{mode:'self'|'admin'}){
 const {user}=useAuth(),me=user!.id,[month,setMonth]=useState(thisMonth()),[list,setList]=useState<any[]|null>(null),[target,setTarget]=useState(''),[error,setError]=useState('');
 const loadList=async()=>{if(mode!=='admin')return;try{setList((await apiDayTypeDesignations(month)).designations);setError('');}catch{setList(null);setError('日別指定清單讀取失敗或無權限。');}};
 useEffect(()=>{void loadList();},[month,mode]);
 return <section className="border border-gray-200 rounded-lg p-4 space-y-3"><h3 className="font-semibold text-gray-800">{mode==='self'?'例假／休息日指定':'例假／休息日核定'}</h3>
  <p className="text-sm text-gray-500">{mode==='self'?'逐月指定自己的例假與休息日，送出後由另一位管理者核定才會用於計薪；未核定前計薪日別一律待核。':'核定後產生該員當月日別日曆（不可覆寫，改版另建版本）。薪資主檔期間的日別日曆參照填 personal-monthly 即逐月採用此核定。鎖月後不可再變更。'}</p>
  <label className="block text-sm">月份<input type="month" className="border rounded ml-2 px-2" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label>
  {mode==='self'?<Editor empId={me} month={month} mine onDone={()=>{}}/>:<>
   {error&&<p role="alert">{error}</p>}
   {list&&(list.length?list.map(d=><React.Fragment key={d.id+':'+d.revision}><ReviewItem d={d} me={me} onDone={()=>void loadList()}/></React.Fragment>):<p className="text-sm text-gray-500">本月尚無日別指定。</p>)}
   <details className="border rounded p-3"><summary className="font-semibold text-sm">代為補錄（例如依當時紀錄補登八月）</summary><label className="block text-sm mt-2">員工編號<input className="border rounded ml-2 px-2" value={target} onChange={e=>setTarget(e.target.value.trim())}/></label>{target&&target!==me&&<React.Fragment key={target+month}><Editor empId={target} month={month} mine={false} onDone={()=>void loadList()}/></React.Fragment>}</details>
  </>}
 </section>;
}
