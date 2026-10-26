import {clockInterval,clockSourceKey,confirmedWork,unionIntervals,validDate} from '../../../utils/attendance';
import {evaluateWorktimeCompliance,type WorktimeComplianceInput,type WorktimeDay,type WorktimeAuthority} from '../../../utils/payroll/worktimeCompliance';
import {loadWorktimeDeclarationEvidence,type WorktimeDeclarationVersion} from './worktimeDeclarations';
import {loadPayrollMonthSource,type PayrollSourceReader,type PayrollMonthSource} from './payrollSourceReader';
import {evidenceHash} from './attendanceCaseLifecycle';

const DAY=86400000,shift=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const last=(m:string)=>{const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return new Date(d.getTime()-DAY).toISOString().slice(0,10);};
const startMinute=(d:string)=>Date.parse(d+'T00:00:00+08:00')/60000;
const ref=(kind:string,value:unknown)=>kind+':'+evidenceHash(value);
const interval=(r:any)=>r&&Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.end>r.start;
const equalUnion=(a:any[],b:any[])=>evidenceHash(unionIntervals(a))===evidenceHash(unionIntervals(b));
export interface WorktimeSourceEvidence {
 schemaVersion:'worktime-source-evidence-v1';empId:string;month:string;sourceHash:string;
 status:'within-checked-limits'|'exceeded'|'needs-review';issues:string[];
 declarationSource:{id:string;revision:number;evidenceVersion:string}|null;
 monthSources:Array<{month:string;kind:'live'|'locked';sourceHash:string}>;
 input:WorktimeComplianceInput|null;compliance:ReturnType<typeof evaluateWorktimeCompliance>;
 workRules:{status:'recorded-applicable'|'needs-review';issues:string[];sourceRefs:string[]};
 formalEligibility:'BLOCKED';applicationStatus:'not-applied';paymentStatus:'not-paid';
}
function historyWindow(v:WorktimeDeclarationVersion){
 const d=v.declaration;let from=v.month+'-01',to=last(v.month);
 if(d.overtimeMode==='54-138'){
  if(!d.cycle||!validDate(d.cycle.from)||!validDate(d.cycle.to)||!d.cycle.from.endsWith('-01'))throw Error('agreed-three-month-cycle-required');
  const end=new Date(d.cycle.from+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+3);
  if(shift(end.toISOString().slice(0,10),-1)!==d.cycle.to||d.cycle.from>from||d.cycle.to<to)throw Error('agreed-cycle-scope-invalid');
  from=d.cycle.from;to=d.cycle.to;
 }
 from=shift(from,-new Date(from+'T00:00:00Z').getUTCDay()-6);to=shift(to,6-new Date(to+'T00:00:00Z').getUTCDay());
 return {from,to};
}
function rulesEvidence(v:WorktimeDeclarationVersion|null,from:string,to:string):WorktimeSourceEvidence['workRules']{
 const w=v?.declaration.workRules,issues:string[]=[];
 if(!v||v.status!=='approved'||!w||w.status!=='recorded'||w.basis==='unresolved')issues.push('effective-work-rules-evidence-missing');
 else{
  if(w.documentState!=='effective')issues.push('work-rules-not-effective');
  if(!w.effectiveFrom||!w.effectiveTo||w.effectiveFrom>from||w.effectiveTo<to)issues.push('work-rules-do-not-cover-history');
  if(!w.authorityOccurredAt||!w.effectiveFrom||Date.parse(w.authorityOccurredAt)>Date.parse(w.effectiveFrom+'T00:00:00+08:00'))issues.push('work-rules-authority-not-timely');
  if(v.declaration.headcount===null||w.basis==='below-30-recorded-terms'&&v.declaration.headcount>=30)issues.push('work-rules-headcount-basis-unverified');
  if(w.basis==='filed-rules'&&(!w.filingRef||!w.publicationRef))issues.push('work-rules-filing-publication-missing');
 }
 return {status:issues.length?'needs-review':'recorded-applicable',issues,sourceRefs:w?.sourceRefs||[]};
}
/** Explicit transaction reader only; never loads a formal-wrapper or D workflow.
 * Maximum five canonical month reads (three-month cycle plus boundary history).
 * Day absence is never a rest-day designation: every date needs an approved
 * active master/calendar and a current complete attendance inventory/scan.
 * Rotating shift patterns and partial employment need additional source types;
 * this adapter never manufactures those identities or predecessor rest proof. */
export async function loadWorktimeSourceEvidence(db:any,reader:PayrollSourceReader,args:{empId:string;month:string;at:string},deps:{loadMonth?:(month:string)=>Promise<PayrollMonthSource>}={}):Promise<WorktimeSourceEvidence>{
 const {empId,month,at}=args,issues:string[]=[],monthSources:WorktimeSourceEvidence['monthSources']=[];
 let approved:WorktimeDeclarationVersion|null=null,declarationSource:WorktimeSourceEvidence['declarationSource']=null,input:WorktimeComplianceInput|null=null;
 let from=month+'-01',to=validDate(from)?last(month):from,rulesTo=to;
 try{
  if(!reader||typeof reader.get!=='function'||typeof empId!=='string'||!empId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!validDate(from)||typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('invalid-worktime-source-scope');
  const declaration=await loadWorktimeDeclarationEvidence(db,reader,empId,month);approved=declaration.approved;declarationSource=declaration.source;
  if(!approved)throw Error('worktime-declaration-not-independently-approved');
  const d=approved.declaration;
  if(d.regime!=='standard-8-40'||d.weekStartsOn!==0||d.exception!=='none'||!['46','54-138'].includes(d.overtimeMode))throw Error('unsupported-or-unverified-worktime-regime');
  ({from,to}=historyWindow(approved));rulesTo=to;
  // Load physical tail sources as well, but do not fabricate a next-day workday
  // or count those minutes twice. The tail is attributed to the original date.
  const physicalTo=shift(to,1),months:string[]=[];for(let date=from.slice(0,7)+'-01';date<=physicalTo;){months.push(date.slice(0,7));const n=new Date(date+'T00:00:00Z');n.setUTCMonth(n.getUTCMonth()+1);date=n.toISOString().slice(0,10);if(months.length>5)throw Error('worktime-history-capacity-exceeded');}
  const days:WorktimeDay[]=[],physicalDays=new Set<string>();let tailThrough=startMinute(to)+1440;
  for(const historyMonth of months){
   // Optional dependency is a trusted request/transaction-scoped cache only.
   // Never share it across transactions, requests, or source revisions.
   const source=await (deps.loadMonth?deps.loadMonth(historyMonth):loadPayrollMonthSource(db,reader,{month:historyMonth,at}));
   if(source.kind==='legacy-locked'||source.kind==='locked'&&source.completeness!=='complete')throw Error('complete-historical-payroll-source-unavailable:'+historyMonth);
   const sourceHash=source.sourceHash;if(!sourceHash)throw Error('historical-source-identity-missing:'+historyMonth);
   const snapshot=source.kind==='live'?source.snapshotInputs:source.run.inputs;
   const evidence=source.kind==='live'?source.sourceEvidence:(source.run as any).sourceEvidence;
   const salaries=source.kind==='live'?source.evaluation.salaries:source.salaries;
   const employees=(snapshot.employees as any[]).filter(e=>e.id===empId),salary=salaries.find(s=>s.empId===empId),e=employees[0],proof=evidence?.attendanceMonthEvidence?.[empId];
   if(employees.length!==1||!e.effectiveMasterVersion||e.masterAssessment?.status!=='confirmed'||!Array.isArray(e.normalPayDays))throw Error('authoritative-active-employment-history-missing:'+historyMonth);
   if(!proof||proof.empId!==empId||proof.month!==historyMonth||proof.inventory!=='complete'||proof.scan!=='current'||!Array.isArray(proof.findings)||proof.findings.length||!Array.isArray(proof.unknowns)||proof.unknowns.length||!Array.isArray(proof.missingCaseIds)||proof.missingCaseIds.length||!Array.isArray(proof.missingDetectorInputs)||proof.missingDetectorInputs.length)throw Error('attendance-history-not-complete-and-current:'+historyMonth);
   const preview=salary?.normalPayPreview,ot=preview?.overtimePreview;
   // Tax, insurance and net-pay readiness are deliberately not prerequisites.
   // Existing classification may retain compliance findings for this evaluator;
   // source/classification issues still cannot be counted as zero minutes.
   if(!preview||preview.employeeId!==empId||preview.month!==historyMonth||preview.status!=='ready'||preview.issues.length||!ot||!Array.isArray(ot.lines)||!Array.isArray(ot.blocking)||ot.blocking.length||!Array.isArray(ot.issues)||ot.issues.length)throw Error('verified-actual-classification-unavailable:'+historyMonth);
   // Wage liability remains calculable when legal authorisation is unresolved.
   // Numeric actual-work checks must not erase holiday consent or statutory
   // personal-leave compliance findings retained by the existing producer.
   if(!Array.isArray(ot.complianceIssues))throw Error('overtime-compliance-inventory-unavailable:'+historyMonth);
   issues.push(...ot.complianceIssues.map(issue=>'existing-overtime-compliance:'+issue));
   const cards=(snapshot.records as any[]).filter(c=>c.empId===empId),cardMap=new Map(cards.map(c=>[c.id,c]));
   if(cardMap.size!==cards.length||cards.some(c=>!validDate(c.date)))throw Error('ambiguous-work-history:'+historyMonth);
   const dayMap=new Map<string,any>();for(const day of e.normalPayDays){if(!validDate(day.date)||dayMap.has(day.date))throw Error('duplicate-or-malformed-master-day');dayMap.set(day.date,day);}
   const tailDay=dayMap.get(physicalTo);if(tailDay?.employmentState==='active'&&tailDay.policy?.status==='approved'&&tailDay.policy?.workRegime==='standard-8-40')physicalDays.add(physicalTo);
   monthSources.push({month:historyMonth,kind:source.kind,sourceHash});
   for(let date=historyMonth+'-01';date<=last(historyMonth);date=shift(date,1)){
    if(date<from||date>to)continue;const day=dayMap.get(date);
    if(!day||day.employmentState!=='active'||!['normal','rest','regular-holiday','national-holiday'].includes(day.dayType)||day.policy?.status!=='approved'||day.policy?.workRegime!=='standard-8-40')throw Error('partial-employment-or-day-classification-unsupported:'+date);
    const actual:Array<{start:number;end:number}>=[],cardSpans:Array<{start:number;end:number}>=[],workdayRefs:string[]=[];
    for(const c of cards.filter(c=>c.date===date)){
     const work=confirmedWork(c),clock=clockInterval(c);
     if(work===null||!clock)throw Error('unverified-work-history:'+date);
     if(work.length){cardSpans.push({start:startMinute(date)+clock.start,end:startMinute(date)+clock.end});workdayRefs.push(ref('clock-workday',[c.id,clockSourceKey(c),c.workReview,clock]));}
     for(const w of work)actual.push({start:startMinute(date)+w.start,end:startMinute(date)+w.end});
    }
    const workdayStart=cardSpans.length?Math.min(...cardSpans.map(s=>s.start)):null,workdayEnd=cardSpans.length?Math.max(...cardSpans.map(s=>s.end)):null;
    if(workdayStart!==null&&(workdayStart<startMinute(date)||workdayStart>=startMinute(date)+1440||workdayEnd!-workdayStart>1440||workdayEnd!>startMinute(physicalTo)+1440))throw Error('verified-clock-in-workday-bounds-incomplete:'+date);
    if(workdayEnd!==null)tailThrough=Math.max(tailThrough,workdayEnd);
    const lines=ot.lines.filter(l=>l.date===date&&!(l.kind==='monthly-holiday-additional-day'&&l.start===l.end)).sort((a,b)=>a.start-b.start||a.end-b.end);
    const shifts=new Set(lines.map(l=>l.workdayId));if(shifts.size>1)throw Error('multiple-daily-workday-identities-unsupported:'+date);
    const segments:WorktimeDay['segments']=[];let holidayMinutes=0;
    for(const l of lines){
     if(!interval(l)||workdayStart===null||workdayEnd===null||l.start<workdayStart||l.end>workdayEnd||!Array.isArray(l.sourceIds)||!l.sourceIds.length||l.sourceIds.length!==l.sourceVersions?.length)throw Error('invalid-classified-work-interval:'+date);
     for(let i=0;i<l.sourceIds.length;i++){const c=cardMap.get(l.sourceIds[i]),work=c&&confirmedWork(c);if(!c||!work||c.date!==date||clockSourceKey(c)!==l.sourceVersions[i]||!equalUnion([{start:l.start,end:l.end}],unionIntervals(work.map(w=>({start:startMinute(c.date)+w.start,end:startMinute(c.date)+w.end}))).filter(w=>w.start<l.end&&w.end>l.start).map(w=>({start:Math.max(w.start,l.start),end:Math.min(w.end,l.end)}))))throw Error('classified-work-source-mismatch:'+date);}
     const sourceRefs=l.sourceIds.map((id,i)=>ref('card',[id,l.sourceVersions[i]]));
     if(day.dayType==='national-holiday'&&l.kind==='holiday-work'){
      // The producer distinguishes the paid multiplier, but uses holiday-work
      // for both bands. Count verified actual minutes once, retaining breaks;
      // the first 480 are holiday normal time, subsequent minutes overtime.
      const normalMinutes=Math.min(l.end-l.start,Math.max(0,480-holidayMinutes));
      if(normalMinutes)segments.push({start:new Date(l.start*60000).toISOString(),end:new Date((l.start+normalMinutes)*60000).toISOString(),classification:'holiday-normal',sourceRefs});
      if(l.end-l.start>normalMinutes)segments.push({start:new Date((l.start+normalMinutes)*60000).toISOString(),end:new Date(l.end*60000).toISOString(),classification:'holiday-overtime',sourceRefs});
      holidayMinutes+=l.end-l.start;continue;
     }
     let classification:WorktimeDay['segments'][number]['classification'];
     if(day.dayType==='normal'&&l.kind==='normal-paid-separately')classification='normal';
     else if(day.dayType==='normal'&&['weekday-overtime','comp-converted'].includes(l.kind))classification='overtime';
     else if(day.dayType==='rest'&&['rest-day-additional','comp-converted'].includes(l.kind))classification='rest-day';
     else throw Error('holiday-or-special-classification-unsupported:'+date);
     segments.push({start:new Date(l.start*60000).toISOString(),end:new Date(l.end*60000).toISOString(),classification,sourceRefs,...(l.kind==='comp-converted'?{compConverted:true}:{})});
    }
    if(!equalUnion(actual,lines.map(l=>({start:l.start,end:l.end}))))throw Error('classified-history-does-not-cover-actual:'+date);
    const dayType=({normal:'working',rest:'rest-day','regular-holiday':'regular-holiday','national-holiday':'holiday'} as const)[day.dayType as 'normal'|'rest'|'regular-holiday'|'national-holiday'];
    // This is a workday identity only. It is NEVER used as a rotation pattern.
    days.push({date,dayType,snapshotRef:'pending',sourceRefs:[ref('master-day',[sourceHash,day]),ref('attendance-scan',[sourceHash,proof.observationDigest])],shiftId:ref('workday',[empId,date,[...shifts]]),segments,
     ...(workdayStart!==null&&workdayEnd!==null?{workdayEvidence:{kind:'verified-clock-in-date' as const,start:new Date(workdayStart*60000).toISOString(),end:new Date(workdayEnd*60000).toISOString(),sourceRefs:workdayRefs}}:{})});
   }
  }
  const hasTail=tailThrough>startMinute(to)+1440;
  if(hasTail&&!physicalDays.has(physicalTo))throw Error('physical-workday-tail-employment-source-missing');
  if(hasTail)rulesTo=physicalTo;else rulesTo=to;
  const snapshotRef=ref('worktime-history',[declarationSource,monthSources,from,to,tailThrough,days]);
  const authorities:WorktimeAuthority[]=d.authorities.map(a=>{const {reason,...authority}=a;return {...authority,empId,snapshotRef,proposedBy:approved!.proposedBy,reviewedBy:approved!.recordApprovedBy!,reviewedAt:approved!.recordApprovedAt!};});
  input={empId,month,snapshotRef,regime:d.regime,weekStartsOn:d.weekStartsOn!,headcount:d.headcount as number,unionExists:d.unionExists as boolean,overtimeMode:d.overtimeMode as '46'|'54-138',...(d.cycle?{cycle:d.cycle}:{}),rotation:d.rotation,...(d.rotationRest==='unknown'?{}:{rotationRest:d.rotationRest}),exception:d.exception,authorities,coverage:{from,to,snapshotRef,sourceRefs:[ref('declaration',declarationSource),...monthSources.map(s=>ref('month',s))],...(hasTail?{workdayTail:{through:new Date(tailThrough*60000).toISOString(),snapshotRef,sourceRefs:[ref('physical-tail',[physicalTo,monthSources,tailThrough])]}}:{})},days:days.map(day=>({...day,snapshotRef}))};
 }catch(error:any){issues.push(typeof error?.message==='string'&&/^[a-z][a-z0-9:-]+$/.test(error.message)?error.message:'worktime-history-source-unavailable');}
 let compliance=evaluateWorktimeCompliance(input);
 if(issues.length)compliance={...compliance,status:'needs-review',checks:compliance.checks.map(c=>({...c,status:'needs-review',issues:[...new Set([...c.issues,...issues])]}))};
 else if(approved?.declaration.rotation==='rotating'){
  const missing='approved-rotation-shift-pattern-and-prior-rest-source-unavailable';issues.push(missing);
  compliance={...compliance,status:'needs-review',checks:compliance.checks.map(c=>c.id==='rotation-rest'?{...c,status:'needs-review',issues:[...new Set([...c.issues,missing])]}:c)};
 }
 const result={schemaVersion:'worktime-source-evidence-v1' as const,empId,month,status:compliance.status,issues,declarationSource,monthSources,input,compliance,workRules:rulesEvidence(approved,from,rulesTo),formalEligibility:'BLOCKED' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const};
 return {...result,sourceHash:evidenceHash(result)};
}
