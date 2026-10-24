import {normalPayPreview} from '../netlify/functions/utils/normalPayPreview';
import {describe,it,expect} from 'vitest';
import {calculateNormalPay} from '../utils/payroll/normalPay';
import {decimal,rational,rounded,evidence} from '../utils/payroll/rational';
import {normalPayCSV} from '../utils/payroll/normalPayExport';
import {normalDays,normalInterval,normalPolicy} from './fixtures/normalPay';
const calc=(days=normalDays(),intervals:any[]=[],month='2026-08')=>calculateNormalPay('SYNTH',month,days,intervals);
describe('C2a synthetic exact golden cases (not approved company policy)',()=>{
 it.each(['2026-08','2026-02'])('complete month %s is exactly 30000',month=>{const r=calc(normalDays(month),[],month);expect(r.status).toBe('ready');expect(r.amount).toBe('30000.00');expect(r.exactTotal).toEqual({numerator:'30000',denominator:'1'});});
 it('31-day inclusive hire on 16th earns 16/31, not 16/30 by default',()=>{const d=normalDays();d.slice(0,15).forEach(x=>x.employmentState='not-employed');expect(calc(d).amount).toBe('15483.87');});
 it('28-day inclusive hire on 15th earns exactly half',()=>{const d=normalDays('2026-02');d.slice(0,14).forEach(x=>x.employmentState='not-employed');expect(calc(d,[],'2026-02').amount).toBe('15000.00');});
 it('explicit 30-day deduction differs from calendar earned, no silent strategy choice',()=>{const d=normalDays();d.forEach(x=>x.policy!.monthlyStrategy='calendar-base-minus-30-unpaid-days');d.slice(0,15).forEach(x=>x.employmentState='not-employed');expect(calc(d).amount).toBe('15000.00');});
 it('exit on 15th is inclusive and later days earn nothing',()=>{const d=normalDays();d.slice(15).forEach(x=>x.employmentState='not-employed');expect(calc(d).amount).toBe('14516.13');});
 it('LOA 10 days and return use independent calendar fraction even with 30-day hire policy',()=>{const d=normalDays();d.forEach(x=>x.policy!.monthlyStrategy='calendar-base-minus-30-unpaid-days');d.slice(10,20).forEach(x=>x.employmentState='loa');expect(calc(d).amount).toBe('20322.58');});
 it('effective raise on 16th retains each source version and unrounded fractions',()=>{const d=normalDays();d.slice(15).forEach(x=>{x.amount='33000';x.payVersion='synthetic-master-v2';});const r=calc(d);expect(r.amount).toBe('31548.39');expect(r.segments[15].payVersion).toBe('synthetic-master-v2');expect(r.exactTotal).toEqual({numerator:'978000',denominator:'31'});});
 it('cross midnight hourly work splits at actual date/rate, not schedule bounds',()=>{const d=normalDays('2026-08',{payBasis:'hourly',amount:'200'});d[1].amount='250';const r=calc(d,[normalInterval('2026-08-01T23:00:00','2026-08-02T01:00:00')]);expect(r.amount).toBeNull();expect(r.exactTotal).toEqual({numerator:'450',denominator:'1'});expect(r.status).toBe('needs-review');expect(r.segments.map(s=>s.minutes)).toEqual([60,60]);});
 it('cross-month interval is clipped once per payroll month',()=>{const work=normalInterval('2026-07-31T23:00:00','2026-08-01T01:00:00');for(const month of ['2026-07','2026-08']){const r=calc(normalDays(month,{payBasis:'hourly',amount:'200'}),[work],month);expect(r.amount).toBeNull();expect(r.exactTotal).toEqual({numerator:'200',denominator:'1'});}});
 it('hourly 6h work and 2h half-paid leave = 1400, no second absence deduction',()=>{const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),[normalInterval('2026-08-01T09:00:00','2026-08-01T15:00:00'),normalInterval('2026-08-01T15:00:00','2026-08-01T17:00:00',{kind:'leave',leaveType:'病假',sourceId:'L1'})]);expect(r.amount).toBe('1400.00');});
 it('monthly unpaid leave deducts once with explicit divisor; paid comp adds no second monthly payment',()=>{const r=calc(normalDays(),[normalInterval('2026-08-01T09:00:00','2026-08-01T10:00:00',{kind:'leave',leaveType:'事假',sourceId:'L1'}),normalInterval('2026-08-01T10:00:00','2026-08-01T11:00:00',{kind:'comp',sourceId:'COMP1'})]);expect(r.amount).toBe('29875.00');expect(r.segments.find(s=>s.kind==='monthly-paid-comp-no-extra')?.exact.numerator).toBe('0');});
 it('approved hourly comp use retains independent source and paid minutes',()=>{const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),[normalInterval('2026-08-01T09:00:00','2026-08-01T10:00:00',{kind:'comp',sourceId:'COMP1'})]);expect(r.amount).toBe('200.00');expect(r.segments[0].sourceIds[0]).toBe('COMP1');});
 it.each(['leave','comp'])('overlapping work and %s is blocked, not double paid',kind=>{const w=normalInterval('2026-08-01T09:00:00','2026-08-01T10:00:00');const r=calc(normalDays(),[w,{...w,kind,leaveType:'特休',sourceId:'OTHER'}]);expect(r.amount).toBeNull();expect(r.issues).toContain('工作／假單／補休來源區間重疊，不能重複給薪');});
 it('extra 60 minutes remain explicit pending C2b, never waived as zero',()=>{const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),[normalInterval('2026-08-01T09:00:00','2026-08-01T18:00:00')]);expect(r.amount).toBeNull();expect(r.extraWorkMinutes).toBe(60);expect(r.statutoryOvertimeAmount).toBeNull();expect(r.exactTotal.numerator).toBe('1600');});
 it('rest day work never uses ordinary 8h threshold as a payable policy',()=>{const d=normalDays('2026-08',{payBasis:'hourly',amount:'200'});d[0].dayType='rest';const r=calc(d,[normalInterval('2026-08-01T09:00:00','2026-08-01T10:00:00')]);expect(r.amount).toBeNull();expect(r.extraWorkMinutes).toBe(60);});
 it.each(['missing-policy','missing-rounding','missing-loa','missing-day','duplicate-day'])('%s is needs-review, not zero',kind=>{const d=normalDays();if(kind==='missing-policy')d[0].policy=null;if(kind==='missing-rounding')d[0].policy!.rounding=null as any;if(kind==='missing-loa')d[0].policy!.loa=null as any;if(kind==='missing-day')d.shift();if(kind==='duplicate-day')d.push(d[0]);expect(calc(d).amount).toBeNull();expect(calc(d).status).toBe('needs-review');});
 it('rounding stage is explicit: 31 rounded daily items differ from one exact monthly total',()=>{const d=normalDays();d.forEach(x=>x.policy!.rounding.stage='per-item');expect(calc(d).amount).toBe('29999.94');expect(calc().amount).toBe('30000.00');});
 it.each([['half-up','1.005','1.01'],['half-even','1.005','1.00'],['half-even','1.015','1.02'],['toward-zero','-1.009','-1.00'],['half-up','-0.004','0.00']])('exact rounding %s(%s)=%s',(mode,value,want)=>expect(rounded(decimal(value),{...normalPolicy().rounding,mode:mode as any})).toBe(want));
 it('invalid fractional minutes and unsafe decimals fail closed without runtime BigInt exceptions',()=>{const w=normalInterval('2026-08-01T09:00:00','2026-08-01T10:00:00');w.start+=0.1;expect(calc(normalDays(),[w]).amount).toBeNull();expect(()=>decimal('1e30')).toThrow();});
 it('all non-employed 31 days under deduction strategy cannot become a negative debt',()=>{const d=normalDays();d.forEach(x=>{x.employmentState='not-employed';x.policy!.monthlyStrategy='calendar-base-minus-30-unpaid-days';});expect(calc(d).amount).toBeNull();});
 it('CSV uses exact API evidence and rounded strings without recalculating',()=>{const r=calc();const csv=normalPayCSV(r);expect(csv).toContain('"30000.00"');expect(csv).toContain('"30000","31",""');expect(r.segments.every(s=>s.rounded===null)).toBe(true);expect(csv).toContain('不得據此發薪');expect(evidence(rational(-0n))).toEqual({numerator:'0',denominator:'1'});});
});

it('untyped approval metadata is never accepted as a policy or work proof',()=>{const d=normalDays();d[0].policy!.approvedBy={} as any;expect(calc(d).amount).toBeNull();const i=normalInterval('2026-08-01T09:00:00','2026-08-01T10:00:00');i.approvalId={} as any;expect(calc(normalDays(),[i]).amount).toBeNull();});
it('unapproved leave ratio cannot quietly turn into unpaid leave',()=>{const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),[normalInterval('2026-08-01T09:00:00','2026-08-01T10:00:00',{kind:'leave',leaveType:'未核假別'})]);expect(r.amount).toBeNull();expect(r.issues.some(x=>x.includes('給薪比例未核定'))).toBe(true);});

it.each(['continuous','split-card','break-same-source'])('cross-day %s cannot reset normal allowance at midnight',kind=>{
 const first=normalInterval('2026-08-01T20:00:00','2026-08-02T06:00:00');
 const intervals=kind==='continuous'?[first]:[ {...first,end:Date.parse('2026-08-02T00:00:00+08:00')/60000}, {...first,start:Date.parse(kind==='break-same-source'?'2026-08-02T01:00:00+08:00':'2026-08-02T00:00:00+08:00')/60000,sourceId:kind==='split-card'?'CARD2':first.sourceId} ];
 const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),intervals);
 expect(r.amount).toBeNull();expect(r.status).toBe('needs-review');expect(r.statutoryOvertimeAmount).toBeNull();expect(r.issues.some(x=>x.includes('跨日工作須合併'))).toBe(true);
});

it.each(['legacy-date','effective-exit'])('manual exit %s cannot be replaced by a trial proration',kind=>{
 const days=normalDays();if(kind==='effective-exit')days.slice(15).forEach(d=>d.employmentState='not-employed');
 const employee={id:'SYNTH',normalPayDays:days,normalPayCompEvidence:{intervals:[],issues:[]},...(kind==='legacy-date'?{resignDate:'2026-08-15'}:{})};
 const r=normalPayPreview(employee,'2026-08',[],[],()=>true);
 expect(r.amount).toBeNull();expect(r.issues.some(x=>x.includes('離職當月日期與薪資須人工輸入'))).toBe(true);expect(r.exactTotal.numerator).not.toBe('0');
});

it('adopted rehire authority does not let stale legacy exit date block the new month',()=>{
 const employee={id:'SYNTH',resignDate:'2026-08-01',normalPayDays:normalDays(),normalPayCompEvidence:{intervals:[],issues:[]},employmentAuthority:{kind:'effective-master',periods:[{from:'2026-08-01',to:'2026-08-31',employmentState:'active'}]}};
 expect(normalPayPreview(employee,'2026-08',[],[],()=>true).amount).toBe('30000.00');
});
it('known effective exit on final month day still requires manual salary, without guessing a finite timeline end is an exit',()=>{
 const employee={id:'SYNTH',normalPayDays:normalDays(),normalPayCompEvidence:{intervals:[],issues:[]},employmentAuthority:{kind:'effective-master',periods:[{from:'2026-08-01',to:'2026-08-31',employmentState:'active'},{from:'2026-09-01',to:'2026-09-30',employmentState:'not-employed'}]}};
 expect(normalPayPreview(employee,'2026-08',[],[],()=>true).amount).toBeNull();
});
const splitNight=()=>[normalInterval('2026-08-01T20:00:00','2026-08-01T23:30:00',{sourceId:'FIRST'}),normalInterval('2026-08-02T00:30:00','2026-08-02T06:00:00',{sourceId:'SECOND'})];
const identity=(id='shift-1',date='2026-08-01')=>({id,date,version:'synthetic-workday-v1',reviewedBy:'synthetic-manager',reviewedAt:'2026-08-03T00:00:00Z'});
it('C2a fix split cards with a midnight break have unknown workday allocation, not ready 1800',()=>{const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),splitNight());expect(r.status).toBe('needs-review');expect(r.amount).toBeNull();expect(r.exactTotal.numerator).toBe('1800');});
it('C2a fix approved same-workday mapping preserves nine hours and separates one extra hour',()=>{const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),splitNight().map(i=>({...i,workday:identity()})));expect(r.amount).toBeNull();expect(r.extraWorkMinutes).toBe(60);expect(r.exactTotal.numerator).toBe('1600');expect(r.statutoryOvertimeAmount).toBeNull();});
it('C2a fix explicit separate workday mapping differs from guessing by a rest gap',()=>{const r=calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),splitNight().map((i,n)=>({...i,workday:identity('shift-'+n,'2026-08-0'+(n+1))})));expect(r.amount).toBe('1800.00');expect(r.extraWorkMinutes).toBe(0);});
it.each(['missing-second','unapproved','conflicting-date'])('C2a fix %s mapping fails closed',mode=>{const intervals=splitNight().map(i=>({...i,workday:identity()}));if(mode==='missing-second')delete intervals[1].workday;if(mode==='unapproved')intervals[1].workday.reviewedBy='';if(mode==='conflicting-date')intervals[1].workday.date='2026-08-02';expect(calc(normalDays('2026-08',{payBasis:'hourly',amount:'200'}),intervals).amount).toBeNull();});
