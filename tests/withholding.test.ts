import {describe,it,expect} from 'vitest';
import {withholdingForMonth,exemptOvertime} from '../utils/payroll/withholding';
import {rational,evidence} from '../utils/payroll/rational';
// Synthetic figures only.
const R=(n:number)=>rational(BigInt(n));
const line=(kind:string,start:number,minutes:number,value:number):any=>({kind,start,end:start+minutes,minutes,exact:evidence(R(value))});
const run=(gross:number,extra:any={})=>withholdingForMonth({month:'2026-08',gross:R(gross),overtimeLines:[],pensionSelf:0,method:'table',healthInsuredHere:true,...extra});
describe('tax-free overtime (MOF 台財稅第16713號)',()=>{
 it('calculates the 46-hour candidate cap without certifying the applicable regime',()=>{const e=exemptOvertime([line('weekday-overtime',0,40*60,8000),line('rest-day-additional',10000,8*60,2000)]);expect(e).toEqual(rational(8000n+1500n));});
 it('holiday overtime is tax-free and outside the 46 hours',()=>{expect(exemptOvertime([line('weekday-overtime',0,46*60,9200),line('holiday-work',10000,8*60,3200)])).toEqual(R(12400));});
 it('converted (no cash) lines are ignored',()=>{expect(exemptOvertime([{kind:'comp-converted',start:0,end:60,minutes:60,exact:null} as any])).toEqual(R(0));});
});
describe('withholding methods (2026)',()=>{
 it('tax table: below the 90,501 starting point withholds nothing',()=>{const r=run(48000);expect(r.status).toBe('ready');expect(r.incomeTax).toBe(0);});
 it('tax table above the starting point requires a confirmed declaration',()=>{expect(run(95000).issues.join()).toContain('扣繳稅額表');});
 it('5% elected: 2,000 or less is not withheld; 48,000 → 2,400',()=>{expect(run(40000,{method:'flat-5'}).incomeTax).toBe(0);expect(run(48000,{method:'flat-5'}).incomeTax).toBe(2400);});
 it('base excludes tax-free overtime and voluntary pension',()=>{const r=run(50000,{method:'flat-5',pensionSelf:2748,overtimeLines:[line('weekday-overtime',0,120,1252)]});expect(r.taxableBase).toEqual(evidence(R(46000)));expect(r.incomeTax).toBe(2300);});
 it('part-time 5% only when one payment reaches 90,501',()=>{expect(run(60000,{method:'part-time-5'}).incomeTax).toBe(0);expect(run(100000,{method:'part-time-5'}).status).toBe('needs-review');});
 it('non-resident: 6% up to 44,250, 18% above',()=>{expect(run(44000,{method:'non-resident'}).incomeTax).toBe(2640);expect(run(50000,{method:'non-resident'}).incomeTax).toBe(9000);});
 it('a fractional 5% amount is held: rounding rule not confirmed',()=>{const r=run(48010,{method:'flat-5'});expect(r.issues.join()).toContain('進位方式待確認');});
 it('a missing method is held',()=>{expect(run(30000,{method:undefined}).issues.join()).toContain('扣繳方式未登錄');});
});
describe('supplementary premium for pay to someone not enrolled here (NHIA)',()=>{
 it('requires payment and exemption evidence above the ordinary threshold',()=>{const r=run(30000,{healthInsuredHere:false});expect(r.status).toBe('needs-review');expect(r.supplementaryPremium).toBe(0);});
 it('nothing below the minimum wage, nothing for people enrolled here',()=>{expect(run(29499,{healthInsuredHere:false}).supplementaryPremium).toBe(0);expect(run(40000).supplementaryPremium).toBe(0);});
});

describe('reviewed table declaration',()=>{
 const declaration={spouseAndDependantsCount:0,countConfirmed:true,countSourceRef:'declaration-2026-08'};
 it('uses the official cell with explicit confirmed zero',()=>{expect(run(90501,declaration)).toMatchObject({status:'ready',incomeTax:2020});});
 it('uses declared spouse/dependants independently of health dependants',()=>{expect(run(99001,{...declaration,spouseAndDependantsCount:1})).toMatchObject({status:'ready',incomeTax:2020});});
 it('uses an exact official above-table formula with reviewed declaration',()=>{expect(run(500005,{...declaration,spouseAndDependantsCount:2})).toMatchObject({status:'ready',incomeTax:94177});});
 it('supports exact formula for a reviewed count beyond printed columns',()=>{expect(run(300000,{...declaration,spouseAndDependantsCount:14})).toMatchObject({status:'ready',incomeTax:13675});});
 it('holds fractional extension tax without defaulting it to a ready zero',()=>{expect(run(500001,declaration)).toMatchObject({status:'needs-review',incomeTax:0});});
 it.each([{countConfirmed:false},{countSourceRef:undefined},{spouseAndDependantsCount:undefined},{spouseAndDependantsCount:12}])('holds unsupported declaration %j',extra=>{expect(run(100000,{...declaration,...extra}).status).toBe('needs-review');});
 it('holds fractional placement at the starting boundary',()=>{expect(run(90500,{...declaration,gross:rational(181001n,2n)}).status).toBe('needs-review');});
});

it('holds withholding beyond the supported exemption cap instead of assuming an extended regime',()=>{const r=run(50000,{overtimeLines:[line('weekday-overtime',0,47*60,9400)]});expect(r.status).toBe('needs-review');expect(r.issues.join()).toContain('超過46小時');});
