import {withEmploymentAuthority} from './employmentAuthority';
import {employmentStateOn} from '../../../utils/employmentAuthority';
import {compEmploymentEvidence} from './compEmployment';
import {selectedCreditSegments} from './compCreditSource';
import {UserRole} from '../../../types';
import {validDate,taipeiDate,intervalMinutes} from '../../../utils/attendance';
import {evidenceHash,caseKey} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths,monthsInRange} from './monthGuard';
import {overtimeActualSource} from './overtimeWorkflow';
import {foldCompLedger,fifoComp,type CompEntry} from './compLedger';
import {planCompCaseRefresh} from './attendanceCaseService';
const fail=(code:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode:code});};
const id=(s:any)=>typeof s==='string'&&s.length>0&&s.length<=150&&!s.includes('/')&&!['.','..'].includes(s);
const get=async(db:any,tx:any,c:string,key:string,optional=false)=>{if(!id(key))fail(400,'識別無效');const s=await tx.get(db.collection(c).doc(key));if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
const rows=async(db:any,tx:any,c:string,empId:string)=>{const s=await tx.get(db.collection(c).where('empId','==',empId).limit(501));if(s.size>500)fail(409,'補休來源技術容量超限');return s.docs.map((d:any)=>({...d.data(),id:d.id}));};
const minute=(v:any)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!validDate(v.slice(0,10))||!Number.isFinite(Date.parse(v)))fail(400,'需完整日期時區及分鐘');return Date.parse(v)/60000;};
const range=(r:any)=>{const start=minute(r.startDate),end=minute(r.endDate);if(end<=start||end-start>31*1440)fail(400,'補休期間無效／超技術容量');return {start,end};};
const date=(m:number)=>taipeiDate(new Date(m*60000));
const months=(r:any)=>{const w=range(r);return monthsInRange(date(w.start),date(w.end-1));};
const overlap=(a:any,b:any)=>a.start<b.end&&b.start<a.end;
const approved=(p:any)=>p?.status==='approved'&&p.version&&p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt));
const policyValid=(p:any,empId:string)=>approved(p)&&p.approvedBy!==empId&&p.empId===empId&&p.employeeAgreedBy===empId&&Number.isFinite(Date.parse(p.employeeAgreedAt))&&Array.isArray(p.reviewerIds)&&p.reviewerIds.length&&p.reviewerIds.every(id)&&validDate(p.effectiveFrom)&&validDate(p.effectiveTo)&&validDate(p.deadline)&&validDate(p.annualEnd)&&p.deadline<=p.annualEnd&&p.reservePending===true&&p.minuteBasis==='explicit-request-interval'&&p.conversion==='one-to-one';
const scope=(a:any,empId:string,p:any,review=false)=>{if(!review&&a.id===empId)return;if(a.id===empId||![UserRole.Admin,UserRole.SuperAdmin].includes(a.role)||!policyValid(p,empId)||!p.reviewerIds.includes(a.id))fail(403,'未指定補休覆核權限／不可自核');};
const period=(p:any,r:any)=>{const w=range(r);if(date(w.start)<p.effectiveFrom||date(w.end-1)>p.effectiveTo)fail(409,'補休政策有效期間不符');};
async function source(db:any,tx:any,empId:string,otId:string){
 const ot=await get(db,tx,'overtimeRequests',otId);if(ot.empId!==empId||!['approved','partial-approved'].includes(ot.status)||!Number.isSafeInteger(ot.approvedMinutes)||ot.approvedMinutes<=0)fail(409,'加班來源尚未核實');
 const actual=await overtimeActualSource(db,tx,empId,range(ot));if(actual.unknown||actual.version!==ot.actualSource?.version||actual.version!==ot.approvalSourceVersion)fail(409,'原加班工作來源已變更／未核實');
 let root=ot,seen=new Set<string>();while(root.supersedesId){if(seen.has(root.id)||seen.size>=20)fail(409,'加班來源鏈無效／容量超限');seen.add(root.id);root=await get(db,tx,'overtimeRequests',root.supersedesId);if(root.empId!==empId)fail(409,'加班來源鏈員工不符');}
 const eligibility=await get(db,tx,'compSourceReviews',otId,true),version=evidenceHash(ot);
 const valid=approved(eligibility)&&eligibility.empId===empId&&eligibility.overtimeVersion===version&&(['normal','rest'].includes(eligibility.dayType)||eligibility.dayEvidence)&&Number.isSafeInteger(eligibility.eligibleMinutes)&&eligibility.eligibleMinutes>0&&eligibility.eligibleMinutes<=ot.approvedMinutes&&intervalMinutes(ot.approvedIntervals||[])>=eligibility.eligibleMinutes;
 return {ot,actual,root:root.id,version,eligibility,eligible:!!valid};
}
const snapshotSource=(s:any)=>({overtimeId:s.ot.id,overtimeVersion:s.version,sourceRoot:s.root,actualVersion:s.actual.version,workRefs:s.actual.refs,sourceStartDate:s.ot.startDate,sourceEndDate:s.ot.endDate,eligibilityVersion:s.eligibility?evidenceHash(s.eligibility):null});
async function checkLots(db:any,tx:any,empId:string,lots:any[],allowExpired=false,checkLocked=true){
 for(const l of lots){const s=await source(db,tx,empId,l.overtimeId);if(s.version!==l.overtimeVersion||s.actual.version!==l.actualVersion||!s.eligible||evidenceHash(s.eligibility)!==l.eligibilityVersion)fail(409,'補休原加班／日別來源變更，需差額覆核');if(checkLocked)await assertTransactionMonths(db,tx,[...months(l),...(l.sourceStartDate?months({startDate:l.sourceStartDate,endDate:l.sourceEndDate}):[])]);if(!allowExpired&&l.available+l.reserved>0&&date(Date.now()/60000)>l.deadline)fail(409,'補休已到期，須原加班日基準待結清');}
}
export const COMP_ACTIONS=['get-comp-workflow','submit-comp-request','act-comp-request','scan-comp-settlement'] as const;
export async function handleCompAction(db:any,uid:string,action:string,data:any){
 if(['actor','status','ledger','balance','allocations','originalWageBasis','approvedBy','payable','sourceEvidence'].some(k=>k in data))fail(400,'不可提交伺服器帳本／核准證據');
 const readTx={get:(r:any)=>r.get()};
 if(action==='get-comp-workflow'){
  const a=await get(db,readTx,'employees',uid),empId=data.empId||uid,p=await get(db,readTx,'compPolicies',empId,true);scope(a,empId,p);
  const requests=await rows(db,readTx,'compRequests',empId),ledger=await rows(db,readTx,'compLedger',empId),tasks=await rows(db,readTx,'compSettlementTasks',empId);let balance:any;const issues:string[]=[];
  try{const f=foldCompLedger(ledger);await checkLots(db,readTx,empId,f.lots,true,false);const employee=await withEmploymentAuthority(db,readTx,await get(db,readTx,'employees',empId));const state=employmentStateOn(employee,date(Date.now()/60000));if(state==='unknown')issues.push('employment-source-unverified');const unavailable=!policyValid(p,empId)||state!=='active';balance={available:unavailable?null:f.lots.filter(l=>l.deadline>=date(Date.now()/60000)).reduce((n,l)=>n+l.available,0),reserved:f.reserved,used:f.used,pendingPolicy:requests.filter(r=>r.status==='pending-policy').reduce((n,r)=>n+r.minutes,0),pendingPayroll:f.lots.filter(l=>l.originalWageBasis?.status!=='confirmed').map(l=>l.id),lots:f.lots};}catch{issues.push('ledger-or-source-unverified');balance={available:null,reserved:null,used:null,pendingPolicy:null,lots:[]};}
  return {empId,requests:requests.map(r=>({...r,sourceVersion:evidenceHash(r)})),ledger,tasks,balance,issues,policy:policyValid(p,empId)?{version:p.version,reviewerIds:p.reviewerIds,deadline:p.deadline}:null,settlementEligibility:'BLOCKED',deliveryEnabled:false};
 }
 if(!id(data.operationId)||typeof data.reason!=='string'||data.reason.trim().length<5||data.reason.length>2000)fail(400,'需操作識別及完整原因');const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await get(db,tx,'employees',uid);if(![UserRole.Employee,UserRole.Admin,UserRole.SuperAdmin].includes(a.role))fail(403,'無補休權限');
  const old=action==='act-comp-request'?await get(db,tx,'compRequests',data.requestId):null,empId=old?.empId||(action==='scan-comp-settlement'||data.kind==='adjustment'?data.empId:uid),p=await get(db,tx,'compPolicies',empId,true);
  const review=action==='scan-comp-settlement'||data.kind==='adjustment'||!!old&&!['cancel','resubmit'].includes(data.mode);scope(a,empId,p,review);if(!review&&uid!==empId)fail(403,'只能本人選擇／撤回');
  const ref=db.collection('compCommands').doc(evidenceHash([uid,data.operationId])),prior=await tx.get(ref);if(prior.exists){if(prior.data().hash!==hash)fail(409,'操作識別內容不符');return prior.data().result;}
  const requests=await rows(db,tx,'compRequests',empId),ledger=await rows(db,tx,'compLedger',empId),fold=foldCompLedger(ledger),employee=await withEmploymentAuthority(db,tx,await get(db,tx,'employees',empId));
  const entries:CompEntry[]=[];const append=(type:any,r:any,allocations:any[],extra:any={})=>entries.push({id:evidenceHash([uid,data.operationId,type,...allocations.map((a:any)=>a.lotId)]),empId,sequence:fold.sequence+entries.length+1,type,requestId:r.id,actor:uid,at,reason:data.reason.trim(),allocations,...extra});
  if(action==='scan-comp-settlement'){
   const state=employmentStateOn(employee,date(Date.now()/60000));if(state==='unknown')fail(409,'任職主檔未涵蓋結清檢查日期，需覆核');const terminated=state==='not-employed';const tasks=await rows(db,tx,'compSettlementTasks',empId),planned:any[]=[];await checkLots(db,tx,empId,fold.lots,true);
   for(const l of fold.lots)if((l.deadline<date(Date.now()/60000)||terminated)&&l.available+l.reserved>0){const task={id:evidenceHash(['comp-settlement',l.id]),empId,lotId:l.id,startDate:l.startDate,endDate:l.endDate,status:'pending-payroll',remainingMinutes:l.available+l.reserved,reservedMinutes:l.reserved,originalWageBasis:l.originalWageBasis,sourceVersion:evidenceHash(l),reason:terminated?'contract-ended':'expired',actor:uid,at};const oldTask=tasks.find(t=>t.id===task.id);if(!oldTask||oldTask.sourceVersion!==task.sourceVersion||oldTask.reason!==task.reason){const history=oldTask?[...(oldTask.history||[]),{revision:oldTask.revision,sourceVersion:oldTask.sourceVersion,remainingMinutes:oldTask.remainingMinutes,reservedMinutes:oldTask.reservedMinutes,reason:oldTask.reason,actor:oldTask.actor,at:oldTask.at}]:[];if(history.length>100)fail(409,'待結清任務歷程容量超限');planned.push({...task,revision:(oldTask?.revision||0)+1,history});}}
   if(tasks.length+planned.filter(t=>!tasks.some(old=>old.id===t.id)).length>500)fail(409,'待結清任務容量超限');const refresh=planned.length?await planCompCaseRefresh(db,tx,empId,[...new Set(planned.flatMap(t=>months(t)))],planned[0],uid,at,planned.slice(1)):()=>{};for(const t of planned){const ref=db.collection('compSettlementTasks').doc(t.id);if(tasks.some(old=>old.id===t.id))tx.update(ref,t);else tx.create(ref,t);}refresh();const result={created:planned.map(t=>t.id),settlementEligibility:'BLOCKED'};tx.create(ref,{hash,result,actor:uid,at});return result;
  }
  if(old){if(old.revision!==data.expectedRevision||evidenceHash(old)!==data.sourceVersion)fail(409,'補休申請版本已變更');await assertTransactionMonths(db,tx,months(old));}
  const creating=!old||data.mode==='resubmit';let r:any,previous:any=null;
  if(creating){
   if(old&&!['needs-info','cancelled','rejected','pending-policy'].includes(old.status))fail(409,'需先撤回／補件，不可覆寫已核申請');if(requests.length>=500)fail(409,'補休申請容量超限');
   const kind=old?.kind||data.kind;if(!['credit','use','adjustment'].includes(kind)||kind==='adjustment'&&old)fail(400,'補休申請類型無效');
   r={id:'comp_'+evidenceHash([uid,data.operationId]),empId,kind,status:'submitted',revision:1,schemaVersion:'comp-request-v1',reason:data.reason.trim(),createdBy:uid,createdAt:at,history:[],policyVersion:policyValid(p,empId)?p.version:null,policyEvidence:policyValid(p,empId)?evidenceHash(p):null,...(old?{supersedesId:old.id}:{})};
   if(kind==='credit'){
    if(data.employeeChoice!==true)fail(400,'必須本人明確選擇補休');const s=await source(db,tx,empId,data.overtimeId||old?.overtimeId);if(!Number.isSafeInteger(data.minutes)||data.minutes<=0||data.minutes>s.ot.approvedMinutes)fail(400,'補休取得分鐘超出已核工作');
    if(fold.lots.some(l=>l.sourceRoot===s.root||(l.approvedIntervals||[]).some((a:any)=>(s.ot.approvedIntervals||[]).some((b:any)=>overlap(a,b))))||requests.some(q=>q.id!==old?.id&&q.kind==='credit'&&(q.sourceRoot===s.root||(q.approvedIntervals||[]).some((a:any)=>(s.ot.approvedIntervals||[]).some((b:any)=>overlap(a,b))))&&!['cancelled','rejected','superseded'].includes(q.status)))fail(409,'原加班來源已選擇或入帳，不可重複取得');
    const segments=selectedCreditSegments(s,data.minutes);Object.assign(r,snapshotSource(s),{overtimeId:s.ot.id,minutes:data.minutes,employeeChoice:{actor:uid,at},creditSegments:segments,approvedIntervals:segments.flatMap(x=>x.approvedIntervals),startDate:segments[0].startDate,endDate:segments[segments.length-1].endDate});await assertTransactionMonths(db,tx,months(s.ot));if(!policyValid(p,empId)||!s.eligible||segments.some(x=>!x.eligible))r.status='pending-policy';else{period(p,r);if(data.minutes>s.eligibility.eligibleMinutes||p.deadline<date(range(r).end-1))fail(409,'補休取得超出已核適用時數／期限');r.deadline=p.deadline;}
   }else if(kind==='use'){
    const w=range(data);const employmentEvidence=await compEmploymentEvidence(db,tx,empId,w);Object.assign(r,{employmentEvidence,startDate:data.startDate,endDate:data.endDate,minutes:w.end-w.start,allocations:[]});
    if(date(w.start)<date(Date.now()/60000))fail(409,'過去／離職後使用需獨立更正流程');
    for(const q of requests)if(q.id!==old?.id&&q.kind==='use'&&!['cancelled','rejected','superseded'].includes(q.status)&&overlap(range(q),w))fail(409,'已有重疊補休使用申請');
    const leaves=await rows(db,tx,'leaveRequests',empId);for(const q of leaves)if(!['駁回','已取消','已取代'].includes(q.status)&&overlap(range(q),w))fail(409,'補休與既有假單重疊／待核');
    const actual=await overtimeActualSource(db,tx,empId,w);if(actual.intervals.length)fail(409,'補休與已確認工作重疊，需調查');
    if(!policyValid(p,empId))r.status='pending-policy';else{period(p,r);await checkLots(db,tx,empId,fold.lots);const eligible=fold.lots.filter(l=>l.deadline>=date(w.end-1));r.allocations=fifoComp(eligible,r.minutes);append('reserve',r,r.allocations);}
   }else{
    const l=fold.lots.find(l=>l.id===data.lotId);if(!l||!Number.isSafeInteger(data.minutes)||data.minutes<=0||data.minutes>l.available)fail(409,'更正只能沖回明確未使用取得分鐘，不可任意增加');await checkLots(db,tx,empId,[l]);Object.assign(r,{startDate:l.startDate,endDate:l.endDate,minutes:data.minutes,lotId:l.id,ledgerSourceVersion:evidenceHash(ledger),proposedBy:uid});
   }
   await assertTransactionMonths(db,tx,months(r));if(old)previous={...old,status:'superseded',revision:old.revision+1,supersededBy:r.id};
  }else{
   r={...old,revision:old.revision+1};if(!['submitted','pending-policy'].includes(old.status))fail(409,'此狀態不能直接處理；已核更正走獨立差額流程');
   if(['cancel','return','request-info','reject'].includes(data.mode)){
    if(data.mode!=='cancel'&&!policyValid(p,empId))fail(409,'指定政策待設定');r.status=data.mode==='cancel'?'cancelled':data.mode==='reject'?'rejected':'needs-info';
    if(old.kind==='use'&&fold.reservations.has(old.id)){const alloc=fold.reservations.get(old.id)!;await checkLots(db,tx,empId,fold.lots.filter(l=>alloc.some(x=>x.lotId===l.id)),true);append('release',r,alloc);}
   }else if(data.mode==='agree'){
    if(!policyValid(p,empId)||old.status==='pending-policy'||old.policyVersion!==p.version||old.policyEvidence!==evidenceHash(p))fail(409,'需本人以已核政策重送新版本');period(p,r);
    if(r.kind==='credit'){
     const s=await source(db,tx,empId,r.overtimeId);if(!s.eligible||s.version!==r.overtimeVersion||evidenceHash(s.eligibility)!==r.eligibilityVersion||r.minutes>s.eligibility.eligibleMinutes||fold.lots.some(l=>l.sourceRoot===s.root)||r.deadline!==p.deadline||r.deadline<date(Date.now()/60000))fail(409,'原來源／期限變更或已取得，須重新選擇');
     const segments=selectedCreditSegments(s,r.minutes);if(evidenceHash(segments)!==evidenceHash(r.creditSegments)||segments.some(x=>!x.eligible))fail(409,'核准取得區間或逐日來源待重新覆核');await assertTransactionMonths(db,tx,months(s.ot));for(const segment of segments){const lot={...snapshotSource(s),...segment,deadline:r.deadline,policyVersion:p.version,policyEvidence:evidenceHash(p),employeeChoice:r.employeeChoice,employerConsent:{actor:uid,at}};append('credit',r,[{lotId:segments.length===1?r.id:r.id+'_'+segment.sourceClaimId.slice(0,16),minutes:segment.minutes}],{lot});}
    }else if(r.kind==='use'){
     const employment=await compEmploymentEvidence(db,tx,empId,range(r));if(!r.employmentEvidence||evidenceHash(employment)!==evidenceHash(r.employmentEvidence))fail(409,'使用時段任職來源變更，保留預占待覆核');const alloc=fold.reservations.get(r.id);if(!alloc)fail(409,'使用無有效預占');await checkLots(db,tx,empId,fold.lots.filter(l=>alloc.some(x=>x.lotId===l.id)));const actual=await overtimeActualSource(db,tx,empId,range(r));if(actual.intervals.length)fail(409,'使用期間新增已核工作，需調查');const leaves=await rows(db,tx,'leaveRequests',empId);if(leaves.some(q=>!['駁回','已取消','已取代'].includes(q.status)&&overlap(range(q),range(r))))fail(409,'使用期間新增假單，需調查');append('debit',r,alloc);
    }else{if(r.proposedBy===uid||r.ledgerSourceVersion!==evidenceHash(ledger))fail(409,'更正須另一指定主管及原帳本版本');const l=fold.lots.find(l=>l.id===r.lotId);if(!l)fail(409,'更正批次不存在');await checkLots(db,tx,empId,[l]);append('adjustment',r,[{lotId:l.id,minutes:r.minutes}],{approval:{proposedBy:r.proposedBy,sourceVersion:r.ledgerSourceVersion}});}
    r.status='approved';r.approvedBy=uid;r.approvedAt=at;
   }else fail(400,'補休操作無效');
  }
  if(ledger.length+entries.length>500)fail(409,'補休帳本技術容量超限');foldCompLedger([...ledger,...entries]);
  const history=(v:any,from:any)=>{v.history=[...(v.history||[]),{revision:v.revision,actor:uid,at,from:from||null,to:v.status,reason:data.reason.trim()}];if(v.history.length>100||Buffer.byteLength(JSON.stringify(v))>300000)fail(409,'補休歷程容量超限');};history(r,old?.status);if(previous)history(previous,old.status);
  const refresh=await planCompCaseRefresh(db,tx,empId,[...new Set([...months(r),...(old?months(old):[])])],r,uid,at,previous?[previous]:[]);
  if(previous)tx.set(db.collection('compRequests').doc(previous.id),previous);tx.set(db.collection('compRequests').doc(r.id),r);for(const e of entries)tx.create(db.collection('compLedger').doc(e.id),e);refresh();tx.create(ref,{hash,result:r,actor:uid,at});return r;
 });
}
// Explicit testable handler; no scheduler, sender, monetary settlement, or production trigger.
export const compEventHandler=handleCompAction;

/** Read-only payroll source projection. A debit is not enough: current source and employment must still bind. */
export async function compNormalPayEvidence(db:any,tx:any,empId:string,month:string){
 const readTx=tx||{get:(r:any)=>r.get()},issues:string[]=[],intervals:any[]=[];
 const first=Date.parse(month+'-01T00:00:00+08:00')/60000,last=first+new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate()*1440;
 const all=await rows(db,readTx,'compRequests',empId),uses=all.filter(r=>r.kind==='use');
 // Overtime converted to comp time must not also be paid in cash. Credits whose
 // source work touches any week of this month (month ±6 days) go to the OT engine.
 const wFirst=first-6*1440,wLast=last+6*1440,credits:any[]=[];
 for(const r of all.filter(r=>r.kind==='credit'&&!['rejected','cancelled','returned','superseded'].includes(r.status)))for(const g of Array.isArray(r.creditSegments)?r.creditSegments:[{start:NaN,end:NaN}]){if(!Number.isSafeInteger(g?.start)||!Number.isSafeInteger(g?.end)){issues.push('補休取得來源區間無效 '+r.id);continue;}if(g.start<wLast&&g.end>wFirst)credits.push({id:r.id,start:g.start,end:g.end,status:r.status});}if(uses.some(r=>!Number.isFinite(Date.parse(r.startDate))||!Number.isFinite(Date.parse(r.endDate))))issues.push('補休使用日期無法判斷月份');const requests=uses.filter(r=>Date.parse(r.startDate)/60000<last&&Date.parse(r.endDate)/60000>first);
 if(!requests.length)return {issues,intervals,credits};
 const ledger=await rows(db,readTx,'compLedger',empId);
 try{const fold=foldCompLedger(ledger);for(const r of requests){
  if(['rejected','cancelled','returned','superseded'].includes(r.status)){if(fold.reservations.has(r.id)||ledger.some(e=>e.type==='debit'&&e.requestId===r.id))fail(409,'補休終態與預占釋放／使用帳本不一致');continue;}
  if(r.status!=='approved'||!r.approvedBy||!r.approvedAt){issues.push('補休使用申請尚未核定');continue;}
  const w=range(r),debits=ledger.filter(e=>e.type==='debit'&&e.requestId===r.id);
  if(debits.length!==1||evidenceHash(debits[0].allocations)!==evidenceHash(r.allocations)||debits[0].allocations.reduce((n:any,a:any)=>n+a.minutes,0)!==w.end-w.start||evidenceHash(await compEmploymentEvidence(db,readTx,empId,w))!==evidenceHash(r.employmentEvidence))fail(409,'補休使用投影來源失效');
  await checkLots(db,readTx,empId,fold.lots.filter(l=>debits[0].allocations.some((a:any)=>a.lotId===l.id)),true,false);
  intervals.push({start:w.start,end:w.end,kind:'comp',sourceId:r.id,sourceVersion:evidenceHash([r,debits[0]]),approvalId:r.approvedBy+'@'+r.approvedAt});
 }}catch{issues.push('補休帳本／核准使用來源待覆核');}
 return {issues,intervals,credits};
}
