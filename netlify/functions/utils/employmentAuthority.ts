import {validateMaster} from './effectiveMaster';
import {evidenceHash} from './attendanceCaseLifecycle';
/** Adoption is authoritative even outside its coverage: uncovered dates stay unknown. */
export async function withEmploymentAuthority(db:any,tx:any,employee:any){
 const get=(r:any)=>tx?tx.get(r):r.get(),head=await get(db.collection('payrollMasterHeads').doc(employee.id));if(!head.exists){const {employmentAuthority:_untrusted,...legacy}=employee;return legacy;}
 const h=head.data(),snap=await get(db.collection('payrollMasterVersions').doc(h.currentVersionId)),v=snap.data();
 try{if(!snap.exists||v.empId!==employee.id||v.status!=='approved'||!v.approvedBy||!Number.isFinite(Date.parse(v.approvedAt)))throw Error();const timeline=validateMaster(v.timeline);return {...employee,employmentAuthority:{kind:'effective-master',version:evidenceHash([h,v]),masterVersionId:h.currentVersionId,...timeline}};}
 catch{return {...employee,employmentAuthority:{kind:'unknown',masterVersionId:h.currentVersionId}};}
}
