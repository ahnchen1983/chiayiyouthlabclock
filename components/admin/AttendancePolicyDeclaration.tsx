import React,{useEffect,useRef,useState} from 'react';
import {UserRole} from '../../types';
import {useAuth} from '../../contexts/AuthContext';
import {APIError,apiAttendancePolicyDeclaration} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {payrollItemIdentity,payrollItemMonth} from '../../utils/payroll/items';
import {validDate} from '../../utils/attendance';

type Scope={empId:string;month:string};
type NumericKey='closeAfterMinutes'|'lateGraceMinutes'|'earlyGraceMinutes'|'workDifferenceTolerance';
type Target={date:string;scheduleVersion:string};
const fields:Array<[NumericKey,string]>=[['closeAfterMinutes','結班等待分鐘'],['lateGraceMinutes','遲到寬限分鐘'],['earlyGraceMinutes','早退寬限分鐘'],['workDifferenceTolerance','工作分鐘差異容許值']];
const empty=():Record<NumericKey,string>=>({closeAfterMinutes:'',lateGraceMinutes:'',earlyGraceMinutes:'',workDifferenceTolerance:''});
const stateNames:Record<string,string>={proposed:'待另一位管理者核定',approved:'已核定',returned:'已退回'};
const field='border rounded p-2 block w-full min-w-0',button='border rounded px-3 py-2 disabled:opacity-50';
const same=(a:Scope|null,b:Scope)=>!!a&&a.empId===b.empId&&a.month===b.month;
const minuteInput=(value:string)=>/^\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
const validMinute=(value:any)=>Number.isSafeInteger(value)&&value>=0;
const reasonOkay=(value:string)=>value.trim().length>=5&&value.length<=2000;
function ValuesView({values}:{values:any}){
 return <div className="text-sm space-y-2">{fields.map(([key,name])=><p key={key}>{name}：{validMinute(values?.[key])?values[key]:'待核實'}</p>)}
  {values?.expectedWorkByDate&&typeof values.expectedWorkByDate==='object'&&!Array.isArray(values.expectedWorkByDate)&&Object.entries(values.expectedWorkByDate).sort(([a],[b])=>a.localeCompare(b)).map(([date,target]:[string,any])=><div key={date} className="border rounded p-2"><p>{date} 預期淨工作分鐘：{validMinute(target?.minutes)?target.minutes:'待核實'}</p><p className="break-all">班表版本：{target?.scheduleVersion||'待核實'}</p></div>)}
 </div>;
}
export default function AttendancePolicyDeclaration(){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id;
 const [query,setQuery]=useState<Scope>({empId:'',month:''}),queryRef=useRef(query),generation=useRef(0),sending=useRef(false);
 const [data,setData]=useState<any>(null),[bound,setBound]=useState<Scope|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refreshRequired,setRefreshRequired]=useState(false),[message,setMessage]=useState('');
 const [numbers,setNumbers]=useState(empty),[minutes,setMinutes]=useState<Record<string,string>>({}),[reason,setReason]=useState(''),[reviewReason,setReviewReason]=useState('');
 const clearForm=()=>{setNumbers(empty());setMinutes({});setReason('');setReviewReason('');};
 useEffect(()=>()=>{generation.current++;},[]);
 const changeQuery=(next:Scope)=>{queryRef.current=next;setQuery(next);generation.current++;setData(null);setBound(null);setLoading(false);setRefreshRequired(false);setMessage('');clearForm();};
 const load=async()=>{
  const scope={...queryRef.current};if(!payrollItemIdentity(scope.empId)||!payrollItemMonth(scope.month)){setMessage('請填寫有效的員工編號與月份。');return;}
  const token=++generation.current;setLoading(true);setData(null);setBound(null);setMessage('');
  try{
   const value=await apiAttendancePolicyDeclaration(scope);
   if(token!==generation.current||!same(queryRef.current,scope))return;
   if(value.empId!==scope.empId||value.month!==scope.month||value.current&&!same(value.current,scope)||!Array.isArray(value.scheduleTargets)||new Set(value.scheduleTargets.map((t:any)=>t.date)).size!==value.scheduleTargets.length||value.scheduleTargets.some((t:any)=>!validDate(t?.date)||typeof t.scheduleVersion!=='string'||!t.scheduleVersion.trim()||t.scheduleVersion.length>150||t.scheduleVersion.includes('/')))throw Error('invalid scope or targets');
   setData(value);setBound(scope);setRefreshRequired(false);clearForm();setMinutes(Object.fromEntries(value.scheduleTargets.map((t:Target)=>[t.date,''])));
  }catch{if(token===generation.current){setData(null);setBound(null);setMessage('出勤政策讀取失敗或班表來源不一致，請重新查詢核實。');}}
  finally{if(token===generation.current)setLoading(false);}
 };
 const current=data?.current,targets:Target[]=data?.scheduleTargets||[],revision=current?.revision??0;
 const historyOkay=!current||Number.isSafeInteger(current.revision)&&current.revision>0&&Array.isArray(current.history)&&current.history.length===current.revision&&current.history.every((h:any,i:number)=>h&&h.revision===i+1&&typeof h.actor==='string'&&!!h.actor&&Object.prototype.hasOwnProperty.call(stateNames,h.to))&&current.history[current.history.length-1]?.to===current.status;
 const manage=!!data?.canManage&&user?.role===UserRole.SuperAdmin&&bound?.empId!==me;
 const author=current?.proposedBy===me||Array.isArray(current?.history)&&current.history.some((h:any)=>h.to==='proposed'&&h.actor===me);
 const blocked=busy||loading||op.busy||!!op.pending||op.blocked||refreshRequired||!manage||!bound||!same(bound,query)||!Number.isSafeInteger(revision)||revision<0||!historyOkay;
 const mayPropose=manage&&(!current||['approved','returned'].includes(current.status));
 const mayReview=manage&&!author&&current?.status==='proposed';
 const expected=current?.values?.expectedWorkByDate;
 const currentTargetsMatch=!!current&&expected&&typeof expected==='object'&&!Array.isArray(expected)&&Object.keys(expected).length===targets.length&&targets.every(t=>validMinute(expected[t.date]?.minutes)&&expected[t.date].scheduleVersion===t.scheduleVersion);
 const currentValuesValid=!!current&&fields.every(([key])=>validMinute(current.values?.[key]))&&currentTargetsMatch;
 const formValid=fields.every(([key])=>minuteInput(numbers[key]))&&targets.every(t=>minuteInput(minutes[t.date]??''))&&reasonOkay(reason);
 const send=async(action:'propose-attendance-policy-declaration'|'review-attendance-policy-declaration',extra:any)=>{
  if(sending.current||blocked||!bound)return;
  sending.current=true;setBusy(true);setMessage('');const scope={...bound};
  const command=JSON.parse(JSON.stringify({caseId:'attendance-policy:'+scope.empId+':'+scope.month,...scope,expectedRevision:revision,operationId:crypto.randomUUID(),...extra}));
  try{await op.attempt({action,command});await load();}
  catch(error){if(error instanceof APIError&&error.status===409){setRefreshRequired(true);setMessage('班表或政策版本已變更，請重新查詢後核對。');}else setMessage('操作未完成確認或未通過，請先核實原操作，不要另送相同內容。');}
  finally{sending.current=false;setBusy(false);}
 };
 const propose=()=>send('propose-attendance-policy-declaration',{...Object.fromEntries(fields.map(([key])=>[key,Number(numbers[key])])),expectedWorkByDate:Object.fromEntries(targets.map(t=>[t.date,{minutes:Number(minutes[t.date]),scheduleVersion:t.scheduleVersion}])),reason:reason.trim()});
 return <section className="p-4 max-w-4xl mx-auto space-y-4 min-w-0 break-words">
  <h2 className="text-xl font-bold">出勤判定政策</h2>
  <p className="text-sm">明確登錄員工本月的出勤判定依據，再由另一位管理者核定。數值與每日淨工作分鐘都須明填，包括0；班段跨度不等於工作事實。</p>
  <div className="border rounded p-3 text-sm space-y-1"><p>工日歸屬：以上班日為準。</p><p>休息處理：依明示且核實的工作／休息時段，不自動扣除一小時。</p></div>
  <p className="text-sm">此流程登錄判定依據，不會自動更正打卡、關閉案件或結薪。</p>
  <AnomalyOperationRecovery onResolved={()=>void load()}/>
  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
   <label className="text-sm min-w-0">政策員工編號<input className={field} value={query.empId} onChange={e=>changeQuery({...queryRef.current,empId:e.target.value.trim()})}/></label>
   <label className="text-sm min-w-0">政策月份<input type="month" className={field} value={query.month} onChange={e=>changeQuery({...queryRef.current,month:e.target.value})}/></label>
   <button type="button" className={button} disabled={loading} onClick={()=>void load()}>查詢出勤政策</button>
  </div>
  {loading&&<p role="status">正在查詢政策與班表版本。</p>}{message&&<p role="status">{message}</p>}
  {data&&bound&&<>
   <p className="text-sm font-semibold">目前查詢：{bound.empId} · {bound.month}</p>
   <p className="text-sm">{data.assessment?.status==='verified'?'目前核定聲明與班表版本已核對。':'尚未完成有效聲明核對，不能據此清除出勤異常。'}</p>
   {!historyOkay&&<p role="alert">政策歷程不完整，請核實後再操作。</p>}
   {current?<section aria-label="目前出勤政策" className="border rounded p-3 space-y-2"><h3 className="font-semibold">目前版本 {current.revision} · {stateNames[current.status]||'狀態待核實'}</h3><p className="text-sm">提出者：{current.proposedBy}；提出時間：{current.proposedAt}</p><ValuesView values={current.values}/>{current.reviewedBy&&<p className="text-sm">核定／退回者：{current.reviewedBy}；時間：{current.reviewedAt}</p>}</section>:<p>尚未建立本月出勤政策。</p>}
   {current&&!currentTargetsMatch&&manage&&<p role="alert">目前提案的逐日基準與班表版本不一致，不能核定；可先退回，再依最新班表重新提出。</p>}
   {mayPropose&&<fieldset className="border rounded p-3 space-y-3 min-w-0" disabled={blocked}><legend>提出本月出勤政策</legend>
    <div className="grid gap-2 sm:grid-cols-2">{fields.map(([key,name])=><label key={key} className="text-sm min-w-0">{name}<input type="number" min={0} step={1} className={field} value={numbers[key]} onChange={e=>setNumbers(previous=>({...previous,[key]:e.target.value}))}/></label>)}</div>
    <p className="text-sm">逐日填入已核實的預期淨工作分鐘。日期包含與本月相交的跨月班段，班表版本由本次查詢綁定，不自行推算或扣休息。</p>
    {targets.length?targets.map(t=><div key={t.date} className="border rounded p-2 space-y-1 min-w-0"><label className="text-sm block">{t.date} 預期淨工作分鐘<input type="number" min={0} step={1} className={field} value={minutes[t.date]??''} onChange={e=>setMinutes(previous=>({...previous,[t.date]:e.target.value}))}/></label><p className="text-xs break-all">班表版本：{t.scheduleVersion}</p></div>):<p className="text-sm">本次班表查詢沒有需要填寫逐日基準的班段。</p>}
    <label className="text-sm block">政策提出依據<textarea className={field} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button type="button" className={button} disabled={blocked||!formValid} onClick={()=>{if(formValid)void propose();}}>提出出勤政策</button>
   </fieldset>}
   {current&&(author||bound.empId===me)&&<p className="text-sm">本人資料或曾提出本月政策者，不能核定或退回。</p>}
   {mayReview&&<fieldset className="border rounded p-3 space-y-2" disabled={blocked}><legend>獨立核定政策</legend><label className="text-sm block">政策核定／退回依據<textarea className={field} maxLength={2000} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked||!currentValuesValid||!reasonOkay(reviewReason)} onClick={()=>void send('review-attendance-policy-declaration',{mode:'approve',reason:reviewReason.trim()})}>核定出勤政策</button><button type="button" className={button} disabled={blocked||!reasonOkay(reviewReason)} onClick={()=>void send('review-attendance-policy-declaration',{mode:'return',reason:reviewReason.trim()})}>退回出勤政策</button></div></fieldset>}
   <section aria-label="出勤政策歷程" className="space-y-2"><h3 className="font-semibold">出勤政策歷程（唯讀）</h3>{Array.isArray(current?.history)?<ol className="space-y-2">{current.history.map((h:any,i:number)=><li key={i} className="border rounded p-2 text-sm"><p>版本 {h.revision} · {stateNames[h.to]||'歷程待核實'}</p><p>{h.actor} · {h.at}</p><p>{h.reason}</p></li>)}</ol>:<p className="text-sm">尚無政策歷程。</p>}</section>
  </>}
 </section>;
}
