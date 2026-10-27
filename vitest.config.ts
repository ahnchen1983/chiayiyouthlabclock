import { defineConfig } from 'vitest/config';
// Deliberately independent of Vite loadEnv / production client initialization.
export default defineConfig({ test: { environment: 'node', exclude: ['tests/firestore-rules.test.ts', 'tests/*.emulator.test.ts', 'tests/e2e/**', 'node_modules/**'], maxWorkers: 2 } });
