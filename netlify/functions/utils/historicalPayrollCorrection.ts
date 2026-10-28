import {UserRole} from '../../../types';
import {assertPayrollItemFields,payrollItemIdentity,payrollItemIdentifier,payrollItemMonth,payrollItemReason} from '../../../utils/payroll/items';
import {evidenceHash} from './attendanceCaseLifecycle';
import {runPayrollMutation} from './monthGuard';
import {loadPayrollMonthSource} from './payrollSourceReader';
import {calculateFrozenHistoricalRateCorrection,validateHistoricalRateCorrection,validHistoricalCorrectedSource} from './frozenHistoricalPayroll';
export const HISTORICAL_PAYROLL_CORRECTION_ACTIONS=['get-historical-payroll-correction','propose-historical-payroll-correction','review-historical-payroll-correction','adopt-historical-payroll-correction'] as const;
const flags={approvalScope:'frozen-contract-rate-correction-only',formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'not-certified'} as const;
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const key=(empId:string,month:string)=>'hpc_'+evidenceHash([empId,month]);
const read=async(reader:any,ref:any,optional=false)=>{const s=await reader.get(ref);if(!s.exists){if(optional)return null;fail(409,'歷史更正不可變來源缺漏');}return s.data();};
const refFor=(v:any)=>({id:v.id,revision:v.revision,evidenceVersion:evidenceHash(v),calculatorVersion:v.assessment.calculatorVersion,adapterVersion:v.assessment.adapterVersion});
async function chain(db:any,reader:any,head:any,id:string,empId:string,month:string){
 const versions:any[]=[],authors=new Set<string>();if(!head)return {versions,authors};
 if(!Number.isSafeInteger(head.revision)||head.revision<1||head.revision>30)fail(409,'歷史更正版本容量無效');let previous:any=null,lastTime=-Infinity;
 for(let revision=1;revision<=head.revision;revision++){
  const v=await read(reader,db.collection('historicalPayrollCorrectionVersions').doc(id+'_'+revision)),h=v.history?.at(-1);
  if(v.schemaVersion!=='historical-payroll-correction-v1'||v.id!==id||v.empId!==empId||v.month!==month||v.revision!==revision||v.history?.length!==revision||!h||h.revision!==revision||h.to!==v.status||!payrollItemIdentity(h.actor)||h.actor===empId||!payrollItemIdentifier(h.operationId)||!Number.isFinite(Date.parse(h.at))||Date.parse(h.at)<lastTime||Object.entries(flags).some(([k,x])=>v[k]!==x))fail(409,'歷史更正版本或範圍無效');
  payrollItemReason(h.reason);validateHistoricalRateCorrection(v.correction,month,v.proposedAt);
  if(previous&&evidenceHash(v.history.slice(0,-1))!==evidenceHash(previous.history))fail(409,'歷史更正事件鏈不符');
  if(v.status==='proposed'){
   if(previous&&!['returned','adopted','reviewed'].includes(previous.status)||v.proposedBy!==h.actor||v.proposedAt!==h.at)fail(409,'歷史更正提案鏈無效');authors.add(h.actor);
  }else{
   const expected=v.status==='reviewed'||v.status==='returned'?'proposed':v.status==='adopted'?'reviewed':null;
   if(!previous||previous.status!==expected||authors.has(h.actor)||evidenceHash([v.correction,v.assessment,v.proposedBy,v.proposedAt])!==evidenceHash([previous.correction,previous.assessment,previous.proposedBy,previous.proposedAt]))fail(409,'歷史更正獨立覆核或凍結內容不符');
   if(v.status==='reviewed'||v.status==='returned'){if(v.reviewedBy!==h.actor||v.reviewedAt!==h.at)fail(409,'歷史更正覆核人不符');}
   if(v.status==='adopted'&&(v.adoptedBy!==h.actor||v.adoptedAt!==h.at))fail(409,'歷史更正採用人不符');
   if(v.status!=='returned'&&v.assessment?.status!=='calculated')fail(409,'未核實來源不能覆核採用');
  }
  if(!validHistoricalCorrectedSource(v.assessment?.source,v.assessment?.bundleHash)||v.assessmentHash!==evidenceHash(v.assessment)||evidenceHash(v.correction)!==evidenceHash(v.assessment?.correction)||v.assessment?.source?.empId!==empId||v.assessment?.source?.month!==month||Buffer.byteLength(JSON.stringify(v))>350000)fail(409,'歷史更正計算證據不符');
  if(v.status==='adopted'){const adoption=await read(reader,db.collection('historicalPayrollCorrectionAdoptions').doc(id+'_'+revision));if(evidenceHash(adoption)!==evidenceHash({correctionRef:refFor(v),original:v.assessment.original,actor:v.adoptedBy,at:v.adoptedAt,...flags}))fail(409,'歷史更正採用證據缺漏');}
  lastTime=Date.parse(h.at);versions.push(v);previous=v;
 }
 if(evidenceHash(head)!==evidenceHash(previous))fail(409,'歷史更正目前版本與不可變鏈不符');return {versions,authors};
}
export async function handleHistoricalPayrollCorrectionAction(db:any,uid:string,action:string,data:any){
 if(!HISTORICAL_PAYROLL_CORRECTION_ACTIONS.includes(action as any))fail(400,'歷史更正操作無效');
 const get=action==='get-historical-payroll-correction',propose=action==='propose-historical-payroll-correction',review=action==='review-historical-payroll-correction';
 assertPayrollItemFields(data,get?['empId','month']:['empId','month','expectedRevision','operationId','reason',...(propose?['correction']:review?['mode']:[])]);
 const {empId,month}=data;if(!payrollItemIdentity(uid)||!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'歷史更正範圍無效');const id=key(empId,month),at=new Date().toISOString(),col=(n:string)=>db.collection(n);
 const authorize=async(reader:any,write:boolean)=>{const actor=await read(reader,col('employees').doc(uid)),person=await read(reader,col('employees').doc(empId));const manage=actor.role===UserRole.SuperAdmin&&uid!==empId;if(write?!manage:!manage&&uid!==empId)fail(403,'無歷史更正權限');if(person.accountKind==='system-account')fail(409,'純系統帳號不適用');return manage;};
 if(get)return db.runTransaction(async(reader:any)=>{
  const canManage=await authorize(reader,false),head=await read(reader,col('historicalPayrollCorrectionHeads').doc(id),true),history=await chain(db,reader,head,id,empId,month);
  const loaded=canManage?await loadPayrollMonthSource(db,reader,{month,at}):null,complete=loaded?.kind==='locked'&&loaded.completeness==='complete';
  const employee=complete?(loaded.run.inputs.employees as any[]).find(e=>e.id===empId):null;
  let stale=false;const sourceIssues:string[]=complete?[]:['需完整原始鎖月快照；缺失歷史主檔重建不在此更正範圍'];
  if(canManage&&head){try{stale=!complete||evidenceHash(calculateFrozenHistoricalRateCorrection(loaded!,empId,head.correction,head.proposedAt))!==head.assessmentHash;}catch{stale=true;}if(stale)sourceIssues.push('原始來源或更正計算版本已變更，需退回後重新提出');}
  return {empId,month,current:canManage||head?.status==='adopted'?head:null,versions:canManage?history.versions:history.versions.filter(v=>v.status==='adopted'),canManage,original:complete?{runId:loaded.run.id,inputHash:loaded.originalInputHash,sourceHash:loaded.sourceHash,runHash:evidenceHash(loaded.run),lockHash:evidenceHash(loaded.lock)}:null,originalSourceAvailable:!!complete,sourceIssues,stale,rateTargets:canManage?(employee?.normalPayDays||[]).map((d:any)=>({date:d.date,payBasis:d.payBasis,amount:d.amount,payVersion:d.payVersion})):[],correctionRef:head?.status==='adopted'?refFor(head):null,...flags};
 });
 if(!payrollItemIdentifier(data.operationId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||review&&!['approve','return'].includes(data.mode))fail(400,'更正操作版本無效');
 const reason=payrollItemReason(data.reason),correction=propose?validateHistoricalRateCorrection(data.correction,month,at):null,hash=evidenceHash([action,data]);
 return runPayrollMutation(db,[],async reader=>{
  await authorize(reader,true);const head=await read(reader,col('historicalPayrollCorrectionHeads').doc(id),true),history=await chain(db,reader,head,id,empId,month),receiptRef=col('historicalPayrollCorrectionCommands').doc(evidenceHash([uid,data.operationId])),receipt=await read(reader,receiptRef,true);
  const to=propose?'proposed':review?(data.mode==='approve'?'reviewed':'returned'):'adopted';
  if(receipt){const result=receipt.result;if(receipt.hash!==hash||receipt.actor!==uid)fail(409,'重送內容不符');await chain(db,reader,result,id,empId,month);const h=result.history.at(-1);if(!head||result.revision!==data.expectedRevision+1||head.revision<result.revision||evidenceHash(head.history.slice(0,result.revision))!==evidenceHash(result.history)||h.actor!==uid||h.operationId!==data.operationId||h.reason!==reason||h.at!==receipt.at||result.status!==to||propose&&evidenceHash(result.correction)!==evidenceHash(correction))fail(409,'重送與不可變歷程不符');return result;}
  if((head?.revision||0)!==data.expectedRevision)fail(409,'歷史更正版本已變更');const revision=data.expectedRevision+1;if(revision>30)fail(409,'歷史更正容量已滿');let result:any;
  if(propose){if(head?.status==='proposed')fail(409,'待審更正需先退回');const loaded=await loadPayrollMonthSource(db,reader,{month,at}),assessment=calculateFrozenHistoricalRateCorrection(loaded,empId,correction,at);result={schemaVersion:'historical-payroll-correction-v1',id,empId,month,correction,assessment,assessmentHash:evidenceHash(assessment),proposedBy:uid,proposedAt:at,...flags};}
  else{
   if(!head||history.authors.has(uid))fail(403,'不得覆核或採用本人曾提出的更正');if(head.status!==(review?'proposed':'reviewed'))fail(409,'更正狀態不符');
   if(to!=='returned'){const loaded=await loadPayrollMonthSource(db,reader,{month,at}),fresh=calculateFrozenHistoricalRateCorrection(loaded,empId,head.correction,head.proposedAt);if(fresh.status!=='calculated'||evidenceHash(fresh)!==head.assessmentHash)fail(409,'原始來源、計算版本或更正證據已變更／待核實');}
   result={...head,...(review?{reviewedBy:uid,reviewedAt:at}:{adoptedBy:uid,adoptedAt:at})};
  }
  result={...result,revision,status:to,history:[...(head?.history||[]),{actor:uid,at,to,revision,reason,operationId:data.operationId}]};
  if(Buffer.byteLength(JSON.stringify(result))>350000)fail(409,'歷史更正證據容量過大');
  reader.create(col('historicalPayrollCorrectionVersions').doc(id+'_'+revision),result);reader.set(col('historicalPayrollCorrectionHeads').doc(id),result);
  if(to==='adopted')reader.create(col('historicalPayrollCorrectionAdoptions').doc(id+'_'+revision),{correctionRef:refFor(result),original:result.assessment.original,actor:uid,at,...flags});
  reader.create(receiptRef,{actor:uid,at,hash,result});return result;
 });
}
export async function loadApprovedHistoricalPayrollCorrection(db:any,reader:any,args:{empId:string;month:string;at:string;correctionRef:ReturnType<typeof refFor>}){
 const {empId,month}=args;if(!payrollItemIdentity(empId)||!payrollItemMonth(month))fail(400,'更正範圍無效');const id=key(empId,month),head=await read(reader,db.collection('historicalPayrollCorrectionHeads').doc(id),true),history=await chain(db,reader,head,id,empId,month);
 if(!head||head.status!=='adopted'||evidenceHash(args.correctionRef)!==evidenceHash(refFor(head)))fail(409,'需明示目前已獨立採用的更正版本');
 const original=await loadPayrollMonthSource(db,reader,{month,at:args.at}),fresh=calculateFrozenHistoricalRateCorrection(original,empId,head.correction,head.proposedAt);
 if(fresh.status!=='calculated'||evidenceHash(fresh)!==head.assessmentHash)fail(409,'更正原始來源或計算版本已變更');
 return {correctionRef:refFor(head),source:fresh.source,original:fresh.original,authors:[...history.authors],binding:{scope:'historical-corrected-rate',correctionRef:refFor(head),original:fresh.original,bundleHash:fresh.bundleHash},...flags};
}
