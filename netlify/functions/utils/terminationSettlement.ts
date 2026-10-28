import {UserRole} from '../../../types';
import {validDate} from '../../../utils/attendance';
import {employmentStateOn} from '../../../utils/employmentAuthority';
import {add,decimal,evidence,mul,rational,sum} from '../../../utils/payroll/rational';
import {runPayrollMutation} from './monthGuard';
import {isMonthLocked} from './monthLock';
import {evidenceHash} from './attendanceCaseLifecycle';
import {loadMonthlyPayrollEmployees,employeePayrollSourceKey} from './payrollReviewStorage';
import {normalPayPreview} from './normalPayPreview';
import {pendingRequestIssues,type PendingSources} from './payrollPreflight';
import {validLeaveAllocations} from './payroll';
const fail=(code:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode:code});};
const ident=(v:any)=>typeof v==='string'&&/^[\w:.-]{1,150}$/.test(v);
const text=(v:any)=>typeof v==='string'&&v.trim().length>=5&&v.length<=2000;
const monthOK=(m:any)=>typeof m==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const doc=async(db:any,tx:any,col:string,id:string,optional=false)=>{if(!ident(id))fail(400,'識別無效');const s=await tx.get(db.collection(col).doc(id));if(!s.exists&&!optional)fail(404,'來源不存在');return s.exists?{...s.data(),id:s.id}:null;};
const rows=async(db:any,tx:any,col:string,empId:string)=>{const q=await tx.get(db.collection(col).where('empId','==',empId));return q.docs.map((s:any)=>({...s.data(),id:s.id}));};
const nextDate=(d:string)=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const fraction=(v:any)=>rational(BigInt(v.numerator),BigInt(v.denominator));
export const TERMINATION_ACTIONS=['get-termination-settlement-version','open-termination-adjustment','get-termination-settlement','save-termination-draft','submit-termination-draft','review-termination-draft'] as const;
// LSA Arts.22/23 (full wages/itemised statement/5-year register), Rules Arts.9/14-1
// (termination settlement and itemisation), checked 2026-10-24:
// https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=23
// https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=9
// https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=14-1
// Audit and two-person controls below are design safeguards, not verbatim legal fields.
// Approval records manual evidence only: NEVER salary adoption, payment or gate override.
async function source(db:any,tx:any,empId:string,month:string,exitDate:string|null){
 const raw=await doc(db,tx,'employees',empId),[emp]=await loadMonthlyPayrollEmployees([raw],month,db,tx);
 const start=month+'-01',prior=new Date(Date.parse(start+'T00:00:00Z')-86400000).toISOString().slice(0,10),last=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10);
 // A date-range query omits missing/invalid work dates, even when their absolute
 // timestamps touch this month. Inventory this employee only; unknown dates are
 // retained in the source hash and remain blockers, never inferred away.
 const cq=await tx.get(db.collection('clockRecords').where('empId','==',empId).limit(10001));
 if(cq.size>10000)fail(409,'員工打卡來源清冊技術容量超限，需受控覆核');
 const cards=cq.docs.map((d:any)=>({...d.data(),id:d.id})).filter((c:any)=>!validDate(c.date)||c.date>=prior&&c.date<=nextDate(last)).sort((a:any,b:any)=>a.id.localeCompare(b.id));
 const datedCards=cards.filter((c:any)=>validDate(c.date));
 const leaves=(await rows(db,tx,'leaveRequests',empId)).filter((l:any)=>typeof l.startDate!=='string'||typeof l.endDate!=='string'||!validDate(l.startDate.slice(0,10))||!validDate(l.endDate.slice(0,10))||!Number.isFinite(Date.parse(l.startDate))||!Number.isFinite(Date.parse(l.endDate))||l.startDate.slice(0,10)<=nextDate(last)&&l.endDate.slice(0,10)>=prior);
 if(cards.length>1000||leaves.length>1000)fail(409,'月份來源技術容量超限，需受控覆核');
 const requests:PendingSources={terminationSettlementDrafts:[],terminationAdjustmentCases:[],compRequests:[],compSettlementTasks:[],overtimeRequests:[],anomalyExplanations:[],leaveRequests:leaves,makeupRequests:[],leaveOfAbsenceRequests:[],shiftSwapRequests:[]};
 for(const kind of ['compRequests','compSettlementTasks','overtimeRequests','anomalyExplanations','makeupRequests','leaveOfAbsenceRequests'] as const)requests[kind]=await rows(db,tx,kind,empId);
 for(const field of ['fromEmpId','toEmpId']){const q=await tx.get(db.collection('shiftSwapRequests').where(field,'==',empId));for(const d of q.docs)if(!requests.shiftSwapRequests.some(r=>r.id===d.id))requests.shiftSwapRequests.push({...d.data(),id:d.id});}
 // Real revisions have recordId plus before/after.empId, not a root empId.
 // Single-field recordId queries retain the complete selected card chains and
 // avoid a full revision-collection scan or a new composite index.
 const revisions:any[]=[];
 for(let offset=0;offset<cards.length;offset+=30){
  const ids=cards.slice(offset,offset+30).map((c:any)=>c.id);
  const rq=await tx.get(db.collection('attendanceRevisions').where('recordId','in',ids).limit(1001-revisions.length));
  revisions.push(...rq.docs.map((d:any)=>({...d.data(),id:d.id})));
  if(revisions.length>1000)fail(409,'打卡更正來源鏈技術容量超限，需受控覆核');
 }
 revisions.sort((a:any,b:any)=>a.id.localeCompare(b.id));
 const cases=await rows(db,tx,'attendanceCases',empId);
 const pending=pendingRequestIssues(month,empId,requests,datedCards,[],revisions).map(i=>i.message);
 for(const c of cards)if(!validDate(c.date))pending.push('打卡日期來源無效，不能假定不影響本月：'+c.id);
 for(const r of revisions)if(r.after?.empId!==empId||r.before&&r.before.empId!==empId)pending.push('打卡更正來源鏈員工歸屬無效：'+r.id);
 for(const l of leaves)if(typeof l.startDate!=='string'||typeof l.endDate!=='string'||!validDate(l.startDate.slice(0,10))||!validDate(l.endDate.slice(0,10))||!Number.isFinite(Date.parse(l.startDate))||!Number.isFinite(Date.parse(l.endDate))||Date.parse(l.endDate)<=Date.parse(l.startDate))pending.push('假單期間來源無效，不能假定不影響本月：'+l.id);
 const fromMinute=Date.parse(start+'T00:00:00+08:00')/60000,toMinute=Date.parse(nextDate(last)+'T00:00:00+08:00')/60000;
 for(const c of cases){const w=c.observation?.window;if(!['resolved','cancelled'].includes(c.status)&&(!w||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<toMinute&&w.end>fromMinute))pending.push('出勤案件尚未完成覆核：'+c.id);}
 const trial=normalPayPreview(emp,month,datedCards,leaves,validLeaveAllocations,pending);
 const issues=trial.issues.filter(s=>!s.startsWith('離職當月日期與薪資須人工輸入'));
 const a=emp.employmentAuthority;
 if(!exitDate||!a||a.kind!=='effective-master'||!['active','loa'].includes(employmentStateOn(emp,exitDate))||employmentStateOn(emp,nextDate(exitDate))!=='not-employed')issues.push('人工離職日期未與已核任職時間軸一致；請先走薪資有效期主檔變更／雙人核定');
 const items:any[]=[];
 for(const kind of [...new Set(trial.segments.map(s=>s.kind))]){const parts=trial.segments.filter(s=>s.kind===kind),amount=sum(parts.map(p=>fraction(p.exact)));items.push({code:'normal:'+kind,kind:amount.n<0n?'deduction':'earning',exact:evidence(amount.n<0n?mul(amount,rational(-1n)):amount),sourceIds:[...new Set(parts.flatMap(p=>p.sourceIds))],status:trial.issues.some(s=>!s.startsWith('離職當月日期與薪資須人工輸入'))?'needs-review':'confirmed'});}
 if(!items.length)issues.push('正常薪資來源明細缺漏');
 for(const key of ['labor','health','pensionSelf']){const value=emp.payrollReview?.insurance?.[key],valid=emp.payrollReview?.reviewedBy&&emp.payrollReview?.reviewedAt&&Number.isFinite(value)&&value>=0;items.push({code:'insurance:'+key,kind:'deduction',exact:valid?evidence(decimal(value)):null,sourceIds:valid?['payroll-review:'+month,emp.payrollReview.reviewedBy+'@'+emp.payrollReview.reviewedAt]:[],status:valid?'confirmed':'needs-review'});if(!valid)issues.push('保費來源未核：'+key);}
 const version=evidenceHash({employee:employeePayrollSourceKey(raw),authority:a||null,days:emp.normalPayDays||null,review:emp.payrollReview||null,comp:emp.normalPayCompEvidence||null,cards,leaves,requests,revisions,cases,exitDate});
 return {version,items,issues:[...new Set(issues)],formalEligibility:'BLOCKED',legalValidation:'pending-C2b-C3',trialScope:'normal-and-reviewed-insurance-only',masterVersion:a?.version||null};
}
export function validateManualSettlement(input:any,src:any){
 if(!input||input.currency!=='TWD'||![0,2].includes(input.precision)||!Array.isArray(input.items)||!input.items.length||input.items.length>100)fail(400,'需明示TWD、元／小數精度及逐項金額');
 const seen=new Set<string>();let nets=0;
 const items=input.items.map((i:any)=>{if(!i||!ident(i.code)||seen.has(i.code)||!['earning','deduction','net'].includes(i.kind)||typeof i.amount!=='string'||!(input.precision===0?/^\d{1,10}$/:/^\d{1,10}(\.\d{1,2})?$/).test(i.amount)||!text(i.reason)||typeof i.sourceCode!=='string'||i.sourceCode.length>150)fail(400,'逐項類別、金額、來源及差額原因無效');seen.add(i.code);if(i.kind==='net')nets++;const match=src.items.find((s:any)=>s.code===i.sourceCode);if(i.kind==='net'&&i.sourceCode!=='manual-net')fail(400,'實發輸入類別無效');if(i.kind!=='net'&&match&&match.kind!==i.kind)fail(400,'應發／扣項類別與來源不同');return {code:i.code,kind:i.kind,amount:i.amount,sourceCode:i.sourceCode,reason:i.reason.trim(),trialExact:match?.exact||null,delta:match?.exact?evidence(add(decimal(i.amount),mul(fraction(match.exact),rational(-1n)))):null,sourceStatus:match?.status||'unverified'};});
 if(nets!==1||!items.some((i:any)=>i.kind==='earning'))fail(400,'必須分列應發項與一筆核定實發，不接受只有總額');
 const sources=items.filter((i:any)=>i.kind!=='net').map((i:any)=>i.sourceCode);if(new Set(sources).size!==sources.length)fail(400,'同一來源不能重複給付／扣款');
 const gross=sum(items.filter((i:any)=>i.kind==='earning').map((i:any)=>decimal(i.amount))),deductions=sum(items.filter((i:any)=>i.kind==='deduction').map((i:any)=>decimal(i.amount))),net=decimal(items.find((i:any)=>i.kind==='net').amount),diff=add(add(gross,mul(deductions,rational(-1n))),mul(net,rational(-1n)));
 const issues=[...src.issues];if(diff.n!==0n)issues.push('逐項應發減扣項不等於人工實發；不自動進位或吞差額');
 for(const s of src.items)if(!sources.includes(s.code))issues.push('必要來源項未列：'+s.code);
 for(const i of items.filter((i:any)=>i.kind!=='net')){if(i.sourceStatus!=='confirmed')issues.push('來源未核：'+i.sourceCode);if(i.delta&&BigInt(i.delta.numerator)!==0n)issues.push('人工與精確試算有差額，尚需明確差額依據及合法進位政策核定：'+i.sourceCode);}
 // C2m has no rules to certify a manual variance or a statutory minimum. Persist
 // differences, but do not treat free text or an approve click as proof of legality.
 return {currency:'TWD',precision:input.precision,items,totals:{gross:evidence(gross),deductions:evidence(deductions),net:evidence(net),reconciliationDifference:evidence(diff)},issues:[...new Set(issues)]};
}
export async function handleTerminationAction(db:any,uid:string,action:string,data:any){
 if(!ident(data.empId)||!monthOK(data.month))fail(400,'員工與月份無效');const readTx={get:(r:any)=>r.get()};
 if(action==='get-termination-settlement'||action==='get-termination-settlement-version'){
  const actor=await doc(db,readTx,'employees',uid);if(uid!==data.empId&&actor.role!==UserRole.SuperAdmin)fail(403,'不得讀取他人離職薪資');await doc(db,readTx,'employees',data.empId);
  if(action==='get-termination-settlement-version'){
   if(!ident(data.draftId)||!Number.isInteger(data.revision)||data.revision<1||data.revision>100)fail(400,'歷史版本識別無效');
   const version=await doc(db,readTx,'terminationSettlementVersions',data.draftId+'_'+data.revision);
   if(version.empId!==data.empId||version.month!==data.month||version.id!==data.draftId+'_'+data.revision)fail(403,'不得跨員工／月份讀歷史');
   if(uid===data.empId&&version.status!=='approved')fail(403,'本人僅可讀已核歷史');return version;
  }
  const all=(await rows(db,readTx,'terminationSettlementDrafts',data.empId)).filter((d:any)=>d.month===data.month);if(all.length>100)fail(409,'月份版本容量超限');const lock=await doc(db,readTx,'monthLocks',data.month,true),manage=actor.role===UserRole.SuperAdmin&&uid!==data.empId;
  const adjustments=(await rows(db,readTx,'terminationAdjustmentCases',data.empId)).filter((r:any)=>r.month===data.month);
  const trial=manage&&!(lock&&isMonthLocked(lock))&&validDate(data.exitDate)&&data.exitDate.slice(0,7)===data.month?await source(db,readTx,data.empId,data.month,data.exitDate):null;
  return {empId:data.empId,month:data.month,records:manage?all:all.filter((r:any)=>r.status==='approved'),adjustments:manage?adjustments:[],source:trial,canManage:manage,locked:!!lock&&isMonthLocked(lock),formalEligibility:'BLOCKED'};
 }
 if(!ident(data.operationId)||!text(data.reason))fail(400,'需操作識別及原因');const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const actor=await doc(db,tx,'employees',uid);if(actor.role!==UserRole.SuperAdmin||uid===data.empId)fail(403,'僅最高管理者可登錄他人離職薪資');
  const receipt=db.collection('terminationSettlementCommands').doc(evidenceHash([uid,data.operationId])),old=await tx.get(receipt);if(old.exists){if(old.data().hash!==hash)fail(409,'相同操作識別內容不同');return old.data().result;}
  const lock=await doc(db,tx,'monthLocks',data.month,true);
  if(action==='open-termination-adjustment'){
   if(!lock||!isMonthLocked(lock))fail(409,'差額案件入口限已鎖歷史月份');await doc(db,tx,'employees',data.empId);
   const existing=(await rows(db,tx,'terminationAdjustmentCases',data.empId)).filter((r:any)=>r.month===data.month);if(existing.length)fail(409,'本月已有歷史差額案件，請使用原案件');
   const result={schemaVersion:'termination-adjustment-v1',id:'termination-adjustment_'+evidenceHash([data.empId,data.month]),empId:data.empId,month:data.month,status:'pending-review',revision:1,reason:data.reason.trim(),actor:uid,at,lockVersion:evidenceHash(lock),originalPayrollRunId:lock.payrollRunId||null,legacySnapshotMissing:!lock.payrollRunId,formalEligibility:'BLOCKED',paymentStatus:'not-paid',history:[{actor:uid,at,to:'pending-review',reason:data.reason.trim()}]};
   tx.create(db.collection('terminationAdjustmentCases').doc(result.id),result);tx.create(receipt,{actor:uid,at,hash,result});return result;
  }
  if(lock&&isMonthLocked(lock))fail(423,'已鎖月份只能另走差額案件；本表不改原snapshot，請建立歷史差額案件，後續核定／付款流程尚未提供');
  const all=(await rows(db,tx,'terminationSettlementDrafts',data.empId)).filter((d:any)=>d.month===data.month);if(all.length>100)fail(409,'月份版本容量超限');
  let current:any=null;if(data.draftId)current=await doc(db,tx,'terminationSettlementDrafts',data.draftId);
  if(current&&(current.schemaVersion!=='termination-settlement-v1'||current.empId!==data.empId||current.month!==data.month||current.revision!==data.expectedRevision))fail(409,'紀錄範圍或版本已變更');
  const exitDate=action==='save-termination-draft'?data.exitDate:current?.exitDate;if(!validDate(exitDate)||exitDate.slice(0,7)!==data.month)fail(400,'離職日期必須在有效月份內');
  const src=await source(db,tx,data.empId,data.month,exitDate);let result:any;
  if(action==='save-termination-draft'){
   if(current&&!['draft','rejected'].includes(current.status)||!current&&data.expectedRevision!==0)fail(409,'不可改已送審／已核版本');
   if(!current&&all.length>=100)fail(409,'月份版本技術容量已滿');if(all.some((r:any)=>r.id!==current?.id&&['draft','pending'].includes(r.status)))fail(409,'已有未完成人工離職紀錄，請先處理原版本');
   const manual=validateManualSettlement(data.manual,src);const revision=(current?.revision||0)+1,id=current?.id||'termination_'+evidenceHash([uid,data.operationId]);
   result={schemaVersion:'termination-settlement-v1',inputApprovalScope:'recorded-inputs-only',id,empId:data.empId,month:data.month,exitDate,revision,status:'draft',source:src,manual,createdBy:current?.createdBy||uid,createdAt:current?.createdAt||at,updatedBy:uid,updatedAt:at,history:[...(current?.history||[]),{actor:uid,at,to:'draft',reason:data.reason.trim(),revision}],formalEligibility:'BLOCKED',paymentStatus:'not-paid',applicationStatus:'not-applied'};
  }else{
   if(!current)fail(404,'紀錄不存在');if(!(action==='review-termination-draft'&&data.mode==='reject')&&src.version!==current.source.version)fail(409,'來源已變更，請重新保存草稿並覆核');
   if(action==='submit-termination-draft'){if(current.status!=='draft')fail(409,'只有草稿可送審');result={...current,status:'pending',submittedBy:uid,submittedAt:at};}
   else{if(current.status!=='pending'||!['approve','reject'].includes(data.mode))fail(409,'審核狀態無效');if([current.createdBy,current.updatedBy,current.submittedBy,...current.history.filter((h:any)=>['draft','pending'].includes(h.to)).map((h:any)=>h.actor)].includes(uid))fail(403,'不得自核本人提出／編輯／送審紀錄');if(data.mode==='approve'&&validateManualSettlement(current.manual,src).issues.length)fail(409,'來源、逐項差額或任職日期仍待覆核，不能核定');if(data.mode==='approve'&&all.some((r:any)=>r.id!==current.id&&r.status==='approved'))fail(409,'已有已核紀錄；須另走差額流程，不能取代');result={...current,status:data.mode==='approve'?'approved':'rejected',reviewedBy:uid,reviewedAt:at};}
   result={...result,revision:current.revision+1,history:[...current.history,{actor:uid,at,to:result.status,reason:data.reason.trim(),revision:current.revision+1}]};
  }
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>700000)fail(409,'紀錄技術容量過大，未寫入任何版本');
  if(result.history.length>100)fail(409,'歷程技術容量已滿');
  // Immutable version captures before/after inputs, reasons and original source evidence.
  tx.create(db.collection('terminationSettlementVersions').doc(result.id+'_'+result.revision),result);
  tx.set(db.collection('terminationSettlementDrafts').doc(result.id),result);tx.create(receipt,{actor:uid,at,hash,result});return result;
 });
}
