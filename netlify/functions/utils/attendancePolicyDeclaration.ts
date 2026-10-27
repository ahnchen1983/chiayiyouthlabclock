import {UserRole} from '../../../types';
import {attendanceCaseMonthWindow} from './attendanceWindow';
import {assessAttendancePolicyEvidence} from './attendancePolicyEvidence';
import {scheduleDayVersion} from './attendanceCaseDetector';
import {evidenceHash} from './attendanceCaseLifecycle';
import {normalizeScheduleDoc} from './calculations';
import {shiftIntervals} from '../../../utils/attendance';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';

export const ATTENDANCE_POLICY_ACTIONS=['get-attendance-policy-declaration','propose-attendance-policy-declaration','review-attendance-policy-declaration'] as const;
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const id=(v:any)=>typeof v==='string'&&!!v.trim()&&v.length<=150&&!v.includes('/');
const reason=(v:any)=>{if(typeof v!=='string'||v.trim().length<5||v.length>2000)fail(400,'請填完整核定依據（5–2000字）');return v.trim();};
const fields=(data:any,allowed:string[])=>{if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!allowed.includes(k)))fail(400,'不得提交未允許的政策或伺服器欄位');};
const read=async(reader:any,ref:any,optional=false)=>{const s=await reader.get(ref);if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
export const attendancePolicyDeclarationId=(empId:string,month:string)=>'apd_'+evidenceHash([empId,month]);
const numeric=['closeAfterMinutes','lateGraceMinutes','earlyGraceMinutes','workDifferenceTolerance'] as const;
const baseFields=['empId','month','expectedRevision','operationId','reason'];
function values(data:any){
 const out:any={};for(const k of numeric){if(!Number.isSafeInteger(data[k])||data[k]<0)fail(400,'結班與容許分鐘需明示非負整數');out[k]=data[k];}
 if(!data.expectedWorkByDate||typeof data.expectedWorkByDate!=='object'||Array.isArray(data.expectedWorkByDate)||Object.keys(data.expectedWorkByDate).length>62)fail(400,'需明示逐日淨應工作分鐘與班表版本');
 out.expectedWorkByDate={};for(const [date,target] of Object.entries(data.expectedWorkByDate) as [string,any][]){
  fields(target,['minutes','scheduleVersion']);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isSafeInteger(target.minutes)||target.minutes<0||!id(target.scheduleVersion))fail(400,'逐日工作基準格式無效');
  out.expectedWorkByDate[date]={minutes:target.minutes,scheduleVersion:target.scheduleVersion};
 }
 return out;
}
async function schedules(db:any,reader:any){
 const snap=await reader.get(db.collection('dailySchedule').limit(501));if(snap.size>500)fail(409,'班表證據超過技術容量');
 return snap.docs.map((d:any)=>normalizeScheduleDoc(d.data(),d.id,''));
}
function relevantDays(days:any[],empId:string,month:string){
 const w=attendanceCaseMonthWindow(month);return days.filter(d=>{const base=Date.parse(d.date+'T00:00:00+08:00')/60000;return (shiftIntervals(d.shifts.filter((s:any)=>s.empId===empId))||[]).some(s=>base+s.start<w.end&&base+s.end>w.start);});
}
function declaration(current:any){
 if(!current||current.status!=='approved')return null;
 return {schemaVersion:'attendance-policy-declaration-v1',version:current.id+'_'+current.revision,status:'approved',empId:current.empId,month:current.month,
  approvedBy:current.reviewedBy,approvedAt:current.reviewedAt,workDateRule:'clock-in-date',breaks:'explicit',...current.values,
  expectedWorkByDate:Object.fromEntries(Object.entries(current.values.expectedWorkByDate).map(([date,t]:[string,any])=>[date,{...t,reviewedBy:current.reviewedBy}]))};
}
async function history(db:any,reader:any,current:any,empId:string,month:string,key:string){
 if(!current)return;
 if(current.id!==key||current.empId!==empId||current.month!==month||!Number.isInteger(current.revision)||current.revision<1||current.revision>100)fail(409,'政策歷程範圍無效');
 let previous:any=null;
 for(let revision=1;revision<=current.revision;revision++){
  const snap=await reader.get(db.collection('attendancePolicyDeclarationVersions').doc(key+'_'+revision));if(!snap.exists)fail(409,'不可變政策版本缺漏');const v=snap.data();
  if(!v||v.schemaVersion!=='attendance-policy-record-v1'||v.id!==key||v.empId!==empId||v.month!==month||v.revision!==revision||!Array.isArray(v.history)||v.history.length!==revision||!['proposed','approved','returned'].includes(v.status))fail(409,'不可變政策版本無效');
  const ev=v.history.at(-1);if(ev.revision!==revision||ev.to!==v.status||!id(ev.actor)||ev.actor===empId||!Number.isFinite(Date.parse(ev.at||''))||reason(ev.reason)!==ev.reason)fail(409,'政策事件來源無效');
  if(evidenceHash(values(v.values))!==evidenceHash(v.values))fail(409,'政策內容無效');
  if(evidenceHash(v.history.slice(0,-1))!==evidenceHash(previous?.history||[]))fail(409,'政策事件鏈不一致');
  if(v.status==='proposed'){
   if(previous&&!['approved','returned'].includes(previous.status)||v.proposedBy!==ev.actor||v.proposedAt!==ev.at)fail(409,'政策提案轉換無效');
  }else{
   if(!previous||previous.status!=='proposed'||evidenceHash(v.values)!==evidenceHash(previous.values)||v.proposedBy!==previous.proposedBy||v.proposedAt!==previous.proposedAt||v.reviewedBy!==ev.actor||v.reviewedAt!==ev.at||v.history.some((h:any)=>h.to==='proposed'&&h.actor===ev.actor))fail(409,'政策雙人核定來源不符');
  }
  previous=v;
 }
 if(evidenceHash(current)!==evidenceHash(previous))fail(409,'政策目前紀錄與不可變歷程不符');
}
/** Trusted read boundary: no fallback to older approval while replacement pending. */
export async function loadAttendancePolicyDeclarationEvidence(db:any,reader:any,empId:string,month:string){
 if(!id(empId))fail(400,'員工識別無效');attendanceCaseMonthWindow(month);
 const key=attendancePolicyDeclarationId(empId,month),current=await read(reader,db.collection('attendancePolicyDeclarations').doc(key),true);
 await history(db,reader,current,empId,month,key);const days=await schedules(db,reader);
 return {current,source:current?{id:key,revision:current.revision,evidenceVersion:evidenceHash(current)}:null,
  assessment:assessAttendancePolicyEvidence({empId,month,declaration:declaration(current),schedules:days})};
}
export async function handleAttendancePolicyDeclarationAction(db:any,uid:string,action:string,data:any){
 if(!ATTENDANCE_POLICY_ACTIONS.includes(action as any))fail(400,'政策操作無效');
 const getting=action==='get-attendance-policy-declaration',proposing=action==='propose-attendance-policy-declaration';
 fields(data,getting?['empId','month']:proposing?[...baseFields,...numeric,'expectedWorkByDate']:[...baseFields,'mode']);
 if(!id(uid)||!id(data.empId))fail(400,'員工識別無效');attendanceCaseMonthWindow(data.month);
 const {empId,month}=data,key=attendancePolicyDeclarationId(empId,month),col=(name:string)=>db.collection(name);
 if(getting){
  const reader={get:(ref:any)=>ref.get()},actor=await read(reader,col('employees').doc(uid));if(uid!==empId&&actor.role!==UserRole.SuperAdmin)fail(403,'無政策檢視權限');
  const employee=await read(reader,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'純系統帳號不適用');
  const evidence=await loadAttendancePolicyDeclarationEvidence(db,reader,empId,month),days=await schedules(db,reader),manage=uid!==empId&&actor.role===UserRole.SuperAdmin;
  return {empId,month,...evidence,current:manage||evidence.current?.status==='approved'?evidence.current:null,canManage:manage,
   scheduleTargets:manage?relevantDays(days,empId,month).map((d:any)=>({date:d.date,scheduleVersion:scheduleDayVersion(d,empId)})):[]};
 }
 if(!id(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'操作識別及版本必填');
 const why=reason(data.reason),provided=proposing?values(data):null;if(!proposing&&!['approve','return'].includes(data.mode))fail(400,'核定方式無效');
 const hash=evidenceHash([action,data]),at=new Date().toISOString();
 return runPayrollMutation(db,[],async tx=>{
  const actor=await read(tx,col('employees').doc(uid));if(actor.role!==UserRole.SuperAdmin||uid===empId)fail(403,'僅非本人最高管理者可提案與核定');
  const employee=await read(tx,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'純系統帳號不適用');
  const receiptRef=col('attendancePolicyDeclarationCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true);
  if(receipt){
   if(receipt.hash!==hash||receipt.actor!==uid)fail(409,'重送操作內容或操作者不同');
   const result=receipt.result,expectedStatus=proposing?'proposed':data.mode==='approve'?'approved':'returned';
   if(!result||result.id!==key||result.empId!==empId||result.month!==month||result.revision!==data.expectedRevision+1||result.status!==expectedStatus||result.history?.at(-1)?.actor!==uid||result.history?.at(-1)?.at!==receipt.at)fail(409,'重送操作結果來源不符');
   await history(db,tx,result,empId,month,key);
   const head=await read(tx,col('attendancePolicyDeclarations').doc(key));await history(db,tx,head,empId,month,key);
   if(head.revision<result.revision||evidenceHash(head.history.slice(0,result.revision))!==evidenceHash(result.history))fail(409,'重送操作不在目前不可變歷程內');
   if(proposing&&evidenceHash(result.values)!==evidenceHash(provided)||result.history.at(-1).reason!==why)fail(409,'重送操作內容與不可變結果不符');
   return result;
  }
  await assertTransactionMonths(db,tx,[month]);const current=await read(tx,col('attendancePolicyDeclarations').doc(key),true);
  await history(db,tx,current,empId,month,key);if((current?.revision||0)!==data.expectedRevision)fail(409,'政策版本已變更');
  const revision=(current?.revision||0)+1;if(revision>100)fail(409,'政策歷程已達技術容量');let next:any;
  if(proposing){
   if(current&&!['approved','returned'].includes(current.status))fail(409,'待核提案不得覆寫');
   next={schemaVersion:'attendance-policy-record-v1',id:key,empId,month,revision,status:'proposed',values:provided,proposedBy:uid,proposedAt:at};
  }else{
   if(!current||current.status!=='proposed')fail(409,'只有待核提案可處理');
   if(current.history.some((h:any)=>h.to==='proposed'&&h.actor===uid))fail(403,'不得核定本人提出或曾編輯的政策');
   next={...current,revision,status:data.mode==='approve'?'approved':'returned',reviewedBy:uid,reviewedAt:at};
  }
  if(proposing||data.mode==='approve'){
   const days=await schedules(db,tx),candidate=declaration({...next,status:'approved',reviewedBy:uid,reviewedAt:at});
   if(assessAttendancePolicyEvidence({empId,month,declaration:candidate,schedules:days}).status!=='verified')fail(409,'政策輸入缺漏或逐日基準與目前班表不符');
  }
  next.history=[...(current?.history||[]),{revision,actor:uid,at,to:next.status,reason:why}];
  if(Buffer.byteLength(JSON.stringify(next))>500000)fail(409,'政策證據容量過大');
  tx.create(col('attendancePolicyDeclarationVersions').doc(key+'_'+revision),next);tx.set(col('attendancePolicyDeclarations').doc(key),next);tx.create(receiptRef,{actor:uid,at,hash,result:next});return next;
 });
}
