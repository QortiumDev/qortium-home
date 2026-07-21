// Guards the accent picker against showing a colour the app does not actually
// render.
//
// ACCENT_OPTIONS in src/displaySettings.ts carries a `swatch` hex used to paint
// the dots in the accent picker, while the colour the app really uses comes
// from `--color-accent` in src/styles.css. Nothing tied the two together, and
// three of the nine had drifted: blue, red and pink each advertised a brighter
// colour than the one selecting them produced.
//
// Both files are read as text with node:fs rather than imported. The values
// live in a .ts module and a stylesheet, neither of which a plain node script
// can import, and reading the real bytes is also what makes the check honest:
// it compares what ships, not a re-declaration of it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8');

const displaySettings = read('src/displaySettings.ts');
const styles = read('src/styles.css');

function parseSwatches() {
  const swatches = new Map();
  const pattern = /value: '(\w+)',\s*\n\s*swatch: '(#[0-9a-fA-F]{6})'/g;
  let match;

  while ((match = pattern.exec(displaySettings)) !== null) {
    swatches.set(match[1], match[2].toLowerCase());
  }

  return swatches;
}

function parseRenderedAccents() {
  const accents = new Map();

  // green is the default and lives in the bare :root block, with no
  // [data-accent] selector of its own.
  const root = /^:root \{([\s\S]*?)^\}/m.exec(styles);
  const rootAccent = root && /--color-accent:\s*(#[0-9a-fA-F]{6})/.exec(root[1]);

  if (rootAccent) {
    accents.set('green', rootAccent[1].toLowerCase());
  }

  const pattern = /^:root\[data-accent="(\w+)"\] \{([\s\S]*?)^\}/gm;
  let match;

  while ((match = pattern.exec(styles)) !== null) {
    const accent = /--color-accent:\s*(#[0-9a-fA-F]{6})/.exec(match[2]);

    if (accent) {
      accents.set(match[1], accent[1].toLowerCase());
    }
  }

  return accents;
}

const swatches = parseSwatches();
const rendered = parseRenderedAccents();
const failures = [];

// A parse that silently finds nothing would let every assertion below pass
// vacuously, so require both sides to have found the full set first.
if (swatches.size === 0) {
  failures.push('Parsed no swatches from src/displaySettings.ts — the ACCENT_OPTIONS shape changed.');
}

if (rendered.size === 0) {
  failures.push('Parsed no accents from src/styles.css — the :root[data-accent] shape changed.');
}

if (swatches.size !== rendered.size) {
  failures.push(
    `Found ${swatches.size} swatches but ${rendered.size} rendered accents. ` +
      'Every accent option needs a matching stylesheet block.',
  );
}

for (const [accent, swatch] of swatches) {
  const actual = rendered.get(accent);

  if (!actual) {
    failures.push(`Accent "${accent}" has a swatch but no --color-accent in src/styles.css.`);
    continue;
  }

  if (swatch !== actual) {
    failures.push(
      `Accent "${accent}": picker shows ${swatch} but the app renders ${actual}. ` +
        'Update the swatch in src/displaySettings.ts to match src/styles.css.',
    );
  }
}

if (failures.length > 0) {
  console.error('Accent swatch check failed:\n');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`Accent swatch check passed: ${swatches.size} swatches match their rendered colour.`);
