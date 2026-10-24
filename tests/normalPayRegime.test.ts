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
it('overtime workday regime that differs from the approved normal policy regime is flagged',()=>{const proof={version:'fixture-v1',reviewedBy:'SYNTHETIC',reviewedAt:'2026-08-02T00:00:00Z'};const days=normalDays('2026-08',{payBasis:'hourly',amount:'200'});const work=normalInterval('2026-08-01T08:00:00','2026-08-01T17:00:00',{approvalId:'SYNTHETIC@2026-08-02T00:00:00Z',workday:{...proof,id:'D',date:'2026-08-01'}});
 for(const d of days)d.policy!.overtime={schemaVersion:'overtime-scope-v1',workdays:[{...proof,id:'D',date:'2026-08-01',weekId:'W',dayType:'normal',regime:'variable',contractMinutes:480,holidayConsent:'unknown',emergency:'absent'}],wages:[],weeks:[]};
 expect(overtimePreview(days,[work]).issues.join()).toContain('工時制度與正常薪資政策不一致');});
