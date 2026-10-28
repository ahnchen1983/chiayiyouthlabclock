import {UserRole} from '../../../types';
import {validDate} from '../../../utils/attendance';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import type {WorktimeAuthority} from '../../../utils/payroll/worktimeCompliance';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';

export const WORKTIME_DECLARATION_ACTIONS=['get-worktime-declaration','propose-worktime-declaration','review-worktime-declaration'] as const;
export type WorktimeAuthorityDeclaration=Pick<WorktimeAuthority,'purpose'|'authorityOccurredAt'|'effectiveFrom'|'effectiveTo'|'sourceRefs'|'consentBody'|'cycleFrom'|'cycleTo'|'designationRef'|'filedOn'>&{reason:string};
export interface WorkRulesDeclaration {
 status:'unknown'|'recorded';basis:'filed-rules'|'below-30-recorded-terms'|'unresolved';sourceRefs:string[];reason:string;
 documentState?:'draft'|'effective'|'unknown';versionRef?:string;authorityOccurredAt?:string;effectiveFrom?:string;effectiveTo?:string;filingRef?:string;publicationRef?:string;
}
export interface WorktimeDeclaration {
 regime:'standard-8-40'|'variable'|'84-1'|'unknown';weekStartsOn:0|null;headcount:number|null;unionExists:boolean|null;
 overtimeMode:'46'|'54-138'|'unknown';cycle:{from:string;to:string}|null;
 rotation:'not-rotating'|'rotating'|'unknown';rotationRest:'11-hour'|'8-hour'|'unknown';exception:'none'|'unknown';
 authorities:WorktimeAuthorityDeclaration[];sourceRefs:string[];workRules:WorkRulesDeclaration;
}
type State='proposed'|'approved'|'returned';
interface History {actor:string;at:string;to:State;revision:number;reason:string;operationId:string}
const flags={approvalScope:'recorded-declaration-only' as const,activationStatus:'not-activated' as const,formalEligibility:'BLOCKED' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const,legalValidation:'unresolved' as const};
export interface WorktimeDeclarationVersion {
 schemaVersion:'worktime-declaration-v1';id:string;empId:string;month:string;revision:number;status:State;declaration:WorktimeDeclaration;
 proposedBy:string;proposedAt:string;reviewedBy?:string;reviewedAt?:string;recordApprovedBy?:string;recordApprovedAt?:string;history:History[];
 approvalScope:'recorded-declaration-only';activationStatus:'not-activated';formalEligibility:'BLOCKED';applicationStatus:'not-applied';paymentStatus:'not-paid';legalValidation:'unresolved';
}
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const invalid=():never=>fail(400,'工時制度聲明格式、證據識別或日期無效');
const refs=(v:any):string[]=>{if(!Array.isArray(v)||!v.length||v.length>20||v.some(r=>!payrollItemIdentifier(r))||new Set(v.map(r=>r.toLowerCase())).size!==v.length)return invalid();return [...v];};
const timestamp=(v:any):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v)&&validDate(v.slice(0,10))&&Number.isFinite(Date.parse(v));
const period=(from:any,to:any)=>{if(!validDate(from)||!validDate(to)||from>to)invalid();};
const purposes=['regime','collective-overtime','individual-overtime','rotation-applicability','54-cycle','rotation-8','filing-54','filing-rotation-8'] as const;
const specific:Record<string,string[]>={'collective-overtime':['consentBody'],'54-cycle':['consentBody','cycleFrom','cycleTo'],'rotation-8':['consentBody','designationRef'],'filing-54':['filedOn'],'filing-rotation-8':['filedOn']};
export const worktimeDeclarationId=(empId:string,month:string)=>'wtd_'+evidenceHash([empId,month]);

export function validateWorktimeDeclaration(value:any):WorktimeDeclaration {
 assertPayrollItemFields(value,['regime','weekStartsOn','headcount','unionExists','overtimeMode','cycle','rotation','rotationRest','exception','authorities','sourceRefs','workRules']);
 if(!['standard-8-40','variable','84-1','unknown'].includes(value.regime)||value.weekStartsOn!==0&&value.weekStartsOn!==null||value.headcount!==null&&(!Number.isSafeInteger(value.headcount)||value.headcount<1)||value.unionExists!==null&&typeof value.unionExists!=='boolean'||!['46','54-138','unknown'].includes(value.overtimeMode)||!['not-rotating','rotating','unknown'].includes(value.rotation)||!['11-hour','8-hour','unknown'].includes(value.rotationRest)||!['none','unknown'].includes(value.exception)||!Array.isArray(value.authorities)||value.authorities.length>purposes.length)return invalid();
 let cycle:WorktimeDeclaration['cycle']=null;
 if(value.cycle!==null){assertPayrollItemFields(value.cycle,['from','to']);period(value.cycle.from,value.cycle.to);cycle={from:value.cycle.from,to:value.cycle.to};}
 const seen=new Set<string>();
 const authorities=value.authorities.map((a:any):WorktimeAuthorityDeclaration=>{
  if(!a||!purposes.includes(a.purpose)||seen.has(a.purpose))return invalid();seen.add(a.purpose);
  const extras=specific[a.purpose]||[];assertPayrollItemFields(a,['purpose','authorityOccurredAt','effectiveFrom','effectiveTo','sourceRefs','reason',...extras]);
  if(!timestamp(a.authorityOccurredAt))return invalid();period(a.effectiveFrom,a.effectiveTo);
  const extra:any={};for(const key of extras){
   if(key==='consentBody'){if(!['union','labor-management'].includes(a[key]))return invalid();}
   else if(['cycleFrom','cycleTo','filedOn'].includes(key)){if(!validDate(a[key]))return invalid();}
   else if(!payrollItemIdentifier(a[key]))return invalid();extra[key]=a[key];
  }
  // A filing is an already occurred fact, not a future promise. Its date may
  // precede the recorded authority event, but cannot be later than that event's
  // Taipei calendar date. Proposal/history validation separately requires the
  // actual authority instant to precede the original proposal instant.
  if(a.purpose==='filing-54'||a.purpose==='filing-rotation-8'){
   const authorityDate=new Date(Date.parse(a.authorityOccurredAt)+8*60*60*1000).toISOString().slice(0,10);
   if(a.filedOn>authorityDate)fail(400,'備查日期不得晚於實際權限事件的臺北日期；尚未備查請保留證據缺漏');
  }
  if(a.purpose==='54-cycle')period(a.cycleFrom,a.cycleTo);
  return {purpose:a.purpose,authorityOccurredAt:a.authorityOccurredAt,effectiveFrom:a.effectiveFrom,effectiveTo:a.effectiveTo,sourceRefs:refs(a.sourceRefs),reason:payrollItemReason(a.reason),...extra};
 });
 let workRules:WorkRulesDeclaration={status:'unknown',basis:'unresolved',sourceRefs:[],reason:'未提供現行生效工作規則或契約條款證據'};
 if(value.workRules!==undefined){
  const w=value.workRules;assertPayrollItemFields(w,['status','basis','sourceRefs','reason','documentState','versionRef','authorityOccurredAt','effectiveFrom','effectiveTo','filingRef','publicationRef']);
  if(!['unknown','recorded'].includes(w.status)||!['filed-rules','below-30-recorded-terms','unresolved'].includes(w.basis))return invalid();
  if(w.status==='unknown'){
   assertPayrollItemFields(w,['status','basis','sourceRefs','reason']);if(w.basis!=='unresolved'||!Array.isArray(w.sourceRefs)||w.sourceRefs.length)return invalid();workRules={status:'unknown',basis:'unresolved',sourceRefs:[],reason:payrollItemReason(w.reason)};
  }else{
   if(!['draft','effective','unknown'].includes(w.documentState)||!payrollItemIdentifier(w.versionRef)||!timestamp(w.authorityOccurredAt))return invalid();period(w.effectiveFrom,w.effectiveTo);
   if(w.basis==='filed-rules'&&(!payrollItemIdentifier(w.filingRef)||!payrollItemIdentifier(w.publicationRef)))return invalid();
   for(const k of ['filingRef','publicationRef'])if(w[k]!==undefined&&!payrollItemIdentifier(w[k]))return invalid();
   workRules={status:'recorded',basis:w.basis,sourceRefs:refs(w.sourceRefs),reason:payrollItemReason(w.reason),documentState:w.documentState,versionRef:w.versionRef,authorityOccurredAt:w.authorityOccurredAt,effectiveFrom:w.effectiveFrom,effectiveTo:w.effectiveTo,...(w.filingRef!==undefined?{filingRef:w.filingRef}:{}),...(w.publicationRef!==undefined?{publicationRef:w.publicationRef}:{})};
  }
 }
 return {regime:value.regime,weekStartsOn:value.weekStartsOn,headcount:value.headcount,unionExists:value.unionExists,overtimeMode:value.overtimeMode,cycle,rotation:value.rotation,rotationRest:value.rotationRest,exception:value.exception,authorities,sourceRefs:refs(value.sourceRefs),workRules};
}
const read=async(reader:any,ref:any,optional=false)=>{const snap=await reader.get(ref);if(!snap.exists){if(optional)return null;fail(409,'工時聲明來源或不可變歷程缺漏');}return snap.data();};
const MAX_REVISIONS=60,MAX_BYTES=160000;
function validateVersion(v:any,id:string,empId:string,month:string){
 try{
  if(!v||v.schemaVersion!=='worktime-declaration-v1'||v.id!==id||v.empId!==empId||v.month!==month||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>MAX_REVISIONS||!Array.isArray(v.history)||v.history.length!==v.revision||Object.entries(flags).some(([k,value])=>v[k]!==value)||evidenceHash(validateWorktimeDeclaration(v.declaration))!==evidenceHash(v.declaration))throw Error();
  let state:State|null=null,proposal:History|null=null,last=-Infinity;const authors=new Set<string>();
  for(let i=0;i<v.history.length;i++){
   const h=v.history[i];assertPayrollItemFields(h,['actor','at','to','revision','reason','operationId']);payrollItemReason(h.reason);
   if(!payrollItemIdentity(h.actor)||h.actor===empId||!timestamp(h.at)||Date.parse(h.at)<last||h.revision!==i+1||!payrollItemIdentifier(h.operationId))throw Error();
   if(h.to==='proposed'){if(state&&!['approved','returned'].includes(state))throw Error();authors.add(h.actor);proposal=h;}
   else if(['approved','returned'].includes(h.to)){if(state!=='proposed'||authors.has(h.actor))throw Error();}else throw Error();
   state=h.to;last=Date.parse(h.at);
  }
  if(state!==v.status||!proposal||v.proposedBy!==proposal.actor||v.proposedAt!==proposal.at)throw Error();
  const final=v.history.at(-1);
  if(state==='proposed'){if(v.reviewedBy!==undefined||v.reviewedAt!==undefined||v.recordApprovedBy!==undefined||v.recordApprovedAt!==undefined)throw Error();}
  else if(v.reviewedBy!==final.actor||v.reviewedAt!==final.at||state==='approved'&&(v.recordApprovedBy!==final.actor||v.recordApprovedAt!==final.at)||state==='returned'&&(v.recordApprovedBy!==undefined||v.recordApprovedAt!==undefined))throw Error();
  if(v.declaration.authorities.some((a:any)=>Date.parse(a.authorityOccurredAt)>Date.parse(v.proposedAt))||v.declaration.workRules.authorityOccurredAt&&Date.parse(v.declaration.workRules.authorityOccurredAt)>Date.parse(v.proposedAt))throw Error();
 }catch{fail(409,'工時聲明版本、事件日期或獨立覆核歷程無效');}
}
async function history(db:any,reader:any,current:any,id:string,empId:string,month:string):Promise<WorktimeDeclarationVersion[]>{
 if(!current)return [];validateVersion(current,id,empId,month);const versions:WorktimeDeclarationVersion[]=[];
 for(let revision=1;revision<=current.revision;revision++){
  const v=await read(reader,db.collection('worktimeDeclarationVersions').doc(id+'_'+revision));validateVersion(v,id,empId,month);
  if(v.revision!==revision||Buffer.byteLength(JSON.stringify(v))>MAX_BYTES)fail(409,'工時聲明版本序號或容量無效');
  const previous=versions.at(-1);
  if(previous&&(evidenceHash(v.history.slice(0,-1))!==evidenceHash(previous.history)||v.status!=='proposed'&&(evidenceHash(v.declaration)!==evidenceHash(previous.declaration)||v.proposedBy!==previous.proposedBy||v.proposedAt!==previous.proposedAt)))fail(409,'工時聲明不可變版本鏈不一致');
  versions.push(v);
 }
 if(evidenceHash(current)!==evidenceHash(versions.at(-1)))fail(409,'工時聲明目前紀錄與不可變歷程不符');return versions;
}
function declarationIssues(v:WorktimeDeclarationVersion|null):string[]{
 if(!v||v.status!=='approved')return ['declaration-not-independently-approved'];
 const d=v.declaration,issues=['classified-source-history-not-assessed'];
 if(d.headcount===null)issues.push('headcount-unknown');if(d.unionExists===null)issues.push('union-status-unknown');if(d.regime==='unknown')issues.push('regime-unknown');else if(d.regime!=='standard-8-40')issues.push('regime-not-supported');
 if(d.weekStartsOn!==0)issues.push('week-start-unverified');if(d.overtimeMode==='unknown')issues.push('overtime-mode-unknown');if(d.rotation==='unknown')issues.push('rotation-unknown');if(d.exception!=='none')issues.push('exception-unresolved');
 const needed=['regime','collective-overtime','individual-overtime','rotation-applicability'];
 if(d.overtimeMode==='54-138'){needed.push('54-cycle');if(!d.cycle)issues.push('agreed-cycle-missing');if(d.headcount===null||d.headcount>=30)needed.push('filing-54');}
 if(d.rotation==='rotating'&&d.rotationRest==='8-hour'){needed.push('rotation-8');if(d.headcount===null||d.headcount>=30)needed.push('filing-rotation-8');}
 for(const purpose of needed)if(!d.authorities.some(a=>a.purpose===purpose))issues.push('authority-missing:'+purpose);
 for(const a of d.authorities)if(Date.parse(a.authorityOccurredAt)>Date.parse(a.effectiveFrom+'T00:00:00+08:00'))issues.push('authority-effective-chronology-unresolved:'+a.purpose);
 const w=d.workRules;
 if(w.status!=='recorded'||w.basis==='unresolved')issues.push('work-rules-evidence-unknown');
 if(w.status==='recorded'){
  if(w.documentState!=='effective')issues.push('work-rules-not-effective');
  const monthStart=v.month+'-01',next=new Date(monthStart+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const monthEnd=new Date(next.getTime()-86400000).toISOString().slice(0,10);
  if(!w.effectiveFrom||!w.effectiveTo||w.effectiveFrom>monthStart||w.effectiveTo<monthEnd)issues.push('work-rules-effective-scope-unresolved');
  if(w.authorityOccurredAt&&w.effectiveFrom&&Date.parse(w.authorityOccurredAt)>Date.parse(w.effectiveFrom+'T00:00:00+08:00'))issues.push('work-rules-effective-chronology-unresolved');
  if(d.headcount===null)issues.push('work-rules-headcount-unknown');
  if(w.basis==='below-30-recorded-terms'&&d.headcount!==null&&d.headcount>=30)issues.push('work-rules-basis-headcount-conflict');
 }
 return issues;
}
/** Trusted read-only boundary. No fallback to an older approved version while a
 * replacement is pending. The consumer must separately bind verified actual
 * work history and assess legal prerequisites; this is never a ready policy. */
export async function loadWorktimeDeclarationEvidence(db:any,reader:{get:(ref:any)=>Promise<any>},empId:string,month:string){
 if(!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工月份無效');
 const id=worktimeDeclarationId(empId,month),current=await read(reader,db.collection('worktimeDeclarations').doc(id),true);
 await history(db,reader,current,id,empId,month);
 return {current:current as WorktimeDeclarationVersion|null,approved:current?.status==='approved'?current as WorktimeDeclarationVersion:null,source:current?{id,revision:current.revision,evidenceVersion:evidenceHash(current)}:null,issues:declarationIssues(current),...flags};
}
export async function handleWorktimeDeclarationAction(db:any,uid:string,action:string,data:any){
 if(!WORKTIME_DECLARATION_ACTIONS.includes(action as any))fail(400,'工時聲明操作無效');
 const getting=action==='get-worktime-declaration',proposing=action==='propose-worktime-declaration';
 assertPayrollItemFields(data,getting?['empId','month']:['empId','month','expectedRevision','operationId','reason',...(proposing?['declaration']:['mode'])]);
 const {empId,month}=data;if(!payrollItemIdentity(uid)||!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工月份無效');
 const id=worktimeDeclarationId(empId,month),col=(name:string)=>db.collection(name);
 const authorize=async(reader:any,writing:boolean)=>{const actor=await read(reader,col('employees').doc(uid));if(writing?(actor.role!==UserRole.SuperAdmin||uid===empId):(uid!==empId&&actor.role!==UserRole.SuperAdmin))fail(403,'無工時聲明存取權限');const subject=await read(reader,col('employees').doc(empId));if(subject.accountKind==='system-account')fail(409,'純系統帳號不適用工時聲明');return actor.role===UserRole.SuperAdmin&&uid!==empId;};
 if(getting)return db.runTransaction(async (reader:any)=>{
  const canManage=await authorize(reader,false),current=await read(reader,col('worktimeDeclarations').doc(id),true),versions=await history(db,reader,current,id,empId,month),visible=canManage||current?.status==='approved'?current:null;
  return {empId,month,current:visible,versions:canManage?versions:versions.filter(v=>v.status==='approved'),canManage,source:visible?{id,revision:visible.revision,evidenceVersion:evidenceHash(visible)}:null,issues:visible?declarationIssues(visible):[],...flags};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'需操作識別及非負整數版本');
 const reason=payrollItemReason(data.reason),declaration=proposing?validateWorktimeDeclaration(data.declaration):null;
 if(!proposing&&!['approve','return'].includes(data.mode))fail(400,'覆核方式無效');
 const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 if(declaration&&(declaration.authorities.some(a=>Date.parse(a.authorityOccurredAt)>Date.parse(at))||declaration.workRules.authorityOccurredAt&&Date.parse(declaration.workRules.authorityOccurredAt)>Date.parse(at)))fail(400,'實際權限事件不能記為未來已發生');
 return runPayrollMutation(db,[],async tx=>{
  await authorize(tx,true);
  const receiptRef=col('worktimeDeclarationCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true),current=await read(tx,col('worktimeDeclarations').doc(id),true);
  if(receipt){
   if(receipt.hash!==hash||receipt.actor!==uid)fail(409,'重送內容或操作者不符');const result=receipt.result;await history(db,tx,result,id,empId,month);await history(db,tx,current,id,empId,month);
   const last=result?.history?.at(-1),expected=proposing?'proposed':data.mode==='approve'?'approved':'returned';
   if(!current||!result||current.revision<result.revision||evidenceHash(current.history.slice(0,result.revision))!==evidenceHash(result.history)||result.revision!==data.expectedRevision+1||result.status!==expected||last.actor!==uid||last.operationId!==data.operationId||last.reason!==reason||last.at!==receipt.at||proposing&&evidenceHash(result.declaration)!==evidenceHash(declaration))fail(409,'重送結果不在目前不可變歷程內');return result;
  }
  await assertTransactionMonths(db,tx,[month]);await history(db,tx,current,id,empId,month);
  if((current?.revision||0)!==data.expectedRevision)fail(409,'工時聲明版本已變更');const revision=(current?.revision||0)+1;if(revision>MAX_REVISIONS)fail(409,'工時聲明歷程已達技術容量');
  let next:any;
  if(proposing){if(current?.status==='proposed')fail(409,'待覆核聲明不可覆寫，需先退回');next={schemaVersion:'worktime-declaration-v1',id,empId,month,revision,status:'proposed',declaration,proposedBy:uid,proposedAt:at,...flags};}
  else{if(!current||current.status!=='proposed')fail(409,'只有待覆核聲明可處理');if(current.history.some((h:History)=>h.to==='proposed'&&h.actor===uid))fail(403,'不得覆核本人提出或曾編輯的聲明');const approved=data.mode==='approve';next={...current,revision,status:approved?'approved':'returned',reviewedBy:uid,reviewedAt:at,...(approved?{recordApprovedBy:uid,recordApprovedAt:at}:{})};}
  next.history=[...(current?.history||[]),{actor:uid,at,to:next.status,revision,reason,operationId:data.operationId}];validateVersion(next,id,empId,month);
  if(Buffer.byteLength(JSON.stringify(next))>MAX_BYTES)fail(409,'工時聲明證據容量過大');
  tx.create(col('worktimeDeclarationVersions').doc(id+'_'+revision),next);tx.set(col('worktimeDeclarations').doc(id),next);tx.create(receiptRef,{actor:uid,at,hash,result:next});return next;
 });
}
