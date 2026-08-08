import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createPermissionState,
  hasPermissionGrant,
  invalidatePermissionState,
  PermissionModelError,
  queuePermissionPrompt,
  resolvePermissionPrompt,
} from './bridge-permissions'
import {
  BridgeContractError,
  prepareMockQdnPermission,
  prepareMockQortalPermission,
} from './mock-bridge-adapters'
import { executeWithNetworkPolicy, HomeV2PolicyError } from './policy'
import {
  createProductState,
  ProductModelError,
  reduceProductState,
} from './product-model'
import { HomeV2Prototype } from './shell/HomeV2Prototype'
import { FixtureBoundaryError, MockHost } from './test-kit/MockHost'
import {
  fixtureApp,
  fixtureIds,
  fixtureOperationContext,
  homeV2Fixture,
  homeV2ProductFixture,
  mockQdnPublishRequest,
  mockQortalAccountRequest,
  qdnPermissionPromptFixture,
  qdnPermissionStateFixture,
  qortalPermissionPromptFixture,
  qortalPermissionStateFixture,
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

function testProductModelKeepsNetworkQualifiedTabs(): void {
  const empty = createProductState()
  const chat = fixtureApp(fixtureIds.chatApp)
  const qortalContext = fixtureOperationContext(
    chat.id,
    'qortal',
    fixtureIds.qortalChatTab,
  )
  const qortiumContext = fixtureOperationContext(
    chat.id,
    'qortium',
    fixtureIds.qortiumChatTab,
  )

  const withQortal = reduceProductState(empty, {
    type: 'open-app',
    app: chat,
    context: qortalContext,
    tabId: fixtureIds.qortalChatTab,
  })
  const withBoth = reduceProductState(withQortal, {
    type: 'open-app',
    app: chat,
    context: qortiumContext,
    tabId: fixtureIds.qortiumChatTab,
  })

  assert.equal(empty.tabs.length, 0)
  assert.equal(withQortal.tabs.length, 1)
  assert.equal(withBoth.tabs.length, 2)
  assert.deepEqual(
    withBoth.tabs.map((tab) => tab.context.targetNetwork),
    ['qortal', 'qortium'],
  )
  assert.equal(Object.isFrozen(withBoth), true)
  assert.equal(Object.isFrozen(withBoth.tabs), true)
  assert.equal(Object.isFrozen(withBoth.tabs[0].context), true)

  const reopenedQortal = reduceProductState(withBoth, {
    type: 'open-app',
    app: chat,
    context: qortalContext,
    tabId: fixtureIds.qortalChatTab,
  })
  assert.equal(reopenedQortal.tabs.length, 2)
  assert.equal(reopenedQortal.activeTabId, fixtureIds.qortalChatTab)

  const dashboard = reduceProductState(reopenedQortal, {
    type: 'navigate',
    destination: 'dashboard',
  })
  assert.equal(dashboard.tabs.length, 2)
  assert.equal(dashboard.activeTabId, null)
  assert.equal(dashboard.destination, 'dashboard')

  const afterClose = reduceProductState(
    reduceProductState(dashboard, {
      type: 'activate-tab',
      tabId: fixtureIds.qortalChatTab,
    }),
    { type: 'close-tab', tabId: fixtureIds.qortalChatTab },
  )
  assert.equal(afterClose.tabs.length, 1)
  assert.equal(afterClose.activeTabId, fixtureIds.qortiumChatTab)

  assert.throws(
    () =>
      reduceProductState(empty, {
        type: 'activate-tab',
        tabId: fixtureIds.tab,
      }),
    (error) => {
      assert.ok(error instanceof ProductModelError)
      assert.equal(error.code, 'TAB_NOT_FOUND')
      return true
    },
  )

  assert.throws(
    () =>
      reduceProductState(empty, {
        type: 'open-app',
        app: chat,
        context: qortalContext,
        tabId: fixtureIds.tab,
      }),
    (error) => {
      assert.ok(error instanceof ProductModelError)
      assert.equal(error.code, 'APP_CONTEXT_MISMATCH')
      return true
    },
  )
}

function testBridgeProtocolsStaySeparate(): void {
  assert.deepEqual(Object.keys(mockQdnPublishRequest), [
    'protocol',
    'action',
    'service',
    'name',
    'identifier',
    'data64',
  ])
  assert.deepEqual(Object.keys(mockQortalAccountRequest), [
    'protocol',
    'action',
  ])
  assert.equal(qdnPermissionPromptFixture.protocol, 'qdnRequest')
  assert.equal(qdnPermissionPromptFixture.action, 'PUBLISH_QDN_RESOURCE')
  assert.equal(qdnPermissionPromptFixture.capability, 'qdn.publish')
  assert.equal(qdnPermissionPromptFixture.context.targetNetwork, 'qortium')
  assert.deepEqual(qdnPermissionPromptFixture.allowedScopes, ['single-request'])

  assert.equal(qortalPermissionPromptFixture.protocol, 'qortalRequest')
  assert.equal(qortalPermissionPromptFixture.action, 'GET_USER_ACCOUNT')
  assert.equal(qortalPermissionPromptFixture.capability, 'qortal.account.read')
  assert.equal(qortalPermissionPromptFixture.context.targetNetwork, 'qortal')
  assert.deepEqual(qortalPermissionPromptFixture.allowedScopes, [
    'single-request',
    'session',
    'always',
  ])
  assert.match(qortalPermissionPromptFixture.summary, /address and public key/)
  assert.equal(
    qortalPermissionPromptFixture.details.some(
      (detail) => detail.label === 'Extra permissions' && detail.value === 'None',
    ),
    true,
  )

  assert.throws(
    () =>
      prepareMockQdnPermission(
        fixtureIds.qdnPermissionRequest,
        mockQdnPublishRequest,
        fixtureApp(fixtureIds.chatApp),
        fixtureOperationContext(
          fixtureIds.chatApp,
          'qortal',
          fixtureIds.qortalChatTab,
        ),
      ),
    (error) => {
      assert.ok(error instanceof BridgeContractError)
      assert.equal(error.code, 'PROTOCOL_CONTEXT_MISMATCH')
      return true
    },
  )
}

function testPermissionBrokerScopesAndInvalidation(): void {
  const qdnOnce = resolvePermissionPrompt(
    qdnPermissionStateFixture,
    qdnPermissionPromptFixture.id,
    { approved: true, scope: 'single-request' },
  )
  assert.equal(qdnOnce.resolution.approved, true)
  assert.equal(qdnOnce.state.grants.length, 0)
  assert.equal(qdnOnce.state.pending.length, 0)

  assert.throws(
    () =>
      resolvePermissionPrompt(
        qdnPermissionStateFixture,
        qdnPermissionPromptFixture.id,
        { approved: true, scope: 'session' },
      ),
    (error) => {
      assert.ok(error instanceof PermissionModelError)
      assert.equal(error.code, 'INVALID_PERMISSION_SCOPE')
      return true
    },
  )

  const qortalSession = resolvePermissionPrompt(
    qortalPermissionStateFixture,
    qortalPermissionPromptFixture.id,
    { approved: true, scope: 'session' },
  ).state
  assert.equal(qortalSession.grants.length, 1)
  assert.equal(
    hasPermissionGrant(qortalSession, qortalPermissionPromptFixture),
    true,
  )
  assert.equal(hasPermissionGrant(qortalSession, qdnPermissionPromptFixture), false)

  const sameAppNewTabPrompt = prepareMockQortalPermission(
    'fixture:permission:qortal-account:new-tab' as typeof qortalPermissionPromptFixture.id,
    mockQortalAccountRequest,
    fixtureApp(fixtureIds.qortalCompatApp),
    fixtureOperationContext(
      fixtureIds.qortalCompatApp,
      'qortal',
      fixtureIds.tab,
    ),
  )
  assert.equal(hasPermissionGrant(qortalSession, sameAppNewTabPrompt), false)

  const afterTabClose = invalidatePermissionState(qortalSession, {
    kind: 'tab-closed',
    tabId: fixtureIds.qortalCompatTab,
  })
  assert.equal(afterTabClose.grants.length, 0)

  const qortalAlways = resolvePermissionPrompt(
    qortalPermissionStateFixture,
    qortalPermissionPromptFixture.id,
    { approved: true, scope: 'always' },
  ).state
  assert.equal(
    invalidatePermissionState(qortalAlways, {
      kind: 'tab-closed',
      tabId: fixtureIds.qortalCompatTab,
    }).grants.length,
    1,
  )
  assert.equal(
    invalidatePermissionState(qortalAlways, {
      kind: 'navigation-changed',
      tabId: fixtureIds.qortalCompatTab,
    }).grants.length,
    1,
  )
  assert.equal(hasPermissionGrant(qortalAlways, sameAppNewTabPrompt), true)
  assert.equal(
    invalidatePermissionState(qortalAlways, { kind: 'locked' }).grants.length,
    0,
  )

  const denied = resolvePermissionPrompt(
    qortalPermissionStateFixture,
    qortalPermissionPromptFixture.id,
    { approved: false },
  )
  assert.equal(denied.resolution.approved, false)
  assert.equal(denied.resolution.scope, null)
  assert.equal(denied.state.grants.length, 0)

  assert.throws(
    () =>
      queuePermissionPrompt(
        qortalPermissionStateFixture,
        qortalPermissionPromptFixture,
      ),
    (error) => {
      assert.ok(error instanceof PermissionModelError)
      assert.equal(error.code, 'DUPLICATE_PERMISSION_REQUEST')
      return true
    },
  )

  assert.equal(Object.isFrozen(createPermissionState()), true)
}

function testDesktopAndPhoneContracts(): void {
  const desktop = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={homeV2ProductFixture}
      permissionState={createPermissionState()}
      layout="desktop"
    />,
  )
  const phone = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={homeV2ProductFixture}
      permissionState={createPermissionState()}
      layout="phone"
    />,
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
    assert.match(html, /role="tablist"/)
    assert.match(html, /fixture:tab:chat:qortal/)
    assert.match(html, /fixture:tab:chat:qortium/)
    assert.doesNotMatch(html, /role="dialog"/)
  }
}

function testPermissionDialogsOnDesktopAndPhone(): void {
  const render = (
    layout: 'desktop' | 'phone',
    permissionState:
      | typeof qdnPermissionStateFixture
      | typeof qortalPermissionStateFixture,
  ) =>
    renderToStaticMarkup(
      <HomeV2Prototype
        snapshot={homeV2Fixture}
        productState={homeV2ProductFixture}
        permissionState={permissionState}
        layout={layout}
      />,
    )

  for (const layout of ['desktop', 'phone'] as const) {
    const qdn = render(layout, qdnPermissionStateFixture)
    assert.match(qdn, /role="dialog"/)
    assert.match(qdn, /data-bridge-protocol="qdnRequest"/)
    assert.match(qdn, /data-bridge-action="PUBLISH_QDN_RESOURCE"/)
    assert.match(qdn, />Allow once</)
    assert.doesNotMatch(qdn, />Allow for this tab</)
    assert.doesNotMatch(qdn, />Always allow for this app</)

    const qortal = render(layout, qortalPermissionStateFixture)
    assert.match(qortal, /role="dialog"/)
    assert.match(qortal, /data-bridge-protocol="qortalRequest"/)
    assert.match(qortal, /data-bridge-action="GET_USER_ACCOUNT"/)
    assert.match(qortal, /Qortal address and public key/)
    assert.match(qortal, />Allow once</)
    assert.match(qortal, />Allow for this tab</)
    assert.match(qortal, />Always allow for this app</)
  }
}

function testRendererSourceHasNoRuntimeEscapeHatches(): void {
  const sourceFiles = [
    ...readdirSync('src/v2/shell')
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `src/v2/shell/${name}`),
    'src/v2/product-model.ts',
    'src/v2/bridge-permissions.ts',
    'src/v2/mock-bridge-adapters.ts',
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
testProductModelKeepsNetworkQualifiedTabs()
testBridgeProtocolsStaySeparate()
testPermissionBrokerScopesAndInvalidation()
testDesktopAndPhoneContracts()
testPermissionDialogsOnDesktopAndPhone()
testRendererSourceHasNoRuntimeEscapeHatches()

console.log('home v2 foundation contract tests passed')
