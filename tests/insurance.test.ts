import {describe,it,expect} from 'vitest';
import {insuranceForMonth,type InsurancePeriod} from '../utils/payroll/insurance';
// Synthetic people. Amounts follow the official formulas and per-item yuan rounding.
const P=(extra:Partial<InsurancePeriod>={}):InsurancePeriod=>({from:'2026-01-01',to:'2099-12-31',laborInsured:true,laborSalary:29500,employmentInsured:true,healthInsuredHere:true,healthAmount:29500,healthDependants:0,pensionWage:30300,pensionSelfPercent:0,...extra});
describe('full month, 2026 rates',()=>{
 it('29,500: labor 678.5→679 + employment 59; health 458 matches the NHIA first-grade table',()=>{const r=insuranceForMonth('2026-08',[P()]);expect(r.status,r.issues.join()).toBe('ready');expect(r.lines.find(l=>l.item==='labor')!.amount).toBe(679);expect(r.lines.find(l=>l.item==='employment')!.amount).toBe(59);expect(r.labor).toBe(738);expect(r.health).toBe(458);});
 it('health dependants: per-person rounding × (1 + at most 3) → 916, 1374, 1832, still 1832 for 5',()=>{for(const [d,v] of [[1,916],[2,1374],[3,1832],[5,1832]])expect(insuranceForMonth('2026-08',[P({healthDependants:d})]).health).toBe(v);});
 it('pension 6% of 45,800 = 2748 (BLI example)',()=>{expect(insuranceForMonth('2026-08',[P({pensionWage:45800,pensionSelfPercent:6})]).pensionSelf).toBe(2748);});
});
describe('partial month (30-day convention)',()=>{
 it('joining on 08-16: labor and pension for 15/30 days; health whole month since enrolled at month end',()=>{const r=insuranceForMonth('2026-08',[P({from:'2026-08-16',pensionWage:30300,pensionSelfPercent:6})]);const labor=r.lines.find(l=>l.item==='labor')!;expect(labor.days).toBe(15);expect(labor.amount).toBe(339);expect(r.health).toBe(458);expect(r.pensionSelf).toBe(909);});
 it('joining on the 31st counts 1 day; February 28th counts 3 days',()=>{expect(insuranceForMonth('2026-08',[P({from:'2026-08-31'})]).lines.find(l=>l.item==='labor')!.days).toBe(1);expect(insuranceForMonth('2026-02',[P({from:'2026-02-28'})]).lines.find(l=>l.item==='labor')!.days).toBe(3);});
 it('leaving on 08-20: 20 days of labor insurance and no health premium from this unit',()=>{const r=insuranceForMonth('2026-08',[P({to:'2026-08-20'})]);expect(r.lines.find(l=>l.item==='labor')!.days).toBe(20);expect(r.health).toBe(0);});
 it('a grade change mid-month splits labor by days; health uses the month-end record',()=>{const r=insuranceForMonth('2026-08',[P({to:'2026-08-15'}),P({from:'2026-08-16',laborSalary:45800,healthAmount:45800})]);expect(r.lines.filter(l=>l.item==='labor').map(l=>l.days)).toEqual([15,15]);expect(r.health).toBe(710);});
});
describe('fail closed',()=>{
 it('a labor salary not on the 2026 grade table is held, not computed',()=>{const r=insuranceForMonth('2026-08',[P({laborSalary:30000})]);expect(r.status).toBe('needs-review');expect(r.issues.join()).toContain('分級表');});
 it('health below the first grade, pension over 6% and overlapping periods are held',()=>{expect(insuranceForMonth('2026-08',[P({healthAmount:20000})]).issues.join()).toContain('第一級');expect(insuranceForMonth('2026-08',[P({pensionSelfPercent:7})]).issues.join()).toContain('6%');expect(insuranceForMonth('2026-08',[P({to:'2026-08-20'}),P({from:'2026-08-10'})]).issues.join()).toContain('重疊');});
 it('months before the first rate entry are not guessed',()=>{expect(insuranceForMonth('2024-12',[P({from:'2024-01-01'})]).issues.join()).toContain('費率未建立');});
 it('not enrolled here → zero premiums, no issue',()=>{const r=insuranceForMonth('2026-08',[P({laborInsured:false,employmentInsured:false,healthInsuredHere:false})]);expect(r.status).toBe('ready');expect(r.labor+r.health).toBe(0);});
});

// Independent review regressions: confirmed enrollment amounts, never salary guesses.
describe('C3a independent review',()=>{
 it('rejects 30,000 as a health insured amount instead of charging 465',()=>{const r=insuranceForMonth('2026-08',[P({healthAmount:30000})]);expect(r.status).toBe('needs-review');expect(r.health).toBe(0);expect(r.issues.join()).toContain('分級表');});
 it('charges 470 only for the explicitly confirmed 30,300 health grade',()=>{const r=insuranceForMonth('2026-08',[P({healthAmount:30300})]);expect(r.status).toBe('ready');expect(r.health).toBe(470);});
 it('employment-only enrollment retains its independent 59 premium',()=>{const r=insuranceForMonth('2026-08',[P({laborInsured:false,employmentInsured:true})]);expect(r.status).toBe('ready');expect(r.labor).toBe(59);expect(r.lines.filter(l=>l.item==='labor')).toEqual([]);expect(r.lines.find(l=>l.item==='employment')?.amount).toBe(59);});
 it('employment-only enrollment requires a confirmed valid grade',()=>{const r=insuranceForMonth('2026-08',[P({laborInsured:false,employmentInsured:true,laborSalary:30000})]);expect(r.status).toBe('needs-review');expect(r.labor).toBe(0);});
});

it.each(['2025-08','2027-08'])('does not apply 2026 grades outside their verified year: %s',month=>{expect(insuranceForMonth(month,[P()]).status).toBe('needs-review');});

it('holds a 31-day split instead of treating 30 plus 1 contribution days as a valid month',()=>{
 const r=insuranceForMonth('2026-08',[P({to:'2026-08-30',pensionSelfPercent:6}),P({from:'2026-08-31',pensionSelfPercent:6})]);
 expect(r.status).toBe('needs-review');expect(r.issues.join()).toContain('超過30日');
});
it.each([{periods:[] as InsurancePeriod[]},{periods:[P({from:'2026-09-01'})]}])('holds a month with no enrollment evidence',({periods})=>{
 const r=insuranceForMonth('2026-08',periods);expect(r.status).toBe('needs-review');expect(r.issues.join()).toContain('未涵蓋');
});
