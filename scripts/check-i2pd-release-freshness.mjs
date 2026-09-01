import assert from 'node:assert/strict'
import {
  I2PD_ACKNOWLEDGED_UPSTREAM_VERSION,
  I2PD_PINNED_RELEASES,
  I2PD_PINNED_VERSION,
} from '../dist-electron/i2pd-release-policy.js'

const TARGETS = [
  'linux-aarch64',
  'linux-x86_64',
  'macos-arm64',
  'macos-x86_64',
  'windows-x86_64',
]
const QORTIUM_VERSION = /^(\d+)\.(\d+)\.(\d+)-q([1-9]\d*)$/
const UPSTREAM_VERSION = /^(\d+)\.(\d+)\.(\d+)$/

function tuple(value, pattern) {
  const match = pattern.exec(value)
  assert(match, `Invalid i2pd version: ${value}`)
  const parsed = match.slice(1).map(Number)
  assert(parsed.every(Number.isSafeInteger), `Unsafe i2pd version: ${value}`)
  return parsed
}

function compare(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function upstreamBase(version) {
  const match = QORTIUM_VERSION.exec(version)
  assert(match, `Invalid Qortium i2pd version: ${version}`)
  return match.slice(1, 4).join('.')
}

function verifyOfflinePolicy() {
  tuple(I2PD_ACKNOWLEDGED_UPSTREAM_VERSION, UPSTREAM_VERSION)
  tuple(I2PD_PINNED_VERSION, QORTIUM_VERSION)
  assert.equal(I2PD_PINNED_RELEASES.length, TARGETS.length)
  assert.deepEqual(
    [...I2PD_PINNED_RELEASES].map((release) => release.target).sort(),
    [...TARGETS].sort(),
  )
  assert(I2PD_PINNED_RELEASES.every((release) => release.version === I2PD_PINNED_VERSION))
  assert(
    compare(
      tuple(upstreamBase(I2PD_PINNED_VERSION), UPSTREAM_VERSION),
      tuple(I2PD_ACKNOWLEDGED_UPSTREAM_VERSION, UPSTREAM_VERSION),
    ) <= 0,
    'Home cannot offer an i2pd build newer than its acknowledged upstream source.',
  )
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'QortiumHome-i2pd-freshness',
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: githubHeaders() })
  assert(response.ok, `GitHub request failed (${response.status}): ${url}`)
  return await response.json()
}

async function fetchText(url) {
  const response = await fetch(url, { headers: githubHeaders() })
  assert(response.ok, `Release asset request failed (${response.status}): ${url}`)
  const text = await response.text()
  assert(text.length <= 128 * 1024, 'The i2pd checksum manifest was unexpectedly large.')
  return text
}

function checksumMap(text) {
  const result = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = /^([a-f0-9]{64})\s+\*?([^/\\\s]+)$/.exec(line.trim())
    assert(match, `Invalid SHA256SUMS line: ${line}`)
    assert(!result.has(match[2]), `Duplicate SHA256SUMS entry: ${match[2]}`)
    result.set(match[2], match[1])
  }
  return result
}

async function verifyOnlineFreshness() {
  const [upstream, qortium] = await Promise.all([
    fetchJson('https://api.github.com/repos/PurpleI2P/i2pd/releases/latest'),
    fetchJson('https://api.github.com/repos/QortiumDev/qortium-i2pd/releases/latest'),
  ])
  assert.equal(typeof upstream.tag_name, 'string')
  assert.equal(typeof qortium.tag_name, 'string')
  const upstreamLatest = upstream.tag_name.replace(/^v/, '')
  const qortiumLatest = qortium.tag_name.replace(/^v/, '')
  tuple(upstreamLatest, UPSTREAM_VERSION)
  tuple(qortiumLatest, QORTIUM_VERSION)

  assert.equal(
    upstreamLatest,
    I2PD_ACKNOWLEDGED_UPSTREAM_VERSION,
    `Upstream i2pd ${upstreamLatest} is not acknowledged by Home; review it and update the policy explicitly.`,
  )
  assert.equal(
    qortiumLatest,
    I2PD_PINNED_VERSION,
    `Qortium i2pd ${qortiumLatest} and Home's offered ${I2PD_PINNED_VERSION} differ.`,
  )

  const assets = new Map(qortium.assets.map((asset) => [asset.name, asset]))
  const manifestAsset = assets.get('SHA256SUMS')
  assert(manifestAsset && typeof manifestAsset.browser_download_url === 'string',
    'The latest Qortium i2pd release has no SHA256SUMS asset.')
  const sums = checksumMap(await fetchText(manifestAsset.browser_download_url))

  for (const release of I2PD_PINNED_RELEASES) {
    const asset = assets.get(release.assetName)
    assert(asset, `Release asset missing: ${release.assetName}`)
    assert.equal(asset.size, release.size, `Release asset size changed: ${release.assetName}`)
    assert.equal(sums.get(release.assetName), release.sha256,
      `Release asset checksum changed: ${release.assetName}`)
    assert.equal(asset.browser_download_url, release.downloadUrl,
      `Release asset URL changed: ${release.assetName}`)
  }

  const acknowledged = tuple(I2PD_ACKNOWLEDGED_UPSTREAM_VERSION, UPSTREAM_VERSION)
  const packaged = tuple(upstreamBase(I2PD_PINNED_VERSION), UPSTREAM_VERSION)
  if (compare(acknowledged, packaged) > 0) {
    console.log(
      `i2pd freshness check passed with an explicit deferral: upstream ${upstreamLatest}, ` +
      `Qortium/Home ${I2PD_PINNED_VERSION}.`,
    )
    return
  }
  console.log(`i2pd freshness check passed: upstream ${upstreamLatest}, Home ${I2PD_PINNED_VERSION}.`)
}

verifyOfflinePolicy()
if (process.argv.includes('--online')) {
  await verifyOnlineFreshness()
} else {
  console.log('Offline i2pd release policy consistency check passed.')
}
