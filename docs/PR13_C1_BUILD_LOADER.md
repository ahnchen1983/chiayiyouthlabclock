# C1 production build loader compatibility

C1 source `908b202548990bdf17047c635d1575849e082463` had two production-build entry paths: `npm run build` used Vite's default bundled config loader, while the PR13 gate and Playwright explicitly selected the runner. On the affected macOS Documents workspace, the former stalled before loading configuration.

## Reproduced cause

With Node 22.22.0 x64, Vite 6.4.2, esbuild 0.25.12 and plugin-react 5.1.4 from the existing lockfile:

- An independent minimal project containing only `export default {};` reproduced the default-loader timeout (60 seconds), without application code, React or Firebase.
- The same esbuild binary completed stdin and virtual-plugin builds in about 4 seconds. A native file-entry build in the Documents workspace timed out at 45 seconds; the identical file under `/tmp` completed in 0.137 seconds.
- A SIGQUIT stack from our own standalone esbuild process located the stall in `syscall.Open → os.Open → realFS.readdir → ReadDirectory → resolver.dirInfoUncached`, recursively traversing ancestor directories. The blocked path length was 24, matching the Documents ancestor in this reproduction. This proves a directory-dependent native filesystem-resolution stall, not a failure executing application config. It does not establish whether the underlying macOS mechanism is TCC, filesystem filtering, or another OS facility.
- The original, unmodified `npm run build` completed in a separate `/tmp` checkout (51.326 seconds), using the same dependency copy and runtime. Node/module-loader incompatibility is therefore not necessary to reproduce the failure: the standalone esbuild CLI already reproduces it.
- No custom Node options, compile-cache settings, esbuild binary override or `VITE_E2E` value were set. No system settings or permissions were changed.

## Minimal supported fix

The build script now explicitly uses `vite build --configLoader runner`. Vite 6 officially supports the runner when the default esbuild config-bundling approach encounters problems: https://v6.vite.dev/config/#configuring-vite (Config Loading). The runner transforms configuration modules on demand without the temporary config-bundle path. It still invokes the same Vite production build, React transforms, Rollup chunking and minification.

The PR13 gate and Playwright build now call this common script, removing their redundant build-only loader arguments. Preview retains its explicit runner. There are no dependency, lockfile, application, typechecking, test assertion, security gate or deployment configuration changes. The config is ESM; the runner's lack of CJS config support does not affect this repository.

## Validation

- Fixed plain `npm run build`: exit 0, 67.533 seconds, 429 modules transformed.
- `npm run typecheck`: exit 0, 98.964 seconds.
- SHA-256 comparison: all 44 files from the original default loader in `/tmp`, the original explicit runner, and the fixed standard build are byte-identical. This includes production Firebase and application chunks; no E2E bundle was substituted.
- Repeated plain `npm run build`: exit 0, 77.934 seconds; all 44 production files still byte-identical.
- Fresh unmodified Documents checkout: plain `npm run build` again timed out at 75.069 seconds before configuration loaded.
- Full unit/API suite in the independent `/tmp` snapshot with the same three script changes: 31 files / 653 tests passed, exit 0 (208.777 seconds). The first Documents attempt hit the external 180-second diagnostic limit and is not counted as a pass; this limit was outside the repository test configuration.
- The same full unit/API suite also passed in the Documents checkout after normal execution approval: 31 files / 653 tests, exit 0 (170.478 seconds). Counts across the two runs are not added.
- Additional browser results and all failed/blocked attempts are recorded with the local handoff evidence.

All work is local to independent checkouts. No push, deployment, production data access, original-author edit or publication checkout edit occurred. Existing C1 full emulator/E2E evidence remains prior evidence, not a claim that those full suites were rerun here.
