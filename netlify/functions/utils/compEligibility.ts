import {calculateOvertime} from '../../../utils/payroll/overtime';
import {confirmedWork,taipeiDate} from '../../../utils/attendance';
import {effectiveMasterForMonth} from './effectiveMaster';
import {evidenceHash} from './attendanceCaseLifecycle';
/** Derives comp-time eligibility for an approved overtime request from the same
 * sources payroll uses (effective master, approved day-type calendar, reviewed
 * cards), replacing a hand-written compSourceReviews document. LSA Art.32-1 only
 * covers weekday overtime and rest-day work, so national/regular holiday work is
 * never eligible. Each eligible minute keeps its original hourly basis and
 * multiplier, which Art.32-1 para 2 requires for paying out untaken hours.
 * Returns null when the employee has no effective master (legacy review path).
 */
const ELIGIBLE=['weekday-overtime','rest-day-additional'];
const midnight=(d:string)=>Date.parse(d+'T00:00:00+08:00')/60000;
export async function deriveCompEligibility(db:any,tx:any,empId:string,ot:any,version:string){
 const ranges=(ot.approvedIntervals||[]).filter((r:any)=>Number.isSafeInteger(r?.start)&&Number.isSafeInteger(r?.end)&&r.end>r.start);if(!ranges.length)return null;
 const head=await tx.get(db.collection('payrollMasterHeads').doc(empId));if(!head.exists)return null;
 const empSnap=await tx.get(db.collection('employees').doc(empId));if(!empSnap.exists)return null;const employee={...empSnap.data(),id:empId};
 const cards=(await tx.get(db.collection('clockRecords').where('empId','==',empId).limit(501))).docs.map((d:any)=>({...d.data(),id:d.id}));
 const dates=[...new Set(ranges.flatMap((r:any)=>[taipeiDate(new Date(r.start*60000)),taipeiDate(new Date((r.end-1)*60000))]))].sort() as string[];
 const months=new Map<string,any>(),dayEvidence:Record<string,any>={};
 for(const date of dates){
  const m=date.slice(0,7);if(!months.has(m))months.set(m,await effectiveMasterForMonth(db,tx,employee,m,{masterVersionId:head.data().currentVersionId}));
  const day=(months.get(m).normalPayDays||[]).find((d:any)=>d.date===date),p=day?.policy;
  const proof=p?.status==='approved'&&p.version&&p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt))?{version:p.version,reviewedBy:p.approvedBy,reviewedAt:p.approvedAt}:null;
  if(!day||!proof||!['normal','rest'].includes(day.dayType)||!['monthly','hourly'].includes(day.payBasis)){dayEvidence[date]={dayType:'unverified',eligibleMinutes:0};continue;}
  // The overtime day's own reviewed work decides which minutes are beyond 8h.
  const work=cards.filter((c:any)=>c.date===date).flatMap((c:any)=>(confirmedWork(c)||[]).map((w:any)=>({id:c.id,sourceVersion:evidenceHash(c),start:midnight(date)+w.start,end:midnight(date)+w.end,workdayId:'D',kind:'actual' as const,version:evidenceHash(c),reviewedBy:c.workReview?.reviewedBy,reviewedAt:c.workReview?.reviewedAt})));
  const result=calculateOvertime({workdays:[{id:'D',date,weekId:'W',dayType:day.dayType,regime:p.workRegime||'unknown',contractMinutes:480,holidayConsent:'unknown',emergency:'unknown',...proof}],work,wages:[{id:day.payVersion,start:midnight(date),end:midnight(date)+1440,payBasis:day.payBasis,components:[{code:'contract-amount',amount:String(day.amount),sourceId:day.payVersion}],componentsComplete:true,monthly240Applicable:true,...proof}],weeks:[],comp:[],compEvidenceComplete:true});
  const tiers:any[]=[];
  for(const l of result.lines.filter(l=>ELIGIBLE.includes(l.kind)&&l.exact&&l.multiplier&&l.hourlyBasis))for(const r of ranges){const start=Math.max(l.start,r.start),end=Math.min(l.end,r.end);if(end>start)tiers.push({start,end,minutes:end-start,kind:l.kind,hourlyBasis:l.hourlyBasis,multiplier:l.multiplier});}
  tiers.sort((a,b)=>a.start-b.start);const eligibleMinutes=tiers.reduce((n,t)=>n+t.minutes,0);
  const hb=tiers[0]?.hourlyBasis;
  dayEvidence[date]={dayType:day.dayType,eligibleMinutes,originalWageBasis:{status:tiers.length?'confirmed':'pending-payroll',originalDate:date,rate:hb?Number(hb.numerator)/Number(hb.denominator):null,tiers:tiers.length?tiers:null,version:evidenceHash(tiers),...(tiers.length?{reviewedBy:proof.reviewedBy,reviewedAt:proof.reviewedAt}:{})}};
 }
 const eligibleMinutes=Object.values(dayEvidence).reduce((n:number,d:any)=>n+d.eligibleMinutes,0);
 const first=Object.values(dayEvidence).find((d:any)=>d.originalWageBasis?.reviewedBy) as any;
 return {status:'approved',derived:'c2b-overtime-engine',empId,overtimeVersion:version,dayEvidence,dayType:dates.length===1?dayEvidence[dates[0]].dayType:'unverified',eligibleMinutes,originalWageBasis:dates.length===1?dayEvidence[dates[0]].originalWageBasis:{status:'pending-payroll',originalDate:dates[0],rate:null,tiers:null},version:evidenceHash(dayEvidence),approvedBy:first?.originalWageBasis.reviewedBy||'system',approvedAt:first?.originalWageBasis.reviewedAt||'1970-01-01T00:00:00Z'};
}
