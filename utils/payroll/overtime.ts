import {decimal,evidence,mul,rational,sum,type FractionEvidence,type Rational} from './rational';
import {validDate} from '../attendance';

/** C2b1: Taiwan standard-hours candidate engine, never a payment authorisation.
 * LSA consolidated revision 2024-07-31, applicable rules checked 2026-10-24 for
 * August 2026: Arts.24/30/32/32-1/36/39/40. No configurable statutory multipliers.
 * https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=N0030001
 * https://calcr2.mol.gov.tw/Index ; hourly conditions: /Daily
 * Art.39 monthly short holiday work: MOL 87台勞動2字039675 (1998-09-14).
 * Enforcement Rules Art.17: midnight is NOT a new workday allowance.
 * Personal leave compliance only: MOL 1030132065, not paid/actual work.
 * These sources do not establish an employer's calendar, wage components,
 * special-hours eligibility, individual comp agreement, or net rounding mode.
 */
export interface OTProof {version:string;reviewedBy:string;reviewedAt:string}
export interface OTWorkday extends OTProof {
 id:string;date:string;weekId:string;dayType:'normal'|'rest'|'regular-holiday'|'national-holiday'|'special'|'unknown';
 regime:'standard-8-40'|'unknown'|'variable'|'84-1';contractMinutes:number;
 holidayConsent:'confirmed'|'unknown';emergency:'confirmed'|'absent'|'unknown';
}
export interface OTWork extends OTProof {id:string;start:number;end:number;workdayId:string;kind:'actual'|'break-work'|'offsite'|'travel'|'personal-leave-compliance';sourceVersion:string}
export interface OTWage extends OTProof {
 id:string;start:number;end:number;payBasis:'monthly'|'hourly';
 components:Array<{code:string;amount:string;sourceId:string}>;componentsComplete:boolean;
 monthly240Applicable:boolean;
}
export interface OTWeek extends OTProof {id:string;dates:string[];complete:boolean}
export interface OTComp extends OTProof {id:string;start:number;end:number;workdayId:string;sourceVersion:string;employeeChoice:boolean;employerConsent:boolean;deadline:string|null;kind:'article32-1'|'other'}
export interface OTInput {workdays:OTWorkday[];work:OTWork[];wages:OTWage[];weeks:OTWeek[];comp:OTComp[];compEvidenceComplete:boolean}
export interface OTLine {workdayId:string;date:string;dayType:string;start:number;end:number;minutes:number;kind:string;basisId:string|null;basisVersion:string|null;hourlyBasis:FractionEvidence|null;multiplier:FractionEvidence|null;exact:FractionEvidence|null;sourceIds:string[];sourceVersions:string[]}
export interface OTResult {version:'overtime-c2b1';status:'candidate'|'needs-review';formalEligibility:'BLOCKED';lines:OTLine[];issues:string[];complianceIssues:string[];actualWorkMinutes:number;personalLeaveComplianceMinutes:number;statutoryComplianceMinutes:number;normalMinutes:number;contractExtraMinutes:number;knownLiability:FractionEvidence;payableAmount:null;rounding:'required-final-round-review';compDisposition:'not-applied'|'pending-original-source-reconciliation';weekNormalMinutes:Record<string,number>}
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const proof=(p:any)=>p&&text(p.version)&&text(p.reviewedBy)&&text(p.reviewedAt)&&Number.isFinite(Date.parse(p.reviewedAt));
const span=(p:any)=>p&&Number.isSafeInteger(p.start)&&Number.isSafeInteger(p.end)&&p.end>p.start;
const midnight=(d:string)=>Date.parse(d+'T00:00:00+08:00')/60000;
const duration=(a:Array<{start:number;end:number}>)=>{let stop=-Infinity,n=0;for(const x of [...a].sort((x,y)=>x.start-y.start)){n+=Math.max(0,x.end-Math.max(stop,x.start));stop=Math.max(stop,x.end);}return n;};
const wageFor=(wages:OTWage[],start:number,end:number):{basis:OTWage|null;rate:Rational|null}=>{
 const wage=wages.filter(w=>span(w)&&w.start<=start&&w.end>=end);let basis:OTWage|null=null,rate:Rational|null=null;
 if(wage.length===1&&proof(wage[0])&&text(wage[0].id)&&wage[0].componentsComplete&&Array.isArray(wage[0].components)&&wage[0].components.length&&['monthly','hourly'].includes(wage[0].payBasis)){
  basis=wage[0];try{const codes=new Set<string>();const components=basis.components.map(c=>{if(!text(c.code)||!text(c.sourceId)||codes.has(c.code))throw Error();codes.add(c.code);const v=decimal(c.amount);if(v.n<0n)throw Error();return v;});rate=sum(components);if(rate.n<=0n)throw Error();if(basis.payBasis==='monthly'){if(!basis.monthly240Applicable)throw Error();rate=mul(rate,rational(1n,240n));}}catch{rate=null;}
 }
 return {basis,rate};
};
// Sort each source tuple once, so the parallel arrays retain ID/version pairing.
const sourceRefs=(sources:OTWork[])=>sources.map(w=>({id:w.id,version:w.sourceVersion})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:a.version<b.version?-1:a.version>b.version?1:0);
export function calculateOvertime(input:OTInput):OTResult {
 const issues=new Set<string>(),compliance=new Set<string>(),lines:OTLine[]=[],values:Rational[]=[],weekNormalMinutes:Record<string,number>={};
 let actualWorkMinutes=0,personalLeaveComplianceMinutes=0,statutoryComplianceMinutes=0,normalMinutes=0,contractExtraMinutes=0;
 const problem=(s:string)=>issues.add(s);
 if(!input||!['workdays','work','wages','weeks','comp'].every(k=>Array.isArray((input as any)[k])))throw Error('invalid overtime input collections');
 const validWork:OTWork[]=[];
 for(const w of input.work){if(!span(w)||!proof(w)||!text(w.id)||!text(w.sourceVersion)||!text(w.workdayId)||!['actual','break-work','offsite','travel','personal-leave-compliance'].includes(w.kind)){problem('工作來源／工日／核實證據缺失');continue;}validWork.push(w);}
 // Conflicting workday identities may not duplicate the same physical work.
 for(let i=0;i<validWork.length;i++)for(let j=i+1;j<validWork.length;j++){const a=validWork[i],b=validWork[j];if(a.start<b.end&&b.start<a.end&&a.workdayId!==b.workdayId)problem('相交來源的工日歸屬衝突');}
 actualWorkMinutes=duration(validWork.filter(w=>w.kind!=='personal-leave-compliance'));
 personalLeaveComplianceMinutes=duration(validWork.filter(w=>w.kind==='personal-leave-compliance'));
 statutoryComplianceMinutes=duration(validWork);
 const knownDays=new Set<string>();
 for(const day of input.workdays){
  if(!proof(day)||!text(day.id)||knownDays.has(day.id)||!validDate(day.date)||!text(day.weekId)||!Number.isSafeInteger(day.contractMinutes)||day.contractMinutes<0||day.contractMinutes>480){problem('工日核定／日期／契約工時無效或重複');continue;}knownDays.add(day.id);
  const all=validWork.filter(w=>w.workdayId===day.id),work=all.filter(w=>w.kind!=='personal-leave-compliance'),leave=all.filter(w=>w.kind==='personal-leave-compliance');
  if(all.some(w=>w.start<midnight(day.date)||w.end>midnight(day.date)+2880))problem('來源超出核定跨日工日邊界');
  const minutes=duration(work),leaveMinutes=duration(leave),complianceMinutes=duration(all);
  // Global union above retains confirmed actual even when workday mapping is missing.
  if(work.some(w=>leave.some(l=>w.start<l.end&&l.start<w.end)))problem('實際工作與事假合規來源重疊');
  if(complianceMinutes>720)compliance.add(day.id+':每日工作與適用事假合規時數超過12小時；不消滅工資義務');
  if(day.regime!=='standard-8-40'){problem(day.id+':特殊制度適用資格／規則未實作');continue;}
  if(!['normal','rest','regular-holiday','national-holiday'].includes(day.dayType)){problem(day.id+':日別／調移／特殊假政策未核');continue;}
  if(day.dayType==='regular-holiday'&&minutes&&day.emergency!=='confirmed')compliance.add(day.id+':例假出勤欠缺法定停止假期依據；給付仍待核');
  if(['rest','national-holiday'].includes(day.dayType)&&minutes&&day.holidayConsent!=='confirmed')compliance.add(day.id+':假日出勤同意證據缺失；給付不因此歸零');
  const n=day.dayType==='normal'?Math.min(480,minutes):0;normalMinutes+=n;contractExtraMinutes+=day.dayType==='normal'?Math.max(0,n-day.contractMinutes):0;weekNormalMinutes[day.weekId]=(weekNormalMinutes[day.weekId]||0)+n;
  const cuts=[...new Set(work.flatMap(w=>[w.start,w.end]).concat(input.wages.filter(span).flatMap(w=>[w.start,w.end])))].sort((a,b)=>a-b);
  const parts=cuts.slice(0,-1).map((start,k)=>{const end=cuts[k+1];return {start,end,sources:work.filter(w=>w.start<end&&w.end>start),...wageFor(input.wages,start,end)};}).filter(p=>p.sources.length);
  const emit=(from:number,to:number,kind:string,mult:Rational|null,rate:Rational|null,basis:OTWage|null,sources:OTWork[],paidMinutes=to-from)=>{const value=rate&&mult?mul(mul(rate,mult),rational(BigInt(paidMinutes),60n)):null,refs=sourceRefs(sources);if(value)values.push(value);lines.push({workdayId:day.id,date:day.date,dayType:day.dayType,start:from,end:to,minutes:to-from,kind,basisId:basis?.id||null,basisVersion:basis?.version||null,hourlyBasis:rate?evidence(rate):null,multiplier:mult?evidence(mult):null,exact:value?evidence(value):null,sourceIds:refs.map(r=>r.id),sourceVersions:refs.map(r=>r.version)});};
  // A whole-day addition cannot take its basis from the first work segment.
  // Check every worked segment before emitting it, including gaps, overlapping
  // wage sources and switches between monthly and hourly pay. Known segment OT
  // remains separate even when the whole-day addition has no established basis.
  if(['national-holiday','regular-holiday'].includes(day.dayType)&&parts.some(p=>input.wages.some(w=>span(w)&&w.payBasis==='monthly'&&w.start<p.end&&w.end>p.start))){
   const first=parts[0],rate=first.rate;
   const sameMonthlyRate=!!rate&&parts.every(p=>p.basis?.payBasis==='monthly'&&!!p.rate&&p.rate.n===rate.n&&p.rate.d===rate.d);
   if(!sameMonthlyRate)problem(day.id+':同一假日整日加給基礎不完整或跨工資基礎，須另核，不以首段自動定案');
   emit(first.start,first.start,'monthly-holiday-additional-day',rational(1n),sameMonthlyRate?rate:null,sameMonthlyRate?first.basis:null,work,480);
  }
  let used=0;
  for(const {start,end,sources,basis,rate} of parts){
   if(!rate)problem(day.id+':完整正常工資組成／有效薪制／240適用證據缺失或重疊');
   let cursor=start;
   while(cursor<end){
    let limit:number,mult:Rational|null,kind:string;
    if(day.dayType==='normal'){limit=used<480?480:used<600?600:used<720?720:Infinity;mult=used<480?rational(0n):used<600?rational(4n,3n):used<720?rational(5n,3n):null;kind=used<480?'normal-paid-separately':'weekday-overtime';}
    else if(day.dayType==='rest'){limit=used<120?120:used<480?480:used<720?720:Infinity;mult=used<120?rational(4n,3n):used<480?rational(5n,3n):used<720?rational(8n,3n):null;kind='rest-day-additional';}
    else {limit=used<480?480:used<600?600:used<720?720:Infinity;kind='holiday-work';mult=used<480?(basis?.payBasis==='monthly'?rational(0n):rational(2n)):(day.dayType==='regular-holiday'?null:used<600?rational(4n,3n):used<720?rational(5n,3n):null);
    }
    const take=Math.min(end-cursor,limit-used);if(mult===null)problem(day.id+':超出已實作給付級距；已核工時保留，給付不可當0');emit(cursor,cursor+take,kind,mult,rate,basis,sources);cursor+=take;used+=take;
   }
  }
 }
 for(const w of validWork)if(!knownDays.has(w.workdayId))problem('工作來源缺少核定工日 '+w.workdayId);
 // Exact seven-day coverage is required, including dates outside the payroll month.
 for(const [id,minutes] of Object.entries(weekNormalMinutes)){
  const rows=input.weeks.filter(w=>w?.id===id),w=rows[0];
  const dates=w?.dates;
  if(rows.length!==1||!proof(w)||!w.complete||!Array.isArray(dates)||dates.length!==7||new Set(dates).size!==7||dates.some((d,i)=>!validDate(d)||i>0&&midnight(d)-midnight(dates[i-1])!==1440)||dates.some(d=>input.workdays.filter(x=>x.weekId===id&&x.date===d).length!==1)||input.workdays.some(d=>d.weekId===id&&!dates.includes(d.date)))problem(id+':完整核定週界資料缺失，跨月不可截斷');
  if(minutes>2400){compliance.add(id+':每週正常工時超過40小時');problem(id+':超週40小時給付分類待覆核，不能被每日8小時掩蓋');}
 }
 if(!input.compEvidenceComplete)problem('補休選擇／同意及帳本來源未完整核對');
 for(const c of input.comp){if(!span(c)||!proof(c)||!text(c.sourceVersion)||!c.employeeChoice||!c.employerConsent||!validDate(c.deadline||'')||c.kind!=='article32-1')problem('補休期限／個別同意／原日來源尚待核');problem('補休原日工資與帳本逐段對帳尚未套用；保留完整給付候選值，不自動扣除');}
 return {version:'overtime-c2b1',status:issues.size||compliance.size?'needs-review':'candidate',formalEligibility:'BLOCKED',lines,issues:[...issues],complianceIssues:[...compliance],actualWorkMinutes,personalLeaveComplianceMinutes,statutoryComplianceMinutes,normalMinutes,contractExtraMinutes,knownLiability:evidence(sum(values)),payableAmount:null,rounding:'required-final-round-review',compDisposition:input.comp.length?'pending-original-source-reconciliation':'not-applied',weekNormalMinutes};
}
