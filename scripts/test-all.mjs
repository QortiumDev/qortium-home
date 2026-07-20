// Runs every "test:*" script in package.json, sequentially, and reports a
// summary. New test scripts are picked up automatically, so a test only needs
// wiring once.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};
const names = Object.keys(scripts).filter((name) => name.startsWith('test:')).sort();

const failed = [];

for (const name of names) {
  process.stdout.write(`\n── ${name}\n`);
  const result = spawnSync('npm', ['run', '--silent', name], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    failed.push(name);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`${names.length - failed.length}/${names.length} test scripts passed.`);

if (failed.length > 0) {
  console.error(`Failed:\n${failed.map((name) => `  ${name}`).join('\n')}`);
  process.exit(1);
}
