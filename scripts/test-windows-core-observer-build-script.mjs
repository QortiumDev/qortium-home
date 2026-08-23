import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(path.join(projectRoot, 'scripts', 'build-windows-core-observer.mjs'), 'utf8');

assert.match(source, /const environmentScriptName = 'qortium-msvc-environment\.cmd';/);
assert.match(source, /const environmentScript = path\.join\(outputDirectory, environmentScriptName\);/);
assert.match(
  source,
  /spawnSync\(process\.env\.ComSpec \?\? 'cmd\.exe', \['\/d', '\/c', environmentScriptName\], \{\n\s*cwd: outputDirectory,/,
);
assert.doesNotMatch(
  source,
  /\['\/d', '\/c', environmentScript\]/,
  'cmd.exe must not receive a checkout-derived script path as its command string',
);

console.log('Windows Core observer build-script safety tests passed.');
