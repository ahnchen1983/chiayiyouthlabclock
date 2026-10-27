import {describe,expect,it} from 'vitest';
import {confirmedWork,resolveClockRecord} from '../utils/attendance';
import {calculateSalaryForEmployee} from '../netlify/functions/utils/payroll';
import {card,employee,month} from './fixtures/payrollV2';

describe('persisted reviewed-work interval evidence',()=>{
 it.each([null,undefined,0,false,'09:00',{},[]])('malformed interval element %j remains unknown across attendance and salary reads',element=>{
  const record={...card(),workIntervals:[element]} as any;
  expect(confirmedWork(record)).toBeNull();
  const attendance=resolveClockRecord(record);expect(attendance.workHours).toBeNull();expect(attendance.payableMinutes).toBeNull();expect(attendance.reviewReasons!.length).toBeGreaterThan(0);
  const salary=calculateSalaryForEmployee(employee,month,[],[record],[]);expect(salary.calculationStatus).toBe('needs-review');expect(salary.netSalary).toBeNull();expect(salary.totalWorkHours).toBeNull();
 });
 it('a malformed row cannot turn the remaining valid rows into partially confirmed work',()=>{
  const record={...card(),workIntervals:[{start:540,end:720},null]} as any;
  expect(confirmedWork(record)).toBeNull();expect(resolveClockRecord(record).workHours).toBeNull();expect(calculateSalaryForEmployee(employee,month,[],[record],[]).netSalary).toBeNull();
 });
 it('valid overlapping intervals retain their union and exact salary',()=>{
  const record={...card(),workIntervals:[{start:540,end:720},{start:660,end:780},{start:840,end:1020}]};
  expect(confirmedWork(record)).toEqual([{start:540,end:780},{start:840,end:1020}]);expect(resolveClockRecord(record).workHours).toBe(7);
  const salary=calculateSalaryForEmployee(employee,month,[],[record],[]);expect(salary.calculationStatus).toBe('ready');expect(salary.totalWorkHours).toBe(7);expect(salary.netSalary).toBe(1400);
 });
 it('an explicitly reviewed empty interval list remains confirmed zero work',()=>{
  const record={...card(),workIntervals:[]};expect(confirmedWork(record)).toEqual([]);expect(resolveClockRecord(record).workHours).toBe(0);
  const salary=calculateSalaryForEmployee(employee,month,[],[record],[]);expect(salary.calculationStatus).toBe('ready');expect(salary.totalWorkHours).toBe(0);expect(salary.netSalary).toBe(0);
 });
});
