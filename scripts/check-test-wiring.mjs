// Fails when a *.test.ts file exists that no npm script ever runs.
//
// Home has no test CI, so an unwired test file is silently dead: it compiles,
// it looks like coverage in review, and it never executes. Six of them had
// accumulated that way before this check existed.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIRECTORIES = ['electron', 'src'];
const TEST_FILE = /\.test\.(ts|tsx|mts)$/;

const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};
const commands = Object.values(scripts).join(' ');

// Scripts either bundle a test from source (esbuild/tsc against the .ts path)
// or run it after build:electron from dist-electron/<name>.test.js.
const compiledNames = new Set(
  [...commands.matchAll(/dist-electron\/(?:[\w./-]*\/)?([\w.-]+)\.test\.js/g)].map(([, name]) => name),
);

function listTestFiles(directory) {
  const absolute = path.join(repoRoot, directory);

  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEST_FILE.test(entry.name))
    .map((entry) => path.relative(repoRoot, path.join(entry.parentPath ?? absolute, entry.name)));
}

const orphaned = [];

for (const directory of TEST_DIRECTORIES) {
  for (const file of listTestFiles(directory)) {
    const stem = path.basename(file).replace(TEST_FILE, '');
    const isWired =
      commands.includes(file.split(path.sep).join('/')) ||
      compiledNames.has(stem) ||
      // Tolerate kebab/camel differences between a source name and its bundle.
      [...compiledNames].some((name) => name.replaceAll('-', '').toLowerCase() === stem.replaceAll('-', '').toLowerCase());

    if (!isWired) {
      orphaned.push(file);
    }
  }
}

if (orphaned.length > 0) {
  console.error(`Test files that no npm script runs (${orphaned.length}):`);
  for (const file of orphaned) {
    console.error(`  ${file}`);
  }
  console.error('\nAdd a "test:<name>" script for each, then include it in npm test.');
  process.exit(1);
}

console.log('Test wiring check passed: every test file is runnable through an npm script.');
