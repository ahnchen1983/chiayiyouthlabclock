import {describe,it,expect} from 'vitest';
import {emulatorTestsCompleted,browserWorkers} from '../scripts/verification-evidence.mjs';
describe('actual emulator completion evidence',()=>{
 it('rejects zero-exit startup/shutdown without executing tests',()=>{expect(emulatorTestsCompleted('','current-run')).toBe(false);expect(emulatorTestsCompleted('Starting emulators\nReceived SIGINT\nShutting down emulators\n','current-run')).toBe(false);});
 it('does not mistake the echoed npm command for completed tests',()=>{expect(emulatorTestsCompleted("firebase emulators:exec 'npm run test:emulator && echo PR13_EMULATOR_TESTS_COMPLETED:current-run'\n",'current-run')).toBe(false);});
 it('accepts a standalone successful command marker including colored CRLF output',()=>{expect(emulatorTestsCompleted('Tests 93 passed\r\n\u001b[32mPR13_EMULATOR_TESTS_COMPLETED:current-run\u001b[0m\r\n','current-run')).toBe(true);});
 it('rejects a failed test log without its completion marker',()=>{expect(emulatorTestsCompleted('Tests 1 failed | 92 passed\nScript exited unsuccessfully\n','current-run')).toBe(false);});
});
it('allows only bounded browser concurrency without changing coverage',()=>{expect(browserWorkers()).toBe('2');expect(browserWorkers('1')).toBe('1');expect(()=>browserWorkers('0')).toThrow();expect(()=>browserWorkers('999')).toThrow();});
it('rejects a prior run completion marker and a marker without a current run identity',()=>{
 expect(emulatorTestsCompleted('PR13_EMULATOR_TESTS_COMPLETED:old-run\n','current-run')).toBe(false);
 expect(emulatorTestsCompleted('PR13_EMULATOR_TESTS_COMPLETED\n','current-run')).toBe(false);
 expect(emulatorTestsCompleted('PR13_EMULATOR_TESTS_COMPLETED:current-run\n','current-run')).toBe(true);
 expect(emulatorTestsCompleted('PR13_EMULATOR_TESTS_COMPLETED:\n','')).toBe(false);
});
