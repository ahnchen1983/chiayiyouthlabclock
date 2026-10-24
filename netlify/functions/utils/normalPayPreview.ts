import {overtimePreview} from './overtimePreview';
import {calculateNormalPay,type NormalPayInterval} from '../../../utils/payroll/normalPay';
import {confirmedWork,clockInterval,clockSourceKey,validDate,taipeiDate} from '../../../utils/attendance';
import {LeaveStatus,isOutingLeaveType} from '../../../types';
import {evidenceHash} from './attendanceCaseLifecycle';
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const approval=(actor:unknown,at:unknown)=>text(actor)&&text(at)&&Number.isFinite(Date.parse(at));
const instant=(value:unknown)=>typeof value==='string'&&validDate(value.slice(0,10))?Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(value)?value:value+'+08:00')/60000:NaN;
const sourceId=(source:any)=>text(source.id)?source.id:'未識別來源';
// Keep the outer policy's employee/date scope. A mapping in a policy used on an
// earlier day cannot authorise a later card merely because both are in a month.
const assignmentScope=(day:any,employeeId:string,start:number,end:number)=>{
 const scope=day.normalPayPolicySource;
 return scope&&scope.id===day.policyId&&scope.status==='approved'&&text(scope.version)&&approval(scope.approvedBy,scope.approvedAt)
  &&Array.isArray(scope.employeeIds)&&scope.employeeIds.includes(employeeId)&&validDate(scope.from)&&validDate(scope.to)
  &&scope.from<=day.date&&scope.to>=day.date
  &&scope.from<=taipeiDate(new Date(start*60000))&&scope.to>=taipeiDate(new Date((end-1)*60000));
};
export function normalPayPreview(emp:any,month:string,cards:any[],leaves:any[],validLeave:(l:any)=>boolean,validationIssues:string[]=[]){
 const issues:string[]=[...validationIssues,...(emp.masterAssessment?.issues||[]).filter((s:string)=>s!=='多段雇用／留停／調薪或部分月折算待C2')],intervals:NormalPayInterval[]=[...(emp.normalPayCompEvidence?.intervals||[])];
 if((emp.normalPayDays||[]).some((d:any)=>d.policy?.rounding?.stage&&d.policy.rounding.stage!=='final'))issues.push('公司已確認最後合計才進位；逐項進位政策不可作為本次試算依據');
 // Confirmed company input process: exit date AND exit-month salary are manual.
 // A trial proration is not an approved override. LSA Arts.22/23 and Enforcement
 // Rules Arts.9/14-1 retain full-payment/itemisation/termination settlement duties.
 // https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=9
 // Manual-input review/line-item reconciliation is not implemented in C2a.
 const days=[...(emp.normalPayDays||[])].sort((a:any,b:any)=>a.date.localeCompare(b.date));
 const authority=emp.employmentAuthority;
 const timelineExit=authority?.kind==='effective-master'&&(authority.periods||[]).some((p:any)=>p.employmentState==='not-employed'&&(authority.periods||[]).some((before:any)=>['active','loa'].includes(before.employmentState)&&String(before.to).startsWith(month)&&Date.parse(p.from+'T00:00:00Z')-Date.parse(before.to+'T00:00:00Z')===86400000));
 if((!authority&&!emp.effectiveMasterVersion&&String(emp.resignDate||'').startsWith(month))||timelineExit||days.some((d:any,i:number)=>i>0&&d.employmentState==='not-employed'&&['active','loa'].includes(days[i-1].employmentState)))issues.push('離職當月日期與薪資須人工輸入並覆核；核定來源／逐項差額流程尚未完成，折算僅供候選比較');
 if(!emp.normalPayCompEvidence)issues.push('補休使用來源未載入');else issues.push(...emp.normalPayCompEvidence.issues);
 const first=Date.parse(month+'-01T00:00:00+08:00')/60000,last=first+new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate()*1440;
 for(const c of cards.filter(c=>c.empId===emp.id)){
  if(typeof c.date!=='string'||!validDate(c.date)){issues.push('打卡日期來源無效，無法判斷月份 '+sourceId(c));continue;}
  const base=Date.parse(c.date+'T00:00:00+08:00')/60000,span=clockInterval(c),work=confirmedWork(c);
  const relevant=c.date.startsWith(month)||!span&&base===first-1440||span&&base+span.start<last&&base+span.end>first;if(!relevant)continue;
  if(work===null||!approval(c.workReview?.reviewedBy,c.workReview?.reviewedAt)){issues.push('實際工作／休息來源未核定，覆核人員／時間或工作區間無效 '+sourceId(c));continue;}
  for(const w of work){const interval:NormalPayInterval={start:base+w.start,end:base+w.end,kind:'work',sourceId:c.id,sourceVersion:clockSourceKey(c),approvalId:c.workReview.reviewedBy+'@'+c.workReview.reviewedAt};
   // Only policy documents loaded by the trusted effective-master adapter can
   // supply identities. Raw/client card.workday fields never authorise grouping.
   const assignments=new Map<string,any>();for(const d of emp.normalPayDays||[]){const p=d.policy;if(p?.status!=='approved'||!text(p.version)||!approval(p.approvedBy,p.approvedAt))continue;if(p.workdayAssignments!==undefined&&!Array.isArray(p.workdayAssignments)){issues.push('工日分配政策格式未核定');continue;}for(const a of p.workdayAssignments||[]){if(!a||typeof a.sourceId!=='string'){issues.push('工日分配政策來源無效');continue;}if(a.sourceId===c.id){if(!assignmentScope(d,emp.id,interval.start,interval.end)){issues.push('工日分配政策不適用目前工作日期／員工或缺少可信來源 '+sourceId(c));continue;}const proof={...a,version:p.version,reviewedBy:p.approvedBy,reviewedAt:p.approvedAt};assignments.set(evidenceHash(proof),proof);}}}
   const exact=[...assignments.values()].filter(a=>a.start===interval.start&&a.end===interval.end&&a.sourceVersion===evidenceHash([interval.sourceVersion,work,interval.approvalId])&&a.workApprovalId===interval.approvalId);
   if(exact.length===1){const a=exact[0];interval.workday={id:a.workdayId,date:a.workdayDate,version:a.version,reviewedBy:a.reviewedBy,reviewedAt:a.reviewedAt};}
   else if(assignments.size)issues.push('工日分配與目前已核工作來源不一致或多重核定 '+c.id);
   intervals.push(interval);
  }
 }
 for(const l of leaves.filter(l=>l.empId===emp.id)){
  if(['駁回','已取消','已取代'].includes(l.status))continue;
  const start=instant(l.startDate),end=instant(l.endDate);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){issues.push('假單日期／期間來源無效，無法排除本月 '+sourceId(l));continue;}
  if(!(start<last&&end>first))continue;
  if(l.status!==LeaveStatus.Approved||!validLeave(l)||!approval(l.approver,l.approvalDate)||!approval(l.payrollReviewedBy,l.payrollReviewedAt)){issues.push('假單尚未核准並有效分配 '+l.id);continue;}
  if(isOutingLeaveType(l.leaveType)){issues.push('外勤正常工時來源待專用核定 '+l.id);continue;}
  for(const a of l.payrollAllocations)intervals.push({start:instant(a.date+'T'+a.from),end:instant(a.date+'T'+a.to),kind:'leave',leaveType:l.leaveType,sourceId:l.id,sourceVersion:evidenceHash(l),approvalId:l.approver+'@'+l.approvalDate+'/'+l.payrollReviewedBy+'@'+l.payrollReviewedAt});
 }
 if((emp.normalPayDays||[]).some((d:any)=>d.payBasis==='hourly'&&d.employmentState==='active')&&!intervals.some(i=>i.start<last&&i.end>first))issues.push('本月沒有已核工作／給薪來源，不能視為已核零工時');
 const result=calculateNormalPay(emp.id,month,emp.normalPayDays||[],intervals,issues);
 result.overtimePreview=overtimePreview(emp.normalPayDays||[],intervals);
 return result;
}
