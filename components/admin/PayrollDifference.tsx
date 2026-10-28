import React,{useEffect,useRef,useState} from 'react';
import {UserRole} from '../../types';
import {useAuth} from '../../contexts/AuthContext';
import {APIError,apiPayrollDifference,apiHistoricalPayrollDifference,getHistoricalPayrollCorrection} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {payrollItemIdentity,payrollItemMonth,payrollItemIdentifier} from '../../utils/payroll/items';
import {comparePayrollAmounts,comparisonFraction,type PayrollComparisonSource} from '../../utils/payroll/comparison';

type Scope={empId:string;month:string};
type CorrectionRef={id:string;revision:number;evidenceVersion:string;calculatorVersion:string;adapterVersion:string};
const correctionKeys=['id','evidenceVersion','calculatorVersion','adapterVersion'] as const;
const validCorrection=(v:any):v is CorrectionRef=>!!v&&Number.isSafeInteger(v.revision)&&v.revision>0&&correctionKeys.every(k=>payrollItemIdentifier(v[k]));
const sameCorrection=(a:CorrectionRef|null|undefined,b:CorrectionRef|null|undefined)=>!a&&!b||!!a&&!!b&&a.revision===b.revision&&correctionKeys.every(k=>a[k]===b[k]);
type ActualRow={sourceCode:string;kind:'earning'|'deduction';amount:string;sourceRefs:string;reason:string};
const labels:Record<string,string>={normal:'正常工資',overtime:'加班費','comp-settlement':'補休結清','insurance:labor':'勞保','insurance:employment':'就業保險','insurance:health':'健保','insurance:pension-self':'勞退自提','tax:income':'所得稅扣繳','health:supplementary':'補充保費','insurance:labor-employment':'原記錄勞就保合計','pension:self':'原記錄勞退自提',leave:'原記錄請假扣款'};
const label=(code:string)=>labels[code]||(code.startsWith('item:')?'其他項目 '+code.slice(5):code);
const status:Record<string,string>={proposed:'待獨立覆核',reviewed:'證據已覆核',returned:'已退回','adoption-recorded':'採納證據已記錄'};
const field='border rounded p-2 block w-full min-w-0',button='border rounded px-3 py-2 disabled:opacity-50';
const same=(a:Scope|null,b:Scope)=>!!a&&a.empId===b.empId&&a.month===b.month;
const refs=(text:string)=>text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const goodRefs=(text:string)=>{const r=refs(text);return r.length>0&&r.length<=20&&new Set(r.map(s=>s.toLowerCase())).size===r.length&&r.every(s=>/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(s));};
const money=(value:string)=>/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value.trim());
const reasonOkay=(value:string)=>value.trim().length>=5&&value.length<=2000;
const difference=(value:any)=>{const f=comparisonFraction(value);return !f?'待核實':f.d===1n?String(f.n):String(f.n)+'/'+String(f.d)+'（精確值）';};
function ComparisonView({record,historical=false}:{record:any;historical?:boolean}){
 const corrected=historical&&(record.comparisonBasis==='corrected-historical-rate'||!!record.correctionRef);
 return <div className="space-y-2 text-sm break-words">
  <p>提出者：{record.proposedBy}；提出時間：{record.proposedAt}</p>
  {historical&&<p>此版本比較基準：{corrected?'已採納歷史費率更正目標':'原始鎖月記錄'}{record.correctionRef&&<>；更正 {record.correctionRef.id} / {record.correctionRef.revision}；證據 {record.correctionRef.evidenceVersion}</>}</p>}
  {Array.isArray(record.comparison?.items)&&record.comparison.items.map((row:any,i:number)=><div key={i} className="border rounded p-2 space-y-1"><p className="font-semibold">{label(row.sourceCode)} · {row.kind==='deduction'?'扣項':'應發項目'}</p><p>{corrected?'已採納更正目標金額':historical?'原始記錄金額':'系統金額'}：{row.systemAmount??'待核實'}；實發證據金額：{row.amount??'未提供'}</p><p>差額：{difference(row.delta)}</p><p>來源：{Array.isArray(row.sourceRefs)?row.sourceRefs.join('、'):'未提供'}</p><p>原因：{row.reason}</p></div>)}
  <p>實發淨額證據：{record.actual?.netAmount??'未提供'}；淨額差額：{difference(record.comparison?.netDelta)}</p>
  <p>實發淨額來源：{Array.isArray(record.actual?.sourceRefs)?record.actual.sourceRefs.join('、'):'未提供'}</p><p>淨額核對原因：{record.actual?.reason||'未提供'}</p>
  <p>證據明細與淨額的差異：{difference(record.comparison?.totals?.reconciliationDifference)}</p>
  {Array.isArray(record.comparison?.issues)&&record.comparison.issues.map((issue:string,i:number)=><p key={i}>{issue}</p>)}
  {record.reviewedBy&&<p>覆核者：{record.reviewedBy}；覆核時間：{record.reviewedAt}</p>}
  {record.adoptedBy&&<p>採納紀錄者：{record.adoptedBy}；記錄時間：{record.adoptedAt}</p>}
 </div>;
}
export default function PayrollDifference({historical=false}:{historical?:boolean}={}){
 return <React.Fragment key={historical?'historical':'live'}><PayrollDifferenceView historical={historical}/></React.Fragment>;
}
function PayrollDifferenceView({historical}:{historical:boolean}){
 const {user}=useAuth(),op=useAnomalyOperation(),me=user!.id;
 const [query,setQuery]=useState<Scope>({empId:'',month:''}),queryRef=useRef(query),request=useRef(0),sending=useRef(false);
 const [basis,setBasis]=useState<'original'|'correction'>('original'),basisRef=useRef<'original'|'correction'>('original');
 const [selectedCorrection,setSelectedCorrection]=useState<CorrectionRef|null>(null);
 const [data,setData]=useState<any>(null),[bound,setBound]=useState<Scope|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refreshRequired,setRefreshRequired]=useState(false),[message,setMessage]=useState('');
 const [rows,setRows]=useState<ActualRow[]>([]),[netAmount,setNetAmount]=useState(''),[netRefs,setNetRefs]=useState(''),[netReason,setNetReason]=useState(''),[proposalReason,setProposalReason]=useState(''),[reviewReason,setReviewReason]=useState(''),[adoptReason,setAdoptReason]=useState('');
 const clearDraft=()=>{setRows([]);setNetAmount('');setNetRefs('');setNetReason('');setProposalReason('');setReviewReason('');setAdoptReason('');};
 useEffect(()=>()=>{request.current++;},[]);
 const changeQuery=(next:Scope)=>{queryRef.current=next;setQuery(next);request.current++;setLoading(false);setData(null);setBound(null);setSelectedCorrection(null);setMessage('');setRefreshRequired(false);clearDraft();};
 const changeBasis=(next:'original'|'correction')=>{basisRef.current=next;setBasis(next);changeQuery({...queryRef.current});};
 const load=async()=>{
  const scope={...queryRef.current};if(!payrollItemIdentity(scope.empId)||!payrollItemMonth(scope.month)){setMessage('請填寫有效的員工編號與月份。');return;}
  const chosenBasis=basisRef.current,generation=++request.current;setLoading(true);setData(null);setBound(null);setSelectedCorrection(null);setMessage('');
  try{
   let correctionRef:CorrectionRef|null=null;
   if(historical&&chosenBasis==='correction'){
    const correction=await getHistoricalPayrollCorrection(scope);
    if(generation!==request.current||!same(queryRef.current,scope)||basisRef.current!==chosenBasis)return;
    if(!same(correction,scope)||!same(correction.current,scope)||correction.current?.status!=='adopted'||correction.current?.assessment?.status!=='calculated'||correction.stale!==false||!validCorrection(correction.correctionRef))throw Error('adopted correction unavailable');
    correctionRef={id:correction.correctionRef.id,revision:correction.correctionRef.revision,evidenceVersion:correction.correctionRef.evidenceVersion,calculatorVersion:correction.correctionRef.calculatorVersion,adapterVersion:correction.correctionRef.adapterVersion};
   }
   const value=historical?await apiHistoricalPayrollDifference({...scope,...(correctionRef?{correctionRef}:{})}):await apiPayrollDifference(scope);
   if(generation!==request.current||!same(queryRef.current,scope))return;
   if(value.empId!==scope.empId||value.month!==scope.month||!Array.isArray(value.versions)||value.current&&!same(value.current,scope)||value.source&&!same(value.source,scope)||value.versions.some((v:any)=>!same(v,scope)))throw Error('scope mismatch');
   if(value.source&&(!Array.isArray(value.source.lines)||new Set(value.source.lines.map((line:any)=>line.code)).size!==value.source.lines.length||value.source.lines.some((line:any)=>typeof line.code!=='string'||!line.code||!['earning','deduction'].includes(line.kind))))throw Error('source rows invalid');
   if(historical&&((value.comparisonBasis??'original-recorded-payroll')!==(correctionRef?'corrected-historical-rate':'original-recorded-payroll')||!sameCorrection(value.correctionRef,correctionRef)))throw Error('comparison basis mismatch');
   setData(value);setBound(scope);setSelectedCorrection(correctionRef);setRefreshRequired(false);clearDraft();setRows((value.source?.lines||[]).map((line:any)=>({sourceCode:line.code,kind:line.kind,amount:'',sourceRefs:'',reason:''})));
  }catch{if(generation===request.current){setData(null);setBound(null);setMessage('差額資料讀取失敗或來源範圍不一致，請重新查詢核實。');}}
  finally{if(generation===request.current)setLoading(false);}
 };
 const current=data?.current,source:PayrollComparisonSource|null=data?.source||null,revision=current?.revision??0;
 const historyOkay=!current||Number.isSafeInteger(current.revision)&&current.revision>0&&Array.isArray(current.history)&&current.history.length===current.revision&&current.history.every((h:any,i:number)=>h&&h.revision===i+1&&typeof h.actor==='string'&&!!h.actor&&Object.prototype.hasOwnProperty.call(status,h.to))&&current.history[current.history.length-1]?.to===current.status;
 const manage=!!data?.canManage&&user?.role===UserRole.SuperAdmin&&bound?.empId!==me;
 const author=current?.proposedBy===me||Array.isArray(current?.history)&&current.history.some((h:any)=>h.to==='proposed'&&h.actor===me)||historical&&(current?.sourceAuthors?.includes(me)||data?.versions?.some((v:any)=>v.sourceAuthors?.includes(me)));
 const basisMismatch=historical&&!!current&&!sameCorrection(current.correctionRef,selectedCorrection);
 const stale=!!data?.stale||!historical&&!!current&&!!source&&current.source?.sourceHash!==source.sourceHash;
 const blocked=busy||loading||op.busy||!!op.pending||op.blocked||refreshRequired||!manage||!bound||!same(bound,query)||!Number.isSafeInteger(revision)||revision<0||!historyOkay;
 const canPropose=manage&&(!current||['reviewed','returned','adoption-recorded'].includes(current.status));
 const canReview=manage&&!author&&current?.status==='proposed';
 const canAdopt=manage&&!author&&current?.status==='reviewed';
 const comparable=(!historical||data?.original?.status==='recorded')&&source?.status==='comparable'&&!stale&&!basisMismatch&&current?.comparison?.varianceStatus!=='unresolved'&&Array.isArray(current?.comparison?.issues)&&current.comparison.issues.length===0;
 const formOkay=!!source&&rows.length>0&&rows.length<=100&&rows.length===source.lines.length&&rows.every(row=>money(row.amount)&&goodRefs(row.sourceRefs)&&reasonOkay(row.reason))&&money(netAmount)&&goodRefs(netRefs)&&reasonOkay(netReason)&&reasonOkay(proposalReason);
 const changeRow=(i:number,key:'amount'|'sourceRefs'|'reason',value:string)=>setRows(previous=>previous.map((row,n)=>n===i?{...row,[key]:value}:row));
 const send=async(action:'propose-payroll-difference'|'review-payroll-difference'|'adopt-payroll-difference',extra:any)=>{
  if(sending.current||blocked||!bound)return;
  sending.current=true;setBusy(true);setMessage('');const scope={...bound};
  const command=JSON.parse(JSON.stringify({caseId:(historical?'historical-payroll-difference:':'payroll-difference:')+scope.empId+':'+scope.month,...scope,expectedRevision:revision,operationId:crypto.randomUUID(),...extra}));
  const routedAction=historical?({'propose-payroll-difference':'propose-historical-payroll-difference','review-payroll-difference':'review-historical-payroll-difference','adopt-payroll-difference':'adopt-historical-payroll-difference'} as const)[action]:action;
  try{await op.attempt({action:routedAction,command});await load();}
  catch(error){if(error instanceof APIError&&error.status===409){setRefreshRequired(true);setMessage('來源或版本已變更，請重新查詢後再核對。');}else setMessage('操作結果尚未確認或未通過，請先核實原操作，不要另送相同內容。');}
  finally{sending.current=false;setBusy(false);}
 };
 const propose=()=>send('propose-payroll-difference',{...(historical&&selectedCorrection?{correctionRef:{...selectedCorrection}}:{}),reason:proposalReason.trim(),actual:{currency:'TWD',items:rows.map(row=>({sourceCode:row.sourceCode,kind:row.kind,amount:row.amount.trim(),sourceRefs:refs(row.sourceRefs),reason:row.reason.trim()})),netAmount:netAmount.trim(),sourceRefs:refs(netRefs),reason:netReason.trim()}});
 return <section className="p-4 max-w-4xl mx-auto space-y-4 min-w-0 break-words">
  <h2 className="text-xl font-bold">{historical?'歷史薪資差額':'薪資差額核對'}</h2>
  <p className="text-sm">{historical?(basis==='correction'?'逐項比較已採納歷史費率更正目標與實發證據；原始鎖月記錄仍保留。差額方向為實發證據減去更正目標，金額含0均須明確填寫。':'逐項比較原始鎖月記錄與實發證據；原始金額未重新計算，也不代表法規已核實。差額方向為實發證據減去原始記錄，金額含0均須明確填寫。'):'逐項比較系統來源與實發證據；金額須明確填寫，包括0。差額方向為實發證據減去系統金額。'}</p>
  <p className="text-sm font-semibold">{historical?'歷史採納只新增核對證據，不會更新原始薪資批次、改寫已鎖月份或付款。':'採納只記錄核對證據，不會套用薪資、改寫已鎖月份或付款。'}</p>
  <AnomalyOperationRecovery onResolved={()=>void load()}/>
  {historical&&<label className="text-sm block">歷史比較基準<select className={field} value={basis} onChange={e=>changeBasis(e.target.value as 'original'|'correction')}><option value="original">原始鎖月記錄</option><option value="correction">已採納歷史費率更正目標</option></select></label>}
  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
   <label className="text-sm min-w-0">差額員工編號<input className={field} value={query.empId} onChange={e=>changeQuery({...queryRef.current,empId:e.target.value.trim()})}/></label>
   <label className="text-sm min-w-0">差額月份<input type="month" className={field} value={query.month} onChange={e=>changeQuery({...queryRef.current,month:e.target.value})}/></label>
   <button type="button" className={button} disabled={loading} onClick={()=>void load()}>{historical?'查詢歷史薪資差額':'查詢薪資差額'}</button>
  </div>
  {loading&&<p role="status">正在查詢差額資料。</p>}{message&&<p role="status">{message}</p>}
  {data&&bound&&<>
   <p className="font-semibold text-sm">目前查詢：{bound.empId} · {bound.month}</p>
   {historical&&<p>本次選擇：{selectedCorrection?'已採納歷史費率更正目標':'原始鎖月記錄'}{selectedCorrection&&<>；更正 {selectedCorrection.id} / {selectedCorrection.revision}；證據 {selectedCorrection.evidenceVersion}</>}</p>}
   {basisMismatch&&<p role="alert">目前提案使用不同的比較基準；核定或採納前須切回該基準。可依目前提案版本退回並保留原因。</p>}
   {stale&&<p role="alert">{historical?'此紀錄的原始鎖月來源已變更，不能核定或記錄採納；請先核實來源並處理舊提案。':'此紀錄的系統來源已變更，不能核定或記錄採納；待覆核提案可先退回，再核對新版來源。'}</p>}
   {Array.isArray(data.sourceIssues)&&data.sourceIssues.map((issue:string,i:number)=><p key={i} className="text-sm">{issue}</p>)}
   {!historyOkay&&<p role="alert">差額歷程不完整，請核實後再操作。</p>}
   {historical&&<section aria-label="原始薪資記錄" className="border rounded p-3 text-sm space-y-1"><h3 className="font-semibold">原始鎖月記錄（唯讀）</h3><p>原始批次：{data.original?.runId??current?.original?.runId??'未取得'}</p>{data.original?.status==='unavailable'&&<p>原始薪資事實缺漏；可提出待查證據，不能核定或記錄採納。</p>}{data.original?.completeness==='legacy-inputs-only'&&<p>原始批次僅保留舊版輸入證據，不代表完整的現行計薪核實。</p>}</section>}
   {!source?<p>{historical?'原始薪資來源尚未取得，不能建立逐項比較。':'系統薪資來源尚未取得，不能建立逐項比較。'}</p>:<section className="border rounded p-3 space-y-2 text-sm"><h3 className="font-semibold">{historical?(selectedCorrection?'已採納更正目標金額':'原始記錄金額'):'本次系統來源'}</h3><p>應發：{source.totals?.gross??'待核實'}；扣項：{source.totals?.deductions??'待核實'}；實發淨額：{source.totals?.net??'待核實'}</p>{source.status!=='comparable'&&<p>{historical?'原始項目或合計仍待核實，缺漏不能當成零；目前只能記錄待查事實。':'系統來源仍待核實，不能把缺漏當成零差額。'}</p>}{source.issues?.map((issue,i)=><p key={i}>{issue}</p>)}</section>}
   {current?<article className="border rounded p-3 space-y-2"><h3 className="font-semibold">目前版本 {current.revision} · {status[current.status]||'狀態待核實'}</h3><ComparisonView record={current} historical={historical}/>{current.status==='adoption-recorded'&&<p className="font-semibold text-sm">已記錄採納，尚未套用薪資，也未付款。</p>}</article>:<p>尚未建立本月差額核對。</p>}
   {canPropose&&source&&<fieldset className="border rounded p-3 space-y-3 min-w-0" disabled={blocked}><legend>提出逐項差額核對</legend><p className="text-sm">請填可核對的來源識別，不貼原始單據；每項都須說明差額或一致的核對依據。</p>
    {rows.map((row,i)=>{const system=source.lines[i],delta=system.status==='confirmed'?comparePayrollAmounts(row.amount.trim(),system.amount).delta:null;return <fieldset key={row.sourceCode} className="border rounded p-2 space-y-2 min-w-0"><legend>{label(row.sourceCode)} · {row.kind==='deduction'?'扣項':'應發項目'}</legend><p className="text-sm">{historical?(selectedCorrection?'已採納更正目標金額':'原始記錄金額'):'系統金額'}：{system.amount??'待核實'}；差額：{difference(delta)}</p>
     <label className="text-sm block">{label(row.sourceCode)} 實發金額<input inputMode="decimal" className={field} value={row.amount} onChange={e=>changeRow(i,'amount',e.target.value)}/></label>
     <label className="text-sm block">{label(row.sourceCode)} 來源識別<textarea className={field} value={row.sourceRefs} onChange={e=>changeRow(i,'sourceRefs',e.target.value)}/></label>
     <label className="text-sm block">{label(row.sourceCode)} 差額／核對原因<textarea maxLength={2000} className={field} value={row.reason} onChange={e=>changeRow(i,'reason',e.target.value)}/></label>
    </fieldset>;})}
    <label className="text-sm block">實發淨額<input inputMode="decimal" className={field} value={netAmount} onChange={e=>setNetAmount(e.target.value)}/></label>
    <label className="text-sm block">實發淨額來源識別<textarea className={field} value={netRefs} onChange={e=>setNetRefs(e.target.value)}/></label>
    <label className="text-sm block">實發淨額核對原因<textarea maxLength={2000} className={field} value={netReason} onChange={e=>setNetReason(e.target.value)}/></label>
    <label className="text-sm block">差額提案原因<textarea maxLength={2000} className={field} value={proposalReason} onChange={e=>setProposalReason(e.target.value)}/></label>
    <button type="button" className={button} disabled={blocked||!formOkay} onClick={()=>{if(formOkay)void propose();}}>提出差額核對</button>
   </fieldset>}
   {current&&(author||bound.empId===me)&&<p className="text-sm">本人資料或曾提出本月差額者，不能覆核或記錄採納。</p>}
   {canReview&&<fieldset disabled={blocked} className="border rounded p-3 space-y-2"><legend>獨立覆核差額證據</legend><label className="text-sm block">差額覆核／退回原因<textarea className={field} maxLength={2000} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked||!comparable||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-difference',{mode:'approve',reason:reviewReason.trim()})}>核定差額證據</button><button type="button" className={button} disabled={blocked||!reasonOkay(reviewReason)} onClick={()=>void send('review-payroll-difference',{mode:'return',reason:reviewReason.trim()})}>退回差額提案</button></div></fieldset>}
   {canAdopt&&<fieldset disabled={blocked||basisMismatch} className="border rounded p-3 space-y-2"><legend>另外記錄證據採納</legend>{current.comparison?.varianceStatus==='nonzero'&&<p className="text-sm">非零差額仍需合法調整核定，不能採納為薪資調整。</p>}<label className="text-sm block">差額採納紀錄原因<textarea className={field} maxLength={2000} value={adoptReason} onChange={e=>setAdoptReason(e.target.value)}/></label><button type="button" className={button} disabled={blocked||!comparable||current.comparison?.varianceStatus!=='zero'||!reasonOkay(adoptReason)} onClick={()=>void send('adopt-payroll-difference',{reason:adoptReason.trim()})}>記錄採納核對證據</button></fieldset>}
   <section aria-label="薪資差額歷史版本" className="space-y-2"><h3 className="font-semibold">薪資差額歷史版本（唯讀）</h3>{data.versions.length?data.versions.map((v:any,i:number)=><details key={v.versionId||i} className="border rounded p-3"><summary>版本 {v.revision} · {status[v.status]||'狀態待核實'}</summary><ComparisonView record={v} historical={historical}/><ul className="space-y-1 text-xs">{Array.isArray(v.history)&&v.history.map((h:any,n:number)=><li key={n}>{h.at} · {h.actor} · {status[h.to]||'歷程待核實'} · {h.reason}</li>)}</ul></details>):<p className="text-sm">尚無歷史版本。</p>}</section>
  </>}
 </section>;
}
