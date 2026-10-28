import {taipeiDate,unionIntervals,intervalMinutes} from '../../../utils/attendance';
import {evidenceHash} from './attendanceCaseLifecycle';
const date=(m:number)=>taipeiDate(new Date(m*60000));
const instant=(m:number)=>new Date(m*60000).toISOString().replace('.000Z','Z');
export function selectedCreditSegments(s:any,minutes:number){
 const ranges=unionIntervals(s.ot.approvedIntervals||[]);let remaining=minutes;const segments:any[]=[];
 if(!Number.isSafeInteger(minutes)||minutes<=0||intervalMinutes(ranges)<minutes)throw Object.assign(new Error('取得分鐘超出核准區間'),{statusCode:409});
 const approvedDates=new Set<string>();for(const r of ranges)for(let start=r.start;start<r.end;){const d=date(start),end=Math.min(r.end,Date.parse(d+'T00:00:00+08:00')/60000+1440);approvedDates.add(d);start=end;}
 for(const r of ranges){let start=r.start;while(start<r.end&&remaining>0){const d=date(start),end=Math.min(r.end,start+remaining,Date.parse(d+'T00:00:00+08:00')/60000+1440),day=s.eligibility?.dayEvidence?.[d]||(approvedDates.size===1?s.eligibility:null),b=day?.originalWageBasis;
   const basis=b?.status==='confirmed'&&b.originalDate===d&&Number.isFinite(b.rate)&&b.rate>0&&Array.isArray(b.tiers)&&b.tiers.length&&b.version&&b.reviewedBy&&Number.isFinite(Date.parse(b.reviewedAt))?b:{status:'pending-payroll',originalDate:d,rate:null,tiers:null,sourceEvidence:b||null};
   const eligible=!!day&&['normal','rest'].includes(day.dayType)&&Number.isSafeInteger(day.eligibleMinutes)&&day.eligibleMinutes>=end-start;
   segments.push({start,end,minutes:end-start,sourceClaimId:evidenceHash([s.root,start,end]),workStart:start,startDate:instant(start),endDate:instant(end),approvedIntervals:[{start,end}],dayType:eligible?day.dayType:'unverified',dayAttribution:'calendar-source-date-not-statutory-classification',eligible,originalWageBasis:basis});remaining-=end-start;start=end;
  }if(!remaining)break;
 }
 // Multiple segments on the same date share one reviewed daily eligibility allowance.
 for(const d of new Set(segments.map(x=>date(x.start)))){const day=s.eligibility?.dayEvidence?.[d]||(approvedDates.size===1?s.eligibility:null);if(!day||segments.filter(x=>date(x.start)===d).reduce((n,x)=>n+x.minutes,0)>day.eligibleMinutes)for(const x of segments.filter(x=>date(x.start)===d))x.eligible=false;}
 return segments;
}
