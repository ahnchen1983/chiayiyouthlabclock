import { describe,it,expect } from 'vitest';
import { caseFormContext,contextDateMatches,contextLeaveMatches } from '../utils/caseFormContext';
const context=caseFormContext({id:'case1',empId:'E1',anchor:'card:C1',window:{start:Date.parse('2026-08-01T22:00:00+08:00')/60000,end:Date.parse('2026-08-02T06:00:00+08:00')/60000}} as any);
describe('case context preserves scope without inferring actual times',()=>{
 it('retains explicit employee, case, card and cross-night start date',()=>{expect(context).toMatchObject({caseId:'case1',empId:'E1',recordId:'C1',date:'2026-08-01'});expect(contextDateMatches(context,'2026-08-02')).toBe(true);expect(contextDateMatches(context,'2026-10-24')).toBe(false);});
 it('filters leave by employee and complete intersecting interval',()=>{expect(contextLeaveMatches(context,{empId:'E1',startDate:'2026-08-02T02:00:00+08:00',endDate:'2026-08-02T06:00:00+08:00'})).toBe(true);expect(contextLeaveMatches(context,{empId:'OTHER',startDate:'2026-08-02T02:00:00+08:00',endDate:'2026-08-02T06:00:00+08:00'})).toBe(false);});
});
