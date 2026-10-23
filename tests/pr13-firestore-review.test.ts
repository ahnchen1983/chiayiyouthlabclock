import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { calculateSalaryForEmployee, normalizeScheduleDoc } from '../netlify/functions/utils/calculations';
import { makePayrollRun } from '../netlify/functions/utils/payrollSnapshot';
import { card, employee, month, review } from './fixtures/payrollV2';

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
