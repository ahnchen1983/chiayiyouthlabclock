import {describe,expect,it} from 'vitest';
import {calculateSalaryForEmployee} from '../netlify/functions/utils/payroll';
import {card,employee,leave,month,schedule} from './fixtures/payrollV2';

const pay=(cards:any[],leaves:any[]=[])=>calculateSalaryForEmployee(employee,month,[schedule()],cards,leaves);
describe('persisted source dates remain visible to salary validation',()=>{
 it('valid evidence still settles before malformed sources are introduced',()=>expect(pay([card()]).netSalary).toBe(1600));
 it.each([undefined,null,7,{},'invalid','2026-04-31'])('unknown card date %j blocks salary without throwing',date=>{
  const result=pay([card(),{...card(),id:'SYNTH-UNKNOWN-DATE',date}]);
  expect(result.calculationStatus).toBe('needs-review');
  expect(result.netSalary).toBeNull();
  expect(result.totalWorkHours).toBeNull();
  expect(result.knownWorkMinutes).toBe(480);
  expect(result.reviewReasons.join()).toContain('打卡日期');
 });
 it('an unrelated employee unknown date cannot block the target employee',()=>{
  expect(pay([card(),{...card(),empId:'OTHER',date:undefined}]).netSalary).toBe(1600);
 });
 it.each([[undefined,undefined],['invalid','invalid'],[7,8],['2026-04-03T17:00','2026-04-02T09:00'],['2026-04-31T09:00','2026-05-01T17:00']])('unknown or reversed approved leave dates %j/%j cannot disappear',(startDate,endDate)=>{
  const result=pay([card()],[{...leave(),startDate,endDate,payrollAllocations:[]}]);
  expect(result.netSalary).toBeNull();
  expect(result.reviewReasons.join()).toContain('請假');
 });
 it('an unrelated malformed approved leave cannot block the target employee',()=>{
  expect(pay([card()],[{...leave(),empId:'OTHER',startDate:undefined,endDate:undefined}]).netSalary).toBe(1600);
 });
});
