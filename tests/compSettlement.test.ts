import {describe,it,expect} from 'vitest';
import {settleCompLots} from '../utils/payroll/compSettlement';
import {normalPayPreview} from '../netlify/functions/utils/normalPayPreview';
import {normalDays} from './fixtures/normalPay';
// Synthetic: hourly 200, rest-day lot 09:00–12:00 (2h at 4/3, then 1h at 5/3).
const at=(t:string)=>Date.parse(t+'+08:00')/60000,R={numerator:'200',denominator:'1'};
const tiers=[{start:at('2026-08-01T09:00'),end:at('2026-08-01T11:00'),minutes:120,kind:'rest-day-additional',hourlyBasis:R,multiplier:{numerator:'4',denominator:'3'}},{start:at('2026-08-01T11:00'),end:at('2026-08-01T12:00'),minutes:60,kind:'rest-day-additional',hourlyBasis:R,multiplier:{numerator:'5',denominator:'3'}}];
const lot=(untakenMinutes:number,extra:any={})=>({id:'LOT',start:at('2026-08-01T09:00'),end:at('2026-08-01T12:00'),deadline:'2026-12-31',untakenMinutes,originalWageBasis:{status:'confirmed',tiers},...extra});
const dec={first:'2026-12-01',last:'2026-12-31'},active={exitInMonth:false,activeOn:()=>true};
describe('valuation at the original day (Art.32-1, used minutes are the earliest)',()=>{
 it('untaken 60 of 180 minutes are the last hour, paid at 5/3 = 1000/3',()=>{const s=settleCompLots([lot(60)],dec,active);expect(s.items[0]).toMatchObject({reason:'expired',minutes:60,exact:{numerator:'1000',denominator:'3'}});expect(s.items[0].parts[0].multiplier).toEqual({numerator:'5',denominator:'3'});});
 it('untaken 90 minutes span both tiers: 30 min at 4/3 + 60 min at 5/3 = 1400/3',()=>{expect(settleCompLots([lot(90)],dec,active).exact).toEqual({numerator:'1400',denominator:'3'});});
 it('fully untaken lot pays the whole original-day value 2600/3',()=>{expect(settleCompLots([lot(180)],dec,active).exact).toEqual({numerator:'2600',denominator:'3'});});
});
describe('which payroll month pays it',()=>{
 it('an already expired lot at a later exit requires settlement reconciliation, not a second payout',()=>{
  expect(settleCompLots([lot(60)],dec,active).items).toHaveLength(1);
  const s=settleCompLots([lot(60)],{first:'2027-01-01',last:'2027-01-31'},{exitInMonth:true,activeOn:()=>false});
  expect(s.items).toHaveLength(0);expect(s.issues.join()).toContain('結清紀錄');
 });
 it('expiry is paid in the deadline month only',()=>{expect(settleCompLots([lot(60)],{first:'2026-11-01',last:'2026-11-30'},active).items).toHaveLength(0);expect(settleCompLots([lot(60)],dec,active).items).toHaveLength(1);});
 it('exit settles every lot in the exit month regardless of deadline',()=>{const s=settleCompLots([lot(60)],{first:'2026-09-01',last:'2026-09-30'},{exitInMonth:true,activeOn:()=>false});expect(s.items[0].reason).toBe('contract-ended');});
 it('a deadline after the employee left is not paid again',()=>{expect(settleCompLots([lot(60)],dec,{exitInMonth:false,activeOn:()=>false}).items).toHaveLength(0);});
 it('a lot without a confirmed original-day basis blocks instead of paying 0',()=>{const s=settleCompLots([lot(60,{originalWageBasis:{status:'pending-payroll',tiers:null}})],dec,active);expect(s.items).toHaveLength(0);expect(s.issues.join()).toContain('缺原加班日工資基礎');});
});
describe('original tier evidence must cover the actual untaken tail exactly once',()=>{
 const value=(changed:any[])=>settleCompLots([lot(60,{originalWageBasis:{status:'confirmed',tiers:changed}})],dec,active);
 it('overlapping tiers cannot count the same original minutes twice',()=>{
  const s=value([tiers[1],tiers[1]]);expect(s.items).toHaveLength(0);expect(s.issues.length).toBeGreaterThan(0);
 });
 it('earlier minutes cannot fill a gap in the untaken tail',()=>{
  const s=value([tiers[0]]);expect(s.items).toHaveLength(0);expect(s.issues.length).toBeGreaterThan(0);
 });
 it.each([undefined,{numerator:'no-number',denominator:'1'},{numerator:'200',denominator:'0'},{numerator:'-200',denominator:'1'}])('invalid original hourly basis fails closed: %j',hourlyBasis=>{
  let s:ReturnType<typeof value>|undefined;expect(()=>{s=value([{...tiers[1],hourlyBasis}]);}).not.toThrow();
  expect(s!.items).toHaveLength(0);expect(s!.issues.length).toBeGreaterThan(0);
 });
 it('invalid multiplier and noninteger boundaries fail closed',()=>{
  for(const changed of [{...tiers[1],multiplier:{numerator:'4',denominator:'0'}},{...tiers[1],start:tiers[1].start+0.5}]){
   let s:ReturnType<typeof value>|undefined;expect(()=>{s=value([changed]);}).not.toThrow();expect(s!.items).toHaveLength(0);expect(s!.issues.length).toBeGreaterThan(0);
  }
 });
});
it('expired comp time joins December gross pay in the combined total',()=>{const RULES={schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240};const days=normalDays('2026-12'),context=[...normalDays('2026-11').slice(-2),...normalDays('2027-01').slice(0,2)].map(d=>({...d,covered:true}));[...days,...context].forEach(d=>(d.policy as any).overtimeRules=RULES);
 const r=normalPayPreview({id:'S',normalPayDays:days,normalPayContextDays:context,normalPayCompEvidence:{intervals:[],issues:[],credits:[],outstanding:[lot(60)]}},'2026-12',[],[],()=>true);
 expect(r.combined!.status,r.combined!.issues.join()).toBe('ready');expect(r.combined!.compSettlementExact).toEqual({numerator:'1000',denominator:'3'});expect(r.combined!.amount).toBe('30333.33');});
