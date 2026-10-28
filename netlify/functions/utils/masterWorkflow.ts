import {UserRole} from '../../../types';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';
import {validateMaster,assertFutureMaster,masterDays} from './effectiveMaster';
import {evidenceHash} from './attendanceCaseLifecycle';
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const read=async(db:any,tx:any,col:string,key:string,optional=false)=>{if(!id(key))fail(400,'識別無效');const s=await tx.get(db.collection(col).doc(key));if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
export const MASTER_ACTIONS=['get-payroll-master','propose-payroll-master','review-payroll-master'] as const;
export async function handleMasterAction(db:any,uid:string,action:string,data:any){
 const readTx={get:(r:any)=>r.get()};
 if(action==='get-payroll-master'){
  const a=await read(db,readTx,'employees',uid),empId=data.empId||uid;if(uid!==empId&&a.role!==UserRole.SuperAdmin)fail(403,'不得讀取他人薪資主檔');const e=await read(db,readTx,'employees',empId),head=await read(db,readTx,'payrollMasterHeads',empId,true),q=await db.collection('payrollMasterVersions').where('empId','==',empId).limit(101).get();if(q.size>100)fail(409,'主檔版本容量超限');const versions=q.docs.map((d:any)=>({...d.data(),id:d.id}));
  return {empId,headRevision:head?.revision||0,current:head?versions.find((v:any)=>v.id===head.currentVersionId)||null:null,versions:uid===empId?versions.filter((v:any)=>v.status==='approved'):versions,migrationPreview:{status:'needs-review',employmentType:null,payBasis:null,effectiveFrom:null,legacy:{position:e.position||null,hourlyRate:e.hourlyRate??null,monthlySalary:e.monthlySalary??null,hireDate:e.hireDate||null}},canPropose:a.role===UserRole.SuperAdmin,formalEligibility:'BLOCKED'};
 }
 if(!id(data.operationId)||!id(data.empId)||typeof data.reason!=='string'||data.reason.trim().length<5||data.reason.length>2000||!Number.isInteger(data.expectedHeadRevision))fail(400,'主檔操作需識別、版本與原因');const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await read(db,tx,'employees',uid);if(a.role!==UserRole.SuperAdmin)fail(403,'僅最高管理者可提出／核定薪資主檔');await read(db,tx,'employees',data.empId);
  const receipt=db.collection('payrollMasterCommands').doc(evidenceHash([uid,data.operationId])),oldReceipt=await tx.get(receipt);if(oldReceipt.exists){if(oldReceipt.data().hash!==hash)fail(409,'重播內容不同');return oldReceipt.data().result;}
  const head=await read(db,tx,'payrollMasterHeads',data.empId,true);if((head?.revision||0)!==data.expectedHeadRevision)fail(409,'有效主檔版本已變更');const current=head?await read(db,tx,'payrollMasterVersions',head.currentVersionId):null;
  const q=await tx.get(db.collection('payrollMasterVersions').where('empId','==',data.empId).limit(101));if(q.size>100||action==='propose-payroll-master'&&q.size>=100)fail(409,'主檔版本技術容量超限');let result:any;
  if(action==='propose-payroll-master'){
   const timeline=validateMaster(data.timeline);assertFutureMaster(current?.timeline||null,timeline);const beforeDays=new Map(current?masterDays(current.timeline).map(d=>[d.date,evidenceHash(d)]):[]);const changed=masterDays(timeline).filter(d=>beforeDays.get(d.date)!==evidenceHash(d));if(!changed.length)fail(409,'主檔沒有變更');await assertTransactionMonths(db,tx,[...new Set(changed.map(d=>d.date.slice(0,7)))]);
   result={id:'master_'+evidenceHash([uid,data.operationId]),empId:data.empId,status:'proposed',revision:1,baseHeadRevision:head?.revision||0,timeline,proposedBy:uid,proposedAt:at,reason:data.reason.trim(),history:[{actor:uid,at,to:'proposed',reason:data.reason.trim()}]};tx.create(db.collection('payrollMasterVersions').doc(result.id),result);
  }else{
   const proposed=await read(db,tx,'payrollMasterVersions',data.versionId);if(proposed.empId!==data.empId||proposed.status!=='proposed'||proposed.revision!==data.expectedRevision||proposed.baseHeadRevision!==(head?.revision||0))fail(409,'提案已變更或基準過期');if(proposed.proposedBy===uid||data.empId===uid)fail(403,'不可核定本人薪額或自己的提案');if(!['approve','return'].includes(data.mode))fail(400,'核定操作無效');
   const timeline=validateMaster(proposed.timeline);assertFutureMaster(current?.timeline||null,timeline);const beforeDays=new Map(current?masterDays(current.timeline).map(d=>[d.date,evidenceHash(d)]):[]);const changed=masterDays(timeline).filter(d=>beforeDays.get(d.date)!==evidenceHash(d));await assertTransactionMonths(db,tx,[...new Set(changed.map(d=>d.date.slice(0,7)))]);
   result={...proposed,revision:proposed.revision+1,status:data.mode==='approve'?'approved':'returned',history:[...proposed.history,{actor:uid,at,to:data.mode,reason:data.reason.trim()}],...(data.mode==='approve'?{approvedBy:uid,approvedAt:at}:{returnedBy:uid,returnedAt:at})};tx.update(db.collection('payrollMasterVersions').doc(result.id),result);if(data.mode==='approve'){tx.set(db.collection('payrollMasterHeads').doc(data.empId),{currentVersionId:result.id,revision:(head?.revision||0)+1,actor:uid,at});tx.create(db.collection('payrollMasterActivations').doc(result.id),{versionId:result.id,previousVersionId:current?.id||null,empId:data.empId,actor:uid,at,from:timeline.from,to:timeline.to});}
  }
  tx.create(receipt,{hash,result,actor:uid,at});return result;
 });
}
