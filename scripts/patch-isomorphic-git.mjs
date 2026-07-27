import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const packagePath = path.join(projectRoot, 'node_modules', 'isomorphic-git', 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const SUPPORTED_ISOMORPHIC_GIT_VERSIONS = new Set(['1.38.9', '1.40.0']);

// This patch reaches into bundled upstream files, so each release stays
// explicitly allowlisted until its inflation and delta-expansion anchors pass review.
if (!SUPPORTED_ISOMORPHIC_GIT_VERSIONS.has(packageJson.version)) {
  throw new Error(
    `Unsupported isomorphic-git version ${packageJson.version}; review the bounded-inflate patch before installing.`,
  );
}

const original = `async function inflate(buffer) {
  if (supportsDecompressionStream === null) {
    supportsDecompressionStream = testDecompressionStream();
  }
  return supportsDecompressionStream
    ? browserInflate(buffer)
    : pako.inflate(buffer)
}`;

const legacyPatched = `const MAX_INFLATED_GIT_OBJECT_BYTES = 16 * 1024 * 1024;

async function inflate(buffer) {
  const inflator = new pako.Inflate({ chunkSize: 64 * 1024 });
  const chunks = [];
  let inflatedBytes = 0;

  inflator.onData = chunk => {
    inflatedBytes += chunk.length;
    if (inflatedBytes > MAX_INFLATED_GIT_OBJECT_BYTES) {
      throw new Error('Git object exceeds the 16 MiB inflation limit')
    }
    chunks.push(chunk);
  };
  inflator.push(buffer, true);
  if (inflator.err) {
    throw new Error(inflator.msg || 'Unable to inflate Git object')
  }

  const output = new Uint8Array(inflatedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output
}`;

const patched = legacyPatched.replace(
  'const MAX_INFLATED_GIT_OBJECT_BYTES = 16 * 1024 * 1024;\n\n',
  '',
);

const originalDelta = `function applyDelta(delta, source) {
  const reader = new BufferCursor(delta);`;

const patchedDelta = `const MAX_INFLATED_GIT_OBJECT_BYTES = 16 * 1024 * 1024;

function applyDelta(delta, source) {
  const reader = new BufferCursor(delta);`;

const duplicatedDeltaConstant = `const MAX_INFLATED_GIT_OBJECT_BYTES = 16 * 1024 * 1024;

const MAX_INFLATED_GIT_OBJECT_BYTES = 16 * 1024 * 1024;

function applyDelta(delta, source) {
  const reader = new BufferCursor(delta);`;

const originalTargetSize = `  const targetSize = readVarIntLE(reader);
  let target;`;

const patchedTargetSize = `  const targetSize = readVarIntLE(reader);
  if (targetSize > MAX_INFLATED_GIT_OBJECT_BYTES) {
    throw new Error('Git delta exceeds the 16 MiB expansion limit')
  }
  let target;`;

for (const filename of ['index.js', 'index.cjs']) {
  const modulePath = path.join(projectRoot, 'node_modules', 'isomorphic-git', filename);
  let source = readFileSync(modulePath, 'utf8');
  let changed = false;

  if (source.includes(legacyPatched)) {
    source = source.replace(legacyPatched, patched);
    changed = true;
  } else if (source.includes(original)) {
    source = source.replace(original, patched);
    changed = true;
  } else if (!source.includes(patched)) {
    throw new Error(`Unsupported isomorphic-git ${filename}; review the bounded-inflate patch before installing.`);
  }

  while (source.includes(duplicatedDeltaConstant)) {
    source = source.replace(duplicatedDeltaConstant, patchedDelta);
    changed = true;
  }
  if (source.includes(patchedDelta)) {
    // Already bounded.
  } else if (source.includes(originalDelta)) {
    source = source.replace(originalDelta, patchedDelta);
    changed = true;
  } else {
    throw new Error(`Unsupported isomorphic-git ${filename}; review the delta-expansion patch before installing.`);
  }

  if (source.includes(originalTargetSize)) {
    source = source.replace(originalTargetSize, patchedTargetSize);
    changed = true;
  } else if (!source.includes(patchedTargetSize)) {
    throw new Error(`Unsupported isomorphic-git ${filename}; review the delta-size patch before installing.`);
  }

  if (changed) {
    writeFileSync(modulePath, source);
    console.log(`Patched isomorphic-git ${filename} with bounded Git object expansion.`);
  } else {
    console.log(`isomorphic-git ${filename} already has bounded Git object expansion.`);
  }
}
