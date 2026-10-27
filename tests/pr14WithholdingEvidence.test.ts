import {describe,it,expect} from 'vitest';
import {withholdingForMonth} from '../utils/payroll/withholding';
import {rational} from '../utils/payroll/rational';
const run=(gross:number,method:'table'|'part-time-5'='table',healthInsuredHere=false)=>withholdingForMonth({month:'2026-08',gross:rational(BigInt(gross)),overtimeLines:[],pensionSelf:0,method,healthInsuredHere});
describe('monthly aggregate is not payment or exemption evidence',()=>{
 it('does not charge every person insured elsewhere without eligibility proof',()=>{const r=run(30000);expect(r.status).toBe('needs-review');expect(r.supplementaryPremium).toBe(0);expect(r.issues.join()).toContain('補充保費');});
 it('does not infer one payment from a monthly sum that could be two actual 15000 payments',()=>{expect(run(30000).issues.join()).toContain('單次給付');});
 it('does not infer one taxable part-time payment from two possible 60000 payments',()=>{const r=run(120000,'part-time-5',true);expect(r.status).toBe('needs-review');expect(r.incomeTax).toBe(0);expect(r.issues.join()).toContain('單次給付');});
 it('retains below-threshold and insured-here controls',()=>{expect(run(29499).status).toBe('ready');expect(run(30000,'table',true).status).toBe('ready');});
});
it.each(['2025-08','2027-08','2026-13'])('does not extend 2026 withholding evidence to %s',month=>{const r=withholdingForMonth({month,gross:rational(30000n),overtimeLines:[],pensionSelf:0,method:'table',healthInsuredHere:true});expect(r.status).toBe('needs-review');});
