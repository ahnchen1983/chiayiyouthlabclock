import {describe,it,expect} from 'vitest';
import {validateItemExecutionPolicy,assessItemExecutionPolicy,type ItemExecutionPolicy} from '../utils/payroll/itemApplication';
import {ITEM_TREATMENT_PURPOSES} from '../utils/payroll/itemTreatment';
const inventory=()=>({empId:'SYNTH',month:'2026-04',mode:'items',sourceRefs:['SYNTH-INVENTORY'],reason:'synthetic fixed item evidence',items:[
 {itemCode:'EXTRA',kind:'earning',amount:'1000.25',from:'2026-04-01',to:'2026-04-30',sourceRefs:['SYNTH-EARNING'],reason:'synthetic independently classified earning'},
 {itemCode:'RECOVERY',kind:'deduction',amount:'50.10',from:'2026-04-15',to:'2026-04-15',sourceRefs:['SYNTH-DEDUCTION'],reason:'synthetic authorized posttax deduction'},
]});
const proof=()=>ITEM_TREATMENT_PURPOSES.map(purpose=>({purpose,status:'documented' as const,sourceRefs:['SYNTH-AUTHORITY-'+purpose],reason:'synthetic source authority evidence',authorityOccurredAt:'2026-03-01T00:00:00Z',effectiveFrom:'2026-04-01',effectiveTo:'2026-04-30'}));
const policy=():ItemExecutionPolicy=>({sourceRefs:['SYNTH-POLICY'],reason:'synthetic explicit execution decisions',items:[
 {itemCode:'EXTRA',recipe:'fixed-taxable-earning',normalWage:'excluded-by-reviewed-evidence',incomeTax:'included',supplementaryPremium:'included',insuranceReporting:'confirmed-timeline',deductionAuthority:'not-applicable',evidence:proof(),reason:'synthetic earning classification'},
 {itemCode:'RECOVERY',recipe:'fixed-posttax-deduction',normalWage:'excluded-by-reviewed-evidence',incomeTax:'not-applicable',supplementaryPremium:'not-applicable',insuranceReporting:'not-applicable',deductionAuthority:'authorized',evidence:proof(),reason:'synthetic deduction authority'},
]});
const assess=(p:unknown=policy(),i:unknown=inventory(),insuranceConfirmed=true)=>assessItemExecutionPolicy(p,i,{insuranceConfirmed});
describe('bounded fixed item application with explicit policy',()=>{
 it('executes exact earning and posttax deduction with stable separate bases',()=>{
  const r=assess();expect(r.status).toBe('ready');expect(r.supported).toBe(true);expect(r.earningsExact).toEqual({numerator:'4001',denominator:'4'});expect(r.deductionsExact).toEqual({numerator:'501',denominator:'10'});
  expect(r.taxableEarningsExact).toEqual(r.earningsExact);expect(r.supplementaryEarningsExact).toEqual(r.earningsExact);expect(r.lines.map(l=>l.code)).toEqual(['item:EXTRA','item:RECOVERY']);expect(r.lines[1].amount).toBe('50.1');
  expect(r.formalEligibility).toBe('BLOCKED');expect(r.paymentStatus).toBe('not-paid');
 });
 it('does not prorate the explicit fixed amount or round fractions',()=>{const i=inventory();i.items[0].from='2026-04-15';i.items[0].to='2026-04-15';i.items[0].amount='0.01';expect(assess(policy(),i).earningsExact).toEqual({numerator:'1',denominator:'100'});});
 it('accepts explicit zero without confusing it with missing',()=>{const i=inventory();i.items[0].amount='0';expect(assess(policy(),i).earningsExact).toEqual({numerator:'0',denominator:'1'});i.items[0].amount='';expect(assess(policy(),i).status).toBe('needs-review');});
 it.each(['amount','formula','ready'])('rejects client %s in execution policy',field=>{const p:any=policy();p.items[0][field]=field==='formula'?'gross * 0.1':'100';expect(()=>validateItemExecutionPolicy(p)).toThrow();});
 it('does not upgrade legacy narrative evidence to execution decisions',()=>{const p:any=policy();for(const item of p.items){delete item.recipe;item.category='bonus';}expect(assess(p).status).toBe('needs-review');});
 it.each(['missing','extra','duplicate','unknown-recipe'])('requires exact item coverage and bounded recipes: %s',mode=>{const p:any=policy();if(mode==='missing')p.items.pop();if(mode==='extra')p.items.push({...p.items[0],itemCode:'EXTRA-OTHER'});if(mode==='duplicate')p.items.push(p.items[0]);if(mode==='unknown-recipe')p.items[0].recipe='automatic-bonus';expect(assess(p).status).toBe('needs-review');});
 it('does not derive exclusion from an item label',()=>{const p=policy();p.items[0].normalWage='unresolved';const i=inventory();i.items[0].reason='bonus label is not authority';expect(assess(p,i).status).toBe('needs-review');});
 it('requires confirmed insurance binding for earning application',()=>{expect(assess(policy(),inventory(),false).issues).toContain('item-execution-insurance-source-unconfirmed:EXTRA');});
 it('rejects recipe kind mismatch and deductions that alter taxable bases',()=>{const i=inventory();i.items[1].kind='earning';expect(assess(policy(),i).status).toBe('needs-review');const p=policy();p.items[1].incomeTax='included';expect(assess(p).status).toBe('needs-review');});
 it('requires every evidence purpose documented for the full item period',()=>{const p=policy();p.items[0].evidence[0]={purpose:'entitlement',status:'unresolved',sourceRefs:[],reason:'synthetic evidence not established'};expect(assess(p).status).toBe('needs-review');const q=policy();q.items[0].evidence[0].effectiveTo='2026-04-29';expect(assess(q).issues).toContain('item-execution-evidence-period-mismatch:entitlement:EXTRA');});
 it('rejects missing or malformed actual authority timestamps without reading a clock',()=>{const p:any=policy();delete p.items[0].evidence[0].authorityOccurredAt;expect(assess(p).status).toBe('needs-review');p.items[0].evidence[0].authorityOccurredAt='tomorrow';expect(assess(p).status).toBe('needs-review');});
 it('holds all totals and applied lines if any one item remains unresolved',()=>{const p=policy();p.items[1].deductionAuthority='unresolved';const r=assess(p);expect(r.lines).toEqual([]);expect(r.earningsExact).toBeNull();expect(r.deductionsExact).toBeNull();expect(r.taxableEarningsExact).toBeNull();expect(r.supported).toBe(false);});
 it('does not mutate inputs or depend on declaration ordering',()=>{const p=policy(),i=inventory(),before=JSON.stringify([p,i]),a=assess(p,i);expect(JSON.stringify([p,i])).toBe(before);p.items.reverse();expect(assess(p,i)).toEqual(a);});
});
