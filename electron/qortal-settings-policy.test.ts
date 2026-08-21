import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectQortalUpdateOwnershipFromLiveResponse,
  detectQortalUpdateOwnershipFromSettings,
  parseQortalSettingsText,
  resolveEffectiveQortalSettings,
  resolveQortalUpdateOwnershipWithLiveResponse,
  type QortalUpdateOwnershipDecision,
} from './qortal-settings-policy.js';

const CHECKED_AT = '2026-08-21T20:00:00.000Z';

function write(targetPath: string, contents: string) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents, 'utf8');
}

async function withRoot(label: string, callback: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(os.tmpdir(), `qortium-home-qortal-policy-${label}-`));

  try {
    await callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function assertDecision(
  actual: QortalUpdateOwnershipDecision,
  expected: {
    enabled: boolean | null;
    ownership: QortalUpdateOwnershipDecision['ownership'];
    source: QortalUpdateOwnershipDecision['detection']['source'];
    usedDefault?: boolean;
  },
) {
  assert.equal(actual.ownership, expected.ownership);
  assert.equal(actual.detection.enabled, expected.enabled);
  assert.equal(actual.detection.source, expected.source);
  assert.equal(actual.detection.defaultEnabled, true);
  assert.equal(actual.detection.usedDefault, expected.usedDefault === true);
  assert.equal(actual.detection.checkedAt, CHECKED_AT);
}

assert.deepEqual(
  parseQortalSettingsText(`
    # full-line comment
    {
      "autoUpdateEnabled": false,
      # another full-line comment
      "bootstrapHosts": ["one", "two",],
    }
  `),
  {
    autoUpdateEnabled: false,
    bootstrapHosts: ['one', 'two'],
  },
);
assert.equal(
  parseQortalSettingsText('{ "autoUpdateEnabled": false # inline comments are not supported\n}'),
  null,
);
assert.equal(parseQortalSettingsText('[]'), null);

for (const [label, contents, expected] of [
  ['default', '{}', { enabled: true, ownership: 'node-native', source: 'default', usedDefault: true }],
  ['false', '{"autoUpdateEnabled":false}', { enabled: false, ownership: 'home-github', source: 'settings-file' }],
  ['true', '{"autoUpdateEnabled":true}', { enabled: true, ownership: 'node-native', source: 'settings-file' }],
] as const) {
  await withRoot(label, async (root) => {
    write(path.join(root, 'settings.json'), contents);
    assertDecision(
      await detectQortalUpdateOwnershipFromSettings('settings.json', {
        checkedAt: CHECKED_AT,
        cwd: root,
      }),
      expected,
    );
  });
}

await withRoot('comments-trailing-comma', async (root) => {
  write(path.join(root, 'settings.json'), `
    # Qortal removes this whole line
    {
      "autoUpdateEnabled": false,
      "bootstrapHosts": ["one",],
    }
  `);
  assertDecision(
    await detectQortalUpdateOwnershipFromSettings('settings.json', {
      checkedAt: CHECKED_AT,
      cwd: root,
    }),
    { enabled: false, ownership: 'home-github', source: 'settings-file' },
  );
});

for (const [label, contents] of [
  ['malformed', '{'],
  ['array-root', '[]'],
  ['inline-comment', '{"autoUpdateEnabled": false # no\n}'],
]) {
  await withRoot(label, async (root) => {
    write(path.join(root, 'settings.json'), contents);
    const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
      checkedAt: CHECKED_AT,
      cwd: root,
    });
    assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
    assert.match(result.detection.reason ?? '', /malformed/);
  });
}

for (const [label, autoUpdateEnabled] of [
  ['string', 'false'],
  ['number', 0],
  ['null', null],
  ['object', {}],
]) {
  await withRoot(`nonboolean-${label}`, async (root) => {
    write(path.join(root, 'settings.json'), JSON.stringify({ autoUpdateEnabled }));
    const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
      checkedAt: CHECKED_AT,
      cwd: root,
    });
    assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
    assert.match(result.detection.reason ?? '', /exact boolean/);
  });
}

await withRoot('size', async (root) => {
  write(path.join(root, 'settings.json'), '{"autoUpdateEnabled":false}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
    maxBytes: 8,
  });
  assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
  assert.match(result.detection.reason ?? '', /byte limit/);
});

await withRoot('relative-user-path', async (root) => {
  write(path.join(root, 'config', 'settings.json'), '{"userPath":"profile"}');
  write(
    path.join(root, 'profile', 'config', 'settings.json'),
    '{"autoUpdateEnabled":false}',
  );
  const result = await detectQortalUpdateOwnershipFromSettings(path.join('config', 'settings.json'), {
    checkedAt: CHECKED_AT,
    cwd: root,
  });
  assertDecision(result, { enabled: false, ownership: 'home-github', source: 'settings-file' });
  assert.equal(result.detection.settingsPath, path.join(root, 'profile', 'config', 'settings.json'));
  const effective = await resolveEffectiveQortalSettings(path.join('config', 'settings.json'), {
    cwd: root,
  });
  assert.equal(effective.kind, 'resolved');
  if (effective.kind === 'resolved') {
    assert.equal(effective.settingsPath, path.join(root, 'profile', 'config', 'settings.json'));
    assert.deepEqual(effective.settings, { autoUpdateEnabled: false });
  }
});

await withRoot('final-chain-default-wins', async (root) => {
  write(
    path.join(root, 'settings.json'),
    '{"autoUpdateEnabled":false,"userPath":"profile"}',
  );
  write(path.join(root, 'profile', 'settings.json'), '{}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
  });
  assertDecision(result, {
    enabled: true,
    ownership: 'node-native',
    source: 'default',
    usedDefault: true,
  });
});

await withRoot('null-user-path', async (root) => {
  write(
    path.join(root, 'settings.json'),
    '{"autoUpdateEnabled":false,"userPath":null}',
  );
  assertDecision(
    await detectQortalUpdateOwnershipFromSettings('settings.json', {
      checkedAt: CHECKED_AT,
      cwd: root,
    }),
    { enabled: false, ownership: 'home-github', source: 'settings-file' },
  );
});

await withRoot('absolute-user-path', async (root) => {
  const profilePath = path.join(root, 'absolute-profile');
  write(path.join(root, 'settings.json'), JSON.stringify({ userPath: profilePath }));
  write(path.join(profilePath, 'settings.json'), '{"autoUpdateEnabled":true}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
  });
  assertDecision(result, { enabled: true, ownership: 'node-native', source: 'settings-file' });
  assert.equal(result.detection.settingsPath, path.join(profilePath, 'settings.json'));
});

await withRoot('absolute-original-filename', async (root) => {
  const originalSettingsPath = path.join(root, 'config', 'settings.json');
  const profilePath = path.join(root, 'profile');
  // JVM Paths.get(userPath, originalAbsoluteFilename) nests the original path
  // segments beneath userPath instead of allowing the later absolute segment
  // to replace the first. Node path.join mirrors that behavior.
  const chainedSettingsPath = path.join(profilePath, originalSettingsPath);

  write(originalSettingsPath, JSON.stringify({ userPath: profilePath }));
  write(chainedSettingsPath, '{"autoUpdateEnabled":false}');
  const result = await detectQortalUpdateOwnershipFromSettings(originalSettingsPath, {
    checkedAt: CHECKED_AT,
    cwd: root,
  });
  assertDecision(result, { enabled: false, ownership: 'home-github', source: 'settings-file' });
  assert.equal(result.detection.settingsPath, chainedSettingsPath);
});

await withRoot('cycle', async (root) => {
  write(path.join(root, 'settings.json'), '{"userPath":"profile"}');
  write(path.join(root, 'profile', 'settings.json'), '{"userPath":"."}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
  });
  assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
  assert.match(result.detection.reason ?? '', /cycle/);
});

await withRoot('canonical-cycle', async (root) => {
  write(path.join(root, 'settings.json'), '{"userPath":"alias"}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
    operations: {
      // Both lexical candidates represent the same canonical file, as they
      // would through a directory symlink. The second pass must be rejected
      // before another read occurs.
      realpath: async () => path.join(root, 'settings.json'),
    },
  });
  assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
  assert.match(result.detection.reason ?? '', /cycle/);
});

await withRoot('depth', async (root) => {
  write(path.join(root, 'settings.json'), '{"userPath":"one"}');
  write(path.join(root, 'one', 'settings.json'), '{"userPath":"two"}');
  write(path.join(root, 'two', 'settings.json'), '{"autoUpdateEnabled":false}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
    maxUserPathDepth: 1,
  });
  assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
  assert.match(result.detection.reason ?? '', /depth limit/);
});

for (const [label, userPath] of [
  ['empty', ''],
  ['whitespace', '   '],
  ['nul', '\0'],
  ['nonstring', 7],
]) {
  await withRoot(`invalid-user-path-${label}`, async (root) => {
    write(path.join(root, 'settings.json'), JSON.stringify({ userPath }));
    const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
      checkedAt: CHECKED_AT,
      cwd: root,
    });
    assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
    assert.match(result.detection.reason ?? '', /userPath was empty or invalid/);
  });
}

await withRoot('missing-chain-target', async (root) => {
  write(path.join(root, 'settings.json'), '{"userPath":"missing"}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
  });
  assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
  assert.match(result.detection.reason ?? '', /could not be resolved/);
});

await withRoot('read-uncertainty', async (root) => {
  const settingsPath = path.join(root, 'settings.json');
  write(settingsPath, '{"autoUpdateEnabled":false}');
  const result = await detectQortalUpdateOwnershipFromSettings('settings.json', {
    checkedAt: CHECKED_AT,
    cwd: root,
    operations: {
      readFile: async () => {
        throw new Error('permission denied');
      },
    },
  });
  assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
  assert.match(result.detection.reason ?? '', /could not be read/);
});

const stoppedHomeManaged: QortalUpdateOwnershipDecision = {
  detection: {
    checkedAt: CHECKED_AT,
    defaultEnabled: true,
    enabled: false,
    source: 'settings-file',
    usedDefault: false,
  },
  ownership: 'home-github',
};

assertDecision(
  detectQortalUpdateOwnershipFromLiveResponse(true, { checkedAt: CHECKED_AT }),
  { enabled: true, ownership: 'node-native', source: 'live-api' },
);
assertDecision(
  resolveQortalUpdateOwnershipWithLiveResponse(true, stoppedHomeManaged, { checkedAt: CHECKED_AT }),
  { enabled: true, ownership: 'node-native', source: 'live-api' },
);
assertDecision(
  resolveQortalUpdateOwnershipWithLiveResponse(false, {
    ...stoppedHomeManaged,
    detection: { ...stoppedHomeManaged.detection, enabled: true },
    ownership: 'node-native',
  }, { checkedAt: CHECKED_AT }),
  { enabled: false, ownership: 'home-github', source: 'live-api' },
);

for (const invalidLiveResponse of ['true', 'false', 1, 0, null, undefined, { value: true }]) {
  const result = resolveQortalUpdateOwnershipWithLiveResponse(
    invalidLiveResponse,
    stoppedHomeManaged,
    { checkedAt: CHECKED_AT },
  );
  assertDecision(result, { enabled: null, ownership: 'observe-only', source: 'unknown' });
  assert.match(result.detection.reason ?? '', /not an exact boolean/);
}

console.log('Qortal settings update-ownership policy checks passed.');
