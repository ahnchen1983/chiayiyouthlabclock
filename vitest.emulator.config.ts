import { defineConfig } from 'vitest/config';

// Fail before loading either test file: these tests delete all emulator data.
// Never infer a project or endpoint from the user's Firebase CLI configuration.
if (!/^127\.0\.0\.1:(8086|8087)$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    process.env.FIREBASE_PROJECT_ID !== 'demo-chiayi-payroll') {
    throw new Error('Emulator tests require FIRESTORE_EMULATOR_HOST=127.0.0.1:8086 (or 8087) and FIREBASE_PROJECT_ID=demo-chiayi-payroll');
}

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/firestore-api.emulator.test.ts', 'tests/firestore-rules.test.ts'],
        fileParallelism: false,
        maxWorkers: 1,
        hookTimeout: 20_000,
        testTimeout: 30_000,
    },
});
