import {calculateOvertime,type OTInput,type OTResult,type OTWork,type OTWorkday,type OTWage,type OTWeek,type OTComp,type OTProof} from '../../../utils/payroll/overtime';
import type {NormalPayDay,NormalPayInterval,OvertimeRules} from '../../../utils/payroll/normalPay';
import {evidenceHash} from './attendanceCaseLifecycle';
import {taipeiDate} from '../../../utils/attendance';
import {rational,sum,evidence} from '../../../utils/payroll/rational';
/** C2b source adapter: derives every overtime input from server-loaded sources —
 * effective-master days (this month plus six context days either side), approved
 * day-type calendars, supervisor-reviewed clock work and the policy's overtime
 * rules. No request payload can supply wages, day types, weeks or work.
 *
 * Multipliers follow LSA Arts.24/39/40 as the MOL calculator applies them
 * (https://calcr2.mol.gov.tw/Daily, checked 2026-10-25): rest-day hours are paid at
 * 4/3, 5/3, 8/3 of the hourly wage in total; hourly staff get 2x for holiday hours
 * within 8h; monthly staff get one extra day. Hourly rates already include paid
 * 例假／休息日 (MOL https://www.mol.gov.tw/1607/28690/2282/2284/2290/7170/).
 */
export interface OvertimeSources {empId:string;month:string;days:NormalPayDay[];contextDays?:any[];intervals:NormalPayInterval[];credits?:Array<{id:string;start:number;end:number;status?:string}>}
export interface OvertimeOutcome extends OTResult {monthExact:{numerator:string;denominator:string}|null;blocking:string[]}
// approvalId is reviewer+'@'+ISO time; split on the last '@' since a reviewer id
// may itself contain '@' but an ISO timestamp never does.
const reviewProof=(id:string)=>{const at=id.lastIndexOf('@');return at>0?{reviewedBy:id.slice(0,at),reviewedAt:id.slice(at+1)}:{reviewedBy:'missing',reviewedAt:'invalid'};};
const shift=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const midnight=(d:string)=>Date.parse(d+'T00:00:00+08:00')/60000;
const policyProof=(p:any):OTProof|null=>p?.status==='approved'&&typeof p.version==='string'&&typeof p.approvedBy==='string'&&Number.isFinite(Date.parse(p.approvedAt))?{version:p.version,reviewedBy:p.approvedBy,reviewedAt:p.approvedAt}:null;
const validRules=(r:any):r is OvertimeRules=>r?.schemaVersion==='overtime-rules-v1'&&Number.isInteger(r.weekStartDay)&&r.weekStartDay>=0&&r.weekStartDay<=6&&r.wageComponents==='single-contract-amount'&&r.monthlyHourlyDivisor===240;
const COMP_ELIGIBLE=['weekday-overtime','rest-day-additional'];
function splitConverted(lines:OTResult['lines'],credits:Array<{id:string;start:number;end:number}>,issues:string[]){
 const out:OTResult['lines']=[];let covered=0;
 for(const l of lines){
  const cuts=COMP_ELIGIBLE.includes(l.kind)?credits.filter(c=>c.start<l.end&&c.end>l.start).map(c=>({start:Math.max(c.start,l.start),end:Math.min(c.end,l.end)})).sort((a,b)=>a.start-b.start):[];
  if(!cuts.length){out.push(l);continue;}
  const value=(from:number,to:number)=>l.hourlyBasis&&l.multiplier?evidence(rational(BigInt(l.hourlyBasis.numerator)*BigInt(l.multiplier.numerator)*BigInt(to-from),BigInt(l.hourlyBasis.denominator)*BigInt(l.multiplier.denominator)*60n)):null;
  let cursor=l.start;for(const c of cuts){if(c.start>cursor)out.push({...l,start:cursor,end:c.start,minutes:c.start-cursor,exact:value(cursor,c.start)});out.push({...l,start:c.start,end:c.end,minutes:c.end-c.start,kind:'comp-converted',exact:null});covered+=c.end-c.start;cursor=Math.max(cursor,c.end);}
  if(cursor<l.end)out.push({...l,start:cursor,end:l.end,minutes:l.end-cursor,exact:value(cursor,l.end)});
 }
 const credited=credits.reduce((n,c)=>n+c.end-c.start,0);
 if(covered!==credited)issues.push('補休取得區間不在本月可補休的加班分段（平日延長工時／休息日），需核對');
 return out;
}
export function overtimePreview(src:OvertimeSources):OvertimeOutcome {
 const {empId,month,days}=src,issues:string[]=[];
 const first=month+'-01',last=month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate()).padStart(2,'0');
 const byDate=new Map<string,any>();for(const d of src.contextDays||[])byDate.set(d.date,d);for(const d of days)byDate.set(d.date,{...d,covered:true});
 // One approved rule set must govern the whole window; versions are not merged.
 const ruleSets=new Map<string,{rules:OvertimeRules;proof:OTProof}>();
 for(const d of byDate.values()){if(!d.covered||d.employmentState==='not-employed')continue;const proof=policyProof(d.policy),rules=d.policy?.overtimeRules;if(!proof){issues.push(d.date+' 計薪政策來源未核定');continue;}if(!validRules(rules)){issues.push('加班計算規則（每週起始日、工資組成、月薪時薪基準）未核定');continue;}ruleSets.set(evidenceHash(rules),{rules,proof});}
 if(ruleSets.size>1)issues.push('同一週期內加班計算規則版本不一致，需明確合併覆核');
 const ruleSet=ruleSets.size===1?[...ruleSets.values()][0]:null;
 const blank=():OvertimeOutcome=>({...calculateOvertime({workdays:[],work:[],wages:[],weeks:[],comp:[],compEvidenceComplete:true}),status:'needs-review',monthExact:null,blocking:[...new Set(issues)],issues:[...new Set(issues)]});
 if(!ruleSet)return blank();
 const {rules,proof}=ruleSet;
 // Every seven-day week touching the month, from the approved week start (Art.36).
 const weeks:OTWeek[]=[],workdays:OTWorkday[]=[];
 for(let d=shift(first,-6);d<=last;d=shift(d,1)){if(new Date(d+'T00:00:00Z').getUTCDay()!==rules.weekStartDay||shift(d,6)<first)continue;const dates=Array.from({length:7},(_,i)=>shift(d,i));weeks.push({id:'W'+d,dates,complete:true,...proof});
  for(const date of dates){const day=byDate.get(date),active=day?.covered&&day.employmentState==='active';
   // Missing adjacent-month authority is not proof that the employee had not
   // joined or had already left. Require explicit coverage of every week day.
   if(!day?.covered||!['active','loa','not-employed'].includes(day.employmentState))issues.push(date+' 跨月任職來源未完整核定，不能視為非在職零工時');
   workdays.push({id:empId+':'+date,date,weekId:'W'+d,dayType:active?(day.dayType||'unknown'):'not-employed',regime:active?(day.policy?.workRegime||'unknown'):'standard-8-40',contractMinutes:480,holidayConsent:'unknown',emergency:'unknown',...proof});}}
 const known=new Set(workdays.map(w=>w.id));
 // Workday = the reviewed card's own date (Enforcement Rules Art.17: a shift
 // crossing midnight belongs to the day it started) unless an approved
 // assignment names another workday.
 const work:OTWork[]=[];
 for(const i of src.intervals){
  if(i.kind==='work'){const date=i.workday?.date||i.sourceDate;if(!date)continue;const id=empId+':'+date;if(!known.has(id))continue;work.push({id:i.sourceId,sourceVersion:i.sourceVersion,start:i.start,end:i.end,workdayId:id,kind:'actual',version:i.sourceVersion,...reviewProof(i.approvalId)});}
  // 事假 counts toward the 12h daily compliance check only, never as work (MOL 1030132065).
  else if(i.kind==='leave'&&i.leaveType==='事假'){const id=empId+':'+taipeiDate(new Date(i.start*60000));if(known.has(id))work.push({id:i.sourceId,sourceVersion:i.sourceVersion,start:i.start,end:i.end,workdayId:id,kind:'personal-leave-compliance',version:i.sourceVersion,...reviewProof(i.approvalId.split('/').pop()||'')});}
 }
 // Wage segments follow the master: one contiguous run per pay basis/amount/version.
 const wages:OTWage[]=[];
 const dated=[...byDate.values()].filter(d=>d.covered&&d.employmentState==='active').sort((a,b)=>a.date.localeCompare(b.date));
 for(const d of dated){if(d.payBasis==='daily'){issues.push(d.date+' 日薪加班計算尚未支援');continue;}const prev=wages[wages.length-1],key=d.payBasis+'|'+d.amount+'|'+d.payVersion;
  if(prev&&(prev as any).key===key&&prev.end===midnight(d.date)){prev.end+=1440;continue;}
  wages.push({id:d.payVersion+':'+d.date,start:midnight(d.date),end:midnight(d.date)+1440,payBasis:d.payBasis,components:[{code:'contract-amount',amount:String(d.amount),sourceId:d.payVersion}],componentsComplete:true,monthly240Applicable:true,...proof,key} as any);}
 const input:OTInput={workdays,work,wages,weeks,comp:[],compEvidenceComplete:true,payDates:{from:first,to:last}};
 let result:OTResult;try{result=calculateOvertime(input);}catch{return {...blank(),blocking:[...issues,'加班來源資料格式無效，不能計為零']};}
 // Comp time (LSA Art.32-1): an approved credit replaces cash for exactly its
 // minutes, which must lie on weekday-overtime or rest-day segments; the line keeps
 // its basis and multiplier for a later payout of untaken hours. A choice still
 // pending means pay-or-comp is undecided, so that employee's overtime waits.
 const inMonth=(src.credits||[]).filter(c=>{const d=taipeiDate(new Date(c.start*60000));return d>=first&&d<=last;});
 const approvedCredits=inMonth.filter(c=>c.status==='approved');
 for(const c of inMonth)if(c.status!=='approved')issues.push('加班改補休申請待核定（加班費或補休未定） '+c.id);
 const lines=splitConverted(result.lines.filter(l=>l.date>=first&&l.date<=last),approvedCredits,issues);
 const blocking=[...new Set([...issues,...result.issues])];
 // Only workdays inside this month are paid here; the rest of a crossing week is
 // paid in its own month. Compliance findings are reported, never used to withhold pay.
 const values=lines.filter(l=>l.kind!=='comp-converted').map(l=>l.exact);
 const monthExact=!blocking.length&&values.every(Boolean)?evidence(sum(values.map(v=>rational(BigInt(v!.numerator),BigInt(v!.denominator))))):null;
 return {...result,lines,issues:blocking,blocking,monthExact,status:blocking.length?'needs-review':'candidate'};
}
