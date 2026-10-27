import {lookupWithholding2026} from './withholdingTable2026';
import {mul,rational,sum,evidence,type Rational,type FractionEvidence} from './rational';
import type {OTLine} from './overtime';
/** Income tax withholding and part-time supplementary health premium (C3b).
 * Sources checked 2026-10-26:
 * - Monthly pay: withholding tax table or, if the employee elects, 5% of the month's
 *   total; under 5%, a monthly tax of 2,000 or less is not withheld. Part-time and
 *   non-monthly pay: 5% when one payment reaches the table's starting point (2026:
 *   90,501 for no spouse/dependants), else none (薪資所得扣繳辦法; 各類所得扣繳率標準;
 *   MOF https://www.mof.gov.tw/singlehtml/384fb3077bb349ea973e7fc6f13b6974?cntId=1d6facbaae674fb7b1e15161df56768e).
 *   Non-residents: 6% up to 1.5 × minimum wage (44,250 in 2026), else 18%.
 * - Overtime pay within LSA Arts.24/32 is tax-free: weekday overtime plus rest-day
 *   work up to 46 hours a month; regular/national holiday overtime is tax-free and
 *   outside the 46 hours (MOF 台財稅第16713號, https://law-out.mof.gov.tw/LawContent.aspx?id=GL005371).
 *   Voluntary pension contribution is excluded (Labor Pension Act Art.14).
 * - Supplementary premium 2.11% on pay to a person not enrolled for health insurance
 *   in this unit, per payment reaching the minimum wage (29,500 in 2026)
 *   (NHIA https://www.nhi.gov.tw/ch/cp-4516-74b0f-2613-1.html).
 * Published 115 table cells require a reviewed spouse/dependant declaration.
 * Official out-of-table formulas accept exact integer results only.
 * Fractional placement and fractional tax rounding remain held. Untaken comp time
 * paid out is treated as taxable salary (no exemption ruling found).
 */
export type WithholdingMethod='table'|'flat-5'|'part-time-5'|'non-resident';
export interface WithholdingResult {status:'ready'|'needs-review';issues:string[];method:WithholdingMethod|null;exemptOvertime:FractionEvidence;taxableBase:FractionEvidence;incomeTax:number;supplementaryPremium:number;supplementaryBase:FractionEvidence}
const START_2026=90501,NON_RESIDENT_LOW_2026=44250,MIN_WAGE_2026=29500,EXEMPT_OT_MINUTES=46*60;
const f=(x:FractionEvidence)=>rational(BigInt(x.numerator),BigInt(x.denominator));
const ge=(a:Rational,n:number)=>a.n>=BigInt(n)*a.d,gt=(a:Rational,n:number)=>a.n>BigInt(n)*a.d;
const integer=(a:Rational)=>a.d===1n;
/** Tax-free overtime value: holiday lines in full; weekday/rest-day lines in time
 * order until 46 hours, the remainder of a crossing line prorated by minutes. */
export function exemptOvertime(lines:OTLine[]):Rational{
 const values:Rational[]=[];let used=0;
 for(const l of [...lines].sort((a,b)=>a.start-b.start)){if(!l.exact)continue;
  if(l.kind==='holiday-work'||l.kind==='monthly-holiday-additional-day'){values.push(f(l.exact));continue;}
  if(!['weekday-overtime','rest-day-additional'].includes(l.kind))continue;
  const take=Math.min(l.minutes,Math.max(0,EXEMPT_OT_MINUTES-used));used+=l.minutes;if(take<=0)continue;
  values.push(take===l.minutes?f(l.exact):mul(f(l.exact),rational(BigInt(take),BigInt(l.minutes))));}
 return sum(values);
}
export function withholdingForMonth(input:{month:string;gross:Rational;overtimeLines:OTLine[];pensionSelf:number;method:WithholdingMethod|null|undefined;healthInsuredHere:boolean;spouseAndDependantsCount?:number;countConfirmed?:boolean;countSourceRef?:string}):WithholdingResult{
 const issues:string[]=[],exempt=exemptOvertime(input.overtimeLines);
 if(input.overtimeLines.filter(l=>['weekday-overtime','rest-day-additional'].includes(l.kind)).reduce((n,l)=>n+l.minutes,0)>EXEMPT_OT_MINUTES)issues.push('超過46小時之加班免稅範圍須依適用制度及完整核定來源另行確認');
 const base=sum([input.gross,mul(exempt,rational(-1n)),rational(BigInt(-input.pensionSelf))]),taxable=base.n<0n?rational(0n):base;
 const salaryPaid=sum([input.gross,mul(exempt,rational(-1n))]);
 if(!/^2026-(0[1-9]|1[0-2])$/.test(input.month))issues.push('此月份扣繳標準未建立');
 let incomeTax=0;const pct=(p:bigint)=>mul(taxable,rational(p,100n));
 const take=(t:Rational)=>{if(integer(t))return Number(t.n);issues.push('扣繳稅額有角分，進位方式待確認');return 0;};
 switch(input.method){
  case 'table':{
   if(gt(taxable,START_2026-1)){
    const sourceValid=typeof input.countSourceRef==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(input.countSourceRef);
    const lookup=lookupWithholding2026({month:input.month,taxableSalary:integer(taxable)?Number(taxable.n):null,spouseAndDependantsCount:input.spouseAndDependantsCount,countConfirmed:input.countConfirmed===true&&sourceValid});
    if(lookup.status==='ready')incomeTax=lookup.incomeTax!;
    else issues.push('扣繳稅額表需有效核定人數及完整適用級距：'+lookup.issues.join('、'));
   }
   break;
  }
  case 'flat-5':{const t=pct(5n);if(t.n>2000n*t.d)incomeTax=take(t);break;}
  case 'part-time-5':if(ge(taxable,START_2026))issues.push('兼職／非每月扣繳需核定單次給付資料，月合計不能代替單次給付');break;
  case 'non-resident':incomeTax=take(pct(gt(taxable,NON_RESIDENT_LOW_2026)?18n:6n));break;
  default:issues.push('所得稅扣繳方式未登錄');
 }
 let supplementaryPremium=0;
 // A monthly aggregate and enrollment-unit flag cannot establish a payment event
 // or exemption eligibility (NHIA regulations Arts.2,4,5, checked 2026-10-26:
 // https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060027).
 // Hold the amount until evidence exists; never infer that insured elsewhere means liable.
 if(!input.healthInsuredHere&&ge(salaryPaid,MIN_WAGE_2026))issues.push('補充保費需核定單次給付及投保類別／免扣證明，月合計與非本單位投保不足以判定');
 return {status:issues.length?'needs-review':'ready',issues,method:input.method||null,exemptOvertime:evidence(exempt),taxableBase:evidence(taxable),incomeTax,supplementaryPremium,supplementaryBase:evidence(salaryPaid)};
}
