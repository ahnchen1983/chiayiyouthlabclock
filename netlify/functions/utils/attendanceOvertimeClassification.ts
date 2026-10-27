import {clockSourceKey,confirmedWork,unionIntervals,validDate} from '../../../utils/attendance';
import {normalPayPreview} from './normalPayPreview';
import {validLeaveAllocations} from './payroll';
import {evidenceHash} from './attendanceCaseLifecycle';

interface Range {start:number;end:number}
interface ClassifiedRange extends Range {sourceIds:string[];sourceVersions:string[]}
/** Trusted internal proof of existing-model interval classification only.
 * Not an overtime request approval, statutory-limit clearance or pay authority. */
export interface AttendanceOvertimeClassification {
 schemaVersion:'attendance-overtime-classification-v1';empId:string;month:string;
 scope:'existing-model-work-classification';formalEligibility:'BLOCKED';
 status:'classified'|'unknown';recordDigest:string;sourceDigest:string;
 ranges:ClassifiedRange[];issues:string[];evidenceVersion:string;
}
const midnight=(d:string)=>Date.parse(d+'T00:00:00+08:00')/60000;
const span=(r:any):r is Range=>r&&Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.end>r.start;
const recordsDigest=(empId:string,records:any[])=>evidenceHash(records.filter(r=>r?.empId===empId).map(r=>[r.id,r]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
const version=(proof:Omit<AttendanceOvertimeClassification,'evidenceVersion'>)=>evidenceHash(proof);
const covered=(range:Range,ranges:Range[])=>unionIntervals(ranges.filter(r=>r.start<range.end&&r.end>range.start).map(r=>({start:Math.max(r.start,range.start),end:Math.min(r.end,range.end)}))).reduce((n,r)=>n+r.end-r.start,0)===range.end-range.start;

/** Pure server adapter. Call with the effective-master loader result and full
 * source inventories, never a client preview or an approved-overtime boolean. */
export function buildAttendanceOvertimeClassification(employee:any,month:string,records:any[],leaves:any[]):AttendanceOvertimeClassification {
 const empId=employee.id,issues:string[]=[],ranges:ClassifiedRange[]=[];
 let recordDigest='',sourceDigest='';
 try{
  if(!Array.isArray(records)||!Array.isArray(leaves)||typeof empId!=='string'||!empId||!validDate(month+'-01'))throw Error();
  recordDigest=recordsDigest(empId,records);
  sourceDigest=evidenceHash({empId,month,recordDigest,leaves:leaves.filter(l=>l?.empId===empId),
   masterAssessment:employee.masterAssessment,effectiveMasterVersion:employee.effectiveMasterVersion,employmentAuthority:employee.employmentAuthority,
   normalPayDays:employee.normalPayDays,normalPayContextDays:employee.normalPayContextDays,normalPayCompEvidence:employee.normalPayCompEvidence});
  const preview=normalPayPreview(employee,month,records,leaves,validLeaveAllocations),ot=preview.overtimePreview;
  if(preview.status!=='ready'||preview.issues.length||preview.combined?.status!=='ready'||preview.combined.issues.length||ot?.status!=='candidate'||
   !Array.isArray(ot.blocking)||ot.blocking.length||!Array.isArray(ot.issues)||ot.issues.length||!Array.isArray(ot.complianceIssues)||ot.complianceIssues.length||!ot.monthExact)issues.push('既有正常／加班分類來源、跨月完整性或已實作法遵仍待核實');
  if(!issues.length){
   const cards=records.filter(r=>r.empId===empId),byId=new Map(cards.map(r=>[r.id,r]));
   if(byId.size!==cards.length)throw Error();
   for(const line of ot!.lines){
    // The whole-day monthly holiday addition carries money but no work span.
    if(line.kind==='monthly-holiday-additional-day'&&line.start===line.end)continue;
    if(!span(line)||!['normal-paid-separately','weekday-overtime','rest-day-additional','holiday-work','comp-converted'].includes(line.kind)||
     !Array.isArray(line.sourceIds)||!line.sourceIds.length||!Array.isArray(line.sourceVersions)||line.sourceIds.length!==line.sourceVersions.length)throw Error();
    for(let i=0;i<line.sourceIds.length;i++){
     const card=byId.get(line.sourceIds[i]),work=card&&confirmedWork(card);
     if(!card||!validDate(card.date)||!work||line.sourceVersions[i]!==clockSourceKey(card)||!covered(line,work.map(w=>({start:midnight(card.date)+w.start,end:midnight(card.date)+w.end}))))throw Error();
    }
    ranges.push({start:line.start,end:line.end,sourceIds:[...line.sourceIds],sourceVersions:[...line.sourceVersions]});
   }
  }
 }catch{issues.push('既有加班分類來源格式或逐段來源核對失敗');}
 const proof:Omit<AttendanceOvertimeClassification,'evidenceVersion'>={schemaVersion:'attendance-overtime-classification-v1',empId,month,
  scope:'existing-model-work-classification',formalEligibility:'BLOCKED',status:issues.length?'unknown':'classified',recordDigest,sourceDigest,
  ranges:issues.length?[]:ranges.sort((a,b)=>a.start-b.start||a.end-b.end),issues};
 return {...proof,evidenceVersion:version(proof)};
}

/** Consumer checks current card versions and exact calendar-day union. Missing
 * previous-month workday tails remain unknown; no interval is silently clipped
 * away to make an incomplete proof fit the current detector observation. */
export function attendanceDayHasClassification(proof:AttendanceOvertimeClassification|undefined,empId:string,month:string,date:string,records:any[],actual:Range[]):boolean {
 try{
  if(!proof||proof.schemaVersion!=='attendance-overtime-classification-v1'||proof.empId!==empId||proof.month!==month||proof.scope!=='existing-model-work-classification'||proof.formalEligibility!=='BLOCKED'||proof.status!=='classified'||!Array.isArray(proof.issues)||proof.issues.length||!proof.sourceDigest||!Array.isArray(proof.ranges)||!validDate(date)||date.slice(0,7)!==month)return false;
  const {evidenceVersion,...content}=proof;if(evidenceVersion!==version(content)||proof.recordDigest!==recordsDigest(empId,records))return false;
  const start=midnight(date),end=start+1440;
  if(!actual.length||actual.some(r=>!span(r)||r.start<start||r.end>end)||proof.ranges.some(r=>!span(r)))return false;
  const classified=proof.ranges.filter(r=>r.start<end&&r.end>start).map(r=>({start:Math.max(start,r.start),end:Math.min(end,r.end)}));
  return evidenceHash(unionIntervals(actual))===evidenceHash(unionIntervals(classified));
 }catch{return false;}
}
