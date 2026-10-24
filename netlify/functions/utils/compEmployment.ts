import {validDate,taipeiDate} from '../../../utils/attendance';
import {evidenceHash} from './attendanceCaseLifecycle';
const fail=():never=>{throw Object.assign(new Error('補休使用時段任職／留停來源未核實或已變更，保留預占待覆核'),{statusCode:409});};
/** Shared contract with C1: an adopted master replaces, never guesses from, legacy employment. */
export async function compEmploymentEvidence(db:any,tx:any,empId:string,w:{start:number;end:number}){
 const e=await tx.get(db.collection('employees').doc(empId));if(!e.exists)fail();const employee=e.data(),first=taipeiDate(new Date(w.start*60000)),last=taipeiDate(new Date((w.end-1)*60000));
 const head=await tx.get(db.collection('payrollMasterHeads').doc(empId));
 if(head.exists){const h=head.data(),s=await tx.get(db.collection('payrollMasterVersions').doc(h.currentVersionId)),v=s.data();if(!s.exists||v.empId!==empId||v.status!=='approved'||!v.approvedBy||!v.approvedAt||v.timeline?.accountKind!=='employee'||!Array.isArray(v.timeline?.periods))fail();
  for(let d=first;d<=last;d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)){const matches=v.timeline.periods.filter((p:any)=>validDate(p.from)&&validDate(p.to)&&p.from<=d&&p.to>=d);if(matches.length!==1||matches[0].employmentState!=='active')fail();}
  return {kind:'effective-master',version:evidenceHash([h,v]),masterVersionId:h.currentVersionId};
 }
 if(employee.accountKind==='system-account'||!validDate(employee.hireDate)||first<employee.hireDate||employee.resignDate&&(!validDate(employee.resignDate)||last>employee.resignDate)||employee.leaveOfAbsenceStart&&(!validDate(employee.leaveOfAbsenceStart)||last>=employee.leaveOfAbsenceStart&&(!employee.leaveOfAbsenceEnd||!validDate(employee.leaveOfAbsenceEnd)||first<=employee.leaveOfAbsenceEnd)))fail();
 return {kind:'legacy-employment',version:evidenceHash([empId,employee.accountKind||null,employee.hireDate,employee.resignDate||null,employee.leaveOfAbsenceStart||null,employee.leaveOfAbsenceEnd||null])};
}
