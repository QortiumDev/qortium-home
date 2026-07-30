import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_NODE_API_URL = 'http://127.0.0.1:24891';
const DEFAULT_NAME = 'QortiumHomeTest';
const APP_IDENTIFIER = 'home-test';
const IMAGE_IDENTIFIER = 'home-image';
const AUDIO_IDENTIFIER = 'home-audio';
const VIDEO_IDENTIFIER = 'home-video';
// Seekable, mobile-friendly media. The fixtures above are only 2-3 seconds long,
// which is far too short to drag a position slider. Keep both long video codecs:
// H.264/AAC exercises common desktop/hardware playback, while video-only VP8 WebM
// gives the Android emulator and lower-end WebViews a software-decodable seek fixture.
const AUDIO_LONG_IDENTIFIER = 'home-audio-mp3';
const VIDEO_LONG_IDENTIFIER = 'home-video-mp4';
const VIDEO_LONG_WEBM_IDENTIFIER = 'home-video-webm';
const LONG_MEDIA_DURATION_SECONDS = 60;
const JSON_IDENTIFIER = 'home-json';
const FILE_IDENTIFIER = 'home-file';
const GIT_IDENTIFIER = 'home-git-demo';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 180_000;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_BASE = BigInt(BASE58_ALPHABET.length);
const REGISTER_NAME_TRANSACTION_TYPE = 3;

const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? DEFAULT_NODE_API_URL).replace(/\/+$/, '');
const testName = process.env.QORTIUM_HOME_TEST_NAME ?? DEFAULT_NAME;
const apiKeyPath = expandHomePath(
  process.env.QORTIUM_HOME_NODE_API_KEY_PATH ?? '~/.config/qortium-core/runtime/apikey.txt',
);
const previewAccountsPath = expandHomePath(
  process.env.QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH ??
    '~/qortium/git/qortium-core/preview/secrets/initial-minting-accounts.json',
);
const gitOnly = process.argv.includes('--git-only');
// Republishing every fixture just to refresh media would also bump home-git-demo, whose
// exact branch/commit shape the Git viewer acceptance testing depends on. This publishes
// only the long seekable media.
const mediaOnly = process.argv.includes('--media-only');
const videoWebmOnly = process.argv.includes('--video-webm-only');

function expandHomePath(filePath) {
  if (filePath === '~') {
    return homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(homedir(), filePath.slice(2));
  }

  return filePath;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8').trim();
}

function decodeBase58(value) {
  let decoded = 0n;

  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error(`Invalid Base58 character: ${character}`);
    }

    decoded = decoded * BASE58_BASE + BigInt(index);
  }

  const bytes = [];

  while (decoded > 0n) {
    bytes.unshift(Number(decoded % 256n));
    decoded /= 256n;
  }

  for (const character of value) {
    if (character !== '1') {
      break;
    }

    bytes.unshift(0);
  }

  return Buffer.from(bytes);
}

function encodeBase58(bytes) {
  let value = 0n;

  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = '';

  while (value > 0n) {
    const remainder = Number(value % BASE58_BASE);
    value /= BASE58_BASE;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }

    encoded = '1' + encoded;
  }

  return encoded || '1';
}

function intBytes(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);

  return bytes;
}

function longBytes(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64BE(BigInt(value));

  return bytes;
}

function sizedStringBytes(value) {
  const stringBytes = Buffer.from(value, 'utf8');

  return Buffer.concat([intBytes(stringBytes.length), stringBytes]);
}

function buildRegisterNameRawBytes58({ account, data, name, timestamp }) {
  const publicKey = decodeBase58(account.accountPublicKey);

  if (publicKey.length !== 32) {
    throw new Error(`Local account public key must decode to 32 bytes, got ${publicKey.length}.`);
  }

  return encodeBase58(
    Buffer.concat([
      intBytes(REGISTER_NAME_TRANSACTION_TYPE),
      longBytes(timestamp),
      intBytes(0),
      publicKey,
      intBytes(0),
      sizedStringBytes(name),
      sizedStringBytes(data),
      longBytes(0),
    ]),
  );
}

function getApiKey() {
  const explicitApiKey = process.env.QORTIUM_HOME_NODE_API_KEY?.trim();

  if (explicitApiKey) {
    return explicitApiKey;
  }

  return readText(apiKeyPath);
}

function getLocalPreviewAccount() {
  const previewAccounts = readJson(previewAccountsPath);
  const account = previewAccounts.accounts?.find((item) => item.role === 'local');

  if (!account?.accountAddress || !account?.accountPrivateKey || !account?.accountPublicKey) {
    throw new Error(`Local preview account was not found in ${previewAccountsPath}.`);
  }

  return account;
}

function getHeaders(contentType) {
  const headers = {
    'X-API-KEY': apiKey,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

async function request(pathname, options = {}) {
  const response = await fetch(`${nodeApiUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `${options.method ?? 'GET'} ${pathname} failed with HTTP ${response.status}.`);
  }

  return text;
}

async function requestJson(pathname, options = {}) {
  const text = await request(pathname, options);

  return text ? JSON.parse(text) : null;
}

function appendQuery(pathname, query) {
  const queryParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        queryParams.append(key, item);
      }
      continue;
    }

    queryParams.set(key, String(value));
  }

  const queryString = queryParams.toString();

  return queryString ? `${pathname}?${queryString}` : pathname;
}

async function waitFor(label, predicate) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    try {
      const result = await predicate();

      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for ${label}.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ''}`,
  );
}

async function signAndProcess(rawUnsignedBytes58, privateKey58) {
  const signedBytes58 = await request('/transactions/sign', {
    method: 'POST',
    headers: getHeaders('application/json'),
    body: JSON.stringify({
      privateKey: privateKey58,
      transactionBytes: rawUnsignedBytes58,
    }),
  });

  const processResult = await request('/transactions/process', {
    method: 'POST',
    headers: getHeaders('text/plain'),
    body: signedBytes58,
  });

  if (processResult.trim() !== 'true' && !processResult.includes('"type"')) {
    throw new Error(`Transaction was not accepted: ${processResult}`);
  }

  return signedBytes58;
}

async function getNameInfo(name) {
  const response = await fetch(`${nodeApiUrl}/names/${encodeURIComponent(name)}`);

  if (response.status === 404) {
    return null;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Name lookup failed with HTTP ${response.status}.`);
  }

  return JSON.parse(text);
}

async function ensureNameRegistered(name, account) {
  const existingName = await getNameInfo(name);

  if (existingName) {
    if (existingName.owner !== account.accountAddress) {
      throw new Error(`${name} is already registered to ${existingName.owner}.`);
    }

    console.log(`Name already registered: ${name} (${existingName.owner})`);
    return;
  }

  console.log(`Registering name with mempow: ${name}`);

  const rawRegisterBytes58 = buildRegisterNameRawBytes58({
    account,
    timestamp: Date.now(),
    name,
    data: JSON.stringify({
      app: 'Qortium Home',
      purpose: 'QDN browser test fixtures',
    }),
  });
  const rawRegisterWithNonce58 = await request('/transactions/mempow/compute', {
    method: 'POST',
    headers: getHeaders('text/plain'),
    body: rawRegisterBytes58,
  });

  await signAndProcess(rawRegisterWithNonce58, account.accountPrivateKey);
  await waitFor(`name ${name}`, async () => {
    const nameInfo = await getNameInfo(name);

    return nameInfo?.owner === account.accountAddress ? nameInfo : null;
  });

  console.log(`Name registered: ${name}`);
}

function createGitFixture(fixtureRoot) {
  const gitDirectory = path.join(fixtureRoot, 'git-repository');
  const gitEnvironment = {
    ...process.env,
    GIT_AUTHOR_DATE: '2026-07-19T12:00:00Z',
    GIT_AUTHOR_NAME: 'Qortium Test Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@qortium.invalid',
    GIT_COMMITTER_DATE: '2026-07-19T12:00:00Z',
    GIT_COMMITTER_NAME: 'Qortium Test Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@qortium.invalid',
  };
  const runGit = (args, date) =>
    execFileSync('git', args, {
      cwd: gitDirectory,
      env: date
        ? { ...gitEnvironment, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
        : gitEnvironment,
      stdio: 'pipe',
    });

  mkdirSync(gitDirectory);
  runGit(['init', '-b', 'main']);
  writeFileSync(
    path.join(gitDirectory, 'README.md'),
    '# Qortium Home Git fixture\n\nA small real repository published to QDN for Home viewer testing.\n',
    'utf8',
  );
  writeFileSync(path.join(gitDirectory, 'LICENSE'), '0BSD test fixture\n', 'utf8');
  mkdirSync(path.join(gitDirectory, 'src'));
  writeFileSync(path.join(gitDirectory, 'src', 'hello.js'), "export const greeting = 'Hello from main';\n", 'utf8');
  runGit(['add', 'README.md', 'LICENSE', 'src/hello.js']);
  runGit(['commit', '-m', 'Create Qortium Home Git fixture'], '2026-07-19T12:00:00Z');

  runGit(['switch', '-c', 'feature/greeting']);
  writeFileSync(
    path.join(gitDirectory, 'src', 'hello.js'),
    "export const greeting = 'Hello from the feature branch';\n",
    'utf8',
  );
  writeFileSync(
    path.join(gitDirectory, 'FEATURE.md'),
    '# Greeting feature\n\nThis file exists only on `feature/greeting`.\n',
    'utf8',
  );
  runGit(['add', 'src/hello.js', 'FEATURE.md']);
  runGit(['commit', '-m', 'Add feature branch greeting'], '2026-07-19T13:00:00Z');

  runGit(['switch', 'main']);
  writeFileSync(
    path.join(gitDirectory, 'CHANGELOG.md'),
    '# Changelog\n\n- Added branch and commit navigation fixture data.\n',
    'utf8',
  );
  writeFileSync(
    path.join(gitDirectory, 'README.md'),
    '# Qortium Home Git fixture\n\nBrowse `main` and `feature/greeting` to verify branch-specific history and files.\n',
    'utf8',
  );
  runGit(['add', 'README.md', 'CHANGELOG.md']);
  runGit(['commit', '-m', 'Document repository navigation'], '2026-07-19T14:00:00Z');

  // Keep the published fixture deterministic and free of executable hook
  // samples or mutable local checkout state. Git recreates its index as needed.
  rmSync(path.join(gitDirectory, '.git', 'hooks'), { force: true, recursive: true });
  rmSync(path.join(gitDirectory, '.git', 'index'), { force: true });
  rmSync(path.join(gitDirectory, '.git', 'COMMIT_EDITMSG'), { force: true });

  return gitDirectory;
}

function createGitFixtureFiles() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'qortium-home-qdn-git-'));
  return { fixtureRoot, gitDirectory: createGitFixture(fixtureRoot) };
}

function generateLongWebmFixture(videoLongWebmPath) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=320x180:rate=12:duration=${LONG_MEDIA_DURATION_SECONDS}`,
      '-c:v',
      'libvpx',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-b:v',
      '250k',
      '-g',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-an',
      videoLongWebmPath,
    ],
    { stdio: 'pipe' },
  );
}

function createLongWebmFixtureFiles() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'qortium-home-qdn-video-webm-'));
  const videoLongWebmPath = path.join(fixtureRoot, 'qortium-home-test-video-long.webm');

  try {
    generateLongWebmFixture(videoLongWebmPath);
  } catch (error) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    throw new Error(
      `Unable to generate the long VP8/WebM fixture with ffmpeg. Install ffmpeg and retry. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }

  return { fixtureRoot, videoLongWebmPath };
}

function createFixtureFiles() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'qortium-home-qdn-'));
  const appDirectory = path.join(fixtureRoot, 'app');
  const websiteDirectory = path.join(fixtureRoot, 'website');
  const imagePath = path.join(fixtureRoot, 'qortium-home-test-image.svg');
  const audioPath = path.join(fixtureRoot, 'qortium-home-test-audio.ogg');
  const videoPath = path.join(fixtureRoot, 'qortium-home-test-video.webm');
  const audioLongPath = path.join(fixtureRoot, 'qortium-home-test-audio-long.mp3');
  const videoLongPath = path.join(fixtureRoot, 'qortium-home-test-video-long.mp4');
  const videoLongWebmPath = path.join(fixtureRoot, 'qortium-home-test-video-long.webm');
  const jsonPath = path.join(fixtureRoot, 'qortium-home-test.json');
  const filePath = path.join(fixtureRoot, 'qortium-home-test-file.txt');
  const gitDirectory = createGitFixture(fixtureRoot);

  mkdirSync(appDirectory);
  mkdirSync(websiteDirectory);

  writeFileSync(
    path.join(fixtureRoot, 'README.txt'),
    'Temporary Qortium Home QDN bootstrap fixtures.\n',
    'utf8',
  );

  writeFileSync(
    path.join(appDirectory, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Qortium Home APP Test</title>
    <style>
      body {
        margin: 0;
        display: grid;
        min-height: 100vh;
        place-items: center;
        color: #f4f0e8;
        background: #0f1313;
        font-family: system-ui, sans-serif;
      }
      main {
        display: grid;
        gap: 12px;
        text-align: center;
      }
      h1 {
        margin: 0;
        font-size: 32px;
      }
      p {
        margin: 0;
        color: #a9b6b6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Qortium Home APP Test</h1>
      <p>Loaded from qdn://APP/${testName}/${APP_IDENTIFIER}</p>
    </main>
  </body>
</html>
`,
    'utf8',
  );

  writeFileSync(
    path.join(websiteDirectory, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Qortium Home WEBSITE Test</title>
    <style>
      body {
        margin: 0;
        color: #162020;
        background: #f4f0e8;
        font-family: system-ui, sans-serif;
      }
      main {
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 32px;
        text-align: center;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 32px;
      }
      p {
        margin: 0;
        color: #4d5d5d;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Qortium Home WEBSITE Test</h1>
        <p>Loaded from qdn://WEBSITE/${testName}/default</p>
      </section>
    </main>
  </body>
</html>
`,
    'utf8',
  );

  writeFileSync(
    imagePath,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" role="img" aria-label="Qortium Home test image">
  <rect width="800" height="450" fill="#0f1313"/>
  <rect x="48" y="48" width="704" height="354" rx="24" fill="#192020" stroke="#344141" stroke-width="4"/>
  <path d="M180 238 L286 132 L392 238 L312 238 L312 318 L248 318 L248 238 Z" fill="#87d99b"/>
  <circle cx="560" cy="168" r="46" fill="#e4c06d"/>
  <text x="400" y="344" text-anchor="middle" font-family="system-ui, sans-serif" font-size="42" font-weight="700" fill="#f4f0e8">Qortium Home IMAGE Test</text>
  <text x="400" y="384" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" fill="#a9b6b6">qdn://IMAGE/${testName}/${IMAGE_IDENTIFIER}</text>
</svg>
`,
    'utf8',
  );

  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        app: 'Qortium Home',
        fixture: 'JSON',
        name: testName,
        resource: `qdn://JSON/${testName}/${JSON_IDENTIFIER}`,
        publishedAt: new Date().toISOString(),
        status: {
          purpose: 'Test the QDN text viewer',
          temporary: true,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  writeFileSync(
    filePath,
    [
      'Qortium Home FILE Test',
      '',
      `Resource: qdn://FILE/${testName}/${FILE_IDENTIFIER}`,
      `Published: ${new Date().toISOString()}`,
      '',
      'This fixture is intentionally small and exists to test the QDN download/details viewer.',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2:sample_rate=44100',
        '-c:a',
        'libvorbis',
        '-q:a',
        '4',
        audioPath,
      ],
      { stdio: 'pipe' },
    );

    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x360:rate=24:duration=3',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=660:duration=3:sample_rate=44100',
        '-shortest',
        '-c:v',
        'libvpx',
        '-b:v',
        '500k',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'libvorbis',
        '-q:a',
        '3',
        videoPath,
      ],
      { stdio: 'pipe' },
    );

    // A rising frequency sweep rather than a constant tone, so a listener can tell by
    // ear whether a seek actually landed somewhere new instead of restarting.
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=220:beep_factor=4:duration=${LONG_MEDIA_DURATION_SECONDS}:sample_rate=44100`,
        '-c:a',
        'libmp3lame',
        '-q:a',
        '5',
        audioLongPath,
      ],
      { stdio: 'pipe' },
    );

    // testsrc2 burns a running timestamp into the picture, so a seek is visually
    // verifiable. -movflags +faststart moves the moov atom to the front, without which
    // a browser cannot start playback (or seek) until the whole file has arrived.
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=640x360:rate=24:duration=${LONG_MEDIA_DURATION_SECONDS}`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:beep_factor=4:duration=${LONG_MEDIA_DURATION_SECONDS}:sample_rate=44100`,
        '-shortest',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-profile:v',
        'baseline',
        '-level',
        '3.0',
        '-pix_fmt',
        'yuv420p',
        '-b:v',
        '500k',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        videoLongPath,
      ],
      { stdio: 'pipe' },
    );

    generateLongWebmFixture(videoLongWebmPath);
  } catch (error) {
    throw new Error(
      `Unable to generate AUDIO and VIDEO fixtures with ffmpeg. Install ffmpeg and retry. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }

  return {
    appDirectory,
    audioLongPath,
    audioPath,
    filePath,
    fixtureRoot,
    gitDirectory,
    imagePath,
    jsonPath,
    videoLongPath,
    videoLongWebmPath,
    videoPath,
    websiteDirectory,
  };
}

async function publishResource({ description, identifier, path: resourcePath, service, title }) {
  const resourcePathname = identifier
    ? `/arbitrary/${service}/${encodeURIComponent(testName)}/${encodeURIComponent(identifier)}`
    : `/arbitrary/${service}/${encodeURIComponent(testName)}`;
  const rawUnsignedBytes58 = await request(
    appendQuery(resourcePathname, {
      title,
      description,
      fee: 0,
    }),
    {
      method: 'POST',
      headers: getHeaders('text/plain'),
      body: resourcePath,
    },
  );
  const rawUnsignedWithNonce58 = await request('/arbitrary/compute', {
    method: 'POST',
    headers: getHeaders('text/plain'),
    body: rawUnsignedBytes58,
  });

  await signAndProcess(rawUnsignedWithNonce58, account.accountPrivateKey);

  console.log(`Published ${service}: qdn://${service}/${testName}/${identifier ?? 'default'}`);
}

async function getResourceStatus(service, identifier) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';

  return requestJson(
    `/arbitrary/resource/status/${service}/${encodeURIComponent(testName)}${identifierPath}?build=true`,
    {
      headers: getHeaders(),
    },
  );
}

async function waitForResourceReady(service, identifier) {
  await waitFor(`${service} ${identifier ?? 'default'} resource`, async () => {
    const status = await getResourceStatus(service, identifier);

    if (status?.status === 'READY') {
      return status;
    }

    if (status?.status === 'BLOCKED' || status?.status === 'BUILD_FAILED' || status?.status === 'UNSUPPORTED') {
      throw new Error(`${service} ${identifier ?? 'default'} status is ${status.status}.`);
    }

    return null;
  });

  console.log(`Ready ${service}: qdn://${service}/${testName}/${identifier ?? 'default'}`);
}

const apiKey = getApiKey();
const account = getLocalPreviewAccount();

console.log(`Node: ${nodeApiUrl}`);
console.log(`Owner: ${account.accountAddress}`);
console.log(`Name: ${testName}`);

const status = await requestJson('/admin/status');

if (!status || status.syncPercent !== 100 || status.isSynchronizing) {
  throw new Error(`Node is not synced: ${JSON.stringify(status)}`);
}

console.log(`Node synced at height ${status.height}.`);

if (gitOnly) {
  const gitFixtures = createGitFixtureFiles();
  try {
    await ensureNameRegistered(testName, account);
    await publishResource({
      service: 'GIT_REPOSITORY',
      identifier: GIT_IDENTIFIER,
      path: gitFixtures.gitDirectory,
      title: 'Qortium Home Git repository demo',
      description: 'Real Git repository with main and feature/greeting branches for Home viewer testing',
    });
    await waitForResourceReady('GIT_REPOSITORY', GIT_IDENTIFIER);
    console.log('QDN Git repository fixture bootstrap complete.');
    console.log(`GIT_REPOSITORY: qdn://GIT_REPOSITORY/${testName}/${GIT_IDENTIFIER}`);
  } finally {
    rmSync(gitFixtures.fixtureRoot, { recursive: true, force: true });
  }
} else if (videoWebmOnly) {
  const fixtures = createLongWebmFixtureFiles();

  try {
    await ensureNameRegistered(testName, account);
    await publishResource({
      service: 'VIDEO',
      identifier: VIDEO_LONG_WEBM_IDENTIFIER,
      path: fixtures.videoLongWebmPath,
      title: 'Qortium Home long VIDEO Test (VP8 WebM)',
      description: `Seekable ${LONG_MEDIA_DURATION_SECONDS}s low-bandwidth VP8 WebM for Android video scrubbing tests`,
    });
    await waitForResourceReady('VIDEO', VIDEO_LONG_WEBM_IDENTIFIER);
    console.log('QDN long VP8/WebM fixture bootstrap complete.');
    console.log(`VIDEO (long VP8 WebM): qdn://VIDEO/${testName}/${VIDEO_LONG_WEBM_IDENTIFIER}`);
  } finally {
    rmSync(fixtures.fixtureRoot, { recursive: true, force: true });
  }
} else if (mediaOnly) {
  const fixtures = createFixtureFiles();

  try {
    await ensureNameRegistered(testName, account);
    await publishResource({
      service: 'AUDIO',
      identifier: AUDIO_LONG_IDENTIFIER,
      path: fixtures.audioLongPath,
      title: 'Qortium Home long AUDIO Test (MP3)',
      description: `Seekable ${LONG_MEDIA_DURATION_SECONDS}s MP3 for audio scrubbing tests on desktop and Android`,
    });
    await publishResource({
      service: 'VIDEO',
      identifier: VIDEO_LONG_IDENTIFIER,
      path: fixtures.videoLongPath,
      title: 'Qortium Home long VIDEO Test (MP4)',
      description: `Seekable ${LONG_MEDIA_DURATION_SECONDS}s H.264/AAC MP4 for video scrubbing tests on desktop and Android`,
    });
    await publishResource({
      service: 'VIDEO',
      identifier: VIDEO_LONG_WEBM_IDENTIFIER,
      path: fixtures.videoLongWebmPath,
      title: 'Qortium Home long VIDEO Test (VP8 WebM)',
      description: `Seekable ${LONG_MEDIA_DURATION_SECONDS}s low-bandwidth VP8 WebM for Android video scrubbing tests`,
    });
    await waitForResourceReady('AUDIO', AUDIO_LONG_IDENTIFIER);
    await waitForResourceReady('VIDEO', VIDEO_LONG_IDENTIFIER);
    await waitForResourceReady('VIDEO', VIDEO_LONG_WEBM_IDENTIFIER);
    console.log('QDN long media fixture bootstrap complete.');
    console.log(`AUDIO (long MP3): qdn://AUDIO/${testName}/${AUDIO_LONG_IDENTIFIER}`);
    console.log(`VIDEO (long MP4): qdn://VIDEO/${testName}/${VIDEO_LONG_IDENTIFIER}`);
    console.log(`VIDEO (long VP8 WebM): qdn://VIDEO/${testName}/${VIDEO_LONG_WEBM_IDENTIFIER}`);
  } finally {
    rmSync(fixtures.fixtureRoot, { recursive: true, force: true });
  }
} else {
  const fixtures = createFixtureFiles();

  try {
    await ensureNameRegistered(testName, account);

    await publishResource({
      service: 'APP',
      identifier: APP_IDENTIFIER,
      path: fixtures.appDirectory,
      title: 'Qortium Home APP Test',
      description: 'Temporary Qortium Home QDN browser test app',
    });
    await publishResource({
      service: 'WEBSITE',
      path: fixtures.websiteDirectory,
      title: 'Qortium Home WEBSITE Test',
      description: 'Temporary Qortium Home QDN browser test website',
    });
    await publishResource({
      service: 'IMAGE',
      identifier: IMAGE_IDENTIFIER,
      path: fixtures.imagePath,
      title: 'Qortium Home IMAGE Test',
      description: 'Temporary Qortium Home QDN browser test image',
    });
    await publishResource({
      service: 'AUDIO',
      identifier: AUDIO_IDENTIFIER,
      path: fixtures.audioPath,
      title: 'Qortium Home AUDIO Test',
      description: 'Temporary Qortium Home QDN browser audio-player test data',
    });
    await publishResource({
      service: 'VIDEO',
      identifier: VIDEO_IDENTIFIER,
      path: fixtures.videoPath,
      title: 'Qortium Home VIDEO Test',
      description: 'Temporary Qortium Home QDN browser video-player test data',
    });
    await publishResource({
      service: 'AUDIO',
      identifier: AUDIO_LONG_IDENTIFIER,
      path: fixtures.audioLongPath,
      title: 'Qortium Home long AUDIO Test (MP3)',
      description: `Seekable ${LONG_MEDIA_DURATION_SECONDS}s MP3 for audio scrubbing tests on desktop and Android`,
    });
    await publishResource({
      service: 'VIDEO',
      identifier: VIDEO_LONG_IDENTIFIER,
      path: fixtures.videoLongPath,
      title: 'Qortium Home long VIDEO Test (MP4)',
      description: `Seekable ${LONG_MEDIA_DURATION_SECONDS}s H.264/AAC MP4 for video scrubbing tests on desktop and Android`,
    });
    await publishResource({
      service: 'VIDEO',
      identifier: VIDEO_LONG_WEBM_IDENTIFIER,
      path: fixtures.videoLongWebmPath,
      title: 'Qortium Home long VIDEO Test (VP8 WebM)',
      description: `Seekable ${LONG_MEDIA_DURATION_SECONDS}s low-bandwidth VP8 WebM for Android video scrubbing tests`,
    });
    await publishResource({
      service: 'JSON',
      identifier: JSON_IDENTIFIER,
      path: fixtures.jsonPath,
      title: 'Qortium Home JSON Test',
      description: 'Temporary Qortium Home QDN browser text-viewer test data',
    });
    await publishResource({
      service: 'FILE',
      identifier: FILE_IDENTIFIER,
      path: fixtures.filePath,
      title: 'Qortium Home FILE Test',
      description: 'Temporary Qortium Home QDN browser download-viewer test file',
    });
    await publishResource({
      service: 'GIT_REPOSITORY',
      identifier: GIT_IDENTIFIER,
      path: fixtures.gitDirectory,
      title: 'Qortium Home Git repository demo',
      description: 'Real Git repository with main and feature/greeting branches for Home viewer testing',
    });

    await waitForResourceReady('APP', APP_IDENTIFIER);
    await waitForResourceReady('WEBSITE');
    await waitForResourceReady('IMAGE', IMAGE_IDENTIFIER);
    await waitForResourceReady('AUDIO', AUDIO_IDENTIFIER);
    await waitForResourceReady('VIDEO', VIDEO_IDENTIFIER);
    await waitForResourceReady('AUDIO', AUDIO_LONG_IDENTIFIER);
    await waitForResourceReady('VIDEO', VIDEO_LONG_IDENTIFIER);
    await waitForResourceReady('VIDEO', VIDEO_LONG_WEBM_IDENTIFIER);
    await waitForResourceReady('JSON', JSON_IDENTIFIER);
    await waitForResourceReady('FILE', FILE_IDENTIFIER);
    await waitForResourceReady('GIT_REPOSITORY', GIT_IDENTIFIER);

    console.log('QDN test data bootstrap complete.');
    console.log(`APP: qdn://APP/${testName}/${APP_IDENTIFIER}`);
    console.log(`WEBSITE: qdn://WEBSITE/${testName}/default`);
    console.log(`IMAGE: qdn://IMAGE/${testName}/${IMAGE_IDENTIFIER}`);
    console.log(`AUDIO: qdn://AUDIO/${testName}/${AUDIO_IDENTIFIER}`);
    console.log(`VIDEO: qdn://VIDEO/${testName}/${VIDEO_IDENTIFIER}`);
    console.log(`AUDIO (long MP3): qdn://AUDIO/${testName}/${AUDIO_LONG_IDENTIFIER}`);
    console.log(`VIDEO (long MP4): qdn://VIDEO/${testName}/${VIDEO_LONG_IDENTIFIER}`);
    console.log(`VIDEO (long VP8 WebM): qdn://VIDEO/${testName}/${VIDEO_LONG_WEBM_IDENTIFIER}`);
    console.log(`JSON: qdn://JSON/${testName}/${JSON_IDENTIFIER}`);
    console.log(`FILE: qdn://FILE/${testName}/${FILE_IDENTIFIER}`);
    console.log(`GIT_REPOSITORY: qdn://GIT_REPOSITORY/${testName}/${GIT_IDENTIFIER}`);
  } finally {
    rmSync(fixtures.fixtureRoot, { recursive: true, force: true });
  }
}
