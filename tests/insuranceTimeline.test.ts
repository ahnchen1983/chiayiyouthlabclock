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
