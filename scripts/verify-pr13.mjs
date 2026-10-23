import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourcePaths = () => [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.ts', '*.tsx', '*.js', '*.json', '*.mjs', '*.css', '*.html', '*.toml', '*.rules', '*.yml').split('\0').filter(Boolean))].sort();
const sourceHash = async () => {
    const hash = createHash('sha256');
    for (const file of sourcePaths()) hash.update(file + '\0').update(await readFile(path.join(root, file)));
    return hash.digest('hex');
};
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(root, '.verification', 'pr13', runId);
await mkdir(evidence, { recursive: true });
const initialHash = await sourceHash();
const manifest = { startedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), sourceHash: initialHash, status: 'running', steps: [] };
const steps = [
    ['typecheck', ['run', 'typecheck']],
    ['unit-api', ['test', '--', '--configLoader', 'runner']],
    ['firestore-emulator', ['run', 'test:emulator:start']],
    ['browser', ['run', 'test:e2e', '--', '--workers=2']],
    ['production-build', ['run', 'build', '--', '--configLoader', 'runner']],
];
let interrupted = false;
for (const [name, args] of steps) {
    const start = Date.now();
    const logPath = path.join(evidence, `${name}.log`);
    const log = await open(logPath, 'w');
    process.stdout.write(`開始驗證：${name}\n`);
    const child = spawn('npm', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => log.write(chunk));
    child.stderr.on('data', chunk => log.write(chunk));
    const exitCode = await new Promise(resolve => {
        child.once('error', error => { log.write(error.message); resolve(1); });
        child.once('close', code => resolve(code ?? 1));
    });
    await log.close();
    manifest.steps.push({ name, exitCode, seconds: (Date.now() - start) / 1000, log: path.relative(root, logPath) });
    await writeFile(path.join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    process.stdout.write(`${name}: ${exitCode === 0 ? '通過' : '失敗'}\n`);
    if (exitCode !== 0) { interrupted = true; break; }
}
if (!interrupted) {
    try {
        git('diff', '--check');
        if (await sourceHash() !== initialHash || git('rev-parse', 'HEAD') !== manifest.commit) throw new Error('驗證期間程式或提交已改變，需要重新驗證');
    } catch (error) {
        interrupted = true;
        manifest.steps.push({ name: 'final-source-check', exitCode: 1, error: error.message });
    }
}
manifest.status = interrupted ? 'failed' : 'passed';
manifest.finishedAt = new Date().toISOString();
await writeFile(path.join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`驗證證據：${path.relative(root, evidence)}\n`);
process.exitCode = interrupted ? 1 : 0;
