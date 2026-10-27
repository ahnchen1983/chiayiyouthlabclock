import {it,expect} from 'vitest';
import {employmentStateOn,employmentWindowStates} from '../utils/employmentAuthority';
const legacy={hireDate:'2020-01-01',resignDate:'2026-04-30'};
const employee={...legacy,employmentAuthority:{kind:'effective-master',version:'synthetic-v1',accountKind:'employee',from:'2026-05-01',to:'2026-05-31',periods:[{from:'2026-05-01',to:'2026-05-10',employmentState:'active'},{from:'2026-05-11',to:'2026-05-15',employmentState:'loa'},{from:'2026-05-16',to:'2026-05-31',employmentState:'active'}]}};
it('adopted rehire is authoritative but unrepresented dates stay unknown',()=>{expect(employmentStateOn(employee,'2026-05-02')).toBe('active');expect(employmentStateOn(employee,'2026-04-10')).toBe('unknown');expect(employmentStateOn(employee,'2026-06-01')).toBe('unknown');expect(employmentStateOn(employee,'2026-05-12')).toBe('loa');});
it('cross-day range retains every effective state and cannot erase LOA',()=>{const start=Date.parse('2026-05-10T23:00:00+08:00')/60000;expect(employmentWindowStates(employee,start,start+120)).toEqual(['active','loa']);});
it('legacy missing hire or malformed interval does not mean active',()=>{expect(employmentStateOn({},'2026-05-01')).toBe('unknown');expect(employmentStateOn({...legacy,resignDate:'bad'},'2026-05-01')).toBe('unknown');expect(employmentStateOn(legacy,'2026-05-01')).toBe('not-employed');});
it('unknown adopted source never falls back to legacy active status',()=>{expect(employmentStateOn({hireDate:'2020-01-01',employmentAuthority:{kind:'unknown'}},'2026-05-01')).toBe('unknown');});
