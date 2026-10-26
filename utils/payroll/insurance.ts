import {mul,rational,rounded,evidence,type Rational,type FractionEvidence,type RoundingPolicy} from './rational';
/** Employee-borne social insurance for one payroll month (C3a). Sources checked
 * 2026-10-26:
 * - Labor insurance ordinary 11.5% since 2025-01-01 + employment insurance 1%
 *   (12.5% total for 2026, MOL https://www.mol.gov.tw/1607/28690/2282/2340/2344/7416/);
 *   employee pays 20%; premium days run from enrollment to withdrawal day and a
 *   month always counts as 30 days (BLI https://www.bli.gov.tw/0014162.html);
 *   each premium is rounded at the yuan (BLI https://www.bli.gov.tw/0006443.html pt 4).
 * - Health insurance 5.17%, employee pays 30%, per person rounded, self plus at most
 *   three dependants (NHIA 115.1.1 table, first grade 29,500); the unit enrolled on the
 *   month's last day charges the whole month (NHIA https://www.nhi.gov.tw/ch/np-2568-1.html).
 * - Labor pension voluntary contribution up to 6% (Labor Pension Act Art.14),
 *   contributed from hire to departure day; partial month = wage × rate × days ÷ 30
 *   (BLI Q&A https://www.bli.gov.tw/Files/18089).
 * Disability premium subsidies and part-time supplementary premium are not modelled.
 */
export interface InsurancePeriod {from:string;to:string;laborInsured:boolean;laborSalary:number;employmentInsured:boolean;healthInsuredHere:boolean;healthAmount:number;healthDependants:number;pensionWage:number;pensionSelfPercent:number;withholdingMethod?:import('./withholding').WithholdingMethod}
export interface InsuranceLine {item:'labor'|'employment'|'health'|'pension-self';from:string|null;to:string|null;days:number|null;basis:number;exact:FractionEvidence;amount:number}
export interface InsuranceResult {status:'ready'|'needs-review';issues:string[];lines:InsuranceLine[];labor:number;health:number;pensionSelf:number}
// Rates by effective start (YYYY-MM); grade tables below are verified only for 2026.
const RATES=[{from:'2025-01',laborOrdinary:rational(115n,1000n),employment:rational(1n,100n),health:rational(517n,10000n),laborShare:rational(20n,100n),healthShare:rational(30n,100n)}];
export const LABOR_SALARY_GRADES_2026=[11100,12540,13500,15840,16500,17280,17880,19047,20008,21009,22000,23100,24000,25250,26400,27600,28590,29500,30300,31800,33300,34800,36300,38200,40100,42000,43900,45800];
// NHIA 115.01.01 table, checked 2026-10-26; confirmed insured amounts, not actual salaries.
// https://www.nhi.gov.tw/ch/cp-19421-f9533-2569-1.html
export const HEALTH_SALARY_GRADES_2026=[29500,30300,31800,33300,34800,36300,38200,40100,42000,43900,45800,48200,50600,53000,55400,57800,60800,63800,66800,69800,72800,76500,80200,83900,87600,92100,96600,101100,105600,110100,115500,120900,126300,131700,137100,142500,147900,150000,156400,162800,169200,175600,182000,189500,197000,204500,212000,219500,228200,236900,245600,254300,263000,273000,283000,293000,303000,313000];
export const HEALTH_FIRST_GRADE_2026=HEALTH_SALARY_GRADES_2026[0];
const YUAN:RoundingPolicy={version:'statutory-yuan-half-up',status:'approved',approvedBy:'statute',approvedAt:'2026-10-26T00:00:00Z',stage:'per-item',precision:0,mode:'half-up'};
const yuan=(r:Rational)=>Number(rounded(r,YUAN));
const day=(d:string)=>Number(d.slice(8,10));
// 30-day convention: a month is always 30 days, so the month's real last day counts
// as day 30 (joining on 02-28 counts 3 days; on the 31st, 1 day).
const premiumDays=(from:string,to:string,monthLast:string)=>Math.max(1,(to===monthLast?30:Math.min(day(to),30))-Math.min(day(from),30)+1);
export function insuranceForMonth(month:string,periods:InsurancePeriod[]):InsuranceResult{
 const issues:string[]=[],lines:InsuranceLine[]=[];
 const first=month+'-01',last=month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate()).padStart(2,'0');
 const rate=[...RATES].reverse().find(r=>r.from<=month);
 if(!rate||!/^2026-(0[1-9]|1[0-2])$/.test(month))return {status:'needs-review',issues:['此月份保險費率未建立'],lines,labor:0,health:0,pensionSelf:0};
 const inMonth=periods.filter(p=>p.from<=last&&p.to>=first).sort((a,b)=>a.from.localeCompare(b.from));
 if(!inMonth.length)issues.push('投保資料未涵蓋此月份，不能視為未投保或零扣款');
 for(let i=1;i<inMonth.length;i++)if(inMonth[i].from<=inMonth[i-1].to)issues.push('投保期間重疊');
 const add=(item:InsuranceLine['item'],p:InsurancePeriod|null,days:number|null,basis:number,value:Rational)=>lines.push({item,from:p?(p.from<first?first:p.from):null,to:p?(p.to>last?last:p.to):null,days,basis,exact:evidence(value),amount:yuan(value)});
 for(const p of inMonth){
  const from=p.from<first?first:p.from,to=p.to>last?last:p.to,days=premiumDays(from,to,last),frac=rational(BigInt(days),30n);
  // Labor and employment enrollment are independent (BLI 0011588.htm, checked 2026-10-26).
  if(p.laborInsured||p.employmentInsured){if(!LABOR_SALARY_GRADES_2026.includes(p.laborSalary))issues.push('勞保／就保投保薪資不在分級表 '+p.laborSalary);else{
   if(p.laborInsured)add('labor',p,days,p.laborSalary,mul(mul(mul(rational(BigInt(p.laborSalary)),rate.laborOrdinary),rate.laborShare),frac));
   if(p.employmentInsured)add('employment',p,days,p.laborSalary,mul(mul(mul(rational(BigInt(p.laborSalary)),rate.employment),rate.laborShare),frac));}}
  if(p.pensionSelfPercent>0){if(!Number.isInteger(p.pensionWage)||p.pensionWage<=0)issues.push('勞退月提繳工資無效');else if(!(p.pensionSelfPercent<=6))issues.push('勞退自提率超過6%');else
   add('pension-self',p,days,p.pensionWage,mul(mul(rational(BigInt(p.pensionWage)),rational(BigInt(Math.round(p.pensionSelfPercent*100)),10000n)),frac));}
 }
 // Health insurance is a whole-month charge by the unit enrolled on the last day.
 const monthEnd=inMonth.find(p=>p.from<=last&&p.to>=last);
 if(monthEnd?.healthInsuredHere){const p=monthEnd;
  if(!HEALTH_SALARY_GRADES_2026.includes(p.healthAmount))issues.push('健保投保金額不在115年度分級表（第一級29,500）');
  else if(!Number.isInteger(p.healthDependants)||p.healthDependants<0)issues.push('健保眷屬人數無效');
  else{const one=yuan(mul(mul(rational(BigInt(p.healthAmount)),rate.health),rate.healthShare)),people=1+Math.min(3,p.healthDependants);lines.push({item:'health',from:null,to:null,days:null,basis:p.healthAmount,exact:evidence(rational(BigInt(one*people))),amount:one*people});}}
 // Adjacent changes on a 31st can otherwise charge 30 + 1 days. Keep the
 // candidates for review rather than inventing how that enrollment change is billed.
 for(const item of ['labor','employment','pension-self'])if(lines.filter(l=>l.item===item).reduce((n,l)=>n+(l.days||0),0)>30)issues.push(item+' 當月計費日數超過30日，期間異動計費需核對');
 const sumOf=(items:string[])=>lines.filter(l=>items.includes(l.item)).reduce((n,l)=>n+l.amount,0);
 return {status:issues.length?'needs-review':'ready',issues,lines,labor:sumOf(['labor','employment']),health:sumOf(['health']),pensionSelf:sumOf(['pension-self'])};
}
