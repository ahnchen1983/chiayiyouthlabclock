import {validDate,taipeiDate} from '../../../utils/attendance';
import {evidenceHash} from './attendanceCaseLifecycle';
export interface MasterPeriod {from:string;to:string;employmentState:'active'|'loa'|'not-employed';employmentType:'full-time'|'part-time'|'fixed-term'|'other';payBasis:'monthly'|'hourly'|'daily';amount:number;policyVersionId:string;dayTypeCalendarId:string}
export interface MasterTimeline {accountKind:'employee'|'system-account';from:string;to:string;periods:MasterPeriod[]}
const fail=(m:string):never=>{throw Object.assign(new Error(m),{statusCode:409});};
// Period reference meaning "resolve each month from that employee's approved
// personal designation" (dayTypeCalendarHeads/{empId}_{YYYY-MM}).
export const PERSONAL_MONTHLY_CALENDAR='personal-monthly';
export const shiftDate=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const nextDate=(d:string)=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
export function validateMaster(value:any):MasterTimeline{
 if(!value||!['employee','system-account'].includes(value.accountKind)||!validDate(value.from)||!validDate(value.to)||value.to<value.from||Date.parse(value.to)-Date.parse(value.from)>3660*86400000||!Array.isArray(value.periods)||value.periods.length>100)fail('主檔期間／容量無效');
 if(value.accountKind==='system-account'){if(value.periods.length)fail('系統帳號不可混入薪資期間');return {accountKind:value.accountKind,from:value.from,to:value.to,periods:[]};}
 if(!value.periods.length)fail('員工主檔不能缺少期間');let cursor=value.from;const periods:MasterPeriod[]=[];
 for(const p of value.periods){if(!validDate(p.from)||!validDate(p.to)||p.to<p.from||p.from!==cursor||p.to>value.to)fail('有效期重疊、缺口或順序無效');if(!['active','loa','not-employed'].includes(p.employmentState)||!['full-time','part-time','fixed-term','other'].includes(p.employmentType)||!['monthly','hourly','daily'].includes(p.payBasis)||!Number.isFinite(p.amount)||p.amount<0||typeof p.policyVersionId!=='string'||!p.policyVersionId||p.policyVersionId.includes('/')||typeof p.dayTypeCalendarId!=='string'||!p.dayTypeCalendarId||p.dayTypeCalendarId.includes('/'))fail('人員類別、薪制、薪額或政策參照未明示');periods.push({from:p.from,to:p.to,employmentState:p.employmentState,employmentType:p.employmentType,payBasis:p.payBasis,amount:p.amount,policyVersionId:p.policyVersionId,dayTypeCalendarId:p.dayTypeCalendarId});cursor=nextDate(p.to);}
 if(cursor!==nextDate(value.to))fail('主檔尾端缺口');return {accountKind:value.accountKind,from:value.from,to:value.to,periods};
}
export const masterDays=(v:MasterTimeline)=>{const days:any[]=[];for(let d=v.from;d<=v.to;d=nextDate(d)){const p=v.periods.find(p=>p.from<=d&&p.to>=d);days.push({date:d,...(p?{...p,from:undefined,to:undefined}:{employmentState:'system-account'})});}return days;};
export function assertFutureMaster(before:MasterTimeline|null,next:MasterTimeline,today=taipeiDate(new Date())){
 // Current date is frozen too: only tomorrow and later may change.
 if(!before){if(next.from<=today)fail('首次核定只能未來生效；歷史只能唯讀遷移預覽');return;}
 if(before.from!==next.from||next.to<before.to||before.accountKind!==next.accountKind)fail('既有範圍／人員帳號類別不可覆寫，需獨立歷史更正流程');
 if(evidenceHash(masterDays(before).filter(d=>d.date<=today))!==evidenceHash(masterDays(next).filter(d=>d.date<=today)))fail('已生效主檔不可追溯覆寫');
}
// Versions created by the proposal workflow must not inherit its former default
// standard regime without explicit scoped evidence. Keep immutable records intact;
// hold their projection until a new properly reviewed version is supplied.
const generatedRegimeAuthority=(p:any):boolean=>{
 if(!p||!Object.prototype.hasOwnProperty.call(p,'proposalId'))return true;
 if(p.normalPay?.workRegime!=='standard-8-40')return true;
 return typeof p.proposalId==='string'&&!!p.proposalId&&p.workRegime==='standard-8-40'&&
  typeof p.workRegimeEvidence==='string'&&p.workRegimeEvidence.trim().length>=5&&p.workRegimeEvidence.length<=2000&&
  !!p.proposedBy&&p.proposedBy!==p.approvedBy&&p.workRegimeConfirmedBy===p.approvedBy&&
  p.workRegimeConfirmedAt===p.approvedAt&&Number.isFinite(Date.parse(p.workRegimeConfirmedAt));
};
export async function effectiveMasterForMonth(db:any,tx:any,employee:any,month:string,storedReview:any){
 const get=(r:any)=>tx?tx.get(r):r.get(),head=await get(db.collection('payrollMasterHeads').doc(employee.id));if(!head.exists)return {...employee,masterAssessment:{status:'legacy-review-required',issues:employee.payrollMasterRequired?['新建員工尚未核定有效期主檔']:[],migrationPreview:{employmentType:null,payBasis:null,effectiveFrom:null,legacyPosition:employee.position||null}}};
 const h=head.data(),snap=await get(db.collection('payrollMasterVersions').doc(h.currentVersionId));const version=snap.data();
 const blocked=(issues:string[])=>({...employee,effectiveMasterVersion:h.currentVersionId,payrollReview:null,masterAssessment:{status:'needs-review',versionId:h.currentVersionId,issues}});
 if(!snap.exists||version.empId!==employee.id||version.status!=='approved'||!version.approvedBy||!version.approvedAt)return blocked(['有效期主檔來源未核定']);let timeline:MasterTimeline;try{timeline=validateMaster(version.timeline);}catch{return blocked(['有效期主檔來源無效']);}
 const first=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 if(end<timeline.from)return {...employee,masterAssessment:{status:'legacy-review-required',issues:employee.payrollMasterRequired?['新建員工月份早於核定主檔，需待覆核']:[],versionId:h.currentVersionId}};
 if(first<timeline.from||end>timeline.to)return blocked(['月份未有完整有效期主檔；部分月折算待C2']);
 if(timeline.accountKind==='system-account')return {...employee,accountKind:'system-account',masterAssessment:{status:'confirmed-system-account',versionId:h.currentVersionId,issues:[]}};
 const daily=masterDays(timeline).filter(d=>d.date>=first&&d.date<=end),issues:string[]=[];const refs=new Map<string,any>();
 const validPolicyRef=(p:any,d:any)=>!!p&&generatedRegimeAuthority(p)&&p.status==='approved'&&!!p.version&&!!p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt))&&!!p.employeeIds?.includes(employee.id)&&validDate(p.from)&&validDate(p.to)&&p.from<=d.date&&p.to>=d.date;
 const validCalendarRef=(c:any,d:any)=>!!c&&c.status==='approved'&&!!c.version&&!!c.approvedBy&&Number.isFinite(Date.parse(c.approvedAt))&&!!c.employeeIds?.includes(employee.id)&&['normal','rest','regular-holiday','national-holiday','special'].includes(c.days?.[d.date]);
 const calKey=(d:any)=>d.dayTypeCalendarId===PERSONAL_MONTHLY_CALENDAR?'dayTypeCalendarHeads/'+employee.id+'_'+d.date.slice(0,7):'dayTypeCalendars/'+d.dayTypeCalendarId;
 const load=async(d:any)=>{for(const [col,key] of [['payrollPolicyVersions',d.policyVersionId],['dayTypeCalendars',d.dayTypeCalendarId]]){const id=col==='dayTypeCalendars'?calKey(d):col+'/'+key;if(refs.has(id))continue;
   if(id.startsWith('dayTypeCalendarHeads/')){const h=await get(db.collection('dayTypeCalendarHeads').doc(id.slice(21))),cid=h.exists?h.data().currentCalendarId:null,s=typeof cid==='string'&&cid&&!cid.includes('/')?await get(db.collection('dayTypeCalendars').doc(cid)):null,v=s?.exists?s.data():null;refs.set(id,v&&v.yearMonth===d.date.slice(0,7)?v:null);}
   else{const s=await get(db.collection(col).doc(key));refs.set(id,s.exists?s.data():null);}}};
 for(const d of daily){await load(d);
  const p=refs.get('payrollPolicyVersions/'+d.policyVersionId),c=refs.get(calKey(d));if(!generatedRegimeAuthority(p))issues.push('政策工時制度來源與獨立核定證據未完整');if(!validPolicyRef(p,d))issues.push('日期適用政策未核定');else if(employee.payrollReview?.policy?.version!==p.version)issues.push('本月覆核政策版本與有效期參照不符');if(!validCalendarRef(c,d))issues.push('日期日別參照未核定');else if(employee.payrollReview?.policy?.regularDates?.includes(d.date)&&c.days[d.date]!=='normal')issues.push('月覆核一般工作日與有效日別衝突，待C2覆核');}
 const signatures=new Set(daily.map(d=>evidenceHash([d.employmentState,d.employmentType,d.payBasis,d.amount,d.policyVersionId,d.dayTypeCalendarId])));
 if(signatures.size!==1||daily.some(d=>d.employmentState!=='active'))issues.push('多段雇用／留停／調薪或部分月折算待C2');
 const row=daily[0];if(row.payBasis==='daily')issues.push('日薪計算待C2');if(storedReview?.masterVersionId!==h.currentVersionId)issues.push('本月薪資覆核尚未綁定有效期主檔版本');
 const normalPayDays=daily.map(d=>{const policy=refs.get('payrollPolicyVersions/'+d.policyVersionId);return {...d,amount:String(d.amount),payVersion:h.currentVersionId,policyId:d.policyVersionId,policy:generatedRegimeAuthority(policy)?policy?.normalPay||null:null,normalPayPolicySource:policy?{id:d.policyVersionId,status:policy.status,version:policy.version,from:policy.from,to:policy.to,employeeIds:policy.employeeIds,approvedBy:policy.approvedBy,approvedAt:policy.approvedAt}:null,dayType:refs.get(calKey(d))?.days?.[d.date]||'unknown'};});
 // Six days either side cover every seven-day week touching the month, so weekly
 // limits use the adjacent month's own approved day types and wages (LSA Art.30/36).
 const contextDays:any[]=[];const all=new Map(masterDays(timeline).map(d=>[d.date,d]));
 for(const date of [...Array.from({length:6},(_,i)=>shiftDate(first,i-6)),...Array.from({length:6},(_,i)=>shiftDate(end,i+1))]){const d=all.get(date);if(!d||d.employmentState==='system-account'){contextDays.push({date,covered:false});continue;}await load(d);const p=refs.get('payrollPolicyVersions/'+d.policyVersionId),c=refs.get(calKey(d));
  contextDays.push({...d,covered:true,amount:String(d.amount),payVersion:h.currentVersionId,policyId:d.policyVersionId,policy:validPolicyRef(p,d)?p.normalPay||null:null,dayType:validCalendarRef(c,d)?c.days[d.date]:'unknown'});}
 return {...employee,accountKind:'employee',employmentType:row.employmentType,payBasis:row.payBasis,hourlyRate:row.payBasis==='hourly'?row.amount:0,monthlySalary:row.payBasis==='monthly'?row.amount:0,normalPayDays,normalPayContextDays:contextDays,masterAssessment:{status:issues.length?'needs-review':'confirmed',versionId:h.currentVersionId,issues:[...new Set(issues)],daily,eligible:daily.some(d=>d.employmentState==='active'||d.employmentState==='loa')},effectiveMasterVersion:h.currentVersionId};
}
