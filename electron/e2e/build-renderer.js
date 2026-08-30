/**
 * OFFLINE 6 — compile the REAL renderer sync stack (frontend/src/sync) to
 * CommonJS so the E2E device process can run the production code (the same
 * engine.ts / localDb.ts / connectivity.ts the React app ships), not a copy.
 *
 * Output: electron/e2e/renderer/*.js (gitignored build artifact).
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tsc = path.join(root, 'frontend', 'node_modules', '.bin', 'tsc');
const outDir = path.join(__dirname, 'renderer');

const res = spawnSync(
  tsc,
    [
      path.join(root, 'frontend', 'src', 'sync', 'engine.ts'),
      '--outDir', outDir,
      '--module', 'commonjs',
      '--target', 'es2020',
      '--moduleResolution', 'node',
      '--esModuleInterop',
      '--skipLibCheck',
      '--noEmitOnError',
    ],
  { stdio: 'inherit' },
);
if (res.status !== 0) process.exit(res.status);
console.log('renderer sync stack compiled to', outDir);
