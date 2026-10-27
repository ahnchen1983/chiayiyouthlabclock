import {validDate} from '../attendance';

/** Fixed-amount evidence only. No formula, legal classification or salary adoption
 * can be supplied by a caller. D adjustments and payment events are separate. */
export interface PayrollItemEvidence {
 itemCode:string;
 kind:'earning'|'deduction';
 amount:string;
 from:string;
 to:string;
 sourceRefs:string[];
 reason:string;
}
export interface PayrollItemInventory {
 empId:string;
 month:string;
 mode:'none'|'items';
 sourceRefs:string[];
 reason:string;
 items:PayrollItemEvidence[];
}
export interface PayrollItemHistory {
 actor:string;
 at:string;
 to:'proposed'|'approved'|'returned';
 revision:number;
 reason:string;
}
export interface PayrollItemInventoryVersion {
 schemaVersion:'payroll-item-inventory-v1';
 id:string;
 empId:string;
 month:string;
 revision:number;
 status:'proposed'|'approved'|'returned';
 inventory:PayrollItemInventory;
 proposedBy:string;
 proposedAt:string;
 approvedBy?:string;
 approvedAt?:string;
 reviewedBy?:string;
 reviewedAt?:string;
 history:PayrollItemHistory[];
 approvalScope:'recorded-evidence-only';
 applicationStatus:'not-applied';
 paymentStatus:'not-paid';
 legalValidation:'unresolved';
}
export interface PayrollItemAssessment {
 status:'missing'|'unreviewed'|'confirmed-none'|'recorded-items-needs-classification';
 formalEligibility:'BLOCKED';
 issues:string[];
 items:Array<PayrollItemEvidence & {classification:{normalWage:'unresolved';incomeTax:'unresolved';supplementaryPremium:'unresolved';deductionAuthority:'unresolved'}}>;
}
const fail=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:400});};
export const payrollItemIdentifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(value);
// Account document IDs follow the existing attendance identity contract, which
// permits email-shaped IDs. They are not interchangeable with source metadata.
export const payrollItemIdentity=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=150&&value.trim()===value&&!/[\u0000-\u001f\u007f/]/.test(value)&&!['.','..'].includes(value);
export const payrollItemMonth=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&validDate(value+'-01');
export const payrollItemReason=(value:unknown):string=>{
 if(typeof value!=='string'||value.trim().length<5||value.length>2000)fail('需5–2000字的具體來源／確認原因');
 return (value as string).trim();
};
export const assertPayrollItemFields=(value:any,allowed:string[]):void=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)fail('資料格式無效');
 if(Object.keys(value).some(key=>!allowed.includes(key)))fail('包含未知或伺服器專用欄位');
};
const refs=(value:any):string[]=>{
 if(!Array.isArray(value)||value.length<1||value.length>20||value.some(ref=>!payrollItemIdentifier(ref)))fail('來源需1–20個中繼資料識別，不接受網址或原始資料');
 if(new Set(value.map((ref:string)=>ref.toLowerCase())).size!==value.length)fail('來源識別重複');
 return [...value];
};
const amount=(value:any):string=>{
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value))fail('金額需非負固定十進位字串（最多十位整數、兩位小數）；差額調整另行核定');
 const [whole,decimal='']=value.split('.'),fraction=decimal.replace(/0+$/,'');
 return fraction?whole+'.'+fraction:whole;
};
export function validatePayrollItemInventory(value:any):PayrollItemInventory {
 assertPayrollItemFields(value,['empId','month','mode','sourceRefs','reason','items']);
 if(!payrollItemIdentity(value.empId)||!payrollItemMonth(value.month))fail('員工／月份識別無效');
 if(!['none','items'].includes(value.mode)||!Array.isArray(value.items)||value.items.length>100)fail('需明示本月無其他項目或1–100筆固定項目');
 if(value.mode==='none'&&value.items.length||value.mode==='items'&&!value.items.length)fail('清冊聲明與項目數量不符');
 const seenCodes=new Set<string>(),seenRefs=new Set<string>();
 const items=value.items.map((row:any):PayrollItemEvidence=>{
  assertPayrollItemFields(row,['itemCode','kind','amount','from','to','sourceRefs','reason']);
  if(!payrollItemIdentifier(row.itemCode)||!['earning','deduction'].includes(row.kind))fail('項目識別或應發／扣項類型無效');
  if(seenCodes.has(row.itemCode.toLowerCase()))fail('項目識別重複');seenCodes.add(row.itemCode.toLowerCase());
  if(!validDate(row.from)||!validDate(row.to)||row.to<row.from||row.from.slice(0,7)!==value.month||row.to.slice(0,7)!==value.month)fail('項目有效期間需完整位於清冊月份內');
  const sourceRefs=refs(row.sourceRefs);
  for(const ref of sourceRefs){const key=ref.toLowerCase();if(seenRefs.has(key))fail('同一來源明細不能重複列入項目');seenRefs.add(key);}
  return {itemCode:row.itemCode,kind:row.kind,amount:amount(row.amount),from:row.from,to:row.to,sourceRefs,reason:payrollItemReason(row.reason)};
 });
 return {empId:value.empId,month:value.month,mode:value.mode,sourceRefs:refs(value.sourceRefs),reason:payrollItemReason(value.reason),items};
}
/** Structural history validation is also used for proposed/returned revisions.
 * It cannot prove persistence: the service additionally checks every immutable
 * revision before trusting the mutable head or permitting another mutation. */
export function validPayrollItemVersionHistory(version:any):boolean {
 try {
  if(!version||version.schemaVersion!=='payroll-item-inventory-v1'||!payrollItemIdentifier(version.id)||!payrollItemIdentity(version.empId)||!payrollItemMonth(version.month)||!Number.isSafeInteger(version.revision)||version.revision<1||version.revision>100)return false;
  if(version.approvalScope!=='recorded-evidence-only'||version.applicationStatus!=='not-applied'||version.paymentStatus!=='not-paid'||version.legalValidation!=='unresolved')return false;
  const inventory=validatePayrollItemInventory(version.inventory);
  if(inventory.empId!==version.empId||inventory.month!==version.month)return false;
  const history=version.history;
  if(!Array.isArray(history)||history.length!==version.revision)return false;
  const authors=new Set<string>();let previousAt=-Infinity,lastProposal:PayrollItemHistory|null=null,previousState:string|null=null;
  for(let index=0;index<history.length;index++){
   const event=history[index];assertPayrollItemFields(event,['actor','at','to','revision','reason']);
   const at=typeof event.at==='string'?Date.parse(event.at):NaN;
   if(!payrollItemIdentity(event.actor)||event.actor===version.empId||event.revision!==index+1||!Number.isFinite(at)||at<previousAt)return false;
   payrollItemReason(event.reason);
   if(event.to==='proposed'){
    if(previousState!==null&&!['approved','returned'].includes(previousState))return false;
    authors.add(event.actor);lastProposal=event;
   }else if(['approved','returned'].includes(event.to)){
    if(previousState!=='proposed'||authors.has(event.actor))return false;
   }else return false;
   previousState=event.to;previousAt=at;
  }
  const last=history[history.length-1];
  if(!lastProposal||last.to!==version.status||version.proposedBy!==lastProposal.actor||version.proposedAt!==lastProposal.at)return false;
  if(version.status==='proposed')return version.approvedBy===undefined&&version.approvedAt===undefined&&version.reviewedBy===undefined&&version.reviewedAt===undefined;
  if(version.reviewedBy!==last.actor||version.reviewedAt!==last.at)return false;
  return version.status==='approved'?version.approvedBy===last.actor&&version.approvedAt===last.at:version.approvedBy===undefined&&version.approvedAt===undefined;
 }catch{return false;}
}
/** Approval records evidence, never validates statutory treatment or authorises
 * payment. The integration owner must separately assess canonical payroll inputs. */
export function assessPayrollItemInventory(version:PayrollItemInventoryVersion|null|undefined):PayrollItemAssessment {
 const pending=(issue:string,status:PayrollItemAssessment['status']='unreviewed'):PayrollItemAssessment=>({status,formalEligibility:'BLOCKED',issues:[issue],items:[]});
 if(!version)return pending('本月其他薪資項目清冊尚未建立','missing');
 let inventory:PayrollItemInventory;
 try{inventory=validatePayrollItemInventory(version.inventory);}catch{return pending('薪資項目清冊格式或來源無效');}
 if(!validPayrollItemVersionHistory(version)||version.status!=='approved')return pending('薪資項目清冊尚未完成獨立證據核定或歷程不完整');
 const history=version.history;
 if(!Array.isArray(history)||!history.length||!payrollItemIdentity(version.approvedBy)||version.approvedBy===version.empId||version.approvedBy===version.proposedBy||!Number.isFinite(Date.parse(version.approvedAt||''))||history.some(h=>h.to==='proposed'&&h.actor===version.approvedBy))return pending('薪資項目核定者、日期或歷史編輯分工無效');
 const last=history[history.length-1];
 if(last.to!=='approved'||last.actor!==version.approvedBy||last.at!==version.approvedAt||last.revision!==version.revision)return pending('薪資項目核定歷程不一致');
 if(inventory.mode==='none')return {status:'confirmed-none',formalEligibility:'BLOCKED',issues:[],items:[]};
 return {status:'recorded-items-needs-classification',formalEligibility:'BLOCKED',issues:['項目金額證據已記錄；工資基礎、稅務、補充保費及扣款依據尚待逐項核定，不得直接採用'],items:inventory.items.map(item=>({...item,classification:{normalWage:'unresolved',incomeTax:'unresolved',supplementaryPremium:'unresolved',deductionAuthority:'unresolved'}}))};
}
