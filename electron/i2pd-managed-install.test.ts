import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  I2pdManagedInstallError,
  activateTrustedI2pdGeneration,
  installPinnedI2pd,
  readI2pdLegacyManagedInstall,
  readI2pdManagedInstall,
  readTrustedI2pdManagedInstall,
  resolveI2pdManagedInstallPaths,
  type I2pdArchiveExtractor,
  type I2pdManagedInstallDependencies,
} from './i2pd-managed-install.js'
import {
  getTrustedI2pdRelease,
  I2PD_LEGACY_VERSION,
  I2PD_PINNED_VERSION,
  type I2pdPinnedRelease,
} from './i2pd-release-policy.js'

const ARCHIVE = Buffer.from('deterministic managed i2pd archive fixture')
const RELEASE: I2pdPinnedRelease = Object.freeze({
  archiveType: 'tar.gz',
  assetName: 'i2pd-2.60.0-q2-linux-x86_64.tar.gz',
  binaryName: 'i2pd',
  downloadUrl: 'https://github.com/QortiumDev/qortium-i2pd/releases/download/2.60.0-q2/i2pd-2.60.0-q2-linux-x86_64.tar.gz',
  logPolicy: 'legacy-unbounded',
  sha256: createHash('sha256').update(ARCHIVE).digest('hex'),
  size: ARCHIVE.byteLength,
  target: 'linux-x86_64',
  version: '2.60.0-q2',
})
const INPUT = { arch: 'x64', platform: 'linux' } as const

function response(bytes = ARCHIVE, init: ResponseInit = {}) {
  return new Response(bytes, {
    headers: { 'Content-Length': String(bytes.byteLength), ...init.headers },
    status: init.status ?? 200,
  })
}

const extractOne: I2pdArchiveExtractor = async ({ destinationPath }) => {
  await mkdir(path.join(destinationPath, 'bin'))
  await writeFile(path.join(destinationPath, 'bin', 'i2pd'), 'verified executable fixture')
}

function dependencies(overrides: Partial<I2pdManagedInstallDependencies> = {}): I2pdManagedInstallDependencies {
  return {
    extractArchive: extractOne,
    fetch: async () => response(),
    now: () => new Date('2026-08-22T12:34:56.000Z'),
    randomToken: () => '0123456789abcdef0123456789abcdef',
    resolveRelease: () => RELEASE,
    ...overrides,
  }
}

async function temporaryBase(label: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), `i2pd-managed-${label}-`))
  return { basePath: path.join(root, 'state'), root }
}

async function expectCode(promise: Promise<unknown>, code: I2pdManagedInstallError['code']) {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof I2pdManagedInstallError && error.code === code)
}

async function noTemporaryEntries(basePath: string) {
  const paths = resolveI2pdManagedInstallPaths(basePath)
  assert.deepEqual((await readdir(paths.downloadsPath)).filter((name) => name.endsWith('.part')), [])
  assert.deepEqual((await readdir(paths.versionsPath)).filter((name) => name.startsWith('.staging-')), [])
}

async function writeTrustedGeneration(
  basePath: string,
  release: I2pdPinnedRelease,
  binaryContents: string,
) {
  const paths = resolveI2pdManagedInstallPaths(basePath)
  await mkdir(paths.downloadsPath, { mode: 0o700, recursive: true })
  await mkdir(paths.runtimePath, { mode: 0o700, recursive: true })
  await mkdir(paths.versionsPath, { mode: 0o700, recursive: true })
  const generation = `${release.version}-${release.target}-${release.sha256}`
  const generationPath = path.join(paths.versionsPath, generation)
  const binaryDirectory = path.join(generationPath, 'bin')
  await mkdir(binaryDirectory, { mode: 0o700, recursive: true })
  const binaryPath = path.join(binaryDirectory, release.binaryName)
  await writeFile(binaryPath, binaryContents, { mode: 0o700 })
  const bytes = Buffer.from(binaryContents)
  const record = {
    archiveSha256: release.sha256,
    archiveSize: release.size,
    archiveType: release.archiveType,
    assetName: release.assetName,
    binaryName: release.binaryName,
    binaryRelativePath: `bin/${release.binaryName}`,
    binarySha256: createHash('sha256').update(bytes).digest('hex'),
    binarySize: bytes.byteLength,
    generation,
    installedAt: '2026-09-01T12:00:00.000Z',
    revision: 1,
    schema: 'qortium-home-i2pd-managed-install',
    target: release.target,
    version: release.version,
  }
  const json = `${JSON.stringify(record, null, 2)}\n`
  await writeFile(path.join(generationPath, '.qortium-home-i2pd-generation.json'), json, {
    mode: 0o600,
  })
  await writeFile(paths.currentRecordPath, json, { mode: 0o600 })
  if (process.platform !== 'win32') {
    await chmod(basePath, 0o700)
    await chmod(generationPath, 0o700)
  }
}

{
  const { basePath, root } = await temporaryBase('success')
  try {
    await mkdir(path.join(basePath, 'runtime'), { recursive: true })
    await writeFile(path.join(basePath, 'runtime', 'router.keys'), 'persistent identity')
    let fetches = 0
    const installed = await installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async (_input, init) => {
        fetches += 1
        assert.equal(init?.redirect, 'manual')
        assert(init?.signal instanceof AbortSignal)
        return response()
      },
    }))
    assert.equal(installed.kind, 'installed')
    assert.equal(fetches, 1)
    assert.equal(path.basename(installed.install.binaryPath), 'i2pd')
    assert.equal(await readFile(path.join(basePath, 'runtime', 'router.keys'), 'utf8'), 'persistent identity')
    if (process.platform !== 'win32') {
      assert.equal((await lstat(basePath)).mode & 0o777, 0o700)
      assert.equal((await lstat(path.join(basePath, 'current.json'))).mode & 0o077, 0)
    }
    const rawRecord = await readFile(path.join(basePath, 'current.json'), 'utf8')
    assert.doesNotMatch(rawRecord, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal((await readI2pdManagedInstall({ ...INPUT, basePath }))?.record.archiveSha256, RELEASE.sha256)
    await expectCode(
      readTrustedI2pdManagedInstall({ ...INPUT, basePath }),
      'record-invalid',
    )
    assert.equal((await installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async () => { throw new Error('already-current must not fetch') },
    }))).kind, 'already-current')
    await noTemporaryEntries(basePath)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('reuse')
  try {
    const first = await installPinnedI2pd({ ...INPUT, basePath }, dependencies())
    await rm(path.join(basePath, 'current.json'))
    const reused = await installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async () => { throw new Error('valid immutable generation must be reused') },
    }))
    assert.equal(reused.kind, 'reused-generation')
    assert.equal(reused.install.generationPath, first.install.generationPath)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('legacy-detection')
  try {
    const release = getTrustedI2pdRelease(I2PD_LEGACY_VERSION, INPUT.platform, INPUT.arch)
    assert(release)
    const paths = resolveI2pdManagedInstallPaths(basePath)
    await mkdir(paths.downloadsPath, { mode: 0o700, recursive: true })
    await mkdir(paths.runtimePath, { mode: 0o700 })
    await mkdir(paths.versionsPath, { mode: 0o700 })
    const legacyGenerationPath = path.join(paths.versionsPath, `${release.version}-${release.target}`)
    await mkdir(legacyGenerationPath, { mode: 0o700 })
    const legacyBinaryPath = path.join(legacyGenerationPath, release.binaryName)
    await writeFile(legacyBinaryPath, 'legacy binary fixture')
    await writeFile(paths.currentRecordPath, `${JSON.stringify({
      asset: release.assetName,
      binaryPath: legacyBinaryPath,
      installedAt: '2026-06-28T02:05:54.315Z',
      sha256: release.sha256,
      target: release.target,
      version: release.version,
    }, null, 2)}\n`, { mode: 0o660 })

    assert.equal((await readI2pdLegacyManagedInstall({ ...INPUT, basePath }))?.version, release.version)
    assert.equal(await readI2pdManagedInstall({ ...INPUT, basePath }), null)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('trusted-rollback')
  try {
    const oldRelease = getTrustedI2pdRelease(I2PD_LEGACY_VERSION, INPUT.platform, INPUT.arch)
    const newRelease = getTrustedI2pdRelease(I2PD_PINNED_VERSION, INPUT.platform, INPUT.arch)
    assert(oldRelease)
    assert(newRelease)
    await writeTrustedGeneration(basePath, oldRelease, 'old trusted binary')
    const oldInstall = await readI2pdManagedInstall({ ...INPUT, basePath })
    assert(oldInstall)
    assert.equal(
      (await readTrustedI2pdManagedInstall({ ...INPUT, basePath }))?.record.version,
      I2PD_LEGACY_VERSION,
    )
    await writeTrustedGeneration(basePath, newRelease, 'new trusted binary')
    assert.equal(
      (await readI2pdManagedInstall({ ...INPUT, basePath }))?.record.version,
      I2PD_PINNED_VERSION,
    )
    await activateTrustedI2pdGeneration(
      { ...INPUT, basePath },
      oldInstall,
      { randomToken: () => 'fedcba9876543210fedcba9876543210' },
    )
    const restored = await readI2pdManagedInstall({ ...INPUT, basePath })
    assert.equal(restored?.record.version, I2PD_LEGACY_VERSION)
    assert.equal(restored?.binaryPath, oldInstall.binaryPath)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('legacy-record')
  try {
    const paths = resolveI2pdManagedInstallPaths(basePath)
    await mkdir(paths.downloadsPath, { mode: 0o700, recursive: true })
    await mkdir(paths.runtimePath, { mode: 0o700 })
    await mkdir(paths.versionsPath, { mode: 0o700 })
    await writeFile(path.join(paths.runtimePath, 'router.keys'), 'preserved legacy identity')
    const legacyGenerationPath = path.join(
      paths.versionsPath,
      `${RELEASE.version}-${RELEASE.target}`,
    )
    await mkdir(legacyGenerationPath, { mode: 0o700 })
    const legacyBinaryPath = path.join(legacyGenerationPath, RELEASE.binaryName)
    await writeFile(legacyBinaryPath, 'legacy binary fixture')
    await writeFile(path.join(paths.downloadsPath, RELEASE.assetName), ARCHIVE, { mode: 0o660 })
    await writeFile(paths.currentRecordPath, `${JSON.stringify({
      asset: RELEASE.assetName,
      binaryPath: legacyBinaryPath,
      installedAt: '2026-08-21T12:34:56.000Z',
      sha256: RELEASE.sha256,
      target: RELEASE.target,
      version: RELEASE.version,
    }, null, 2)}\n`, { mode: 0o644 })

    const migrated = await installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async () => { throw new Error('verified legacy archive must be reused') },
    }))
    assert.equal(migrated.kind, 'migrated-legacy')
    assert.equal((await readI2pdManagedInstall({ ...INPUT, basePath }))?.record.revision, 1)
    assert.equal(await readFile(legacyBinaryPath, 'utf8'), 'legacy binary fixture')
    assert.equal(await readFile(path.join(paths.runtimePath, 'router.keys'), 'utf8'), 'preserved legacy identity')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('legacy-archive-fallback')
  try {
    const paths = resolveI2pdManagedInstallPaths(basePath)
    await mkdir(paths.downloadsPath, { mode: 0o700, recursive: true })
    await mkdir(paths.runtimePath, { mode: 0o700 })
    await mkdir(paths.versionsPath, { mode: 0o700 })
    const legacyGenerationPath = path.join(paths.versionsPath, `${RELEASE.version}-${RELEASE.target}`)
    await mkdir(legacyGenerationPath, { mode: 0o700 })
    const legacyBinaryPath = path.join(legacyGenerationPath, RELEASE.binaryName)
    await writeFile(legacyBinaryPath, 'legacy binary fixture')
    await writeFile(path.join(paths.downloadsPath, RELEASE.assetName), 'wrong archive')
    await writeFile(paths.currentRecordPath, `${JSON.stringify({
      asset: RELEASE.assetName,
      binaryPath: legacyBinaryPath,
      installedAt: '2026-08-21T12:34:56.000Z',
      sha256: RELEASE.sha256,
      target: RELEASE.target,
      version: RELEASE.version,
    }, null, 2)}\n`, { mode: 0o644 })

    let fetches = 0
    const migrated = await installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async () => { fetches += 1; return response() },
    }))
    assert.equal(migrated.kind, 'migrated-legacy')
    assert.equal(fetches, 1)
    assert.equal(await readFile(legacyBinaryPath, 'utf8'), 'legacy binary fixture')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('no-overwrite')
  try {
    const paths = resolveI2pdManagedInstallPaths(basePath)
    await mkdir(paths.downloadsPath, { mode: 0o700, recursive: true })
    await mkdir(paths.runtimePath, { mode: 0o700 })
    await mkdir(paths.versionsPath, { mode: 0o700 })
    const generationPath = path.join(
      paths.versionsPath,
      `${RELEASE.version}-${RELEASE.target}-${RELEASE.sha256}`,
    )
    await mkdir(generationPath, { mode: 0o700 })
    await writeFile(path.join(generationPath, 'foreign-marker'), 'preserve')
    await expectCode(installPinnedI2pd({ ...INPUT, basePath }, dependencies()), 'record-invalid')
    assert.equal(await readFile(path.join(generationPath, 'foreign-marker'), 'utf8'), 'preserve')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('records')
  try {
    const installed = await installPinnedI2pd({ ...INPUT, basePath }, dependencies())
    const recordPath = path.join(basePath, 'current.json')
    const original = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    await writeFile(recordPath, JSON.stringify({ ...original, extra: true }), { mode: 0o600 })
    await expectCode(readI2pdManagedInstall({ ...INPUT, basePath }), 'record-invalid')
    await writeFile(recordPath, JSON.stringify({ ...original, binaryRelativePath: '../../i2pd' }), { mode: 0o600 })
    await expectCode(readI2pdManagedInstall({ ...INPUT, basePath }), 'record-invalid')
    await writeFile(recordPath, JSON.stringify(original), { mode: 0o600 })
    await expectCode(readI2pdManagedInstall({ arch: 'x64', basePath, platform: 'darwin' }), 'record-invalid')
    if (process.platform !== 'win32') {
      await rm(recordPath)
      await symlink(path.join(installed.install.generationPath, '.qortium-home-i2pd-generation.json'), recordPath)
      await expectCode(readI2pdManagedInstall({ ...INPUT, basePath }), 'record-invalid')
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

for (const test of [
  {
    code: 'download-failed' as const,
    label: 'untrusted redirect',
    fetch: async () => new Response(null, { headers: { Location: 'https://evil.example/i2pd' }, status: 302 }),
  },
  {
    code: 'download-invalid' as const,
    label: 'declared size',
    fetch: async () => response(ARCHIVE, { headers: { 'Content-Length': String(ARCHIVE.byteLength + 1) } }),
  },
  {
    code: 'download-invalid' as const,
    label: 'short stream',
    fetch: async () => response(ARCHIVE.subarray(0, ARCHIVE.length - 1)),
  },
  {
    code: 'download-invalid' as const,
    label: 'oversized stream',
    fetch: async () => response(Buffer.concat([ARCHIVE, Buffer.from('x')]), { headers: {} }),
  },
  {
    code: 'download-invalid' as const,
    label: 'digest mismatch',
    fetch: async () => response(Buffer.alloc(ARCHIVE.length, 1)),
  },
]) {
  const { basePath, root } = await temporaryBase(test.label.replace(' ', '-'))
  try {
    await expectCode(installPinnedI2pd({ ...INPUT, basePath }, dependencies({ fetch: test.fetch })), test.code)
    await noTemporaryEntries(basePath)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('trusted-redirect')
  try {
    const requested: string[] = []
    const result = await installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async (input) => {
        requested.push(String(input))
        return requested.length === 1
          ? new Response(null, {
              headers: { Location: 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture?token=opaque' },
              status: 302,
            })
          : response()
      },
    }))
    assert.equal(result.kind, 'installed')
    assert.equal(requested.length, 2)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('timeout')
  try {
    await expectCode(installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
      timeoutMs: 5,
    })), 'download-failed')
    await noTemporaryEntries(basePath)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

for (const [label, extractor] of [
  ['missing-binary', async ({ destinationPath }: Parameters<I2pdArchiveExtractor>[0]) => {
    await writeFile(path.join(destinationPath, 'README'), 'no binary')
  }],
  ['duplicate-binary', async ({ destinationPath }: Parameters<I2pdArchiveExtractor>[0]) => {
    await mkdir(path.join(destinationPath, 'a'))
    await mkdir(path.join(destinationPath, 'b'))
    await writeFile(path.join(destinationPath, 'a', 'i2pd'), 'one')
    await writeFile(path.join(destinationPath, 'b', 'i2pd'), 'two')
  }],
] as const) {
  const { basePath, root } = await temporaryBase(label)
  try {
    await expectCode(installPinnedI2pd({ ...INPUT, basePath }, dependencies({ extractArchive: extractor })), 'archive-invalid')
    await noTemporaryEntries(basePath)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

if (process.platform !== 'win32') {
  const { basePath, root } = await temporaryBase('symlink-binary')
  try {
    await expectCode(installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      extractArchive: async ({ destinationPath }) => {
        await symlink('/bin/true', path.join(destinationPath, 'i2pd'))
      },
    })), 'archive-invalid')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('extract-fault')
  try {
    await mkdir(path.join(basePath, 'runtime'), { recursive: true })
    await writeFile(path.join(basePath, 'runtime', 'router.keys'), 'keep')
    await assert.rejects(installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      extractArchive: async ({ destinationPath }) => {
        await writeFile(path.join(destinationPath, 'partial'), 'partial')
        throw new Error('injected extraction fault')
      },
    })), /injected extraction fault/)
    await noTemporaryEntries(basePath)
    assert.equal(await readFile(path.join(basePath, 'runtime', 'router.keys'), 'utf8'), 'keep')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

{
  const { basePath, root } = await temporaryBase('activation-fault')
  try {
    await assert.rejects(installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      beforeActivate: () => { throw new Error('injected activation fault') },
    })), /injected activation fault/)
    assert.equal(await readI2pdManagedInstall({ ...INPUT, basePath }), null)
    await noTemporaryEntries(basePath)
    const recovered = await installPinnedI2pd({ ...INPUT, basePath }, dependencies({
      fetch: async () => { throw new Error('activation recovery must reuse the generation') },
    }))
    assert.equal(recovered.kind, 'reused-generation')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

if (process.platform !== 'win32') {
  const { basePath, root } = await temporaryBase('base-symlink')
  try {
    const real = path.join(root, 'real')
    await mkdir(real)
    await symlink(real, basePath, 'dir')
    await expectCode(installPinnedI2pd({ ...INPUT, basePath }, dependencies()), 'record-invalid')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

await expectCode(
  installPinnedI2pd({ arch: 'arm', basePath: path.join(os.tmpdir(), 'unsupported-i2pd'), platform: 'linux' }, dependencies()),
  'target-unsupported',
)

console.log('i2pd managed install checks passed.')
