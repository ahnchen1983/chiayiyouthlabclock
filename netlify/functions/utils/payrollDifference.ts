import {loadApprovedPayrollPaymentEvidence} from './payrollPaymentEvidence';
import {assessPaymentEvidence} from '../../../utils/payroll/paymentEvidence';
import {loadPayrollMonthWithPaymentEvidence} from './payrollPaymentSource';
import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentifier,payrollItemIdentity,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import {comparisonDecimal,comparePayrollAmounts,type PayrollComparisonSource} from '../../../utils/payroll/comparison';
import {add,decimal,evidence,mul,rational,sum,type FractionEvidence} from '../../../utils/payroll/rational';
import {evidenceHash} from './attendanceCaseLifecycle';
import {loadPayrollMonthSource} from './payrollSourceReader';
import {runPayrollMutation,assertTransactionMonths} from './monthGuard';

export const PAYROLL_DIFFERENCE_ACTIONS=['get-payroll-difference','propose-payroll-difference','review-payroll-difference','adopt-payroll-difference'] as const;
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const flags={approvalScope:'recorded-comparison-only' as const,adoptionScope:'reviewed-comparison-evidence-only' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const,formalEligibility:'BLOCKED' as const,legalValidation:'not-certified' as const};
const idFor=(empId:string,month:string)=>'pd_'+evidenceHash([empId,month]);
const read=async(tx:any,ref:any,optional=false)=>{const snap=await tx.get(ref);if(!snap.exists){if(optional)return null;fail(404,'來源不存在');}return snap.data();};
const references=(v:any):string[]=>{if(!Array.isArray(v)||!v.length||v.length>20||v.some(x=>!payrollItemIdentifier(x))||new Set(v.map(x=>x.toLowerCase())).size!==v.length)fail(400,'需1–20個不重複來源中繼資料識別，不接受網址或原始資料');return [...v];};
const amount=(v:any):string=>{if(typeof v!=='string'||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(v))fail(400,'實際登錄金額需非負固定十進位字串，最多十位整數及兩位小數');return comparisonDecimal(v)!;};
interface ActualItem {sourceCode:string;kind:'earning'|'deduction';amount:string;sourceRefs:string[];reason:string}
export interface PayrollDifferenceActual {currency:'TWD';items:ActualItem[];netAmount:string;sourceRefs:string[];reason:string}
export function validatePayrollDifferenceActual(value:any):PayrollDifferenceActual {
 assertPayrollItemFields(value,['currency','items','netAmount','sourceRefs','reason']);
 if(value.currency!=='TWD'||!Array.isArray(value.items)||!value.items.length||value.items.length>100)fail(400,'需TWD及1–100個逐項實際金額');
 const seen=new Set<string>();
 const items=value.items.map((item:any):ActualItem=>{
  assertPayrollItemFields(item,['sourceCode','kind','amount','sourceRefs','reason']);
  if(!payrollItemIdentifier(item.sourceCode)||!['earning','deduction'].includes(item.kind)||seen.has(item.sourceCode))fail(400,'項目來源類別無效或重複');seen.add(item.sourceCode);
  return {sourceCode:item.sourceCode,kind:item.kind,amount:amount(item.amount),sourceRefs:references(item.sourceRefs),reason:payrollItemReason(item.reason)};
 });
 return {currency:'TWD',items,netAmount:amount(value.netAmount),sourceRefs:references(value.sourceRefs),reason:payrollItemReason(value.reason)};
}
export interface DifferenceComparison {
 items:Array<ActualItem&{systemAmount:string|null;sourceStatus:string;delta:FractionEvidence|null}>;
 netDelta:FractionEvidence|null;
 totals:{gross:FractionEvidence;deductions:FractionEvidence;net:FractionEvidence;reconciliationDifference:FractionEvidence};
 issues:string[];
 varianceStatus:'zero'|'nonzero'|'unresolved';
}
export function compareActual(actual:PayrollDifferenceActual,source:PayrollComparisonSource):DifferenceComparison {
 if(!source||source.schemaVersion!=='payroll-comparison-source-v1'||!Array.isArray(source.lines)||!source.totals||!Array.isArray(source.issues)||!['comparable','needs-review'].includes(source.status))fail(409,'系統比較來源格式無效');
 const codes=new Set<string>();for(const line of source.lines){if(!payrollItemIdentifier(line.code)||codes.has(line.code)||!['earning','deduction'].includes(line.kind))fail(409,'系統比較項目識別重複或無效');codes.add(line.code);}
 const issues=[...source.issues];if(source.status!=='comparable')issues.push('系統金額及法定來源尚未完整核定');
 const items=actual.items.map(item=>{
  const system=source.lines.find(line=>line.code===item.sourceCode),known=system?.status==='confirmed'&&system.kind===item.kind&&comparisonDecimal(system.amount)!==null;
  if(!known)issues.push('逐項來源或類別未核：'+item.sourceCode);
  return {...item,systemAmount:known?system!.amount:null,sourceStatus:system?.status||'missing',delta:known?comparePayrollAmounts(item.amount,system!.amount).delta:null};
 });
 for(const line of source.lines)if(!items.some(item=>item.sourceCode===line.code))issues.push('必要來源項目未列：'+line.code);
 const gross=sum(items.filter(i=>i.kind==='earning').map(i=>decimal(i.amount))),deductions=sum(items.filter(i=>i.kind==='deduction').map(i=>decimal(i.amount))),net=decimal(actual.netAmount),difference=add(add(gross,mul(deductions,rational(-1n))),mul(net,rational(-1n)));
 if(difference.n!==0n)issues.push('逐項應發減扣項不等於登錄實發，不得吞掉差額');
 const netDelta=comparePayrollAmounts(actual.netAmount,source.totals.net).delta;if(!netDelta)issues.push('系統實發來源未知');
 const unresolved=issues.length>0||items.some(i=>!i.delta)||!netDelta;
 const nonzero=items.some(i=>i.delta&&BigInt(i.delta.numerator)!==0n)||!!netDelta&&BigInt(netDelta.numerator)!==0n;
 return {items,netDelta,totals:{gross:evidence(gross),deductions:evidence(deductions),net:evidence(net),reconciliationDifference:evidence(difference)},issues:[...new Set(issues)],varianceStatus:unresolved?'unresolved':nonzero?'nonzero':'zero'};
}
type State='proposed'|'reviewed'|'returned'|'adoption-recorded';
interface History {actor:string;at:string;to:State;revision:number;reason:string;operationId:string}
export interface PayrollDifferenceVersion {
 schemaVersion:'payroll-difference-v1';id:string;empId:string;month:string;revision:number;status:State;
 source:PayrollComparisonSource;monthSourceHash:string;actual:PayrollDifferenceActual;comparison:DifferenceComparison;
 proposedBy:string;proposedAt:string;reviewedBy?:string;reviewedAt?:string;adoptedBy?:string;adoptedAt?:string;adoptionId?:string;
 adoptionStatus:'not-recorded'|'recorded';history:History[];
 approvalScope:'recorded-comparison-only';adoptionScope:'reviewed-comparison-evidence-only';applicationStatus:'not-applied';paymentStatus:'not-paid';formalEligibility:'BLOCKED';legalValidation:'not-certified';
}
const MAX_REVISIONS=40,MAX_VERSION_BYTES=200000;
function validateVersion(v:any,id:string,empId:string,month:string):void {
 try{
  if(!v||v.id!==id||v.empId!==empId||v.month!==month||v.schemaVersion!=='payroll-difference-v1'||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>MAX_REVISIONS||!Array.isArray(v.history)||v.history.length!==v.revision||Object.entries(flags).some(([key,value])=>v[key]!==value)||typeof v.monthSourceHash!=='string'||!v.monthSourceHash||v.source?.empId!==empId||v.source?.month!==month||typeof v.source?.sourceHash!=='string'||!v.source.sourceHash)throw Error();
  const actual=validatePayrollDifferenceActual(v.actual),comparison=compareActual(actual,v.source);
  if(evidenceHash(actual)!==evidenceHash(v.actual)||evidenceHash(comparison)!==evidenceHash(v.comparison))throw Error();
  const authors=new Set<string>();let previous:State|null=null,lastAt=-Infinity,proposal:History|null=null,review:History|null=null,adoption:History|null=null;
  for(let index=0;index<v.history.length;index++){
   const h=v.history[index];assertPayrollItemFields(h,['actor','at','to','revision','reason','operationId']);
   if(!payrollItemIdentity(h.actor)||h.actor===empId||!payrollItemIdentifier(h.operationId)||h.revision!==index+1||typeof h.at!=='string'||!Number.isFinite(Date.parse(h.at))||Date.parse(h.at)<lastAt)throw Error();payrollItemReason(h.reason);
   if(h.to==='proposed'){if(previous&&!['returned','reviewed','adoption-recorded'].includes(previous))throw Error();authors.add(h.actor);proposal=h;review=null;adoption=null;}
   else if(h.to==='reviewed'||h.to==='returned'){if(previous!=='proposed'||authors.has(h.actor))throw Error();review=h;}
   else if(h.to==='adoption-recorded'){if(previous!=='reviewed'||authors.has(h.actor))throw Error();adoption=h;}
   else throw Error();previous=h.to;lastAt=Date.parse(h.at);
  }
  if(previous!==v.status||!proposal||v.proposedBy!==proposal.actor||v.proposedAt!==proposal.at)throw Error();
  if(review?(v.reviewedBy!==review.actor||v.reviewedAt!==review.at):(v.reviewedBy!==undefined||v.reviewedAt!==undefined))throw Error();
  if(adoption?(v.adoptedBy!==adoption.actor||v.adoptedAt!==adoption.at||v.adoptionId!==id+'_'+v.revision||v.adoptionStatus!=='recorded'):(v.adoptedBy!==undefined||v.adoptedAt!==undefined||v.adoptionId!==undefined||v.adoptionStatus!=='not-recorded'))throw Error();
  if(v.status==='reviewed'&&comparison.issues.length||v.status==='adoption-recorded'&&comparison.varianceStatus!=='zero')throw Error();
 }catch{fail(409,'差額比較版本或不可變歷程無效');}
}
const adoptionEvidence=(v:PayrollDifferenceVersion)=>({id:v.adoptionId,comparisonId:v.id,empId:v.empId,month:v.month,revision:v.revision,reviewRevision:v.revision-1,sourceHash:v.source.sourceHash,monthSourceHash:v.monthSourceHash,comparisonHash:evidenceHash(v.comparison),actor:v.adoptedBy,at:v.adoptedAt,reviewedBy:v.reviewedBy,...flags});
async function verifyChain(db:any,tx:any,current:any,id:string,empId:string,month:string):Promise<PayrollDifferenceVersion[]>{
 if(!current)return [];
 validateVersion(current,id,empId,month);const versions:PayrollDifferenceVersion[]=[];let bytes=0;
 for(let revision=1;revision<=current.revision;revision++){
  const v=await read(tx,db.collection('payrollDifferenceVersions').doc(id+'_'+revision));validateVersion(v,id,empId,month);if(v.revision!==revision)fail(409,'差額比較歷史版本序號無效');
  bytes+=Buffer.byteLength(JSON.stringify(v),'utf8');if(bytes>MAX_REVISIONS*MAX_VERSION_BYTES)fail(409,'差額比較完整歷程超出技術容量');
  const previous=versions[versions.length-1];if(previous){
   if(evidenceHash(v.history.slice(0,-1))!==evidenceHash(previous.history))fail(409,'差額比較歷史來源鏈不一致');
   if(v.status!=='proposed'&&evidenceHash([v.source,v.monthSourceHash,v.actual,v.comparison])!==evidenceHash([previous.source,previous.monthSourceHash,previous.actual,previous.comparison]))fail(409,'審核或採用時不可修改比較來源或金額');
  }
  if(v.status==='adoption-recorded'){const adopted=await read(tx,db.collection('payrollDifferenceAdoptions').doc(v.adoptionId));if(evidenceHash(adopted)!==evidenceHash(adoptionEvidence(v)))fail(409,'獨立採用紀錄不一致');}
  versions.push(v);
 }
 if(evidenceHash(current)!==evidenceHash(versions[versions.length-1]))fail(409,'差額比較目前版本與不可變歷史不一致');return versions;
}
async function canonical(db:any,tx:any,empId:string,month:string,at:string){
 const result=await loadPayrollMonthWithPaymentEvidence(db,tx,{month,at});
 if(result.kind!=='live')return {source:null,monthSourceHash:null,paymentActual:null,issues:['已鎖或歷史來源需另走保留原快照的調整案件']};
 const source=result.comparisons[empId];if(!source||source.empId!==empId||source.month!==month)fail(409,'員工本月沒有可核對的系統比較來源');
 const payment:any=result.sourceEvidence?.paymentAllocations?.[empId]?.evidence;
 let paymentActual: {net:string|null;incomeTax:string|null;supplementaryPremium:string|null;paymentSource:unknown;allocationSource:unknown;allocated:boolean}|null=payment?.assessment?.status==='ready-calculation'?{net:payment.assessment.totals.cashPaid,incomeTax:payment.assessment.totals.actualIncomeTax,supplementaryPremium:payment.assessment.totals.actualSupplementaryPremium,paymentSource:payment.paymentSource,allocationSource:payment.allocationSource,allocated:true}:null;
 let paymentIssue:string|null=null;
 if(!paymentActual){
  const cash=await loadApprovedPayrollPaymentEvidence(db,tx,empId,month);
  if(cash.current){
   if(!cash.approved||cash.approved.sourceBinding.sourceHash!==result.sourceHash)paymentIssue='給付證據尚待核定或來源已變更';
   else{const assessed=assessPaymentEvidence(cash.approved.inventory,{empId,month,monthlyPayable:source.totals.net,payableSourceRef:result.sourceHash});paymentActual={net:assessed.totalRecorded,incomeTax:null,supplementaryPremium:null,paymentSource:cash.source,allocationSource:null,allocated:false};}
  }
 }
 return {source,monthSourceHash:result.sourceHash,issues:[...source.issues,...(paymentIssue?[paymentIssue]:[])],paymentActual,paymentIssue};
}

/** A variance against calculated obligations is allowed; contradicting already
 * independently approved actual cash/deduction facts is a different source
 * conflict and must not enter a second authoritative actual ledger. */
function assertActualPaymentConsistency(actual:PayrollDifferenceActual,fresh:Awaited<ReturnType<typeof canonical>>){
 if('paymentIssue' in fresh&&fresh.paymentIssue)fail(409,fresh.paymentIssue);
 if(!fresh.paymentActual)return;
 const paid=fresh.paymentActual;
 if(comparisonDecimal(paid.net)!==comparisonDecimal(actual.netAmount))fail(409,'人工實發與已核定實際支付不符，請先核實支付來源');
 if(!paid.allocated)return; // Cash-only evidence proves net, not invented tax components.
 for(const line of actual.items){
  const expected=line.sourceCode==='tax:income'?paid.incomeTax:line.sourceCode==='health:supplementary'?paid.supplementaryPremium:fresh.source?.lines.find(l=>l.code===line.sourceCode)?.amount;
  if(comparisonDecimal(expected)!==comparisonDecimal(line.amount))fail(409,'人工逐項金額與已核定實際給付分配不符');
 }
}

/** This records independent comparison review and a separate selection of a
 * zero-variance comparison. It is not a salary adjustment/application engine.
 * Nonzero differences may be reviewed as evidence, but their lawful adjustment
 * classification remains unresolved and cannot be adopted by this operation. */
export async function handlePayrollDifferenceAction(db:any,uid:string,action:string,data:any){
 if(!PAYROLL_DIFFERENCE_ACTIONS.includes(action as any))fail(400,'差額比較操作無效');
 const getting=action==='get-payroll-difference',proposing=action==='propose-payroll-difference',reviewing=action==='review-payroll-difference';
 assertPayrollItemFields(data,getting?['empId','month']:['empId','month','expectedRevision','operationId','reason',...(proposing?['actual']:reviewing?['mode']:[])]);
 const {empId,month}=data;if(!payrollItemIdentity(uid)||!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工／月份無效');
 const id=idFor(empId,month),col=(name:string)=>db.collection(name),at=new Date().toISOString();
 const authorize=async(tx:any,writing:boolean)=>{const actor=await read(tx,col('employees').doc(uid));if(writing?(actor.role!==UserRole.SuperAdmin||uid===empId):(uid!==empId&&actor.role!==UserRole.SuperAdmin))fail(403,'無權讀取或處理他人薪資差額');const employee=await read(tx,col('employees').doc(empId));if(employee.accountKind==='system-account')fail(409,'純系統帳號不適用薪資差額');return actor.role===UserRole.SuperAdmin&&uid!==empId;};
 if(getting)return db.runTransaction(async(tx:any)=>{
  const canManage=await authorize(tx,false),current=await read(tx,col('payrollDifferenceHeads').doc(id),true),versions=await verifyChain(db,tx,current,id,empId,month);
  const fresh=canManage?await canonical(db,tx,empId,month,at):{source:null,monthSourceHash:null,issues:[]};
  const visible=(v:any)=>v&&['reviewed','adoption-recorded'].includes(v.status);
  return {empId,month,current:canManage||visible(current)?current:null,versions:canManage?versions:versions.filter(visible),source:fresh.source,sourceIssues:fresh.issues,stale:!!current&&canManage&&(!fresh.source||current.source.sourceHash!==fresh.source.sourceHash||current.monthSourceHash!==fresh.monthSourceHash),canManage};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'需操作識別及非負整數版本');
 const reason=payrollItemReason(data.reason),actual=proposing?validatePayrollDifferenceActual(data.actual):null;
 if(reviewing&&!['approve','return'].includes(data.mode))fail(400,'差額比較審核操作無效');
 const hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  await authorize(tx,true);
  const receiptRef=col('payrollDifferenceCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true);
  if(receipt){if(receipt.hash!==hash)fail(409,'同一操作識別內容不同');const result=receipt.result;validateVersion(result,id,empId,month);const last=result.history[result.history.length-1];if(last.actor!==uid||last.operationId!==data.operationId)fail(409,'操作收據操作者或識別不一致');await verifyChain(db,tx,result,id,empId,month);return result;}
  await assertTransactionMonths(db,tx,[month]);
  const current=await read(tx,col('payrollDifferenceHeads').doc(id),true);if((current?.revision||0)!==data.expectedRevision)fail(409,'差額比較版本已變更');await verifyChain(db,tx,current,id,empId,month);
  const revision=(current?.revision||0)+1;if(revision>MAX_REVISIONS)fail(409,'差額比較月份歷程技術容量已滿');
  const event=(to:State):History=>({actor:uid,at,to,revision,reason,operationId:data.operationId});let result:PayrollDifferenceVersion;
  if(proposing){
   if(current?.status==='proposed')fail(409,'待核定比較不可覆寫，請先核退');
   const fresh=await canonical(db,tx,empId,month,at);if(!fresh.source||!fresh.monthSourceHash)fail(409,'歷史月份須走獨立調整案件');
   assertActualPaymentConsistency(actual!,fresh);
   result={schemaVersion:'payroll-difference-v1',id,empId,month,revision,status:'proposed',source:fresh.source,monthSourceHash:fresh.monthSourceHash,actual:actual!,comparison:compareActual(actual!,fresh.source),proposedBy:uid,proposedAt:at,history:[...(current?.history||[]),event('proposed')],adoptionStatus:'not-recorded',...flags};
  }else{
   if(!current||current.history.some((h:History)=>h.to==='proposed'&&h.actor===uid))fail(403,'不得審核或採用自己提出／曾編輯的比較');
   if(reviewing&&current.status!=='proposed'||!reviewing&&current.status!=='reviewed')fail(409,'差額比較目前狀態不能執行此操作');
   if(reviewing&&data.mode==='return')result={...current,revision,status:'returned',reviewedBy:uid,reviewedAt:at,history:[...current.history,event('returned')]};
   else{
    const fresh=await canonical(db,tx,empId,month,at);
    if(!fresh.source||fresh.source.sourceHash!==current.source.sourceHash||fresh.monthSourceHash!==current.monthSourceHash||evidenceHash(fresh.source)!==evidenceHash(current.source))fail(409,'系統來源已變更，需重新提出並獨立覆核');
    assertActualPaymentConsistency(current.actual,fresh);
    const comparison=compareActual(current.actual,fresh.source);if(comparison.issues.length)fail(409,'逐項來源、必要項目或實發加總尚待核對');
    if(reviewing)result={...current,revision,status:'reviewed',reviewedBy:uid,reviewedAt:at,history:[...current.history,event('reviewed')]};
    else{if(comparison.varianceStatus!=='zero')fail(409,'非零差額尚需合法調整分類，不能記錄為可採用比較');result={...current,revision,status:'adoption-recorded',adoptionStatus:'recorded',adoptedBy:uid,adoptedAt:at,adoptionId:id+'_'+revision,history:[...current.history,event('adoption-recorded')]};}
   }
  }
  validateVersion(result,id,empId,month);if(Buffer.byteLength(JSON.stringify(result),'utf8')>MAX_VERSION_BYTES)fail(409,'差額比較來源及歷程超出本批技術容量');
  tx.create(col('payrollDifferenceVersions').doc(id+'_'+revision),result);
  if(result.status==='adoption-recorded')tx.create(col('payrollDifferenceAdoptions').doc(result.adoptionId),adoptionEvidence(result));
  tx.set(col('payrollDifferenceHeads').doc(id),result);tx.create(receiptRef,{actor:uid,at,hash,result});return result;
 });
}

export interface PayrollDifferenceAdoptionProof {
 status:'verified-zero'|'missing'|'pending'|'stale'|'invalid';
 identity:{id:string;revision:number;adoptionId:string;evidenceVersion:string}|null;
 issues:string[];
}
/** Internal read-only loader. It never invokes the canonical reader: callers
 * supply its already-computed stable source from the SAME transaction. Neither
 * this proof nor an adoption revision belongs in the calculation source hash. */
export async function loadPayrollDifferenceAdoptionEvidence(db:any,reader:{get:(ref:any)=>Promise<any>},args:{empId:string;month:string;monthSourceHash:string;source:PayrollComparisonSource}):Promise<PayrollDifferenceAdoptionProof>{
 const result=(status:PayrollDifferenceAdoptionProof['status'],issue:string):PayrollDifferenceAdoptionProof=>({status,identity:null,issues:[issue]});
 try{
  const {empId,month,monthSourceHash,source}=args;
  if(!payrollItemIdentity(empId)||!payrollItemMonth(month)||!monthSourceHash||source?.empId!==empId||source.month!==month)return result('invalid','差額採納證據範圍無效');
  const id=idFor(empId,month),current=await read(reader,db.collection('payrollDifferenceHeads').doc(id),true);
  if(!current)return result('missing','本月尚無逐項零差額採納證據');
  await verifyChain(db,reader,current,id,empId,month);
  if(current.status!=='adoption-recorded')return result('pending','目前差額版本尚未獨立覆核並另外記錄採納');
  if(current.monthSourceHash!==monthSourceHash||current.source.sourceHash!==source.sourceHash||evidenceHash(current.source)!==evidenceHash(source))return result('stale','差額採納所依據的當前計薪來源已變更');
  const compared=compareActual(current.actual,source);
  if(source.status!=='comparable'||compared.issues.length||compared.varianceStatus!=='zero')return result('invalid','差額採納不是完整且逐項為零的比較');
  return {status:'verified-zero',identity:{id,revision:current.revision,adoptionId:current.adoptionId,evidenceVersion:evidenceHash(adoptionEvidence(current))},issues:[]};
 }catch{return result('invalid','差額採納不可變歷程或獨立採納紀錄無法核實');}
}

/** Internal adjustment-source boundary. Selection must name the current fully
 * reviewed immutable comparison; no client-supplied amounts enter this path. */
export async function loadReviewedPayrollDifferenceForAdjustment(db:any,reader:PayrollSourceReaderForAdjustment,args:{empId:string;month:string;at:string;comparisonRef?:{id:string;revision:number;evidenceVersion:string}}){
 const {empId,month,at}=args,id=idFor(empId,month);
 const current=await read(reader,db.collection('payrollDifferenceHeads').doc(id),true);
 if(!current)fail(409,'需先完成目前月份的獨立差額覆核');
 await verifyChain(db,reader,current,id,empId,month);
 const comparisonRef=args.comparisonRef??{id,revision:current.revision,evidenceVersion:evidenceHash(current)};
 if(!['reviewed','adoption-recorded'].includes(current.status)||comparisonRef?.id!==id||comparisonRef.revision!==current.revision||comparisonRef.evidenceVersion!==evidenceHash(current))fail(409,'調整所選差額版本不是目前已覆核來源');
 const fresh=await canonical(db,reader,empId,month,at);
 if(!fresh.source||fresh.source.status!=='comparable'||fresh.monthSourceHash!==current.monthSourceHash||evidenceHash(fresh.source)!==evidenceHash(current.source)||compareActual(current.actual,fresh.source).issues.length)fail(409,'調整所據的計薪來源已變更或未完整核實');
 assertActualPaymentConsistency(current.actual,fresh);
 return {comparisonRef,source:fresh.source,actual:current.actual,binding:{scope:'current',comparisonRef:{...comparisonRef},monthSourceHash:current.monthSourceHash,sourceHash:fresh.source.sourceHash,...(fresh.paymentActual?{paymentSource:fresh.paymentActual.paymentSource,allocationSource:fresh.paymentActual.allocationSource}:{})},authors:[...new Set<string>(current.history.filter((h:History)=>h.to==='proposed').map((h:History)=>h.actor))]};
}
type PayrollSourceReaderForAdjustment={get(ref:any):Promise<any>};
