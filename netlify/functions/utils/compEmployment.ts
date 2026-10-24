import {evidenceHash} from './attendanceCaseLifecycle';
import {withEmploymentAuthority} from './employmentAuthority';
import {employmentWindowStates} from '../../../utils/employmentAuthority';
const fail=():never=>{throw Object.assign(new Error('補休使用時段任職／留停來源未核實或已變更，保留預占待覆核'),{statusCode:409});};
export async function compEmploymentEvidence(db:any,tx:any,empId:string,w:{start:number;end:number}){
 const s=await tx.get(db.collection('employees').doc(empId));if(!s.exists)fail();const e=await withEmploymentAuthority(db,tx,{...s.data(),id:empId});if(employmentWindowStates(e,w.start,w.end).some(v=>v!=='active'))fail();
 if(e.employmentAuthority)return {kind:'effective-master',version:e.employmentAuthority.version,masterVersionId:e.employmentAuthority.masterVersionId};
 return {kind:'legacy-employment',version:evidenceHash([empId,e.accountKind||null,e.hireDate,e.resignDate||null,e.leaveOfAbsenceStart||null,e.leaveOfAbsenceEnd||null])};
}
