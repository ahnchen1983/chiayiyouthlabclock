import {loadApprovedHistoricalPayrollCorrection} from './historicalPayrollCorrection';
import {validHistoricalCorrectedSource} from './frozenHistoricalPayroll';
import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentifier,payrollItemIdentity,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import {comparisonDecimal,type PayrollComparisonSource} from '../../../utils/payroll/comparison';
import {add,decimal,evidence,mul,rational,sum} from '../../../utils/payroll/rational';
import {compareActual,validatePayrollDifferenceActual,type PayrollDifferenceActual,type DifferenceComparison} from './payrollDifference';
import {loadPayrollMonthSource} from './payrollSourceReader';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation} from './monthGuard';

export const HISTORICAL_PAYROLL_DIFFERENCE_ACTIONS=['get-historical-payroll-difference','propose-historical-payroll-difference','review-historical-payroll-difference','adopt-historical-payroll-difference'] as const;
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const flags={comparisonBasis:'original-recorded-payroll' as const,approvalScope:'historical-comparison-evidence-only' as const,adoptionScope:'reviewed-historical-comparison-evidence-only' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const,formalEligibility:'BLOCKED' as const,legalValidation:'not-certified' as const};
export interface HistoricalPayrollOrigin {
 status:'recorded'|'unavailable';runId:string|null;inputHash:string|null;sourceHash:string|null;
 completeness:'complete'|'legacy-inputs-only'|'unavailable';lockHash:string;runHash:string|null;salaryHash:string|null;
}
export interface HistoricalCorrectionRef {id:string;revision:number;evidenceVersion:string;calculatorVersion:string;adapterVersion:string}
type State='proposed'|'reviewed'|'returned'|'adoption-recorded';
interface Event {actor:string;at:string;revision:number;to:State;reason:string;operationId:string}
export interface HistoricalPayrollDifferenceVersion {
 schemaVersion:'historical-payroll-difference-v1';id:string;empId:string;month:string;revision:number;status:State;
 original:HistoricalPayrollOrigin;source:PayrollComparisonSource;actual:PayrollDifferenceActual;comparison:DifferenceComparison;
 proposedBy:string;proposedAt:string;reviewedBy?:string;reviewedAt?:string;adoptedBy?:string;adoptedAt?:string;adoptionId?:string;
 adoptionStatus:'not-recorded'|'recorded';history:Event[];
 correctionRef?:HistoricalCorrectionRef;sourceAuthors?:string[];correctionBinding?:{scope:string;correctionRef:HistoricalCorrectionRef;original:Record<string,unknown>;bundleHash:string};
 comparisonBasis:'original-recorded-payroll'|'corrected-historical-rate';approvalScope:'historical-comparison-evidence-only';adoptionScope:'reviewed-historical-comparison-evidence-only';applicationStatus:'not-applied';paymentStatus:'not-paid';formalEligibility:'BLOCKED';legalValidation:'not-certified';
}
const keyFor=(empId:string,month:string)=>'hpd_'+evidenceHash([empId,month]);
const amount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?comparisonDecimal(String(v)):null;
const read=async(tx:any,ref:any,optional=false)=>{const snap=await tx.get(ref);if(!snap.exists){if(optional)return null;fail(404,'歷史來源不存在');}return snap.data();};
const MAX_REVISIONS=30,MAX_BYTES=180000;

/** Recorded arithmetic only: never rerun historical payroll or reinterpret a
 * locked calculation as legally verified. Missing fields stay missing. */
async function originalSource(db:any,tx:any,empId:string,month:string,at:string){
 const loaded=await loadPayrollMonthSource(db,tx,{month,at});
 if(loaded.kind==='live')return fail(409,'歷史差額只適用已鎖月份；未鎖月份請使用一般比較');
 const salary=loaded.kind==='locked'?loaded.salaries.find(s=>s.empId===empId):undefined;
 const original:HistoricalPayrollOrigin={status:salary?'recorded':'unavailable',runId:loaded.kind==='locked'?loaded.run.id:typeof loaded.lock?.payrollRunId==='string'?loaded.lock.payrollRunId:null,
  inputHash:loaded.kind==='locked'?loaded.originalInputHash:null,sourceHash:loaded.kind==='locked'?loaded.sourceHash:null,
  completeness:loaded.kind==='locked'?loaded.completeness:'unavailable',lockHash:evidenceHash(loaded.lock),runHash:loaded.kind==='locked'?evidenceHash(loaded.run):null,salaryHash:salary?evidenceHash(salary):null};
 const issues:string[]=salary?[]:['原始鎖月快照不存在、損毀或缺少此員工；僅能記錄待查事實'];
 const refs=original.runId?[{kind:'original-payroll-run',id:original.runId,version:original.runHash||original.lockHash}]:[];
 const fields=[['normal','earning','baseSalary'],['overtime','earning','overtimePay'],['comp-settlement','earning','compSettlementPay'],['insurance:labor-employment','deduction','laborInsurance'],['insurance:health','deduction','healthInsurance'],['pension:self','deduction','laborPensionSelf'],['leave','deduction','leaveDeduction'],['tax:income','deduction','incomeTax'],['health:supplementary','deduction','supplementaryPremium']] as const;
 const lines:PayrollComparisonSource['lines']=fields.map(([code,kind,field])=>{
  const recorded=amount(salary?.[field]),lineIssues=recorded===null?['原始記錄缺少金額：'+code]:[];issues.push(...lineIssues);
  return {code,kind,status:recorded===null?'needs-review':'confirmed',exact:recorded===null?null:evidence(decimal(recorded)),amount:recorded,sourceRefs:refs,issues:lineIssues};
 });
 const appliedItems=salary?.itemApplication;
 if(appliedItems){
  if(appliedItems.status!=='ready'||!appliedItems.source||!Array.isArray(appliedItems.lines))issues.push('原始額外項目計算來源未完整記錄');
  else for(const item of appliedItems.lines){
   const recorded=comparisonDecimal(item.appliedAmount),valid=payrollItemIdentifier(item.code)&&item.code.startsWith('item:')&&['earning','deduction'].includes(item.kind)&&recorded!==null&&decimal(recorded).n>=0n&&!lines.some(l=>l.code===item.code);
   if(!valid){issues.push('原始額外項目金額或識別無效');continue;}
   lines.push({code:item.code,kind:item.kind,status:'confirmed',exact:evidence(decimal(recorded!)),amount:recorded,recordedAmount:item.amount,sourceRefs:refs,issues:[]});
  }
 }
 const gross=amount(salary?.grossSalary),deductions=amount(salary?.totalDeductions),net=amount(salary?.netSalary);
 if(gross===null||deductions===null||net===null)issues.push('原始應發／扣項／實發合計缺漏');
 if(!issues.length){
  const earnings=sum(lines.filter(l=>l.kind==='earning').map(l=>decimal(l.amount!))),deducted=sum(lines.filter(l=>l.kind==='deduction').map(l=>decimal(l.amount!)));
  const equal=(a:ReturnType<typeof decimal>,b:string)=>{const r=decimal(b);return a.n*r.d===r.n*a.d;};
  if(!equal(earnings,gross!)||!equal(deducted,deductions!)||!equal(add(earnings,mul(deducted,rational(-1n))),net!))issues.push('原始逐項金額與鎖月合計不符，不能推定差額為零');
 }
 const source:PayrollComparisonSource={schemaVersion:'payroll-comparison-source-v1',empId,month,calculationVersion:salary?.calculationVersion||null,sourceHash:'',status:issues.length?'needs-review':'comparable',sources:refs,lines,totals:{gross,deductions,net},inventoryStatus:'historical-recorded-only',rounding:null,issues,formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'};
 source.sourceHash=evidenceHash({original,source:{...source,sourceHash:undefined}});
 return {original,source};
}
function correctionReference(value:any):HistoricalCorrectionRef {
 assertPayrollItemFields(value,['id','revision','evidenceVersion','calculatorVersion','adapterVersion']);
 if(!payrollItemIdentifier(value.id)||!Number.isSafeInteger(value.revision)||value.revision<1||!payrollItemIdentifier(value.evidenceVersion)||!payrollItemIdentifier(value.calculatorVersion)||!payrollItemIdentifier(value.adapterVersion))fail(400,'歷史更正引用無效');return {...value};
}
const originIdentity=(v:HistoricalPayrollOrigin)=>({runId:v.runId,inputHash:v.inputHash,sourceHash:v.sourceHash,runHash:v.runHash,lockHash:v.lockHash,salaryHash:v.salaryHash});
async function selectedSource(db:any,reader:any,empId:string,month:string,at:string,correctionRef?:HistoricalCorrectionRef){
 const original=await originalSource(db,reader,empId,month,at);
 if(!correctionRef)return {...original,comparisonBasis:'original-recorded-payroll' as const};
 const corrected=await loadApprovedHistoricalPayrollCorrection(db,reader,{empId,month,at,correctionRef});
 if(original.original.status!=='recorded'||original.original.completeness!=='complete'||evidenceHash(originIdentity(original.original))!==evidenceHash(corrected.original)||!validHistoricalCorrectedSource(corrected.source,corrected.binding.bundleHash))fail(409,'歷史更正與原始鎖月身份不一致');
 return {original:original.original,source:corrected.source,comparisonBasis:'corrected-historical-rate' as const,correctionRef:corrected.correctionRef,sourceAuthors:corrected.authors,correctionBinding:corrected.binding};
}
const selectedIdentity=(v:any)=>[v.original,v.source,v.comparisonBasis,v.correctionRef??null,v.sourceAuthors??null,v.correctionBinding??null];
function validate(v:any,id:string,empId:string,month:string){
 try{
  if(!v||v.schemaVersion!=='historical-payroll-difference-v1'||v.id!==id||v.empId!==empId||v.month!==month||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>MAX_REVISIONS||!Array.isArray(v.history)||v.history.length!==v.revision||Object.entries(flags).some(([k,value])=>k!=='comparisonBasis'&&v[k]!==value))throw Error();
  if(!v.original||!['recorded','unavailable'].includes(v.original.status)||!['complete','legacy-inputs-only','unavailable'].includes(v.original.completeness)||typeof v.original.lockHash!=='string'||!v.original.lockHash||v.source?.empId!==empId||v.source?.month!==month)throw Error();
  if(v.comparisonBasis==='original-recorded-payroll'){
   if(v.correctionRef!==undefined||v.sourceAuthors!==undefined||v.correctionBinding!==undefined||v.source.sourceHash!==evidenceHash({original:v.original,source:{...v.source,sourceHash:undefined}}))throw Error();
  }else if(v.comparisonBasis==='corrected-historical-rate'){
   correctionReference(v.correctionRef);const b=v.correctionBinding;
   if(v.original.status!=='recorded'||v.original.completeness!=='complete'||!b||b.scope!=='historical-corrected-rate'||!b.bundleHash||evidenceHash(b.correctionRef)!==evidenceHash(v.correctionRef)||evidenceHash(b.original)!==evidenceHash(originIdentity(v.original))||!validHistoricalCorrectedSource(v.source,b.bundleHash)||!Array.isArray(v.sourceAuthors)||!v.sourceAuthors.length||v.sourceAuthors.some((x:any)=>!payrollItemIdentity(x))||new Set(v.sourceAuthors).size!==v.sourceAuthors.length)throw Error();
  }else throw Error();
  const actual=validatePayrollDifferenceActual(v.actual),comparison=compareActual(actual,v.source);
  if(evidenceHash(actual)!==evidenceHash(v.actual)||evidenceHash(comparison)!==evidenceHash(v.comparison))throw Error();
  const authors=new Set<string>();let previous:State|null=null,last=-Infinity,p:Event|null=null,r:Event|null=null,a:Event|null=null;
  for(let i=0;i<v.history.length;i++){
   const h=v.history[i];assertPayrollItemFields(h,['actor','at','revision','to','reason','operationId']);
   if(!payrollItemIdentity(h.actor)||h.actor===empId||!payrollItemIdentifier(h.operationId)||h.revision!==i+1||typeof h.at!=='string'||!Number.isFinite(Date.parse(h.at))||Date.parse(h.at)<last)throw Error();payrollItemReason(h.reason);
   if(h.to==='proposed'){if(previous&&!['returned','reviewed','adoption-recorded'].includes(previous))throw Error();authors.add(h.actor);p=h;r=null;a=null;}
   else if(h.to==='reviewed'||h.to==='returned'){if(previous!=='proposed'||authors.has(h.actor))throw Error();r=h;}
   else if(h.to==='adoption-recorded'){if(previous!=='reviewed'||authors.has(h.actor))throw Error();a=h;}else throw Error();
   previous=h.to;last=Date.parse(h.at);
  }
  if(previous!==v.status||!p||v.proposedBy!==p.actor||v.proposedAt!==p.at)throw Error();
  if(r?(v.reviewedBy!==r.actor||v.reviewedAt!==r.at):(v.reviewedBy!==undefined||v.reviewedAt!==undefined))throw Error();
  if(a?(v.adoptedBy!==a.actor||v.adoptedAt!==a.at||v.adoptionId!==id+'_'+v.revision||v.adoptionStatus!=='recorded'):(v.adoptedBy!==undefined||v.adoptedAt!==undefined||v.adoptionId!==undefined||v.adoptionStatus!=='not-recorded'))throw Error();
  if((r&&v.sourceAuthors?.includes(r.actor))||(a&&v.sourceAuthors?.includes(a.actor)))throw Error();
  if(v.status==='reviewed'&&comparison.issues.length||v.status==='adoption-recorded'&&comparison.varianceStatus!=='zero')throw Error();
 }catch{fail(409,'歷史差額版本或來源歷程無效');}
}
const adoption=(v:HistoricalPayrollDifferenceVersion)=>({id:v.adoptionId,comparisonId:v.id,empId:v.empId,month:v.month,revision:v.revision,original:v.original,sourceHash:v.source.sourceHash,comparisonHash:evidenceHash(v.comparison),actor:v.adoptedBy,at:v.adoptedAt,reviewedBy:v.reviewedBy,...flags,...(v.correctionRef?{comparisonBasis:v.comparisonBasis,correctionRef:v.correctionRef,sourceAuthors:v.sourceAuthors,correctionBinding:v.correctionBinding}:{})});
async function chain(db:any,tx:any,current:any,id:string,empId:string,month:string){
 if(!current)return [];
 validate(current,id,empId,month);const versions:HistoricalPayrollDifferenceVersion[]=[],sourceAuthors=new Set<string>();
 for(let revision=1;revision<=current.revision;revision++){
  const v=await read(tx,db.collection('historicalPayrollDifferenceVersions').doc(id+'_'+revision));validate(v,id,empId,month);
  if(v.revision!==revision||Buffer.byteLength(JSON.stringify(v))>MAX_BYTES)fail(409,'歷史差額版本序號或容量無效');
  const prior=versions.at(-1);if(prior&&(evidenceHash(v.history.slice(0,-1))!==evidenceHash(prior.history)||v.status!=='proposed'&&evidenceHash([selectedIdentity(v),v.actual,v.comparison])!==evidenceHash([selectedIdentity(prior),prior.actual,prior.comparison])))fail(409,'歷史差額不可變來源鏈不符');
  if(v.status==='adoption-recorded'&&evidenceHash(await read(tx,db.collection('historicalPayrollDifferenceAdoptions').doc(v.adoptionId)))!==evidenceHash(adoption(v)))fail(409,'歷史差額獨立採用證據缺漏');
  for(const author of v.sourceAuthors||[])sourceAuthors.add(author);
  if(v.status!=='proposed'&&sourceAuthors.has(v.history.at(-1)!.actor))fail(409,'歷史更正作者不得覆核或採用歷史差額');
  versions.push(v);
 }
 if(evidenceHash(current)!==evidenceHash(versions.at(-1)))fail(409,'歷史差額目前版本與不可變歷程不符');return versions;
}
/** Dedicated evidence ledger: a locked month permits these annotations only.
 * No original run/lock, attendance, employee, salary or payment row is written. */
export async function handleHistoricalPayrollDifferenceAction(db:any,uid:string,action:string,data:any){
 if(!HISTORICAL_PAYROLL_DIFFERENCE_ACTIONS.includes(action as any))fail(400,'歷史差額操作無效');
 const getting=action==='get-historical-payroll-difference',proposing=action==='propose-historical-payroll-difference',reviewing=action==='review-historical-payroll-difference';
 assertPayrollItemFields(data,getting?['empId','month','correctionRef']:['empId','month','expectedRevision','operationId','reason',...(proposing?['actual','correctionRef']:reviewing?['mode']:[])]);
 const {empId,month}=data;if(!payrollItemIdentity(uid)||!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'員工月份無效');
 const requestedCorrectionRef=data.correctionRef===undefined?undefined:correctionReference(data.correctionRef);
 const id=keyFor(empId,month),at=new Date().toISOString(),col=(name:string)=>db.collection(name);
 const authorize=async(tx:any,writing:boolean)=>{const actor=await read(tx,col('employees').doc(uid));if(writing?(actor.role!==UserRole.SuperAdmin||uid===empId):(uid!==empId&&actor.role!==UserRole.SuperAdmin))fail(403,'無歷史薪資差額權限');const person=await read(tx,col('employees').doc(empId));if(person.accountKind==='system-account')fail(409,'純系統帳號不適用');return actor.role===UserRole.SuperAdmin&&uid!==empId;};
 if(getting)return db.runTransaction(async(tx:any)=>{
  const canManage=await authorize(tx,false),current=await read(tx,col('historicalPayrollDifferenceHeads').doc(id),true),versions=await chain(db,tx,current,id,empId,month);
  const fresh=canManage?await selectedSource(db,tx,empId,month,at,requestedCorrectionRef):null,visible=(v:any)=>v&&['reviewed','adoption-recorded'].includes(v.status);
  let stale=false;if(canManage&&current){try{const stored=await selectedSource(db,tx,empId,month,at,current.correctionRef);stale=evidenceHash(selectedIdentity(current))!==evidenceHash(selectedIdentity(stored));}catch{stale=true;}}
  return {empId,month,current:canManage||visible(current)?current:null,versions:canManage?versions:versions.filter(visible),source:fresh?.source||null,original:fresh?.original||null,stale,canManage,...flags,comparisonBasis:fresh?.comparisonBasis||'original-recorded-payroll',correctionRef:fresh&&'correctionRef' in fresh?fresh.correctionRef:null,sourceAuthors:fresh&&'sourceAuthors' in fresh?fresh.sourceAuthors:[]};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)fail(400,'操作識別及版本無效');
 const reason=payrollItemReason(data.reason),actual=proposing?validatePayrollDifferenceActual(data.actual):null;
 if(reviewing&&!['approve','return'].includes(data.mode))fail(400,'審核方式無效');const hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async tx=>{
  await authorize(tx,true);const receiptRef=col('historicalPayrollDifferenceCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(tx,receiptRef,true);
  const head=await read(tx,col('historicalPayrollDifferenceHeads').doc(id),true);
  if(receipt){
   if(receipt.hash!==hash||receipt.actor!==uid)fail(409,'重送內容或操作者不符');const result=receipt.result;validate(result,id,empId,month);await chain(db,tx,result,id,empId,month);await chain(db,tx,head,id,empId,month);
   const event=result.history.at(-1),expectedStatus=proposing?'proposed':reviewing?(data.mode==='approve'?'reviewed':'returned'):'adoption-recorded';
   if(!head||head.revision<result.revision||evidenceHash(head.history.slice(0,result.revision))!==evidenceHash(result.history)||result.revision!==data.expectedRevision+1||result.status!==expectedStatus||event.actor!==uid||event.operationId!==data.operationId||event.reason!==reason||event.at!==receipt.at||proposing&&evidenceHash(result.actual)!==evidenceHash(actual))fail(409,'重送結果與不可變歷程不符');return result;
  }
  if((head?.revision||0)!==data.expectedRevision)fail(409,'歷史差額版本已變更');const existingVersions=await chain(db,tx,head,id,empId,month);
  const fresh=reviewing&&data.mode==='return'?head:await selectedSource(db,tx,empId,month,at,proposing?requestedCorrectionRef:head?.correctionRef),revision=(head?.revision||0)+1;if(revision>MAX_REVISIONS)fail(409,'歷史差額技術容量已滿');
  const event=(to:State):Event=>({actor:uid,at,revision,to,reason,operationId:data.operationId});let result:HistoricalPayrollDifferenceVersion;
  if(proposing){
   if(head?.status==='proposed')fail(409,'待審提案不得覆寫');
   result={schemaVersion:'historical-payroll-difference-v1',id,empId,month,revision,status:'proposed',actual:actual!,comparison:compareActual(actual!,fresh.source),proposedBy:uid,proposedAt:at,adoptionStatus:'not-recorded',history:[...(head?.history||[]),event('proposed')],...flags,...fresh};
  }else{
   if(!head||head.history.some((h:Event)=>h.to==='proposed'&&h.actor===uid)||existingVersions.some(v=>v.sourceAuthors?.includes(uid)))fail(403,'不得覆核或採用自己曾提出的歷史差額');
   if(reviewing?head.status!=='proposed':head.status!=='reviewed')fail(409,'歷史差額狀態不符');
   if(reviewing&&data.mode==='return')result={...head,revision,status:'returned',reviewedBy:uid,reviewedAt:at,history:[...head.history,event('returned')]};
   else{
    if(evidenceHash(selectedIdentity(fresh))!==evidenceHash(selectedIdentity(head)))fail(409,'原始鎖月來源已變更，須重新提出');
    const compared=compareActual(head.actual,fresh.source);if(fresh.original.status!=='recorded'||compared.issues.length)fail(409,'原始項目或實發證據缺漏，不能核定');
    if(reviewing)result={...head,revision,status:'reviewed',reviewedBy:uid,reviewedAt:at,history:[...head.history,event('reviewed')]};
    else{if(compared.varianceStatus!=='zero')fail(409,'非零歷史差額需另核合法調整，不能採用');result={...head,revision,status:'adoption-recorded',adoptionStatus:'recorded',adoptedBy:uid,adoptedAt:at,adoptionId:id+'_'+revision,history:[...head.history,event('adoption-recorded')]};}
   }
  }
  validate(result,id,empId,month);if(Buffer.byteLength(JSON.stringify(result))>MAX_BYTES)fail(409,'歷史差額證據容量過大');
  tx.create(col('historicalPayrollDifferenceVersions').doc(id+'_'+revision),result);if(result.status==='adoption-recorded')tx.create(col('historicalPayrollDifferenceAdoptions').doc(result.adoptionId),adoption(result));
  tx.set(col('historicalPayrollDifferenceHeads').doc(id),result);tx.create(receiptRef,{actor:uid,at,hash,result});return result;
 });
}

/** A complete preserved target is required for an adjustment. Legacy numeric
 * summaries remain readable evidence but cannot become an executable target. */
export async function loadReviewedHistoricalPayrollDifferenceForAdjustment(db:any,reader:{get(ref:any):Promise<any>},args:{empId:string;month:string;at:string;comparisonRef?:{id:string;revision:number;evidenceVersion:string}}){
 const {empId,month,at}=args,id=keyFor(empId,month);
 const current=await read(reader,db.collection('historicalPayrollDifferenceHeads').doc(id),true);
 if(!current)fail(409,'需先完成歷史月份的獨立差額覆核');
 const versions=await chain(db,reader,current,id,empId,month);
 const comparisonRef=args.comparisonRef??{id,revision:current.revision,evidenceVersion:evidenceHash(current)};
 if(!['reviewed','adoption-recorded'].includes(current.status)||comparisonRef?.id!==id||comparisonRef.revision!==current.revision||comparisonRef.evidenceVersion!==evidenceHash(current))fail(409,'調整所選歷史差額版本不是目前已覆核來源');
 const fresh=await selectedSource(db,reader,empId,month,at,current.correctionRef);
 if(fresh.original.status!=='recorded'||fresh.original.completeness!=='complete'||fresh.source.status!=='comparable'||evidenceHash(selectedIdentity(fresh))!==evidenceHash(selectedIdentity(current))||compareActual(current.actual,fresh.source).issues.length)fail(409,'原始完整來源缺漏或已變更，不能由歷史總額推定調整依據');
 return {comparisonRef,source:fresh.source,actual:current.actual,binding:{scope:'historical',comparisonRef:{...comparisonRef},original:fresh.original,sourceHash:fresh.source.sourceHash,...(current.correctionRef?{correctionRef:current.correctionRef,correctionBinding:current.correctionBinding}:{} )},authors:[...new Set<string>([...current.history.filter((h:Event)=>h.to==='proposed').map((h:Event)=>h.actor),...versions.flatMap(v=>v.sourceAuthors||[])])]};
}
