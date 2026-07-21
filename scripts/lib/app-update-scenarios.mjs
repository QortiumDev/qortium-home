// Shared scenario fixtures for the desktop and Android app-update-state smoke
// tests, so the two harnesses assert the same behaviour from one definition.
//
// The regression under guard (fixed in #179): an 'up-to-date' check result
// still carries the compatible asset for the installed release, so a stored
// downloadedUpdate kept matching on release tag and digest forever. The update
// card reported "Downloaded" and offered "Show file" / "Install APK" instead
// of "Up to date", permanently, on every launch.
//
// GitHub is stubbed rather than queried so the scenarios stay deterministic:
// asserting the real 'up-to-date' path against live releases would only hold
// while the installed version happens to be the newest published one.

export const scenarioNames = ['installed', 'pending'];

export const appUpdatePreferencesKey = 'qortium-home-app-update-preferences';

// Mirrors a real release's asset list so the app's own selector faces the same
// choice it would in production. Callers resolve the winner with the shipped
// selectCompatibleUpdateAsset rather than a copy of its rules, so a change to
// asset naming or priority cannot silently desync these fixtures from the app.
const assetNameTemplates = [
  'Qortium-Home-{version}-android-release.apk',
  'Qortium-Home-{version}-arm64.AppImage',
  'Qortium-Home-{version}-macos1015-x64.dmg',
  'Qortium-Home-{version}-macos11-universal.dmg',
  'Qortium-Home-{version}-universal.dmg',
  'Qortium-Home-{version}-x64.exe',
  'Qortium-Home-{version}-x86_64.AppImage',
];

export function parseScenarioArgument(argv, envValue, fail) {
  const requested =
    argv.find((argument) => argument.startsWith('--scenario='))?.slice('--scenario='.length).trim() ||
    (argv.includes('--all') ? 'all' : '') ||
    envValue?.trim() ||
    'all';

  if (requested === 'all') {
    return [...scenarioNames];
  }

  if (!scenarioNames.includes(requested)) {
    fail(`Unknown scenario ${JSON.stringify(requested)}. Expected one of: ${scenarioNames.join(', ')}, all.`);
  }

  return [requested];
}

export function getNextVersion(version, fail) {
  const [core] = version.split('-');
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));

  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    fail(`Unable to derive a newer version from ${JSON.stringify(version)}.`);
  }

  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

export function buildRelease(version) {
  const tagName = `v${version}`;

  return {
    assets: assetNameTemplates.map((template, index) => {
      const name = template.replace('{version}', version);

      return {
        browser_download_url: `https://example.invalid/${tagName}/${name}`,
        // Deterministic and distinct per asset, so a seed built from the wrong
        // asset cannot match by accident.
        digest: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
        name,
        size: 1024 * (index + 1),
      };
    }),
    draft: false,
    html_url: `https://example.invalid/releases/${tagName}`,
    name: tagName,
    prerelease: true,
    published_at: '2026-07-20T00:00:00Z',
    tag_name: tagName,
  };
}

export function buildScenarioFixture({ asset, currentVersion, fail, homeUpdatePolicy = 'notify', scenario }) {
  const releaseVersion = scenario === 'installed' ? currentVersion : getNextVersion(currentVersion, fail);
  const release = buildRelease(releaseVersion);
  const chosenAsset = asset ?? null;

  return {
    preferences: chosenAsset
      ? {
          downloadedUpdate: {
            canOpen: true,
            canReveal: true,
            digest: chosenAsset.digest,
            digestVerified: true,
            downloadedAt: '2026-07-21T00:00:00.000Z',
            fileName: chosenAsset.name,
            filePath: `/tmp/${chosenAsset.name}`,
            releaseTag: release.tag_name,
            size: chosenAsset.size,
          },
          homeUpdatePolicy,
          releaseChannel: null,
        }
      : null,
    release,
    releaseVersion,
  };
}

// Overrides window.fetch for the GitHub release endpoints only. On Android the
// CapacitorHttp plugin patches window.fetch itself at runtime, so this has to
// be applied *after* page load rather than as a pre-load bootstrap, or
// Capacitor's patch replaces it and the stub silently never applies.
export function buildFetchStubSource(release) {
  return `
(() => {
  const releasePayload = ${JSON.stringify(release)};
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';

    if (url.includes('api.github.com') && url.includes('/releases')) {
      const body = url.includes('/releases/latest') ? releasePayload : [releasePayload];

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    }

    return originalFetch(input, init);
  };

  return true;
})()
`;
}

// Reads the update card the same way on both platforms. The card carries both
// the status row and the action button, so no navigation into Settings is
// needed to observe either half of the regression.
export function buildUpdateCardStateSource(storedDownloadExpression) {
  return `
(async () => {
  const card = document.querySelector('.dashboard-card--updates');

  if (!card) {
    return null;
  }

  const rows = [...card.querySelectorAll('.detail-list__row')];
  const statusRow = rows.find((row) => row.querySelector('.detail-list__label')?.textContent?.trim() === 'Status');
  const actionButtons = [...card.querySelectorAll('.dashboard-card__actions button')];

  return {
    actions: actionButtons.map((button) => button.textContent?.trim() ?? ''),
    status: statusRow?.querySelector('.detail-list__value')?.textContent?.trim() ?? '',
    storedDownloadTag: await (${storedDownloadExpression}),
  };
})()
`;
}

export function getScenarioExpectations({ platformOs, release, scenario }) {
  if (scenario === 'installed') {
    return {
      // The regression itself.
      action: null,
      status: 'Up to date',
      storedDownloadTag: null,
    };
  }

  // The other half: a download for a release that really is still pending has
  // to survive, or the fix would just have broken the feature it guards.
  return {
    action: platformOs === 'android' ? 'Install APK' : 'Show file',
    status: 'Downloaded',
    storedDownloadTag: release.tag_name,
  };
}

export function assertScenarioState({ assert, expectations, scenario, state }) {
  assert(
    state.status === expectations.status,
    `Scenario ${scenario}: expected status ${JSON.stringify(expectations.status)}, found ${JSON.stringify(state.status)}.`,
  );

  if (expectations.action === null) {
    assert(
      state.actions.length === 0,
      `Scenario ${scenario}: expected no update action, found ${JSON.stringify(state.actions)}.`,
    );
  } else {
    assert(
      state.actions.includes(expectations.action),
      `Scenario ${scenario}: expected a ${JSON.stringify(expectations.action)} action, found ${JSON.stringify(state.actions)}.`,
    );
  }

  assert(
    state.storedDownloadTag === expectations.storedDownloadTag,
    `Scenario ${scenario}: expected stored download ${JSON.stringify(expectations.storedDownloadTag)}, found ${JSON.stringify(state.storedDownloadTag)}.`,
  );
}
