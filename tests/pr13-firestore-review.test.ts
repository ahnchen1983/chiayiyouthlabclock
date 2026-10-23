import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { calculateSalaryForEmployee, normalizeScheduleDoc } from '../netlify/functions/utils/calculations';
import { makePayrollRun, sanitizePayrollSnapshot, selectPayrollLeaveEvidence } from '../netlify/functions/utils/payrollSnapshot';
import { card, employee, month, review, leave } from './fixtures/payrollV2';

const require = createRequire(import.meta.url);
// Initialize the SDK's module graph before loading its document validator.
require('@google-cloud/firestore');
const { validateDocumentData } = require('@google-cloud/firestore/build/src/write-batch.js');

describe('PR 13 production Firestore snapshot serialization', () => {
    it.each([
        { kind: 'v2', raw: { status: '營運', shifts: [{ empId: employee.id, name: employee.name, role: 'partTime', from: '09:00', to: '17:00' }] } },
        { kind: 'legacy v1', raw: { status: '營運', shiftTime: '09:00-17:00', partTime: [employee.name] } },
    ])('can persist a ready payroll run with $kind schedule optional fields absent', ({ raw }) => {
        const schedules = [normalizeScheduleDoc(raw, '2026-04-01', '')];
        const records = [card()];
        const salary = calculateSalaryForEmployee(employee, month, schedules, records, []);
        expect(salary.calculationStatus).toBe('ready');
        const run = makePayrollRun('synthetic-run', month, review.reviewedAt, [salary], {
            employees: [employee], schedules, records, leaves: [],
        });
        // firebaseAdmin.ts uses the default ignoreUndefinedProperties=false.
        // This is the same validator used by Firestore transaction.create().
        expect(() => validateDocumentData('data', run, false, false)).not.toThrow();
    });
});


describe('payroll snapshot canonical evidence', () => {
    it('hashes the exact sanitized input, preserving values and original evidence', () => {
        const schedules = [normalizeScheduleDoc({ status: '營運', shifts: [{ empId: employee.id, name: employee.name, role: 'partTime', from: '09:00', to: '17:00' }] }, '2026-04-01', '')];
        const records = [card()];
        const salary = calculateSalaryForEmployee(employee, month, schedules, records, []);
        const inputEmployee = { ...employee, evidence: { absent: undefined, zero: 0, no: false, empty: '', nil: null, text: '原始佐證' } };
        const run = makePayrollRun('synthetic-run', month, review.reviewedAt, [salary], { employees: [inputEmployee], schedules, records, leaves: [] });
        const stored = run.inputs.employees[0] as typeof inputEmployee;
        expect(stored.evidence).toEqual({ zero: 0, no: false, empty: '', nil: null, text: '原始佐證' });
        expect(Object.hasOwn(stored.evidence, 'absent')).toBe(false);
        expect(Object.hasOwn(inputEmployee.evidence, 'absent')).toBe(true);
        expect(run.inputHash).toBe(createHash('sha256').update(JSON.stringify(run.inputs)).digest('hex'));
        expect(() => validateDocumentData('data', run, false, false)).not.toThrow();
    });
    it('canonicalizes object keys recursively while preserving array order', () => {
        expect(sanitizePayrollSnapshot({ b: { d: 4, c: 3 }, a: [{ z: 2, y: 1 }, 0] })).toEqual({ a: [{ y: 1, z: 2 }, 0], b: { c: 3, d: 4 } });
        const a = JSON.stringify(sanitizePayrollSnapshot({ b: { d: 4, c: 3 }, a: [2, 1] }));
        const b = JSON.stringify(sanitizePayrollSnapshot({ a: [2, 1], b: { c: 3, d: 4 } }));
        expect(a).toBe(b);
        expect(a).not.toBe(JSON.stringify(sanitizePayrollSnapshot({ a: [1, 2], b: { c: 3, d: 4 } })));
    });
    it.each([NaN, Infinity, -Infinity, 1n, new Date('2026-04-01'), new Map(), () => 1, Symbol('unsupported'), [undefined], new Array(1), [[1]]])('rejects unsupported evidence instead of corrupting it (%s)', value => {
        expect(() => sanitizePayrollSnapshot({ value })).toThrow('快照含');
    });
    it('rejects cyclic evidence and accessors without invoking them', () => {
        const cycle: any = {}; cycle.self = cycle;
        expect(() => sanitizePayrollSnapshot(cycle)).toThrow('循環');
        let invoked = false; const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return 1; } });
        expect(() => sanitizePayrollSnapshot(accessor)).toThrow('動態'); expect(invoked).toBe(false);
    });
});


describe('snapshot leave evidence matches live payroll relevance', () => {
    it('retains invalid target-month allocations for validation and full next-day boundary leave', () => {
        const current = leave();
        const invalidAllocation = { ...leave('2026-03-20'), id: 'invalid-allocation', payrollAllocations: leave().payrollAllocations };
        const invalidCurrent = { ...leave(), id: 'invalid-current', startDate: '2026-04-invalid', endDate: '2026-04-invalid' };
        const boundary = { ...leave('2026-05-01'), id: 'boundary' };
        const unrelated = { ...leave('2026-05-02'), id: 'unrelated' };
        const otherEmployee = { ...current, id: 'other-employee', empId: 'OTHER' };
        expect(selectPayrollLeaveEvidence([current, invalidAllocation, invalidCurrent, boundary, unrelated, otherEmployee], month, [employee.id]).map(l => l.id))
            .toEqual([current.id, 'invalid-allocation', 'invalid-current', 'boundary']);
    });
});
