// Firebase CLI may exit zero on SIGINT before it runs its test command. Only an
// exact marker emitted by the successful test command is completion evidence;
// the marker embedded in npm's echoed command line is not sufficient.
export const EMULATOR_COMPLETION_MARKER = 'PR13_EMULATOR_TESTS_COMPLETED';
export function emulatorTestsCompleted(output, runId) {
    if (typeof runId !== 'string' || !runId) return false;
    return output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).includes(EMULATOR_COMPLETION_MARKER + ':' + runId);
}
export function browserWorkers(value = '2') {
    if (!['1', '2'].includes(value)) throw new Error('PR13_BROWSER_WORKERS must be 1 or 2');
    return value;
}
