import {describe,expect,it} from 'vitest';
import {loadPayrollPreWithholdingSource} from '../netlify/functions/utils/payrollPreWithholdingSource';
const empId='synthetic@example.test',month='2026-08',sourceHash='a'.repeat(64);
const args={empId,month,at:'2026-10-26T00:00:00Z'};
// The complete upstream boundary is supplied explicitly. Any accidental further
// database access fails; this suite invokes the real projection without mocks.
const db={collection(){throw Error('Unexpected database access for existing source');}};
const reader={async get(){throw Error('Unexpected database read for existing source');}};
function source():any{return {kind:'live',sourceHash,evaluation:{salaries:[{empId,reviewReasons:[],withholdingDetail:{method:'part-time-5',issues:[]},normalPayPreview:{status:'ready',rounding:{version:'synthetic-precision-2',status:'approved',approvedBy:'SYNTHETIC_REVIEWER',approvedAt:'2026-07-01T00:00:00Z',stage:'final',precision:2,mode:'half-up'},combined:{status:'ready',amount:'32000.00',normalExact:{numerator:'32000',denominator:'1'},overtimeExact:{numerator:'0',denominator:'1'}},overtimePreview:{blocking:[],issues:[],lines:[]}},insuranceDetail:{status:'ready',pensionSelf:1818,lines:[{item:'labor',amount:679},{item:'employment',amount:59},{item:'health',amount:458},{item:'pension-self',amount:1818}]}}]},snapshotInputs:{employees:[{id:empId,insuranceSource:{versionId:'SYNTHETIC_INSURANCE',evidenceVersion:'b'.repeat(64)}}]},sourceEvidence:{itemInventories:{[empId]:{assessment:{status:'confirmed-none'}}}}};}
const project=(v:any)=>loadPayrollPreWithholdingSource(db,reader,args,v);
const salary=(v:any)=>v.evaluation.salaries[0];
describe('pre-withholding source exact integer normalization after approved precision',()=>{
 it('accepts precision-two 32000.00 as exact 32000 without changing statutory items',async()=>{
  const v=source(),before=JSON.stringify(v),result=await project(v);
  expect(result.baseSourceHash).toBe(sourceHash);expect(result.issues).toEqual([]);
  expect(result.source).toMatchObject({empId,month,status:'ready',earnings:[{code:'normal',amount:'32000'},{code:'overtime',amount:'0'},{code:'comp-settlement',amount:'0'}],pensionSelf:{amount:'1818'},otherDeductions:[{code:'insurance:labor',amount:'679'},{code:'insurance:employment',amount:'59'},{code:'insurance:health',amount:'458'}]});
  expect(result.source?.sourceHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(v)).toBe(before);
 });
 it('canonicalizes alternate exact-integer formatting to the same projected identity',async()=>{
  const first=source(),second=source();salary(second).normalPayPreview.combined.amount='32000';
  expect(await project(second)).toEqual(await project(first));
 });
 it('preserves explicit zero as a known amount',async()=>{
  const v=source();salary(v).normalPayPreview.combined={status:'ready',amount:'0.00',normalExact:{numerator:'0',denominator:'1'},overtimeExact:{numerator:'0',denominator:'1'}};
  expect((await project(v)).source?.earnings.map((e:any)=>e.amount)).toEqual(['0','0','0']);
 });
 it('holds a genuine normal amount of 32000.50 without rounding it to an integer',async()=>{
  const v=source(),c=salary(v).normalPayPreview.combined;c.normalExact={numerator:'64001',denominator:'2'};c.amount='32000.50';const before=JSON.stringify(v);
  expect(await project(v)).toMatchObject({source:null,baseSourceHash:sourceHash,issues:['pre-withholding-amount-projection-unresolved']});expect(JSON.stringify(v)).toBe(before);
 });
 it('holds fractional overtime and comp allocations independently of integral normal wages',async()=>{
  for(const component of ['overtime','comp']){const v=source(),c=salary(v).normalPayPreview.combined;c.amount='32000.50';if(component==='overtime')c.overtimeExact={numerator:'1',denominator:'2'};expect(await project(v)).toMatchObject({source:null,issues:['pre-withholding-amount-projection-unresolved']});}
 });
 it('does not accept negative normal amounts or negative residual comp allocation',async()=>{
  const negative=source();salary(negative).normalPayPreview.combined.normalExact={numerator:'-32000',denominator:'1'};salary(negative).normalPayPreview.combined.amount='-32000.00';
  const residual=source();salary(residual).normalPayPreview.combined.amount='31999.00';
  for(const v of [negative,residual])expect(await project(v)).toMatchObject({source:null,issues:['pre-withholding-amount-projection-unresolved']});
 });
 it('keeps missing or unapproved earnings unknown rather than treating them as zero',async()=>{
  for(const edit of [(v:any)=>salary(v).normalPayPreview.combined.amount=null,(v:any)=>salary(v).normalPayPreview.status='needs-review',(v:any)=>salary(v).normalPayPreview.rounding.status='draft']){const v=source();edit(v);expect(await project(v)).toMatchObject({source:null,issues:['confirmed-pre-withholding-earnings-unavailable']});}
 });
 it('does not project unavailable insurance or a locked historical source',async()=>{
  const v=source();salary(v).insuranceDetail.status='needs-review';expect(await project(v)).toMatchObject({source:null,issues:['confirmed-insurance-and-pension-source-unavailable']});
  expect(await project({kind:'locked'})).toMatchObject({source:null,baseSourceHash:null,issues:['pre-withholding-source-requires-unlocked-original-month']});
 });
});
