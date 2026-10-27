import {loadPayrollItemExecutionEvidence} from './payrollItemExecution';
import type {WithholdingResult} from '../../../utils/payroll/withholding';
import {loadPayrollItemTreatmentEvidence} from './payrollItemTreatment';
import {assessAttendanceMonth,type AttendanceMonthEvidence} from './attendanceMonthEvidence';
import {loadAttendanceScanCertificate} from './attendanceScanStorage';
import {createHash} from 'node:crypto';
import type {ClockRecord,LeaveRequest,MonthLock,PayrollRun,SalaryDetail,ScheduleEvent} from '../../../types';
import {validDate} from '../../../utils/attendance';
import {employmentWindowStates} from '../../../utils/employmentAuthority';
import type {PayrollComparisonSource,PayrollComparisonSourceRef} from '../../../utils/payroll/comparison';
import type {PayrollItemAssessment,PayrollItemInventoryVersion} from '../../../utils/payroll/items';
import {normalizeScheduleDoc} from './calculations';
import {loadMonthlyPayrollEmployees} from './payrollReviewStorage';
import {payrollReviewFields} from './payrollReviewValidation';
import {evaluatePayrollMonth,type PendingSources,type RequestKind} from './payrollPreflight';
import {loadAttendanceCaseEvidence,loadAttendanceCaseInput,type AttendanceCaseEvidence} from './attendanceCaseEvidence';
import {foldCompLedger} from './compLedger';
import {evidenceHash} from './attendanceCaseLifecycle';
import {sanitizePayrollSnapshot} from './payrollSnapshot';
import {loadPayrollItemInventoryEvidence} from './payrollItems';
import {projectPayrollComparisonSource} from './payrollComparisonSource';

export interface PayrollSourceReader {get(ref:any):Promise<any>}
export type PayrollSnapshotInputs=PayrollRun['inputs'];
type ItemEvidence={version:PayrollItemInventoryVersion|null;source:{id:string;revision:number;evidenceVersion:string}|null;assessment:PayrollItemAssessment};
export interface PayrollSourceEvidence {
 schemaVersion:'payroll-source-evidence-v1';
 month:string;
 sourceHash:string;
 requests:PendingSources;
 revisions:any[];
 cases:any[];
 caseEvidence:Record<string,AttendanceCaseEvidence>;
 attendanceMonthEvidence?:Record<string,AttendanceMonthEvidence>;
 itemInventories:Record<string,ItemEvidence>;
 paymentAllocations?:Record<string,{result:WithholdingResult;evidence:unknown}>;
 itemExecutions?:Record<string,Awaited<ReturnType<typeof loadPayrollItemExecutionEvidence>>>;
 itemTreatments?:Record<string,Awaited<ReturnType<typeof loadPayrollItemTreatmentEvidence>>>;
 // Actual documents and template absence/fallback remain distinguishable.
 dailyInventory:any[];
 scheduleTemplates:any[];
 compLedger:any[];
 // Full read inventory remains hash-bound without archiving unrelated raw rows.
 rawAttendanceDigests?:{records:string;leaves:string};
}
export type PayrollMonthSource=
 | {kind:'live';evaluation:ReturnType<typeof evaluatePayrollMonth>;sourceHash:string;comparisons:Record<string,PayrollComparisonSource>;snapshotInputs:PayrollSnapshotInputs;sourceEvidence:PayrollSourceEvidence}
 | {kind:'locked';run:PayrollRun;lock:MonthLock;salaries:SalaryDetail[];originalInputHash:string;sourceHash:string|null;completeness:'legacy-inputs-only'|'complete'}
 | {kind:'legacy-locked';lock:MonthLock;issues:string[]};
const fail=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:409});};
const identifier=(v:any):v is string=>typeof v==='string'&&!!v&&v.length<=150&&!v.includes('/');
const pendingCollections:RequestKind[]=['terminationSettlementDrafts','terminationAdjustmentCases','compRequests','compSettlementTasks','overtimeRequests','anomalyExplanations','leaveRequests','makeupRequests','leaveOfAbsenceRequests','shiftSwapRequests'];
const rows=async(db:any,reader:PayrollSourceReader,name:string):Promise<any[]>=>{
 // A bound is a completeness guard, never permission to return a partial set.
 const snap=await reader.get(db.collection(name).limit(10001));
 if(snap.size>10000)fail('計薪來源清冊超出完整讀取容量：'+name);
 return snap.docs.map((d:any)=>({...d.data(),id:d.id})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
};
const calculationEmployee=(e:any)=>({
 masterAssessment:e.masterAssessment||null,payBasis:e.payBasis||null,employmentType:e.employmentType||null,effectiveMasterVersion:e.effectiveMasterVersion||null,
 id:e.id,accountKind:e.accountKind||null,name:e.name,role:e.role??null,position:e.position,status:e.status,
 hourlyRate:e.hourlyRate??null,monthlySalary:e.monthlySalary??null,hireDate:e.hireDate||'',resignDate:e.resignDate||'',leaveOfAbsenceStart:e.leaveOfAbsenceStart||'',leaveOfAbsenceEnd:e.leaveOfAbsenceEnd||'',payrollReview:payrollReviewFields(e.payrollReview),
 ...Object.fromEntries(['normalPayDays','normalPayContextDays','normalPayCompEvidence','insurancePeriods','insuranceSource','employmentAuthority'].filter(key=>e[key]!==undefined).map(key=>[key,e[key]])),
});
const pickEvidence=(row:any,keys:string[])=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
const clockEvidence=(row:any)=>pickEvidence(row,['id','empId','date','clockInTime','clockOutTime','clockInAt','clockOutAt','workHours','status','workIntervals','workReview','attendanceRevisionId','rawMinutes','payableMinutes','calculationVersion','reviewReasons','source','manuallyEdited','editedBy','editedAt','note','notes']);
const leaveEvidence=(row:any)=>pickEvidence(row,['id','empId','leaveType','startDate','endDate','hours','status','payrollAllocations','requestDate','approver','approvalDate','revision','schemaVersion','supersedesId','supersededBy','caseId','explanationId','requestedSpanMinutes','policyStatus','reviewIssues','applicationEvidence','leavePolicyAssessment']);
function snapshotAttendance(month:string,employees:any[],records:ClockRecord[],leaves:LeaveRequest[]){
 const included=new Set(employees.map(e=>e.id));
 // Full week-boundary context (C2b), including malformed dates which cannot be
 // proved unrelated. Calculation itself still receives the complete inventory.
 const first=new Date(month+'-01T00:00:00Z'),next=new Date(first);next.setUTCMonth(next.getUTCMonth()+1);
 first.setUTCDate(first.getUTCDate()-6);next.setUTCDate(next.getUTCDate()+5);
 const from=first.toISOString().slice(0,10),to=next.toISOString().slice(0,10);
 const scopedRecords=records.filter(r=>included.has(r.empId)&&(!validDate(r.date)||r.date>=from&&r.date<=to));
 const scopedLeaves=leaves.filter(l=>{
  if(!included.has(l.empId))return false;
  const start=typeof l.startDate==='string'?l.startDate.slice(0,10):'',end=typeof l.endDate==='string'?l.endDate.slice(0,10):'';
  return !validDate(start)||!validDate(end)||start>end||start<=to&&end>=from||Array.isArray(l.payrollAllocations)&&l.payrollAllocations.some(a=>!validDate(a?.date)||a.date>=from&&a.date<=to);
 });
 return {records:scopedRecords.map(clockEvidence) as ClockRecord[],leaves:scopedLeaves.map(leaveEvidence) as LeaveRequest[]};
}
const employeeInMonth=(e:any,month:string)=>{
 if(e.employmentAuthority){const start=Date.parse(month+'-01T00:00:00+08:00')/60000,next=new Date(month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const end=Date.parse(next.toISOString().slice(0,10)+'T00:00:00+08:00')/60000;return e.accountKind!=='system-account'&&!employmentWindowStates(e,start,end).every(s=>s==='not-employed');}
 return e.effectiveMasterVersion?e.accountKind!=='system-account'&&e.masterAssessment?.eligible!==false:e.accountKind!=='system-account'&&!(e.payrollReview?.yearMonth===month&&e.payrollReview?.participation==='system-account'&&e.payrollReview?.participationReason?.trim()&&e.payrollReview?.reviewedBy&&e.payrollReview?.reviewedAt)&&(!e.hireDate||e.hireDate.slice(0,7)<=month)&&(!e.resignDate||e.resignDate.slice(0,7)>=month);
};
function monthlySchedules(month:string,daily:any[],templates:any[]):ScheduleEvent[]{
 const byDate=new Map(daily.map(d=>[d.id,d])),byWeekday=new Map(templates.map(d=>[Number(d.id),d]));
 const current=new Date(month+'-01T00:00:00Z'),result:ScheduleEvent[]=[];
 while(current.toISOString().slice(0,7)===month){
  const date=current.toISOString().slice(0,10),weekday=current.getUTCDay(),label=['日','一','二','三','四','五','六'][weekday],actual=byDate.get(date);
  if(actual)result.push(normalizeScheduleDoc(actual,date,label));
  else{const t=byWeekday.get(weekday)||{};result.push({date,dayOfWeek:label,status:t.status||'休館',...(t.openingHours||t.shiftTime?{openingHours:t.openingHours||t.shiftTime}:{}),...(t.requiredHeadcount!==undefined?{requiredHeadcount:t.requiredHeadcount}:{}),shifts:[]});}
  current.setUTCDate(current.getUTCDate()+1);
 }
 return result;
}
const sourceDigest=(snapshotInputs:PayrollSnapshotInputs,evidence:Omit<PayrollSourceEvidence,'sourceHash'>)=>evidenceHash({snapshotInputs,sourceEvidence:evidence});
function completeEnvelope(value:any,month:string):value is PayrollSourceEvidence {
 return value?.schemaVersion==='payroll-source-evidence-v1'&&value.month===month&&typeof value.sourceHash==='string'&&!!value.sourceHash&&
  value.requests&&pendingCollections.every(name=>Array.isArray(value.requests[name]))&&Array.isArray(value.revisions)&&Array.isArray(value.cases)&&
  !!value.caseEvidence&&typeof value.caseEvidence==='object'&&!Array.isArray(value.caseEvidence)&&!!value.itemInventories&&typeof value.itemInventories==='object'&&!Array.isArray(value.itemInventories)&&
  Array.isArray(value.dailyInventory)&&Array.isArray(value.scheduleTemplates)&&Array.isArray(value.compLedger);
}
async function lockedSource(db:any,reader:PayrollSourceReader,month:string,lock:MonthLock):Promise<PayrollMonthSource>{
 const blocked=(message:string):PayrollMonthSource=>({kind:'legacy-locked',lock,issues:[message]});
 if(lock.yearMonth!==month||!identifier(lock.payrollRunId))return blocked('已鎖月份缺少可核對的原始薪資快照參照');
 const snap=await reader.get(db.collection('payrollRuns').doc(lock.payrollRunId));
 if(!snap.exists)return blocked('已鎖月份原始薪資快照不存在，不得以現行資料重建');
 const run=snap.data() as PayrollRun;
 try{
  if(run.id!==lock.payrollRunId||run.yearMonth!==month||typeof run.calculationVersion!=='string'||!run.calculationVersion||!Array.isArray(run.salaries)||!run.salaries.length||!run.inputs||!['employees','schedules','records','leaves'].every(key=>Array.isArray((run.inputs as any)[key])))return blocked('原始薪資快照識別或範圍無效');
  const employees=(run.inputs.employees as any[]).map(e=>e?.id),ids=run.salaries.map(s=>s.empId);
  if(employees.some(id=>!identifier(id))||new Set(employees).size!==employees.length||new Set(ids).size!==ids.length||ids.length!==employees.length||run.salaries.some(s=>!identifier(s.empId)||!employees.includes(s.empId)||s.yearMonth!==month||s.calculationStatus!=='locked'||typeof s.netSalary!=='number'||!Number.isFinite(s.netSalary)))return blocked('原始薪資快照員工或月份範圍無效');
  const inputs=sanitizePayrollSnapshot(run.inputs),originalHash=createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
  if(run.inputHash!==originalHash)return blocked('原始薪資快照輸入雜湊不一致');
  const envelope=(run as any).sourceEvidence;
  let sourceHash:string|null=null,completeness:'legacy-inputs-only'|'complete'='legacy-inputs-only';
  if(envelope!==undefined){
   if(!completeEnvelope(envelope,month))return blocked('完整計薪來源封存格式無效');
   const {sourceHash:recorded,...content}=sanitizePayrollSnapshot(envelope);
   if(recorded!==sourceDigest(inputs,content))return blocked('完整計薪來源封存雜湊不一致');
   if(ids.some(id=>!envelope.caseEvidence[id]||!envelope.itemInventories[id]))return blocked('完整計薪來源封存員工證據缺漏');
   sourceHash=recorded;completeness='complete';
  }
  return {kind:'locked',run,lock,salaries:run.salaries,originalInputHash:run.inputHash,sourceHash,completeness};
 }catch{return blocked('原始薪資快照包含無效來源格式，不能重建為已核定薪資');}
}

/** Internal server reader. Authorization belongs to the calling API. Raw source
 * evidence is for private verification/snapshots, never a public response. Every
 * read, including nested authority loaders, uses the explicitly supplied reader.
 * The caller supplies a consistent transaction; this function never opens one or
 * writes. Evaluation time is not part of the source digest, but resulting case
 * observations are, so unchanged reads do not invalidate independent reviews. */
export async function loadPayrollMonthSource(db:any,reader:PayrollSourceReader,input:{month:string;at:string},resolvedPayments?:Record<string,{result:WithholdingResult;evidence:unknown}>):Promise<PayrollMonthSource>{
 if(!reader||typeof reader.get!=='function'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input?.month)||!validDate(input.month+'-01')||typeof input.at!=='string'||!Number.isFinite(Date.parse(input.at)))fail('需有效月份、核對時間及明示唯讀來源');
 const {month,at}=input;
 const lockSnap=await reader.get(db.collection('monthLocks').doc(month));
 const lock=lockSnap.exists?lockSnap.data() as MonthLock:null;
 if(lockSnap.exists&&(!lock||typeof lock!=='object'||Array.isArray(lock)||lock.yearMonth!==month))fail('月鎖來源格式或月份無效，不得當成未鎖月份');
 if(lock){
  if(lock.unlockedAt===undefined)return lockedSource(db,reader,month,lock);
  // Truthiness is not unlock authority. Validate the historical lock and explicit
  // reopening metadata before any current employee/source collection is read.
  const timestamp=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&validDate(v.slice(0,10))&&Number.isFinite(Date.parse(v));
  const actor=(v:unknown):v is string=>identifier(v)&&v.trim()===v&&v.trim().length>0&&!/[\u0000-\u001f\u007f]/.test(v);
  if(!timestamp(lock.unlockedAt)||!timestamp(lock.lockedAt)||Date.parse(lock.unlockedAt)<Date.parse(lock.lockedAt)||!actor(lock.lockedBy)||!actor(lock.unlockedBy)||typeof lock.unlockReason!=='string'||!lock.unlockReason.trim())fail('月鎖解鎖證據無效，不得讀取現行計薪來源');
 }
 const rawEmployees=await rows(db,reader,'employees');
 const records=await rows(db,reader,'clockRecords') as ClockRecord[];
 const leaves=await rows(db,reader,'leaveRequests') as LeaveRequest[];
 const dailyInventory=await rows(db,reader,'dailySchedule'),scheduleTemplates=await rows(db,reader,'scheduleTemplate');
 if(records.some(r=>!identifier(r.empId))||leaves.some(l=>!identifier(l.empId))||dailyInventory.some(d=>!validDate(d.id)))fail('計薪來源員工或班表日期歸屬未知，不能排除為不相關資料');
 const reviewed=await loadMonthlyPayrollEmployees(rawEmployees,month,db,reader);
 const employees=reviewed.map(calculationEmployee).filter(e=>employeeInMonth(e,month));
 const schedules=monthlySchedules(month,dailyInventory,scheduleTemplates);
 const requests={} as PendingSources;
 for(const name of pendingCollections)requests[name]=name==='leaveRequests'?leaves:await rows(db,reader,name);
 const compLedger=await rows(db,reader,'compLedger'),groups=new Map<string,any[]>();
 for(const row of compLedger){if(!identifier(row.empId))fail('補休帳本員工歸屬未知');groups.set(row.empId,[...(groups.get(row.empId)||[]),row]);}
 for(const [empId,entries] of groups)try{foldCompLedger(entries);}catch{requests.compRequests.push({id:'ledger-unverified:'+empId,empId,status:'unverified'});}
 const revisions=await rows(db,reader,'attendanceRevisions'),cases=await rows(db,reader,'attendanceCases');
 const attendanceMonthEvidence:Record<string,AttendanceMonthEvidence>={};
 const itemExecutions:NonNullable<PayrollSourceEvidence['itemExecutions']>={};
 const itemTreatments:NonNullable<PayrollSourceEvidence['itemTreatments']>={};
 const caseEvidence:Record<string,AttendanceCaseEvidence>={},itemInventories:Record<string,ItemEvidence>={};
 for(const employee of employees){
  caseEvidence[employee.id]=await loadAttendanceCaseEvidence(db,reader,{empId:employee.id,month,cases,at});
  itemInventories[employee.id]=await loadPayrollItemInventoryEvidence(db,reader,employee.id,month);
  if(itemInventories[employee.id].version?.inventory.mode==='items'){
   itemTreatments[employee.id]=await loadPayrollItemTreatmentEvidence(db,reader,employee.id,month);
   itemExecutions[employee.id]=await loadPayrollItemExecutionEvidence(db,reader,employee.id,month);
   (employee as any).payrollItemExecution=itemExecutions[employee.id];
  }
  const detectorInput=await loadAttendanceCaseInput(db,reader,employee.id,month,at);
  // Keep the exact bounded record inventory used to build the classification
  // proof and scan certificate. Replacing it with unrelated historical cards
  // invalidates that proof's digest. Global card attribution was checked above;
  // malformed employee cards remain in the loader's conservative scope filter.
  detectorInput.leaves=leaves;
  detectorInput.swaps=requests.shiftSwapRequests as any;
  const loadedScan=await loadAttendanceScanCertificate(db,reader,{empId:employee.id,month});
  const monthProof=assessAttendanceMonth({empId:employee.id,month,input:detectorInput,cases,certificate:loadedScan.certificate,explanationDigest:detectorInput.explanationInventory?.sourceDigest});
  if(loadedScan.status==='unknown')monthProof.scan='unknown';
  attendanceMonthEvidence[employee.id]=monthProof;
 }
 const snapshotInputs=sanitizePayrollSnapshot({employees,schedules,...snapshotAttendance(month,employees,records,leaves)});
 const archivedRequests={...requests,leaveRequests:leaves.map(l=>({...leaveEvidence(l),id:l.id}))};
 const rawAttendanceDigests={records:evidenceHash(sanitizePayrollSnapshot(records)),leaves:evidenceHash(sanitizePayrollSnapshot(leaves))};
 const content=sanitizePayrollSnapshot({schemaVersion:'payroll-source-evidence-v1' as const,month,requests:archivedRequests,revisions,cases,caseEvidence,attendanceMonthEvidence,itemInventories,...(Object.keys(itemTreatments).length?{itemTreatments}:{}),...(Object.keys(itemExecutions).length?{itemExecutions}:{}),dailyInventory,scheduleTemplates,compLedger,rawAttendanceDigests,...(resolvedPayments&&Object.keys(resolvedPayments).length?{paymentAllocations:resolvedPayments}:{})});
 const sourceHash=sourceDigest(snapshotInputs,content),sourceEvidence={...content,sourceHash};
 const evaluation=evaluatePayrollMonth({month,employees,schedules,records,leaves,requests,revisions,cases,caseEvidence,attendanceMonthEvidence,...(resolvedPayments?{resolvedPaymentWithholding:Object.fromEntries(Object.entries(resolvedPayments).map(([id,value])=>[id,value.result]))}:{})});
 const comparisons:Record<string,PayrollComparisonSource>={};
 for(const salary of evaluation.salaries){
  const employee=employees.find(e=>e.id===salary.empId)!,insurance=(employee as any).insuranceSource,item=itemInventories[salary.empId];
  const sources:PayrollComparisonSourceRef[]=[{kind:'payroll-inputs',id:salary.empId,version:sourceHash}];
  if(insurance?.versionId&&insurance?.evidenceVersion)sources.push({kind:'insurance-timeline',id:insurance.versionId,version:insurance.evidenceVersion});
  if(item.source)sources.push({kind:'payroll-item-inventory',id:item.source.id,version:String(item.source.revision)});
  const execution=itemExecutions[salary.empId];if(execution?.approved&&execution.source)sources.push({kind:'payroll-item-execution',id:execution.source.id,version:execution.source.evidenceVersion});
  comparisons[salary.empId]=projectPayrollComparisonSource({salary,sources,inventory:item.version});
 }
 return {kind:'live',evaluation,sourceHash,comparisons,snapshotInputs,sourceEvidence};
}
