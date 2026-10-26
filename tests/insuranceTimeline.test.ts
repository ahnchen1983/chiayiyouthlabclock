import {it,expect} from 'vitest';
import {validateInsurancePeriods} from '../netlify/functions/utils/insuranceTimeline';
// Synthetic periods only.
const P=(extra:any={})=>({from:'2026-08-01',to:'2026-12-31',laborInsured:true,laborSalary:29500,employmentInsured:true,healthInsuredHere:true,healthAmount:29500,healthDependants:0,pensionWage:30300,pensionSelfPercent:6,withholdingMethod:'table',...extra});
const code=(f:()=>any)=>{try{f();return 0;}catch(e:any){return e.statusCode;}};
it('accepts a complete period and normalises unused fields to 0',()=>{expect(validateInsurancePeriods([P({laborInsured:false,employmentInsured:false,laborSalary:45800})])[0].laborSalary).toBe(0);});
it.each([
 ['labor salary off the grade table',{laborSalary:30000}],['health amount not a grade',{healthAmount:30000}],['employment-only invalid grade',{laborInsured:false,laborSalary:30000}],['health below the first grade',{healthAmount:20000}],
 ['negative dependants',{healthDependants:-1}],['pension above 6%',{pensionSelfPercent:6.5}],['pension with three decimals',{pensionSelfPercent:1.234}],['pension without a wage',{pensionWage:0}],
 ['unanswered insured flag',{healthInsuredHere:undefined}],['unanswered withholding method',{withholdingMethod:undefined}],['reversed dates',{from:'2026-12-31',to:'2026-08-01'}],
])('refuses %s',(_n,extra)=>{expect(code(()=>validateInsurancePeriods([P(extra)]))).toBe(400);});
it('refuses overlapping or empty timelines',()=>{expect(code(()=>validateInsurancePeriods([P({to:'2026-09-30'}),P({from:'2026-09-15'})]))).toBe(400);expect(code(()=>validateInsurancePeriods([]))).toBe(400);});

it('accepts employment-only enrollment and retains the confirmed grade',()=>{const p=validateInsurancePeriods([P({laborInsured:false,employmentInsured:true})])[0];expect(p.laborInsured).toBe(false);expect(p.employmentInsured).toBe(true);expect(p.laborSalary).toBe(29500);});

it('retains confirmed insurance head/version identity without exposing unrelated fields',async()=>{
 const {loadInsuranceEvidence}=await import('../netlify/functions/utils/insuranceTimeline');
 const rows:any={'insuranceTimelineHeads/E1':{currentVersionId:'V1',revision:2},'insuranceTimelineVersions/V1':{empId:'E1',status:'approved',approvedBy:'A2',approvedAt:'2026-08-01T00:00:00Z',periods:[P({privateContact:'NESTED_SYNTHETIC_PRIVATE'})],privateNote:'not part of provenance'}};
 const reads:string[]=[];const db:any={collection:(c:string)=>({doc:(id:string)=>({path:c+'/'+id,get:async()=>({exists:!!rows[c+'/'+id],data:()=>rows[c+'/'+id],id})})})};
 const tx={get:async(r:any)=>{reads.push(r.path);return r.get();}};
 const a=await loadInsuranceEvidence(db,tx,'E1');expect(a.periods).toEqual([P()]);expect(a.source).toMatchObject({versionId:'V1',headRevision:2});expect(a.source.evidenceVersion).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(a.source)).not.toContain('privateNote');expect(JSON.stringify(a)).not.toContain('NESTED_SYNTHETIC_PRIVATE');
 rows['insuranceTimelineVersions/V1'].periods=[P({healthDependants:1})];const b=await loadInsuranceEvidence(db,tx,'E1');expect(b.source.evidenceVersion).not.toBe(a.source.evidenceVersion);expect(reads).toEqual(['insuranceTimelineHeads/E1','insuranceTimelineVersions/V1','insuranceTimelineHeads/E1','insuranceTimelineVersions/V1']);
});
it('insurance provenance stays missing for absent, malformed or foreign approved heads',async()=>{
 const {loadInsuranceEvidence}=await import('../netlify/functions/utils/insuranceTimeline');
 for(const head of [null,{currentVersionId:'V1',revision:0},{currentVersionId:'V1',revision:1}]){
  const rows:any={'insuranceTimelineHeads/E1':head,'insuranceTimelineVersions/V1':{empId:'OTHER',status:'approved',periods:[P()]}};
  const db:any={collection:(c:string)=>({doc:(id:string)=>({get:async()=>({exists:!!rows[c+'/'+id],data:()=>rows[c+'/'+id],id})})})};
  expect((await loadInsuranceEvidence(db,null,'E1')).source).toBeNull();
 }
});
