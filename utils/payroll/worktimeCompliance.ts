/** Bounded evidence assessment, not legal certification or payroll authority.
 * Caller must verify immutable source/authority records before constructing this input.
 * This pure boundary checks their scope, chronology, completeness and consistency.
 */
export type WorktimeCheckStatus='within-checked-limits'|'exceeded'|'needs-review';
export interface WorktimeCheck {id:string;status:WorktimeCheckStatus;issues:string[];actualMinutes?:number;limitMinutes?:number}
export interface WorktimeAuthority {
 purpose:'regime'|'collective-overtime'|'individual-overtime'|'rotation-applicability'|'54-cycle'|'rotation-8'|'filing-54'|'filing-rotation-8';
 empId:string;snapshotRef:string;sourceRefs:string[];proposedBy:string;reviewedBy:string;reviewedAt:string;authorityOccurredAt:string;effectiveFrom:string;effectiveTo:string;
 consentBody?:'union'|'labor-management';cycleFrom?:string;cycleTo?:string;designationRef?:string;filedOn?:string;
}
export interface WorktimeDay {
 date:string;dayType:'working'|'rest-day'|'regular-holiday'|'holiday';snapshotRef:string;sourceRefs:string[];shiftId:string;
 // Source-verified original clock-in workday. A later segment may begin after
 // midnight; it retains this day's classification and overtime counters.
 // This proves workday bounds, never a rotating shift-pattern identity.
 workdayEvidence?:{kind:'verified-clock-in-date';start:string;end:string;sourceRefs:string[]};
 segments:Array<{start:string;end:string;classification:'normal'|'overtime'|'rest-day'|'holiday-normal'|'holiday-overtime';sourceRefs:string[];compConverted?:boolean}>;
}
export interface WorktimeComplianceInput {
 empId:string;month:string;snapshotRef:string;regime:string;weekStartsOn:number;headcount:number;unionExists:boolean;
 overtimeMode?:'46'|'54-138';cycle?:{from:string;to:string};rotation:'not-rotating'|'rotating'|'unknown';rotationRest?:'11-hour'|'8-hour';exception?:'none'|string;
 authorities:WorktimeAuthority[];coverage:{from:string;to:string;snapshotRef:string;sourceRefs:string[];workdayTail?:{through:string;snapshotRef:string;sourceRefs:string[]};restBoundary?:{kind:'verified-rest';from:string;to:string;snapshotRef:string;sourceRefs:string[]}};days:WorktimeDay[];
}
const DAY=86400000;
const identifier=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,149}$/.test(v);
const date=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const refs=(v:any)=>Array.isArray(v)&&v.length>0&&v.length<=20&&v.every(identifier)&&new Set(v).size===v.length;
const iso=(n:number)=>new Date(n).toISOString().slice(0,10);
const timestamp=(v:any)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&date(v.slice(0,10))&&Number.isFinite(Date.parse(v));
const instant=(v:any)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&date(v.slice(0,10))&&Number.isFinite(Date.parse(v));
const check=(id:string,issues:string[]=[],exceeded=false):WorktimeCheck=>({id,status:issues.length?'needs-review':exceeded?'exceeded':'within-checked-limits',issues});
const keys=['normal-time','daily-total','monthly-overtime','cycle-overtime','weekly-rest','rotation-rest'];
export function evaluateWorktimeCompliance(input:unknown){
 const v=input as WorktimeComplianceInput;
 const finish=(checks:WorktimeCheck[])=>({status:checks.some(c=>c.status==='needs-review')?'needs-review' as const:checks.some(c=>c.status==='exceeded')?'exceeded' as const:'within-checked-limits' as const,checks,formalEligibility:'BLOCKED' as const,applicationStatus:'not-applied' as const,paymentStatus:'not-paid' as const});
 const unknown=(issue:string)=>finish(keys.map(id=>check(id,[issue])));
 if(!v||!identifier(v.empId)||!identifier(v.snapshotRef)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month||'')||!date(v.month+'-01'))return unknown('invalid-scope');
 if(v.regime!=='standard-8-40'||v.weekStartsOn!==0||v.exception!=='none')return unknown('unsupported-or-undeclared-regime-or-exception');
 if(!['46','54-138'].includes(v.overtimeMode||''))return unknown('unknown-overtime-mode');
 const start=Date.parse(v.month+'-01'),next=new Date(start);next.setUTCMonth(next.getUTCMonth()+1);const end=next.getTime()-DAY;
 let assessedFrom=start,assessedTo=end;
 let firstWeek=start-new Date(start).getUTCDay()*DAY,lastWeek=end+(6-new Date(end).getUTCDay())*DAY;
 let requiredFrom=firstWeek-6*DAY,requiredTo=lastWeek;
 const extended=v.overtimeMode==='54-138';
 if(extended){
  if(!date(v.cycle?.from)||!date(v.cycle?.to))return unknown('agreed-three-month-cycle-missing');
  if(!v.cycle!.from.endsWith('-01'))return unknown('mid-month-cycle-not-supported');
  const cstart=Date.parse(v.cycle!.from),boundary=new Date(cstart);const originalDay=boundary.getUTCDate();boundary.setUTCDate(1);boundary.setUTCMonth(boundary.getUTCMonth()+3);const last=new Date(Date.UTC(boundary.getUTCFullYear(),boundary.getUTCMonth()+1,0)).getUTCDate();boundary.setUTCDate(Math.min(originalDay,last));
  if(iso(boundary.getTime()-DAY)!==v.cycle!.to||cstart>start||Date.parse(v.cycle!.to)<end)return unknown('cycle-does-not-cover-month-or-is-not-three-calendar-months');
  assessedFrom=cstart;assessedTo=Date.parse(v.cycle!.to);
  firstWeek=assessedFrom-new Date(assessedFrom).getUTCDay()*DAY;lastWeek=assessedTo+(6-new Date(assessedTo).getUTCDay())*DAY;
  requiredFrom=firstWeek-6*DAY;requiredTo=lastWeek;
 }
 if(!v.coverage||!date(v.coverage.from)||!date(v.coverage.to)||Date.parse(v.coverage.from)>requiredFrom||Date.parse(v.coverage.to)<requiredTo||v.coverage.snapshotRef!==v.snapshotRef||!refs(v.coverage.sourceRefs)||!Array.isArray(v.days)||v.days.length>400)return unknown('complete-source-bound-history-required');
 const nominalCoverageEnd=Date.parse(v.coverage.to+'T00:00:00+08:00')+DAY,tail=v.coverage.workdayTail;
 if(tail!==undefined&&(!instant(tail.through)||tail.snapshotRef!==v.snapshotRef||!refs(tail.sourceRefs)||Date.parse(tail.through)<=nominalCoverageEnd||Date.parse(tail.through)>nominalCoverageEnd+DAY))return unknown('workday-tail-history-unverified');
 const coverageEnd=tail?Date.parse(tail.through):nominalCoverageEnd,authorityTo=tail?iso(coverageEnd-1+8*3600000):v.coverage.to;
 const authority=(purpose:WorktimeAuthority['purpose'])=>{
  const a=Array.isArray(v.authorities)?v.authorities.filter(a=>a?.purpose===purpose):[];
  if(a.length!==1)return null;const r=a[0];
  return r.empId===v.empId&&r.snapshotRef===v.snapshotRef&&refs(r.sourceRefs)&&identifier(r.proposedBy)&&identifier(r.reviewedBy)&&r.proposedBy!==r.reviewedBy&&r.reviewedBy!==v.empId&&timestamp(r.reviewedAt)&&timestamp(r.authorityOccurredAt)&&Date.parse(r.reviewedAt)>=Date.parse(r.authorityOccurredAt)&&date(r.effectiveFrom)&&date(r.effectiveTo)&&r.effectiveFrom<=v.coverage.from&&r.effectiveTo>=authorityTo&&Date.parse(r.authorityOccurredAt)<=Date.parse(r.effectiveFrom+'T00:00:00+08:00')?r:null;
 };
 if(!authority('regime')||!authority('collective-overtime')||!authority('individual-overtime')||typeof v.unionExists!=='boolean'||!Number.isSafeInteger(v.headcount)||v.headcount<1)return unknown('regime-overtime-authority-or-headcount-unverified');
 const body=v.unionExists?'union':'labor-management';
 if(authority('collective-overtime')!.consentBody!==body)return unknown('collective-consent-body-mismatch');
 const filing=(purpose:'filing-54'|'filing-rotation-8',implementation:string)=>{const a=authority(purpose);return !!a&&date(a.filedOn)&&a.filedOn! < implementation;};
 if(extended){const a=authority('54-cycle');if(!a||a.consentBody!==body||a.cycleFrom!==v.cycle!.from||a.cycleTo!==v.cycle!.to||v.headcount>=30&&!filing('filing-54',a.effectiveFrom))return unknown('54-cycle-consent-agreement-or-filing-unverified');}
 const coverageStart=Date.parse(v.coverage.from+'T00:00:00+08:00');
 const days=new Map<string,{day:WorktimeDay;normal:number;total:number;ot:number;start:number;end:number}>(),intervals:Array<[number,number]>=[];
 for(const d of v.days){
  if(!d||!date(d.date)||d.date<v.coverage.from||d.date>v.coverage.to||days.has(d.date)||!['working','rest-day','regular-holiday','holiday'].includes(d.dayType)||d.snapshotRef!==v.snapshotRef||!refs(d.sourceRefs)||!identifier(d.shiftId)||!Array.isArray(d.segments)||d.segments.length>100)return unknown('day-classification-source-or-uniqueness-invalid');
  const workday=d.workdayEvidence;
  if(workday!==undefined&&(workday.kind!=='verified-clock-in-date'||!instant(workday.start)||!instant(workday.end)||!refs(workday.sourceRefs)||iso(Date.parse(workday.start)+8*3600000)!==d.date||Date.parse(workday.end)<=Date.parse(workday.start)||Date.parse(workday.end)-Date.parse(workday.start)>DAY||Date.parse(workday.start)<coverageStart||Date.parse(workday.end)>coverageEnd))return unknown('verified-clock-in-workday-bounds-invalid');
  let normal=0,total=0,ot=0,first=Infinity,last=-Infinity;
  for(const s of d.segments){
   if(!s||!instant(s.start)||!instant(s.end)||!refs(s.sourceRefs)||s.compConverted!==undefined&&typeof s.compConverted!=='boolean')return unknown('unverified-work-interval');
   const a=Date.parse(s.start),b=Date.parse(s.end),minutes=(b-a)/60000;
   const attributed=workday?a>=Date.parse(workday.start)&&b<=Date.parse(workday.end):iso(a+8*3600000)===d.date;
   if(!Number.isSafeInteger(minutes)||minutes<=0||minutes>1440||!attributed||a<coverageStart||b>coverageEnd)return unknown('invalid-minute-interval-or-workdate');
   const allowed=d.dayType==='working'||d.dayType==='regular-holiday'?['normal','overtime']:d.dayType==='rest-day'?['rest-day']:['holiday-normal','holiday-overtime'];
   if(!allowed.includes(s.classification)||s.compConverted&&!['overtime','rest-day','holiday-overtime'].includes(s.classification))return unknown('work-classification-mismatch');
   total+=minutes;if(s.classification==='normal'||s.classification==='holiday-normal')normal+=minutes;else ot+=minutes;
   first=Math.min(first,a);last=Math.max(last,b);intervals.push([a,b]);
  }
  if(d.dayType==='holiday'&&normal>480)return unknown('holiday-normal-over-eight-hours-needs-reclassification');
  days.set(d.date,{day:d,normal,total,ot,start:first,end:last});
 }
 for(let n=Date.parse(v.coverage.from);n<=Date.parse(v.coverage.to);n+=DAY)if(!days.has(iso(n)))return unknown('history-date-missing-not-zero');
 intervals.sort((a,b)=>a[0]-b[0]);if(intervals.some((s,i)=>i>0&&s[0]<intervals[i-1][1]))return unknown('overlapping-work-intervals');
 const selected=[...days.values()].filter(d=>d.day.date>=v.month+'-01'&&d.day.date<=iso(end));
 const assessed=[...days.values()].filter(d=>d.day.date>=iso(firstWeek)&&d.day.date<=iso(lastWeek));
 let normalExceeded=assessed.some(d=>(d.day.dayType==='working'||d.day.dayType==='regular-holiday')&&d.normal>480),restExceeded=false;
 for(let n=firstWeek;n<=lastWeek;n+=7*DAY){const week=Array.from({length:7},(_,i)=>days.get(iso(n+i*DAY))!);if(week.reduce((sum,d)=>sum+(d.day.dayType==='working'?d.normal:0),0)>2400)normalExceeded=true;if(week.filter(d=>d.day.dayType==='regular-holiday').length<1||week.filter(d=>d.day.dayType==='rest-day').length<1)restExceeded=true;}
 let run=0;for(let n=Date.parse(v.coverage.from);n<=Date.parse(v.coverage.to);n+=DAY){const d=days.get(iso(n))!;run=d.total>0?run+1:0;if(d.day.date>=iso(firstWeek)&&d.day.date<=iso(lastWeek)&&(run>6||d.day.dayType==='regular-holiday'&&d.total>0))restExceeded=true;}
 const monthly=selected.reduce((sum,d)=>sum+d.ot,0),monthlyLimit=extended?3240:2760;
 const monthlyCheck:WorktimeCheck=normalExceeded?check('monthly-overtime',['normal-classification-excess-overtime-total-untrusted']):{...check('monthly-overtime',[],monthly>monthlyLimit),actualMinutes:monthly,limitMinutes:monthlyLimit};
 const cycleMinutes=extended?[...days.values()].filter(d=>d.day.date>=v.cycle!.from&&d.day.date<=v.cycle!.to).reduce((sum,d)=>sum+d.ot,0):0;
 const cycleMonthTotals=new Map<string,number>();if(extended)for(const d of days.values()){if(d.day.date>=v.cycle!.from&&d.day.date<=v.cycle!.to){const m=d.day.date.slice(0,7);cycleMonthTotals.set(m,(cycleMonthTotals.get(m)||0)+d.ot);}}
 const cycleCheck:WorktimeCheck=normalExceeded?check('cycle-overtime',['normal-classification-excess-overtime-total-untrusted']):extended?{...check('cycle-overtime',[],cycleMinutes>8280||[...cycleMonthTotals.values()].some(n=>n>3240)),actualMinutes:cycleMinutes,limitMinutes:8280}:check('cycle-overtime');
 let rotationCheck=check('rotation-rest');
 if(!authority('rotation-applicability')||!['rotating','not-rotating'].includes(v.rotation)||v.rotationRest!==undefined&&!['11-hour','8-hour'].includes(v.rotationRest))rotationCheck=check('rotation-rest',['rotation-applicability-unverified']);
 else if(v.rotation==='rotating'){
  const boundary=v.coverage.restBoundary;
  const boundaryVerified=boundary?.kind==='verified-rest'&&boundary.snapshotRef===v.snapshotRef&&refs(boundary.sourceRefs)&&instant(boundary.from)&&instant(boundary.to)&&Date.parse(boundary.to)===coverageStart&&Date.parse(boundary.to)-Date.parse(boundary.from)>=660*60000;
  if(!boundaryVerified)rotationCheck=check('rotation-rest',['prior-shift-or-rest-boundary-unverified']);
  let limit=660;if(v.rotationRest==='8-hour'){const a=authority('rotation-8');if(!a||!identifier(a.designationRef)||a.consentBody!==body||v.headcount>=30&&!filing('filing-rotation-8',a.effectiveFrom))rotationCheck=check('rotation-rest',['eight-hour-exception-authority-unverified']);else limit=480;}
  if(rotationCheck.status!=='needs-review'){const worked=[...days.values()].filter(d=>d.total>0).sort((a,b)=>a.start-b.start);let bad=false;for(let i=1;i<worked.length;i++){const d=worked[i],previous=worked[i-1];if(d.day.date>=iso(assessedFrom)&&d.day.date<=iso(assessedTo)&&previous.day.shiftId!==d.day.shiftId&&(d.start-previous.end)/60000<limit)bad=true;}rotationCheck={...check('rotation-rest',[],bad),limitMinutes:limit};}
 }
 return finish([check('normal-time',[],normalExceeded),check('daily-total',[],assessed.some(d=>d.total>720)),monthlyCheck,cycleCheck,check('weekly-rest',[],restExceeded),rotationCheck]);
}
