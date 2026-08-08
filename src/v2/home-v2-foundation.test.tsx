import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { executeWithNetworkPolicy, HomeV2PolicyError } from './policy'
import { HomeV2Prototype } from './shell/HomeV2Prototype'
import { FixtureBoundaryError, MockHost } from './test-kit/MockHost'
import {
  fixtureApp,
  fixtureIds,
  fixtureOperationContext,
  homeV2Fixture,
} from './test-kit/fixtures'

function assertFixtureBoundary(
  error: unknown,
  capability: FixtureBoundaryError['capability'],
): boolean {
  assert.ok(error instanceof FixtureBoundaryError)
  assert.equal(error.code, 'FIXTURE_BOUNDARY')
  assert.equal(error.capability, capability)
  return true
}

async function testMockHostFailsClosed(): Promise<void> {
  const host = new MockHost(homeV2Fixture)
  assert.equal(await host.getSnapshot(), homeV2Fixture)
  assert.equal(Object.isFrozen(homeV2Fixture), true)
  assert.equal(Object.isFrozen(homeV2Fixture.identity.presences), true)
  assert.equal(Object.isFrozen(homeV2Fixture.apps), true)

  const context = fixtureOperationContext(fixtureIds.chatApp, 'qortium')
  await assert.rejects(
    host.requestNetwork({ context, path: '/fixture', method: 'GET' }),
    (error) => assertFixtureBoundary(error, 'network'),
  )
  await assert.rejects(
    host.readFile({ context, purpose: 'fixture' }),
    (error) => assertFixtureBoundary(error, 'filesystem'),
  )
  await assert.rejects(
    host.unlockVault(context),
    (error) => assertFixtureBoundary(error, 'vault'),
  )
  await assert.rejects(
    host.signIntent({
      context,
      transactionType: 'FIXTURE',
      summary: 'Must never sign',
    }),
    (error) => assertFixtureBoundary(error, 'signing'),
  )
  await assert.rejects(
    host.manageNativeService({
      context,
      service: 'reticulum',
      command: 'start',
    }),
    (error) => assertFixtureBoundary(error, 'managed-service'),
  )
}

function testWrongNetworkStopsBeforeAdapter(): void {
  const app = fixtureApp(fixtureIds.qortiumOnlyApp)
  const wrongNetworkContext = fixtureOperationContext(app.id, 'qortal')
  let adapterCalls = 0

  assert.throws(
    () =>
      executeWithNetworkPolicy(app, wrongNetworkContext, () => {
        adapterCalls += 1
      }),
    (error) => {
      assert.ok(error instanceof HomeV2PolicyError)
      assert.equal(error.code, 'NETWORK_CONTEXT_MISMATCH')
      assert.equal(error.targetNetwork, 'qortal')
      return true
    },
  )
  assert.equal(adapterCalls, 0)

  const validContext = fixtureOperationContext(app.id, 'qortium')
  const result = executeWithNetworkPolicy(app, validContext, () => {
    adapterCalls += 1
    return 'accepted'
  })
  assert.equal(result, 'accepted')
  assert.equal(adapterCalls, 1)
}

function testDesktopAndPhoneContracts(): void {
  const desktop = renderToStaticMarkup(
    <HomeV2Prototype snapshot={homeV2Fixture} layout="desktop" />,
  )
  const phone = renderToStaticMarkup(
    <HomeV2Prototype snapshot={homeV2Fixture} layout="phone" />,
  )

  assert.match(desktop, /data-layout="desktop"/)
  assert.match(phone, /data-layout="phone"/)
  for (const html of [desktop, phone]) {
    assert.match(html, /data-nav-label="Dashboard"/)
    assert.doesNotMatch(html, /data-nav-label="Home"/)
    assert.match(html, />Qortal</)
    assert.match(html, />Qortium</)
    assert.match(html, />AliceQ</)
    assert.match(html, />Alice</)
    assert.match(html, />Pinned apps</)
    assert.match(html, />Chat</)
    assert.match(html, />Wallets</)
    assert.match(html, />Reticulum</)
    assert.match(html, />Optional</)
  }
}

function testRendererSourceHasNoRuntimeEscapeHatches(): void {
  const sourceFiles = [
    'src/v2/shell/HomeV2Prototype.tsx',
    'src/v2/test-kit/fixtures.ts',
  ]
  const forbidden = [
    'window.qortiumHome',
    'fetch(',
    'XMLHttpRequest',
    'WebSocket',
    '../electron',
    'privateKey',
    'seedPhrase',
  ]

  for (const path of sourceFiles) {
    const source = readFileSync(path, 'utf8')
    for (const token of forbidden) {
      assert.equal(
        source.includes(token),
        false,
        `${path} must not contain ${token}`,
      )
    }
  }
}

await testMockHostFailsClosed()
testWrongNetworkStopsBeforeAdapter()
testDesktopAndPhoneContracts()
testRendererSourceHasNoRuntimeEscapeHatches()

console.log('home v2 foundation contract tests passed')
