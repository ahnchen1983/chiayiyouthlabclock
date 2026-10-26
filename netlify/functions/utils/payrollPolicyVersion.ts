import {UserRole} from '../../../types';
import {validDate} from '../../../utils/attendance';
import {runPayrollMutation} from './monthGuard';
import {evidenceHash} from './attendanceCaseLifecycle';
/** Creates payrollPolicyVersions through a two-person flow: an admin proposes the
 * scope (employees, effective period, the "other" leave fraction) and a different
 * admin approves. Every other rule is built here from decisions the company already
 * confirmed or from statute, so they cannot be mistyped:
 * - standard 8h/40h regime, seven-day cycle Sunday–Saturday (confirmed 2026-10-26)
 * - mid-month hire: full amount × employed calendar days ÷ month days (confirmed)
 * - one final rounding to whole dollars, half-up (confirmed)
 * - monthly hourly basis /240 (MOL calculator), comp use paid at approved minutes
 * - 特休 paid (LSA Art.38), 事假 unpaid (Leave Rules Art.7), 病假 half pay within the
 *   statutory 30 days (Leave Rules Art.4), leave of absence unpaid
 * Approved versions are immutable; changes create a new version.
 */
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150&&!v.includes('/');
const manager=(r:any)=>r===UserRole.Admin||r===UserRole.SuperAdmin;
const read=async(tx:any,ref:any,optional=false)=>{const s=await tx.get(ref);if(!s.exists){if(optional)return null;fail(404,'來源不存在');}return {...s.data(),id:s.id};};
const FRACTIONS:Record<string,{numerator:number;denominator:number}>={paid:{numerator:1,denominator:1},half:{numerator:1,denominator:2},unpaid:{numerator:0,denominator:1}};
export function buildNormalPayPolicy(version:string,approvedBy:string,approvedAt:string,otherLeave:string|null){
 const proof={version,status:'approved' as const,approvedBy,approvedAt};
 return {...proof,dateRule:'taipei-calendar',employmentDates:'inclusive',restDays:'calendar-paid',dailyNormalMinutes:480,workRegime:'standard-8-40',
  monthlyStrategy:'calendar-earned',fullMonth:'contract-amount',loa:{method:'daily-base-fraction',numerator:0,denominator:1},monthlyLeaveHourlyDivisor:'240',
  leavePaidFractions:{'特休':FRACTIONS.paid,'事假':FRACTIONS.unpaid,'病假':FRACTIONS.half,...(otherLeave?{'其他':FRACTIONS[otherLeave]}:{})},
  compUse:'approved-paid-minutes',rounding:{...proof,stage:'final',precision:0,mode:'half-up'},
  overtimeRules:{schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240}};
}
export const PAYROLL_POLICY_ACTIONS=['list-payroll-policy-versions','propose-payroll-policy-version','review-payroll-policy-version'] as const;
export async function handlePayrollPolicyAction(db:any,uid:string,action:string,data:any){
 const col=(c:string)=>db.collection(c),readTx={get:(r:any)=>r.get()};
 const actor=await read(readTx,col('employees').doc(uid));if(!manager(actor.role))fail(403,'僅管理者可處理計薪政策版本');
 if(action==='list-payroll-policy-versions'){
  const [v,p]=await Promise.all([col('payrollPolicyVersions').limit(201).get(),col('payrollPolicyProposals').limit(201).get()]);if(v.size>200||p.size>200)fail(409,'政策版本容量超限');
  const rows=(q:any)=>q.docs.map((d:any)=>({...d.data(),id:d.id})).sort((a:any,b:any)=>String(b.from).localeCompare(String(a.from)));
  return {versions:rows(v),proposals:rows(p)};
 }
 if(!id(data.operationId))fail(400,'需操作識別');const reason=typeof data.reason==='string'?data.reason.trim():'';if(reason.length<5||reason.length>2000)fail(400,'需至少5字原因');
 const at=new Date().toISOString(),hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  const a=await read(tx,col('employees').doc(uid));if(!manager(a.role))fail(403,'僅管理者可處理計薪政策版本');
  const receipt=col('payrollPolicyCommands').doc(evidenceHash([uid,data.operationId])),old=await tx.get(receipt);if(old.exists){if(old.data().hash!==hash)fail(409,'重播內容不同');return old.data().result;}
  let result:any;
  if(action==='propose-payroll-policy-version'){
   const ids=data.employeeIds;if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length||ids.some((x:any)=>!id(x)))fail(400,'適用員工清單無效');
   for(const e of ids){const emp=await read(tx,col('employees').doc(e),true);if(!emp)fail(400,'適用員工不存在 '+e);if(emp.accountKind==='system-account')fail(400,'系統帳號不適用計薪政策 '+e);}
   if(!validDate(data.from)||!validDate(data.to)||data.to<data.from)fail(400,'有效期間無效');
   if(data.otherLeave!==null&&!Object.keys(FRACTIONS).includes(data.otherLeave))fail(400,'「其他」假別給薪方式無效');
   result={id:'ppp_'+evidenceHash([uid,data.operationId]),status:'proposed',revision:1,employeeIds:[...ids].sort(),from:data.from,to:data.to,otherLeave:data.otherLeave,proposedBy:uid,proposedAt:at,reason,history:[{actor:uid,at,to:'proposed',reason}]};
   tx.create(col('payrollPolicyProposals').doc(result.id),result);
  }else{
   if(!id(data.proposalId)||!Number.isInteger(data.expectedRevision))fail(400,'需提案識別與版本');
   const p=await read(tx,col('payrollPolicyProposals').doc(data.proposalId));
   if(p.status!=='proposed'||p.revision!==data.expectedRevision)fail(409,'提案已變更或已處理');
   if(p.proposedBy===uid)fail(403,'不可核定自己提出的政策');if(!['approve','return'].includes(data.mode))fail(400,'核定操作無效');
   const history=[...p.history,{actor:uid,at,to:data.mode,reason}];
   if(data.mode==='return')result={...p,status:'returned',revision:p.revision+1,history};
   else{
    const version='ppv_'+evidenceHash([p.id,uid,data.operationId]);
    tx.create(col('payrollPolicyVersions').doc(version),{status:'approved',version,approvedBy:uid,approvedAt:at,proposedBy:p.proposedBy,employeeIds:p.employeeIds,from:p.from,to:p.to,proposalId:p.id,normalPay:buildNormalPayPolicy(version,uid,at,p.otherLeave)});
    result={...p,status:'approved',revision:p.revision+1,approvedBy:uid,approvedAt:at,versionId:version,history};
   }
   tx.set(col('payrollPolicyProposals').doc(p.id),result);
  }
  tx.create(receipt,{hash,result,actor:uid,at});return result;
 });
}
