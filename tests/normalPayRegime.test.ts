import {it,expect} from 'vitest';
import {calculateNormalPay} from '../utils/payroll/normalPay';
import {overtimePreview} from '../netlify/functions/utils/overtimePreview';
import {normalDays,normalInterval} from './fixtures/normalPay';
// Synthetic only. Monthly rostering is not proof of a statutory regime; missing or
// unsupported regimes must stay pending while keeping the computed evidence.
const calc=(days=normalDays())=>calculateNormalPay('SYNTH','2026-08',days,[]);
it('approved standard-8-40 regime keeps the exact 30000 candidate ready',()=>{const r=calc();expect(r.status).toBe('ready');expect(r.amount).toBe('30000.00');});
it.each([undefined,'unknown','variable','84-1'])('regime %s blocks ready but keeps segment evidence',regime=>{const d=normalDays();d.forEach(x=>{if(regime===undefined)delete (x.policy as any).workRegime;else (x.policy as any).workRegime=regime;});const r=calc(d);expect(r.status).toBe('needs-review');expect(r.amount).toBeNull();expect(r.segments).toHaveLength(31);expect(r.exactTotal).toEqual({numerator:'30000',denominator:'1'});expect(r.issues.join()).toContain('工時制度');});
it('one unsupported day inside the month is enough to block',()=>{const d=normalDays();d[19].policy={...d[19].policy!,workRegime:'variable' as any};const r=calc(d);expect(r.status).toBe('needs-review');expect(r.issues.join()).toContain('2026-08-20');});
it('a worked day under an unsupported regime blocks the overtime part too',()=>{const days=normalDays('2026-08',{payBasis:'hourly',amount:'200'});days.forEach(d=>(d.policy as any).overtimeRules={schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240});days[2].policy={...days[2].policy!,workRegime:'variable' as any};
 const work=normalInterval('2026-08-03T08:00:00','2026-08-03T17:00:00',{approvalId:'SYNTHETIC@2026-08-04T00:00:00Z',sourceDate:'2026-08-03'});
 const r=overtimePreview({empId:'SYNTH',month:'2026-08',days,contextDays:[],intervals:[work]});expect(r.blocking.join()).toContain('特殊制度');expect(r.monthExact).toBeNull();});
