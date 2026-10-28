import React,{useState} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {apiInsuranceTimeline} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {LABOR_SALARY_GRADES_2026,HEALTH_FIRST_GRADE_2026,HEALTH_SALARY_GRADES_2026} from '../../utils/payroll/insurance';
const blank=()=>({from:'',to:'',laborInsured:true,laborSalary:'29500',employmentInsured:true,healthInsuredHere:true,healthAmount:String(HEALTH_FIRST_GRADE_2026),healthDependants:'0',pensionWage:'',pensionSelfPercent:'0',withholdingMethod:'',withholdingSpouseAndDependants:'',withholdingCountSourceRef:''});
const yes=(b:boolean)=>b?'是':'否';
const METHOD:Record<string,string>={table:'依扣繳稅額表（每月固定薪資）','flat-5':'本人選擇按5%','part-time-5':'兼職／非每月給付 5%','non-resident':'非居住者'};
const validCountDeclaration=(row:any)=>{
 if(row.withholdingMethod!=='table')return true;
 const count=String(row.withholdingSpouseAndDependants??'').trim(),source=String(row.withholdingCountSourceRef??'').trim();
 if(!count&&!source)return true;
 return /^\d+$/.test(count)&&Number.isInteger(Number(count))&&Number(count)>=0&&Number(count)<=100&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(source);
};
const countDeclaration=(period:any)=>period.withholdingMethod!=='table'?'非依扣繳表，無此項人數申報':
 `扣繳表人數：${Number.isInteger(period.withholdingSpouseAndDependants)?period.withholdingSpouseAndDependants:'未提供'}（不含本人）；來源：${period.withholdingCountSourceRef||'未提供'}`;
// One admin proposes, a different admin (not the employee) approves; premiums are
// computed from this record by the payroll engine, never typed per month.
export default function InsuranceTimeline(){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id;
 const [empId,setEmpId]=useState(''),[data,setData]=useState<any>(null),[rows,setRows]=useState<any[]>([blank()]),[reason,setReason]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{if(!empId)return;try{setData(await apiInsuranceTimeline(empId));setMsg('');}catch{setData(null);setMsg('投保資料讀取失敗或無權限。');}};
 const blocked=busy||op.busy||!!op.pending||op.blocked||!data;
 const change=(i:number,k:string,v:any)=>setRows(rows.map((r,n)=>n===i?{...r,[k]:v}:r));
 const send=async(action:'propose-insurance-timeline'|'review-insurance-timeline',extra:any)=>{setBusy(true);try{await op.attempt({action,command:{caseId:'insurance:'+data.empId,empId:data.empId,expectedHeadRevision:data.headRevision,operationId:crypto.randomUUID(),reason:reason.trim(),...extra}});setReason('');await load();}catch{setMsg('操作未通過或結果未知（版本變更、鎖月、權限）；請重新讀取核實。');}finally{setBusy(false);}};
 const periods=()=>rows.map(r=>({from:r.from,to:r.to,laborInsured:r.laborInsured,laborSalary:Number(r.laborSalary),employmentInsured:r.employmentInsured,healthInsuredHere:r.healthInsuredHere,healthAmount:Number(r.healthAmount),healthDependants:Number(r.healthDependants),pensionWage:Number(r.pensionWage||0),pensionSelfPercent:Number(r.pensionSelfPercent),withholdingMethod:r.withholdingMethod,...(r.withholdingMethod==='table'&&String(r.withholdingSpouseAndDependants??'').trim()&&String(r.withholdingCountSourceRef??'').trim()?{withholdingSpouseAndDependants:Number(r.withholdingSpouseAndDependants),withholdingCountSourceRef:r.withholdingCountSourceRef.trim()}:{})}));
 const copy=()=>{const p=data?.current?.periods;if(p)setRows(p.map((x:any)=>({...x,laborSalary:String(x.laborSalary||29500),healthAmount:String(x.healthAmount||HEALTH_FIRST_GRADE_2026),healthDependants:String(x.healthDependants),pensionWage:x.pensionWage?String(x.pensionWage):'',pensionSelfPercent:String(x.pensionSelfPercent),withholdingMethod:x.withholdingMethod||'',withholdingSpouseAndDependants:x.withholdingSpouseAndDependants==null?'':String(x.withholdingSpouseAndDependants),withholdingCountSourceRef:typeof x.withholdingCountSourceRef==='string'?x.withholdingCountSourceRef:''})));};
 return <section className="p-4 max-w-5xl mx-auto space-y-3 break-words"><h2 className="text-xl font-bold">投保與扣繳資料（勞保、就保、健保、勞退自提、所得稅）</h2><AnomalyOperationRecovery onResolved={()=>void load()}/>
  <p className="text-sm text-gray-600">依勞保局、健保署投保資料登錄；保費由系統依法定費率計算（勞保 11.5%＋就保 1%、員工負擔 20%，按投保日數÷30；健保 5.17%、員工負擔 30%、月底在保者計全月、眷屬最多計 3 口；勞退自提依月提繳工資×自提率）。投保金額請依核定投保資料選擇級距，不直接填實際薪資；勞保與就保依實際參加項目分別勾選。已鎖定月份不可變更。</p>
  <div className="flex gap-2 items-end"><label className="text-sm">員工編號<input className="border block" value={empId} onChange={e=>{setEmpId(e.target.value.trim());setData(null);}}/></label><button type="button" className="px-3 py-1 rounded border" onClick={()=>void load()}>查詢投保資料</button></div>
  {msg&&<p role="status" className="text-sm">{msg}</p>}
  {data&&<>
   <p className="text-sm">目前生效版本：{data.current?.id||'尚未核定（主檔員工薪資會待核）'}；版本序號 {data.headRevision}</p>
   {data.current&&<div className="overflow-x-auto"><table className="text-xs border w-full"><thead><tr><th>期間</th><th>勞保／勞就保投保薪資</th><th>就保</th><th>健保在本單位／金額／眷屬</th><th>勞退提繳工資／自提</th><th>扣繳方式</th><th>扣繳表人數與來源</th></tr></thead><tbody>{data.current.periods.map((p:any,i:number)=><tr key={i} className="border-t"><td>{p.from}–{p.to}</td><td>{yes(p.laborInsured)} {p.laborInsured||p.employmentInsured?p.laborSalary:''}</td><td>{yes(p.employmentInsured)}</td><td>{yes(p.healthInsuredHere)} {p.healthInsuredHere?p.healthAmount+'／'+p.healthDependants+' 口':''}</td><td>{p.pensionSelfPercent>0?p.pensionWage+'／'+p.pensionSelfPercent+'%':'未自提'}</td><td>{METHOD[p.withholdingMethod]||'未登錄'}</td><td>{countDeclaration(p)}</td></tr>)}</tbody></table></div>}
   {data.canPropose&&<details className="border rounded p-3"><summary className="font-semibold text-sm">提出新的投保資料版本</summary><button type="button" disabled={blocked||!data.current} onClick={copy} className="text-sm underline mt-2">帶入目前版本</button>
    {rows.map((r,i)=><fieldset key={i} className="border p-2 mt-2 grid gap-2 sm:grid-cols-3"><legend className="text-sm">期間 {i+1}</legend>
     <label className="text-sm">起日 {i+1}<input type="date" className="border block" value={r.from} disabled={blocked} onChange={e=>change(i,'from',e.target.value)}/></label>
     <label className="text-sm">迄日 {i+1}<input type="date" className="border block" value={r.to} disabled={blocked} onChange={e=>change(i,'to',e.target.value)}/></label>
     <label className="text-sm"><input type="checkbox" checked={r.laborInsured} disabled={blocked} onChange={e=>change(i,'laborInsured',e.target.checked)}/> 勞保 {i+1}</label>
     <label className="text-sm">勞保／就保投保薪資 {i+1}<select className="border block" value={r.laborSalary} disabled={blocked||(!r.laborInsured&&!r.employmentInsured)} onChange={e=>change(i,'laborSalary',e.target.value)}>{LABOR_SALARY_GRADES_2026.map(g=><option key={g} value={g}>{g}</option>)}</select></label>
     <label className="text-sm"><input type="checkbox" checked={r.employmentInsured} disabled={blocked} onChange={e=>change(i,'employmentInsured',e.target.checked)}/> 就保 {i+1}</label>
     <label className="text-sm"><input type="checkbox" checked={r.healthInsuredHere} disabled={blocked} onChange={e=>change(i,'healthInsuredHere',e.target.checked)}/> 健保在本單位 {i+1}</label>
     <label className="text-sm">健保投保金額 {i+1}<select className="border block" value={r.healthAmount} disabled={blocked||!r.healthInsuredHere} onChange={e=>change(i,'healthAmount',e.target.value)}>{!HEALTH_SALARY_GRADES_2026.includes(Number(r.healthAmount))&&<option value={r.healthAmount}>待核對級距：{r.healthAmount}</option>}{HEALTH_SALARY_GRADES_2026.map(g=><option key={g} value={g}>{g}</option>)}</select></label>
     <label className="text-sm">健保眷屬人數 {i+1}<input type="number" min={0} className="border block" value={r.healthDependants} disabled={blocked||!r.healthInsuredHere} onChange={e=>change(i,'healthDependants',e.target.value)}/></label>
     <label className="text-sm">勞退月提繳工資 {i+1}<input type="number" className="border block" value={r.pensionWage} disabled={blocked} onChange={e=>change(i,'pensionWage',e.target.value)}/></label>
     <label className="text-sm">勞退自提率% {i+1}<input type="number" min={0} max={6} step={0.01} className="border block" value={r.pensionSelfPercent} disabled={blocked} onChange={e=>change(i,'pensionSelfPercent',e.target.value)}/></label>
     <label className="text-sm">所得稅扣繳方式 {i+1}<select className="border block" value={r.withholdingMethod} disabled={blocked} onChange={e=>change(i,'withholdingMethod',e.target.value)}><option value="">請選擇</option>{Object.entries(METHOD).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
     {r.withholdingMethod==='table'&&<>
      <label className="text-sm min-w-0">扣繳表配偶及扶養親屬人數（不含本人） {i+1}<input type="number" min={0} max={100} step={1} className="border block w-full" value={r.withholdingSpouseAndDependants} disabled={blocked} onChange={e=>change(i,'withholdingSpouseAndDependants',e.target.value)}/></label>
      <label className="text-sm min-w-0">扣繳人數來源識別 {i+1}<input className="border block w-full" maxLength={150} value={r.withholdingCountSourceRef} disabled={blocked} onChange={e=>change(i,'withholdingCountSourceRef',e.target.value)}/></label>
      <p className="text-xs sm:col-span-3">此人數為配偶加受扶養親屬，不包含本人，與健保眷屬人數分開。兩欄均可留白；需查表但申報未確認時，薪資會待核。若填人數（包括0），須同時填申報表的來源識別，不接受網址。超過11人或表列薪資範圍時，依115年公式計算；角分與未決適用條件仍待核實。100人為登錄容量上限。</p>
     </>}
     <button type="button" disabled={blocked||rows.length===1} onClick={()=>setRows(rows.filter((_,n)=>n!==i))} className="text-sm underline text-left">移除期間 {i+1}</button></fieldset>)}
    <button type="button" disabled={blocked||rows.length>=100} onClick={()=>setRows([...rows,blank()])} className="text-sm underline mt-2">新增期間</button>
    <label className="block text-sm mt-2">提出原因（至少5字）<textarea className="border block w-full" value={reason} disabled={blocked} onChange={e=>setReason(e.target.value)}/></label>
    <button type="button" disabled={blocked||reason.trim().length<5||rows.some(r=>!r.from||!r.to||!r.withholdingMethod||!validCountDeclaration(r))} onClick={()=>void send('propose-insurance-timeline',{periods:periods()})} className="mt-2 px-3 py-1 rounded bg-brand-blue-dark text-white disabled:opacity-50">送出投保資料提案</button></details>}
   {data.versions.filter((v:any)=>v.status==='proposed').map((v:any)=><article key={v.id} className="border rounded p-3 text-sm space-y-1"><p className="font-semibold">待核定 · {v.id} · 提出 {v.proposedBy} · 影響月份 {v.changedMonths.join('、')}</p><p>{v.reason}</p>{v.periods.map((p:any,i:number)=><p key={i}>{p.from}–{p.to}：勞保 {p.laborInsured?p.laborSalary:'否'}；就保 {p.employmentInsured?p.laborSalary:'否'}；健保 {p.healthInsuredHere?p.healthAmount+'／眷屬 '+p.healthDependants:'否'}；勞退自提 {p.pensionSelfPercent}%；扣繳方式：{METHOD[p.withholdingMethod]||'未登錄'}；{countDeclaration(p)}</p>)}
    {v.proposedBy===me||data.empId===me?<p className="text-xs text-gray-500">本人資料或自己提出的版本需由另一位管理者核定。</p>:<><label className="block">核定／退回原因（至少5字）<textarea className="border block w-full" value={reason} disabled={blocked} onChange={e=>setReason(e.target.value)}/></label><div className="flex gap-2"><button type="button" disabled={blocked||reason.trim().length<5} onClick={()=>void send('review-insurance-timeline',{versionId:v.id,expectedRevision:v.revision,mode:'approve'})} className="px-3 py-1 rounded bg-green-700 text-white disabled:opacity-50">核定投保資料</button><button type="button" disabled={blocked||reason.trim().length<5} onClick={()=>void send('review-insurance-timeline',{versionId:v.id,expectedRevision:v.revision,mode:'return'})} className="px-3 py-1 rounded border disabled:opacity-50">退回</button></div></>}</article>)}
   <section aria-label="投保與扣繳歷史版本" className="space-y-2"><h3 className="font-semibold text-sm">投保與扣繳歷史版本（唯讀）</h3>{data.versions.filter((v:any)=>v.status!=='proposed').map((v:any)=><details key={v.id} className="border rounded p-3 text-sm"><summary>{v.status==='approved'?'已核定':'已退回'} · {v.id} · 提出 {v.proposedBy}</summary><p>原因：{v.reason}</p>{v.periods.map((p:any,i:number)=><p key={i}>{p.from}–{p.to}；扣繳方式：{METHOD[p.withholdingMethod]||'未登錄'}；{countDeclaration(p)}</p>)}<p>核定者：{v.approvedBy||'尚未核定'}；核定時間：{v.approvedAt||'尚未核定'}</p></details>)}</section>
  </>}
 </section>;
}
