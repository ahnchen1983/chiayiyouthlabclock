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
 it('expiry is paid in the deadline month only',()=>{expect(settleCompLots([lot(60)],{first:'2026-11-01',last:'2026-11-30'},active).items).toHaveLength(0);expect(settleCompLots([lot(60)],dec,active).items).toHaveLength(1);});
 it('exit settles every lot in the exit month regardless of deadline',()=>{const s=settleCompLots([lot(60)],{first:'2026-09-01',last:'2026-09-30'},{exitInMonth:true,activeOn:()=>false});expect(s.items[0].reason).toBe('contract-ended');});
 it('a deadline after the employee left is not paid again',()=>{expect(settleCompLots([lot(60)],dec,{exitInMonth:false,activeOn:()=>false}).items).toHaveLength(0);});
 it('a lot without a confirmed original-day basis blocks instead of paying 0',()=>{const s=settleCompLots([lot(60,{originalWageBasis:{status:'pending-payroll',tiers:null}})],dec,active);expect(s.items).toHaveLength(0);expect(s.issues.join()).toContain('缺原加班日工資基礎');});
});
it('expired comp time joins December gross pay in the combined total',()=>{const RULES={schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240};const days=normalDays('2026-12');days.forEach(d=>(d.policy as any).overtimeRules=RULES);
 const r=normalPayPreview({id:'S',normalPayDays:days,normalPayContextDays:[],normalPayCompEvidence:{intervals:[],issues:[],credits:[],outstanding:[lot(60)]}},'2026-12',[],[],()=>true);
 expect(r.combined!.status,r.combined!.issues.join()).toBe('ready');expect(r.combined!.compSettlementExact).toEqual({numerator:'1000',denominator:'3'});expect(r.combined!.amount).toBe('30333.33');});
