#!/usr/bin/env node
/**
 * Runs the compiled local-analytics port tests (`test/analytics.test.ts`).
 *
 * Why this exists: `tsc` must emit CommonJS for these tests (they import
 * extensionless modules, which only CommonJS resolves), but this package is
 * `"type": "module"` — so the output directory needs its own
 * `{"type":"commonjs"}` marker before `node --test` will load it. Doing that
 * here keeps `npm test` a single cross-platform command instead of a shell
 * one-liner that behaves differently on Windows.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const outDir = new URL('../test-build/', import.meta.url);
const target = new URL('test/analytics.test.js', outDir);

writeFileSync(new URL('package.json', outDir), '{ "type": "commonjs" }\n');

const result = spawnSync(process.execPath, ['--test', fileURLToPath(target)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
