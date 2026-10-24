import {LeaveStatus} from '../../../types';
import {validDate,taipeiDate} from '../../../utils/attendance';
import {evidenceHash} from './attendanceCaseLifecycle';
export interface LeavePolicyVersion {
 version:string;status:'draft'|'approved';approvedBy?:string;approvedAt?:string;
 effectiveFrom:string;effectiveTo:string;employeeIds:string[];leaveType:string;
 backdatedMaxDays?:number;
 quota?:{periodStart:string;periodEnd:string;minutes:number;basis:'requested-span-minutes';reservePending:true};
}
const fail=(s:string):never=>{throw Object.assign(new Error(s),{statusCode:409});};
export const leaveTimestamp=(v:any)=>typeof v==='string'?Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(v)?v:v+'+08:00'):NaN;
const active=(r:any)=>[LeaveStatus.Pending,LeaveStatus.NeedsInfo,LeaveStatus.Approved].includes(r.status);
export async function assessLeavePolicy(db:any,tx:any,r:any,excludeIds:string[]=[],at=new Date().toISOString()){
 const issues:string[]=[],first=taipeiDate(new Date(leaveTimestamp(r.startDate))),last=taipeiDate(new Date(leaveTimestamp(r.endDate)-1));
 const snap=await tx.get(db.collection('leavePolicyVersions').limit(101));if(snap.size>100)fail('假別政策容量超限，需覆核');
 const scoped=snap.docs.map((d:any)=>({...d.data(),id:d.id})).filter((p:any)=>p.leaveType===r.leaveType&&Array.isArray(p.employeeIds)&&p.employeeIds.includes(r.empId)&&validDate(p.effectiveFrom)&&validDate(p.effectiveTo));
 const confirmed=scoped.filter((p:any)=>p.status==='approved'&&p.version&&p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt)));
 const matches=scoped.filter((p:any)=>p.effectiveFrom<=first&&p.effectiveTo>=last);
 if(confirmed.length&&!confirmed.some((p:any)=>p.effectiveFrom<=first&&p.effectiveTo>=last))fail('申請不在已核假別政策有效期間，需另外覆核');
 const approved=matches.filter((p:any)=>p.status==='approved'&&p.version&&p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt)));
 if(approved.length>1)fail('假別有效期政策重疊，不能擅選');
 if(!approved.length)return {status:'needs-review',issues:['leave-type-effective-policy-unverified','backdated-deadline-unverified','quota-policy-unverified']};
 const p=approved[0];
 if(!Number.isInteger(p.backdatedMaxDays)||p.backdatedMaxDays<0)issues.push('backdated-deadline-unverified');
 else if(Date.parse(taipeiDate(new Date(at)))-Date.parse(first)>p.backdatedMaxDays*86400000)fail('超過已核補申請期限，需另外更正流程');
 const q=p.quota;let reservedMinutes:number|undefined;
 if(!q||!validDate(q.periodStart)||!validDate(q.periodEnd)||q.periodStart>first||q.periodEnd<last||!Number.isSafeInteger(q.minutes)||q.minutes<0||q.basis!=='requested-span-minutes'||q.reservePending!==true)issues.push('quota-policy-unverified');
 else {
  const requests=await tx.get(db.collection('leaveRequests').where('empId','==',r.empId).limit(501));if(requests.size>500)fail('假單來源容量超限');let used=0;
  for(const d of requests.docs){const old={...d.data(),id:d.id};if(excludeIds.includes(old.id)||old.leaveType!==r.leaveType||[LeaveStatus.Rejected,LeaveStatus.Cancelled,LeaveStatus.Superseded].includes(old.status))continue;
   const start=leaveTimestamp(old.startDate),end=leaveTimestamp(old.endDate);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('既有額度來源期間未知');
   const a=taipeiDate(new Date(start)),b=taipeiDate(new Date(end-1));if(b<q.periodStart||a>q.periodEnd)continue;if(!active(old))fail('既有額度來源狀態未知，需覆核');if(a<q.periodStart||b>q.periodEnd)fail('假單跨額度期間，需分期覆核');used+=(end-start)/60000;
  }
  reservedMinutes=(leaveTimestamp(r.endDate)-leaveTimestamp(r.startDate))/60000;if(!Number.isSafeInteger(reservedMinutes)||reservedMinutes<=0)fail('額度分鐘無效');if(used+reservedMinutes>q.minutes)fail('已核額度不足（含待審及待補件預占）');
 }
 return {status:issues.length?'needs-review':'confirmed-reservation-only',issues,policyVersion:p.version,policyEvidence:evidenceHash(p),...(reservedMinutes===undefined?{}:{reservedMinutes,reservationState:active(r)?'reserved':'not-active'})};
}
