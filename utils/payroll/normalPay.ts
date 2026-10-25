import type {OTResult} from './overtime';
/** Approved overtime rules. Week start is the employer's fixed seven-day cycle (LSA
 * Art.36); a single contract amount is the full regular wage; monthly hourly basis /240. */
export interface OvertimeRules {schemaVersion:'overtime-rules-v1';weekStartDay:number;wageComponents:'single-contract-amount';monthlyHourlyDivisor:240}
import {validDate} from '../attendance';
import {add,decimal,evidence,mul,rational,rounded,sum,validRounding,type FractionEvidence,type Rational,type RoundingPolicy} from './rational';
export interface NormalPayPolicy {
 // C2b rules applied to sources derived from the master, calendars and reviewed work.
 overtimeRules?:OvertimeRules;
 version:string;status:'approved';approvedBy:string;approvedAt:string;
 dateRule:'taipei-calendar';employmentDates:'inclusive';restDays:'calendar-paid';dailyNormalMinutes:480;
 // Statutory work regime from the approved policy source. Only standard-8-40 is
 // implemented; monthly rostering alone never establishes a variable/84-1 regime.
 workRegime?:'standard-8-40'|'variable'|'84-1'|'unknown';
 monthlyStrategy:'calendar-earned'|'calendar-base-minus-30-unpaid-days';
 fullMonth:'contract-amount';loa:{method:'daily-base-fraction';numerator:number;denominator:number};
 monthlyLeaveHourlyDivisor:string;leavePaidFractions:Record<string,{numerator:number;denominator:number}>;
 compUse:'approved-paid-minutes';rounding:RoundingPolicy;
 workdayAssignments?:Array<{sourceId:string;sourceVersion:string;workApprovalId:string;start:number;end:number;workdayId:string;workdayDate:string}>;
}
export interface NormalPayDay {date:string;employmentState:'active'|'loa'|'not-employed';payBasis:'monthly'|'hourly'|'daily';amount:string;payVersion:string;policyId:string;dayType:string;policy:NormalPayPolicy|null}
export interface ReviewedWorkday {id:string;date:string;version:string;reviewedBy:string;reviewedAt:string}
export interface NormalPayInterval {start:number;end:number;kind:'work'|'leave'|'comp';sourceId:string;sourceVersion:string;approvalId:string;leaveType?:string;workday?:ReviewedWorkday;sourceDate?:string}
export interface NormalPaySegment {employeeId:string;date:string;start:number|null;end:number|null;minutes:number|null;kind:string;payVersion:string;policyId:string;policyVersion:string;sourceIds:string[];exact:FractionEvidence;rounded:string|null}
export interface NormalPayCombined {status:'ready'|'needs-review';issues:string[];exactTotal:FractionEvidence|null;amount:string|null;normalExact:FractionEvidence;overtimeExact:FractionEvidence|null}
export interface NormalPayResult {overtimePreview?:OTResult&{monthExact?:FractionEvidence|null;blocking?:string[]};combined?:NormalPayCombined;version:'normal-pay-c2a';status:'ready'|'needs-review';scope:'normal-pay-only';month:string;employeeId:string;issues:string[];segments:NormalPaySegment[];exactTotal:FractionEvidence;amount:string|null;extraWorkMinutes:number;statutoryOvertimeAmount:null;rounding:RoundingPolicy|null}
const date=(m:number)=>new Date(m*60000+8*3600000).toISOString().slice(0,10);
const dayStart=(d:string)=>Date.parse(d+'T00:00:00+08:00')/60000;
const ratio=(r:any)=>r&&Number.isSafeInteger(r.numerator)&&Number.isSafeInteger(r.denominator)&&r.denominator>0&&r.numerator>=0&&r.numerator<=r.denominator;
const validPolicy=(p:any):p is NormalPayPolicy=>p?.status==='approved'&&typeof p.version==='string'&&!!p.version&&typeof p.approvedBy==='string'&&!!p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt))&&p.dateRule==='taipei-calendar'&&p.employmentDates==='inclusive'&&p.restDays==='calendar-paid'&&p.dailyNormalMinutes===480&&['calendar-earned','calendar-base-minus-30-unpaid-days'].includes(p.monthlyStrategy)&&p.fullMonth==='contract-amount'&&p.loa?.method==='daily-base-fraction'&&ratio(p.loa)&&p.compUse==='approved-paid-minutes'&&!!p.leavePaidFractions&&validRounding(p.rounding);
/** overtimeEngine: work beyond 8h or on non-normal days is valued by the C2b engine
 * and joined in `combined`, so it is no longer an unresolved gap here. */
export function calculateNormalPay(employeeId:string,month:string,days:NormalPayDay[],intervals:NormalPayInterval[],inputIssues:string[]=[],options:{overtimeEngine?:boolean}={}):NormalPayResult {
 const issues=new Set(inputIssues),segments:NormalPaySegment[]=[],values:Rational[]=[];let extraWorkMinutes=0,rounding:RoundingPolicy|null=null;
 const invalid=(m:string)=>issues.add(m);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid month');
 const year=Number(month.slice(0,4)),mo=Number(month.slice(5)),count=new Date(Date.UTC(year,mo,0)).getUTCDate(),from=dayStart(month+'-01'),to=from+count*1440;
 const relevant=intervals.filter(i=>Number.isSafeInteger(i.start)&&Number.isSafeInteger(i.end)&&i.end>i.start&&i.start<to&&i.end>from).sort((a,b)=>a.start-b.start||a.end-b.end);
 for(const i of intervals)if(!Number.isSafeInteger(i.start)||!Number.isSafeInteger(i.end)||i.end<=i.start||typeof i.sourceId!=='string'||!i.sourceId||typeof i.sourceVersion!=='string'||!i.sourceVersion||typeof i.approvalId!=='string'||!i.approvalId||!['work','leave','comp'].includes(i.kind))invalid('來源區間／核准證據無效');
 // Labor Standards Act Enforcement Rules Art.17 requires cross-calendar-day normal
 // work to be combined; midnight is a valuation boundary, never a fresh 8h allowance.
 // https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=17
 // Checked 2026-10-24. Missing grouping (including breaks) remains pending.
 // Reviewed identities classify normal minutes only; C2b still owns legal day
 // types, rest limits and statutory extra pay. No rest-gap heuristic is a proof.
 const work=relevant.filter(i=>i.kind==='work');
 const workDates=new Set(work.flatMap(i=>[date(i.start),date(i.end-1)]));
 const needsIdentity=workDates.size>1||work.some(i=>!!i.workday);
 const validIdentity=(i:NormalPayInterval)=>{const w=i.workday;return !!w&&typeof w.id==='string'&&!!w.id&&typeof w.version==='string'&&!!w.version&&typeof w.reviewedBy==='string'&&!!w.reviewedBy&&typeof w.reviewedAt==='string'&&Number.isFinite(Date.parse(w.reviewedAt))&&validDate(w.date)&&i.start>=dayStart(w.date)&&i.end<=dayStart(w.date)+2880;};
 if(needsIdentity&&work.some(i=>!validIdentity(i)))invalid('跨日工作須合併或區分核定工日；工日分配證據缺失，不能依零時／休息間隔推定新的8小時');
 const identities=new Map<string,string>();for(const i of work){if(!validIdentity(i))continue;const w=i.workday!;if(identities.has(w.id)&&identities.get(w.id)!==w.date)invalid('同一工日識別的歸屬日期衝突');identities.set(w.id,w.date);}
 const usedByWorkday=new Map<string,number>();
 for(let n=0;n<relevant.length;n++)for(let j=n+1;j<relevant.length&&relevant[j].start<relevant[n].end;j++)invalid('工作／假單／補休來源區間重疊，不能重複給薪');
 const push=(d:NormalPayDay,kind:string,value:Rational,source:NormalPayInterval|null=null,start:number|null=null,end:number|null=null)=>{values.push(value);segments.push({employeeId,date:d.date,start,end,minutes:start===null?null:end!-start,kind,payVersion:d.payVersion,policyId:d.policyId,policyVersion:d.policy!.version,sourceIds:source?[source.sourceId,source.sourceVersion,source.approvalId]:[d.payVersion],exact:evidence(value),rounded:null});};
 for(let n=1;n<=count;n++){
  const dkey=month+'-'+String(n).padStart(2,'0'),rows=days.filter(d=>d.date===dkey);if(rows.length!==1){invalid(dkey+' 有效主檔缺口或重疊');continue;}const d=rows[0],p=d.policy;
  if(!validPolicy(p)||typeof d.payVersion!=='string'||!d.payVersion||typeof d.policyId!=='string'||!d.policyId||!['normal','rest','regular-holiday','national-holiday','special'].includes(d.dayType)){invalid(dkey+' 正常薪資／折算／rounding政策尚未核定');continue;}
  // Missing/unsupported regime keeps computing evidence below but can never be ready.
  if(p.workRegime!=='standard-8-40')invalid(dkey+' 工時制度來源未核定或尚未支援（'+(p.workRegime||'未提供')+'）；固定8小時模型不能當正式結果');
  if(rounding&&JSON.stringify(rounding)!==JSON.stringify(p.rounding)){invalid('月份跨 rounding 政策，需明確分項結算規則');continue;}rounding=p.rounding;
  let rate:Rational;try{rate=decimal(d.amount);if(rate.n<0n)throw Error();}catch{invalid(dkey+' 薪額無效');continue;}
  if(!['active','loa','not-employed'].includes(d.employmentState)||!['monthly','hourly'].includes(d.payBasis)){invalid(dkey+' 薪制／雇用狀態待核');continue;}
  const begin=dayStart(dkey),end=begin+1440,parts=relevant.filter(i=>i.start<end&&i.end>begin);
  // Calendar paid days are a declared contract policy, not an inference from attendance.
  if(d.payBasis==='monthly'){
   let base=mul(rate,rational(1n,BigInt(count)));
   if(d.employmentState==='not-employed')base=p.monthlyStrategy==='calendar-earned'?rational(0n):add(base,mul(rate,rational(-1n,30n)));
   if(d.employmentState==='loa')base=mul(base,rational(BigInt(p.loa.numerator),BigInt(p.loa.denominator)));
   push(d,'monthly-calendar-segment',base);
  }
  const dayGroups=new Set(parts.filter(i=>i.kind==='work'&&i.workday).map(i=>i.workday!.id));if(dayGroups.size>1)invalid(dkey+' 同曆日多工日配置待C2b核定');
  for(const i of parts){const start=Math.max(begin,i.start),stop=Math.min(end,i.end),minutes=stop-start;if(d.employmentState!=='active'){invalid(dkey+' 非有效在職日有工作／假單／補休，需核實');continue;}
   if(i.kind==='work'){
    if(d.dayType!=='normal'){if(!options.overtimeEngine)invalid(dkey+' 非一般日工作待C2b');extraWorkMinutes+=minutes;continue;}
    const group=i.workday?'workday:'+i.workday.id:'candidate-calendar:'+dkey,used=usedByWorkday.get(group)||0;const normal=Math.min(minutes,Math.max(0,480-used));usedByWorkday.set(group,used+minutes);extraWorkMinutes+=minutes-normal;
    if(d.payBasis==='hourly'&&normal)push(d,'hourly-normal-work',mul(rate,rational(BigInt(normal),60n)),i,start,start+normal);
   }else{
    const f=i.kind==='comp'?{numerator:1,denominator:1}:p.leavePaidFractions[i.leaveType||''];if(!ratio(f)){invalid(dkey+' 假別給薪比例未核定');continue;}
    if(d.payBasis==='hourly')push(d,i.kind==='comp'?'paid-comp-use':'paid-leave',mul(rate,rational(BigInt(minutes)*BigInt(f.numerator),60n*BigInt(f.denominator))),i,start,stop);
    else {let divisor:Rational;try{divisor=decimal(p.monthlyLeaveHourlyDivisor);if(divisor.n<=0n)throw Error();}catch{invalid('月薪請假扣款時薪除數未核定');continue;}
     push(d,i.kind==='comp'?'monthly-paid-comp-no-extra':'monthly-leave-deduction',mul(mul(rate,rational(divisor.d,divisor.n)),rational(-BigInt(minutes)*BigInt(f.denominator-f.numerator),60n*BigInt(f.denominator))),i,start,stop);
    }
   }
  }
 }
 if(extraWorkMinutes&&!options.overtimeEngine)invalid('超出正常工時／非一般日工資待C2b，不等於免付加班費');
 const total=sum(values);if(total.n<0n)invalid('正常薪資合計為負，需人工覆核，不能當作員工欠款');let amount:string|null=null;
 if(rounding){if(rounding.stage==='per-item')segments.forEach((s,i)=>s.rounded=rounded(values[i],rounding!));amount=rounded(rounding.stage==='per-item'?sum(segments.map(s=>decimal(s.rounded!))):total,rounding);}
 return {version:'normal-pay-c2a',scope:'normal-pay-only',status:issues.size?'needs-review':'ready',month,employeeId,issues:[...issues],segments,exactTotal:evidence(total),amount:issues.size?null:amount,extraWorkMinutes,statutoryOvertimeAmount:null,rounding};
}
