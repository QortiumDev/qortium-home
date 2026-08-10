import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  defaultHomeV2Appearance,
  homeV2AccentOptions,
  homeV2LanguageOptions,
  migrateLegacyAppearance,
  resolveHomeV2SystemLanguage,
} from './appearance'
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
  buildAppResourceLocation,
  parseAppResourceLocation,
} from './resource-location'
import {
  createProductState,
  ProductModelError,
  reduceProductState,
  restoreProductState,
} from './product-model'
import {
  readHomeV2AppNavigationMessage,
  readHomeV2AppTitleMessage,
  sanitizeHomeV2AppTitle,
} from './app-frame-messages'
import { HomeV2FixturePreview } from './fixture/HomeV2FixturePreview'
import { HomeV2Prototype } from './shell/HomeV2Prototype'
import type { DualIdentityLookupResult } from './contracts'
import {
  createAndroidFixtureHost,
  createElectronFixtureHost,
  FixtureBoundaryError,
  MockHost,
  type FixturePlatform,
} from './test-kit/MockHost'
import {
  fixtureApp,
  fixtureIds,
  fixtureOperationContext,
  fixtureTabContext,
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
  platform: FixturePlatform = 'generic',
): boolean {
  assert.ok(error instanceof FixtureBoundaryError)
  assert.equal(error.code, 'FIXTURE_BOUNDARY')
  assert.equal(error.capability, capability)
  assert.equal(error.platform, platform)
  return true
}

async function testMockHostFailsClosed(): Promise<void> {
  const host = new MockHost(homeV2Fixture)
  assert.equal(await host.getSnapshot(), homeV2Fixture)
  assert.equal(Object.isFrozen(homeV2Fixture), true)
  assert.equal(Object.isFrozen(homeV2Fixture.appearance), true)
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

async function testPlatformFixtureHostsFailClosed(): Promise<void> {
  const context = fixtureOperationContext(fixtureIds.chatApp, 'qortium')
  for (const host of [
    createElectronFixtureHost(homeV2Fixture),
    createAndroidFixtureHost(homeV2Fixture),
  ]) {
    assert.equal(await host.getSnapshot(), homeV2Fixture)
    await assert.rejects(
      host.requestNetwork({ context, path: '/fixture', method: 'GET' }),
      (error) => assertFixtureBoundary(error, 'network', host.platform),
    )
    await assert.rejects(
      host.readFile({ context, purpose: 'fixture' }),
      (error) => assertFixtureBoundary(error, 'filesystem', host.platform),
    )
    await assert.rejects(
      host.unlockVault(context),
      (error) => assertFixtureBoundary(error, 'vault', host.platform),
    )
    await assert.rejects(
      host.signIntent({
        context,
        transactionType: 'FIXTURE',
        summary: 'Must never sign',
      }),
      (error) => assertFixtureBoundary(error, 'signing', host.platform),
    )
    await assert.rejects(
      host.manageNativeService({
        context,
        service: 'reticulum',
        command: 'start',
      }),
      (error) =>
        assertFixtureBoundary(error, 'managed-service', host.platform),
    )
  }
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

function testProductModelKeepsSourceQualifiedTabs(): void {
  const empty = createProductState()
  const chat = fixtureApp(fixtureIds.chatApp)
  const chatContext = fixtureTabContext(chat, fixtureIds.chatTab)
  const qortalApp = fixtureApp(fixtureIds.qortalCompatApp)
  const qortalContext = fixtureTabContext(
    qortalApp,
    fixtureIds.qortalCompatTab,
  )

  const withChat = reduceProductState(empty, {
    type: 'open-app',
    app: chat,
    context: chatContext,
    tabId: fixtureIds.chatTab,
  })
  const routedChat = reduceProductState(empty, {
    type: 'open-app',
    app: chat,
    context: {
      ...chatContext,
      resourceLocation: `${chatContext.resourceLocation}?group=42` as typeof chatContext.resourceLocation,
    },
    tabId: fixtureIds.chatTab,
  })
  const reopenedChat = reduceProductState(withChat, {
    type: 'open-app',
    app: chat,
    context: {
      ...chatContext,
      tabId: fixtureIds.tab,
    },
    tabId: fixtureIds.tab,
  })
  const withBothSources = reduceProductState(reopenedChat, {
    type: 'open-app',
    app: qortalApp,
    context: qortalContext,
    tabId: fixtureIds.qortalCompatTab,
  })

  assert.equal(empty.tabs.length, 0)
  assert.equal(withChat.tabs.length, 1)
  assert.equal(
    routedChat.tabs[0].context.resourceLocation,
    `${chatContext.resourceLocation}?group=42`,
  )
  assert.equal(reopenedChat.tabs.length, 1)
  assert.equal(reopenedChat.activeTabId, fixtureIds.chatTab)
  const titledChat = reduceProductState(withChat, {
    type: 'set-tab-title',
    tabId: fixtureIds.chatTab,
    title: 'Chat room 42',
  })
  assert.equal(titledChat.tabs[0].title, 'Chat room 42')
  assert.equal(titledChat.revision, withChat.revision + 1)
  assert.equal(
    reduceProductState(titledChat, {
      type: 'set-tab-title',
      tabId: fixtureIds.chatTab,
      title: 'Chat room 42',
    }),
    titledChat,
  )
  const resetChatTitle = reduceProductState(titledChat, {
    type: 'set-tab-title',
    tabId: fixtureIds.chatTab,
    title: null,
  })
  assert.equal(resetChatTitle.tabs[0].title, 'fixture-chat')
  assert.equal(withBothSources.tabs.length, 2)
  assert.deepEqual(
    withBothSources.tabs.map((tab) => tab.context.sourceNetwork),
    ['qortium', 'qortal'],
  )
  assert.equal(Object.isFrozen(withBothSources), true)
  assert.equal(Object.isFrozen(withBothSources.tabs), true)
  assert.equal(Object.isFrozen(withBothSources.tabs[0].context), true)
  const restored = restoreProductState(JSON.parse(JSON.stringify(withBothSources)))
  assert.equal(restored.tabs.length, 2)
  assert.equal(restored.activeTabId, fixtureIds.qortalCompatTab)
  assert.deepEqual(
    restored.tabs.map((tab) => tab.context.resourceLocation),
    withBothSources.tabs.map((tab) => tab.context.resourceLocation),
  )
  assert.deepEqual(restoreProductState({ tabs: [{ id: '../../unsafe' }] }), createProductState())

  const dashboard = reduceProductState(withBothSources, {
    type: 'navigate',
    destination: 'dashboard',
  })
  assert.equal(dashboard.tabs.length, 2)
  assert.equal(dashboard.activeTabId, null)
  assert.equal(dashboard.destination, 'dashboard')

  const afterClose = reduceProductState(
    reduceProductState(dashboard, {
      type: 'activate-tab',
      tabId: fixtureIds.chatTab,
    }),
    { type: 'close-tab', tabId: fixtureIds.chatTab },
  )
  assert.equal(afterClose.tabs.length, 1)
  assert.equal(afterClose.activeTabId, fixtureIds.qortalCompatTab)

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
        context: chatContext,
        tabId: fixtureIds.tab,
      }),
    (error) => {
      assert.ok(error instanceof ProductModelError)
      assert.equal(error.code, 'APP_CONTEXT_MISMATCH')
      return true
    },
  )
}

function testAndroidAppFrameMessagesStayBounded(): void {
  const token = 'fixture-bridge-token'
  const renderUrl = 'https://qdn-app.local/render/APP/Help/Help'

  assert.equal(
    sanitizeHomeV2AppTitle('  Help\n\u202eCenter  '),
    'Help Center',
  )
  const longTitle = sanitizeHomeV2AppTitle('A'.repeat(200))
  assert.equal(longTitle?.length, 160)
  assert.equal(longTitle?.endsWith('…'), true)
  assert.deepEqual(
    readHomeV2AppTitleMessage({
      type: 'qortium:qdn-title',
      bridgeToken: token,
      title: 'Help v2',
    }, token),
    { title: 'Help v2' },
  )
  assert.equal(
    readHomeV2AppTitleMessage({
      type: 'qortium:qdn-title',
      bridgeToken: 'wrong-token',
      title: 'Forged',
    }, token),
    null,
  )

  assert.deepEqual(
    readHomeV2AppNavigationMessage({
      type: 'qortium:qdn-navigation',
      bridgeToken: token,
      activeIndex: 1,
      entries: [
        { index: 0, url: '/render/APP/Help/Help#overview' },
        { index: 1, url: `${renderUrl}#details` },
      ],
    }, token, renderUrl),
    {
      activeIndex: 1,
      entries: [
        { index: 0, url: `${renderUrl}#overview` },
        { index: 1, url: `${renderUrl}#details` },
      ],
    },
  )
  assert.equal(
    readHomeV2AppNavigationMessage({
      type: 'qortium:qdn-navigation',
      bridgeToken: token,
      activeIndex: 0,
      entries: [{ index: 0, url: 'https://other.example/forged' }],
    }, token, renderUrl),
    null,
  )
  assert.equal(
    readHomeV2AppNavigationMessage({
      type: 'qortium:qdn-navigation',
      bridgeToken: token,
      activeIndex: 1,
      entries: [
        { index: 0, url: renderUrl },
        { index: 0, url: `${renderUrl}#duplicate` },
      ],
    }, token, renderUrl),
    null,
  )
}

function testAppResourceSchemesStaySourceQualified(): void {
  const qdn = buildAppResourceLocation('qortium', {
    service: 'APP',
    name: 'Chat',
    identifier: 'Chat',
  })
  const qortal = buildAppResourceLocation('qortal', {
    service: 'APP',
    name: 'Qortal App',
    identifier: null,
  })
  assert.equal(qdn, 'qdn://APP/Chat/Chat')
  assert.equal(qortal, 'qortal://APP/Qortal%20App/default')
  assert.deepEqual(parseAppResourceLocation(qdn), {
    identity: { service: 'APP', name: 'Chat', identifier: 'Chat' },
    identifierWasExplicit: true,
    location: qdn,
    routePath: '',
    search: '',
    hash: '',
    sourceNetwork: 'qortium',
  })
  assert.equal(parseAppResourceLocation(qortal).sourceNetwork, 'qortal')
  assert.deepEqual(
    parseAppResourceLocation(
      'qdn://APP/Help/Help/page%20two?view=docs#install-linux',
    ),
    {
      identity: { service: 'APP', name: 'Help', identifier: 'Help' },
      identifierWasExplicit: true,
      location: 'qdn://APP/Help/Help/page%20two?view=docs#install-linux',
      routePath: '/page%20two',
      search: '?view=docs',
      hash: '#install-linux',
      sourceNetwork: 'qortium',
    },
  )
  assert.deepEqual(parseAppResourceLocation('qortal://APP/Example'), {
    identity: { service: 'APP', name: 'Example', identifier: null },
    identifierWasExplicit: false,
    location: 'qortal://APP/Example/default',
    routePath: '',
    search: '',
    hash: '',
    sourceNetwork: 'qortal',
  })
  assert.throws(() => parseAppResourceLocation('qdn://'))
  assert.throws(() => parseAppResourceLocation('qdn://qortal/APP/Chat'))
  assert.throws(() => parseAppResourceLocation('https://example.invalid/app'))
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
          fixtureIds.chatTab,
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
  assert.match(desktop, /data-theme="light"/)
  assert.match(phone, /data-layout="phone"/)
  for (const html of [desktop, phone]) {
    assert.match(html, /class="home-v2-browser-chrome"/)
    assert.match(html, /home-v2-home-mark/)
    assert.match(html, /data-network-mark="qortal"/)
    assert.match(html, /data-network-mark="qortium"/)
    assert.match(html, /home-v2-status-dot/)
    assert.match(html, /aria-label="Browser tabs"/)
    assert.match(html, /value="home:\/\/dashboard"/)
    assert.match(html, /aria-label="Go to address"/)
    assert.ok(
      html.indexOf('home-v2-browser-chrome') < html.indexOf('home-v2-dashboard'),
      'browser chrome must wrap the Dashboard rather than live inside it',
    )
    assert.doesNotMatch(html, /home-v2-sidebar/)
    assert.doesNotMatch(html, />Home</)
    assert.match(html, />Qortal</)
    assert.match(html, />Qortium</)
    assert.match(html, />AliceQ</)
    assert.match(html, />Alice</)
    assert.match(html, />Pinned apps</)
    assert.match(html, />Account lookup</)
    assert.match(html, /aria-label="Account address or name"/)
    assert.match(html, />Chat</)
    assert.match(html, />Wallets</)
    assert.match(html, />Disabled</)
    assert.match(html, />Local</)
    assert.match(html, />Public</)
    assert.match(html, />Custom</)
    assert.match(html, /aria-label="Qortal connection mode"/)
    assert.match(html, /aria-label="Qortium connection mode"/)
    assert.doesNotMatch(html, /home-v2-node-modes/)
    assert.doesNotMatch(html, /Previewnet/)
    assert.match(html, /role="tablist"/)
    assert.match(html, /fixture:tab:chat/)
    assert.match(html, /fixture:tab:qortal-compat/)
    assert.doesNotMatch(html, /role="dialog"/)
  }
}

function testDualIdentityLookupContract(): void {
  const qortalAddress = 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH'
  const qortiumAddress = 'QwbXDZs6N7YmfTaHoHX2FCTiDtUjsLH22E'
  const lookup: DualIdentityLookupResult = {
    inputKind: 'name',
    message: 'This name belongs to different addresses. The results are not merged.',
    networks: {
      qortal: {
        address: qortalAddress,
        avatar: {
          identifier: 'qortal_avatar',
          name: 'SharedName',
          service: 'THUMBNAIL',
          source: 'legacy-name',
        },
        detail: '1 registered name',
        matchedQueryName: true,
        names: ['SharedName'],
        network: 'qortal',
        primaryName: 'SharedName',
        state: 'resolved',
      },
      qortium: {
        address: qortiumAddress,
        avatar: null,
        detail: '1 registered name',
        matchedQueryName: true,
        names: ['SharedName'],
        network: 'qortium',
        primaryName: 'SharedName',
        state: 'resolved',
      },
    },
    query: 'SharedName',
    sharedAddress: null,
    state: 'conflict',
  }
  for (const layout of ['desktop', 'phone'] as const) {
    const html = renderToStaticMarkup(
      <HomeV2Prototype
        snapshot={homeV2Fixture}
        productState={createProductState()}
        permissionState={createPermissionState()}
        layout={layout}
        identityLookup={lookup}
        identityLookupInput="SharedName"
        onIdentityLookupInput={() => undefined}
        onIdentityLookupSubmit={() => undefined}
      />,
    )
    assert.match(html, /data-lookup-state="conflict"/)
    assert.match(html, />Name conflict</)
    assert.match(html, /results are not merged/)
    assert.match(html, new RegExp(qortalAddress))
    assert.match(html, new RegExp(qortiumAddress))
    assert.match(html, /qortal_avatar/)
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function testProductMarkAssetsAndColorOwnership(): void {
  assert.equal(
    sha256('src/assets/icons/qortium-home-protoicon-thick-interior.png'),
    'e2ec41f775c54e11b9692e869eb8d4bb13f73655533daf5829440011c86e91ce',
  )
  assert.equal(
    sha256('src/v2/assets/marks/qortium-protoicon-black-transparent.webp'),
    'd2e6355b6418e557c608ac9ee8616c3d5aaf5f8b46cee0d09fcfcbbeb31c47ef',
  )
  assert.equal(
    sha256('src/v2/assets/marks/qortal-from-qortium-spokes-removed.svg'),
    '8d588988c17cf62e2cce6dee54428b90ffcca9ac2e5e7071b06e03f0f337fe21',
  )

  const css = readFileSync('src/v2/shell/home-v2-prototype.css', 'utf8')
  const qortalRule =
    /\.home-v2-network-mark\[data-network-mark='qortal'\]\s*\{([^}]*)\}/.exec(
      css,
    )
  const qortiumRule =
    /\.home-v2-network-mark\[data-network-mark='qortium'\]\s*\{([^}]*)\}/.exec(
      css,
    )
  assert.ok(qortalRule)
  assert.ok(qortiumRule)
  assert.match(qortalRule[1], /var\(--v2-qortal\)/)
  assert.match(qortiumRule[1], /var\(--v2-qortium\)/)
  assert.doesNotMatch(qortalRule[1], /accent/)
  assert.doesNotMatch(qortiumRule[1], /accent/)
  assert.match(css, /\.home-v2-status-dot/)
  assert.match(css, /data-theme='dark'[\s\S]*?\.home-v2-home-mark img/)
}

function testStartupStatesAndAppearance(): void {
  const productState = createProductState()
  const render = (
    account: typeof homeV2Fixture.account,
    appearance = homeV2Fixture.appearance,
  ) =>
    renderToStaticMarkup(
      <HomeV2Prototype
        snapshot={{ ...homeV2Fixture, account, appearance }}
        productState={productState}
        permissionState={createPermissionState()}
        layout="desktop"
      />,
    )

  const noAccount = render(
    {
      ...homeV2Fixture.account,
      state: 'none',
      selectedIdentityId: null,
      rememberUnlock: false,
      manuallyLocked: false,
    },
  )
  assert.match(noAccount, /data-account-state="none"/)
  assert.match(noAccount, /home-v2-account-panel/)
  assert.match(noAccount, />No account selected</)
  assert.match(noAccount, /aria-label="Selected account"/)
  assert.match(noAccount, />Create account…</)
  assert.match(noAccount, />Import account…</)
  assert.match(noAccount, />New Account</)
  assert.doesNotMatch(noAccount, />Switch account</)
  assert.doesNotMatch(noAccount, /Browse first|Your start page/)

  const locked = render(
    {
      ...homeV2Fixture.account,
      state: 'locked',
      manuallyLocked: true,
    },
    {
      ...homeV2Fixture.appearance,
      theme: 'dark',
      resolvedTheme: 'dark',
    },
  )
  assert.match(locked, /data-theme="dark"/)
  assert.match(locked, /data-account-state="locked"/)
  assert.match(locked, /home-v2-account-panel/)
  assert.match(locked, />Unlock account</)
  assert.doesNotMatch(locked, />Lock on exit</)
  assert.doesNotMatch(locked, />Remember unlock</)

  const unlocked = render(homeV2Fixture.account)
  assert.match(unlocked, /data-account-state="unlocked"/)
  assert.match(unlocked, />Lock account</)
  assert.doesNotMatch(unlocked, /Good to see you|Welcome back|Your browser/)

  const catalogue = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={homeV2ProductFixture}
      permissionState={createPermissionState()}
      layout="desktop"
      accountCatalogue={{
        activeAccountId: 'wallet:main',
        accounts: [
          {
            address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
            addressIndex: 0,
            id: 'wallet:main',
            isUnlocked: false,
            label: 'Main account',
            supportsDerivedAddresses: true,
            walletId: 'wallet:main',
          },
        ],
      }}
      selectedAccountId="wallet:main"
      onSelectAccount={() => undefined}
    />,
  )
  assert.match(catalogue, /value="account:wallet:main" selected=""/)
  assert.match(catalogue, /Main account · QH143K2q…/)
  assert.match(catalogue, /value="create" disabled=""/)
  assert.match(catalogue, /value="import" disabled=""/)

  const css = readFileSync('src/v2/shell/home-v2-prototype.css', 'utf8')
  assert.match(css, /--v2-bg: #edece8/)
  assert.match(css, /--v2-bg: #242423/)
  assert.match(css, /--v2-qortal: #356da5/)
  assert.match(css, /--v2-qortium: #2f7953/)
  assert.match(css, /--v2-status-online: #327653/)
  assert.equal([...css.matchAll(/--v2-qortal:/g)].length, 2)
  assert.equal([...css.matchAll(/--v2-qortium:/g)].length, 2)
  assert.match(css, /\.home-v2-node-card \{[\s\S]*?grid-template-rows:/)
  assert.match(css, /\.home-v2-account-panel \{[\s\S]*?grid-template-rows:/)
  assert.doesNotMatch(css, /--v2-bg: #e6dac8/)
  assert.doesNotMatch(css, /--v2-bg: #211e1c/)
  assert.doesNotMatch(css, /--v2-qortal: #73566d/)
  assert.doesNotMatch(css, /--v2-qortium: #805d49/)
  assert.doesNotMatch(css, /#225b44/i)
}

function testAppearanceSettingsAndLegacyMigration(): void {
  const settingsState = reduceProductState(createProductState(), {
    type: 'navigate',
    destination: 'settings',
  })
  const html = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={settingsState}
      permissionState={createPermissionState()}
      layout="desktop"
    />,
  )

  assert.match(html, /data-theme-preference="system"/)
  assert.match(html, /data-accent="clay"/)
  assert.match(html, /data-text-size="medium"/)
  assert.match(html, /data-language="system"/)
  assert.match(html, /data-resolved-language="en"/)
  assert.match(html, /lang="en" dir="ltr"/)
  assert.match(html, /--v2-app-zoom:1/)
  assert.match(html, />Appearance</)
  assert.match(html, />Theme</)
  assert.match(html, />Accent</)
  assert.match(html, />Text size</)
  assert.match(html, />Page zoom</)
  assert.match(html, />Language</)
  assert.match(html, /aria-label="Theme"/)
  assert.match(html, /aria-label="Accent"/)
  assert.match(html, />Clay<\/option>/)
  assert.match(html, />100%</)
  assert.match(html, />System language</)
  assert.match(html, />Account security</)
  assert.match(html, />Remember unlock</)
  assert.match(html, />Lock on exit</)
  assert.doesNotMatch(html, /home-v2-segmented/)
  assert.doesNotMatch(html, /home-v2-accent-options/)
  assert.doesNotMatch(html, />Fun</)
  assert.doesNotMatch(html, />Classic</)
  assert.doesNotMatch(html, />Modern</)

  const noAccountSettings = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={{
        ...homeV2Fixture,
        account: {
          ...homeV2Fixture.account,
          state: 'none',
          selectedIdentityId: null,
        },
      }}
      productState={settingsState}
      permissionState={createPermissionState()}
      layout="desktop"
    />,
  )
  assert.doesNotMatch(noAccountSettings, />Account security</)

  const rtlHtml = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={{
        ...homeV2Fixture,
        appearance: {
          ...homeV2Fixture.appearance,
          language: 'ar',
          resolvedLanguage: 'ar',
        },
      }}
      productState={settingsState}
      permissionState={createPermissionState()}
      layout="phone"
    />,
  )
  assert.match(rtlHtml, /lang="ar" dir="rtl"/)

  const migrated = migrateLegacyAppearance(
    {
      theme: 'dark',
      accent: 'green',
      textSize: 'huge',
      appZoom: 137.4,
      language: 'zh-TW',
      ui: 'fun',
    },
    'light',
    'en',
  )
  assert.deepEqual(migrated, {
    theme: 'dark',
    resolvedTheme: 'dark',
    accent: 'green',
    textSize: 'huge',
    appZoom: 137,
    language: 'zh-TW',
    resolvedLanguage: 'zh-TW',
  })
  assert.equal('ui' in migrated, false)
  assert.deepEqual(
    homeV2AccentOptions.slice(1).map((option) => option.value),
    [
      'green',
      'blue',
      'orange',
      'purple',
      'red',
      'teal',
      'cyan',
      'pink',
      'yellow',
    ],
  )
  assert.equal(homeV2LanguageOptions.length, 24)
  assert.equal(resolveHomeV2SystemLanguage('pt-BR'), 'pt')
  assert.equal(resolveHomeV2SystemLanguage('zh-Hant-TW'), 'zh-TW')
  assert.equal(resolveHomeV2SystemLanguage('unknown'), 'en')
  assert.deepEqual(migrateLegacyAppearance(null), defaultHomeV2Appearance)
  assert.equal(migrateLegacyAppearance({ appZoom: 400 }).appZoom, 200)
  assert.equal(migrateLegacyAppearance({ appZoom: 20 }).appZoom, 50)
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

function testInteractiveFixturePreviewContract(): void {
  const html = renderToStaticMarkup(<HomeV2FixturePreview />)
  assert.match(html, /Home 2.0 offline preview/)
  assert.match(html, /No live services/)
  assert.match(html, />desktop</)
  assert.match(html, />phone</)
  assert.match(html, />none</)
  assert.match(html, />locked</)
  assert.match(html, />unlocked</)
  assert.match(html, />electron</)
  assert.match(html, />android</)
  assert.match(html, />qdnRequest permission</)
  assert.match(html, />qortalRequest permission</)
  assert.match(html, />Lock fixture</)
  assert.match(html, /0 saved fixture grants/)
  assert.match(html, /value="home:\/\/dashboard"/)
  assert.doesNotMatch(html, /data-tab-id="fixture:tab:/)
}

function testFixtureElectronEntryIsIsolated(): void {
  const source = readFileSync('electron/v2-fixture-main.ts', 'utf8')
  const config = JSON.parse(
    readFileSync('electron-builder.v2-fixture.json', 'utf8'),
  ) as {
    appId: string
    directories: { output: string; buildResources: string }
    electronFuses: Readonly<Record<string, boolean>>
    files: readonly string[]
  }
  const stageScript = readFileSync('scripts/stage-home-v2-fixture.mjs', 'utf8')
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Readonly<Record<string, string>>
  }

  assert.equal(config.appId, 'org.qortium.home.v2preview')
  assert.equal(config.directories.output, '../dist-release-v2-fixture')
  assert.equal(config.directories.buildResources, '../build')
  assert.deepEqual(config.files, [
    'dist/**/*',
    'dist-electron/v2-fixture-main.js',
    'package.json',
    'LICENSE',
  ])
  assert.equal(config.electronFuses.runAsNode, false)
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true)
  assert.equal(config.electronFuses.grantFileProtocolExtraPrivileges, true)
  assert.match(
    packageJson.scripts['dist:linux:x64:v2-fixture'],
    /--projectDir \.v2-fixture-package --config electron-builder\.json/,
  )
  assert.match(packageJson.scripts['dist:linux:x64:v2-fixture'], /--publish never/)
  assert.match(stageScript, /main: 'dist-electron\/v2-fixture-main\.js'/)
  assert.match(stageScript, /type: 'module'/)
  assert.match(stageScript, /node_modules\/electron\/package\.json/)
  assert.doesNotMatch(stageScript, /dependencies:/)
  assert.match(source, /contextIsolation: true/)
  assert.match(source, /nodeIntegration: false/)
  assert.match(source, /sandbox: true/)
  assert.match(source, /enableNetworkEmulation\(\{ offline: true \}\)/)
  assert.match(source, /setDevicePermissionHandler\(\(\) => false\)/)
  assert.match(source, /disable-background-networking/)
  assert.match(source, /qortium-home-v2-fixture-preview/)
  assert.match(source, /devTools: false/)
  assert.match(source, /will-redirect/)
  assert.match(source, /callback\(false\)/)
  assert.match(source, /action: 'deny'/)
  assert.match(source, /http:\/\/\*\/\*/)
  assert.doesNotMatch(source, /preload:/)
  for (const productionModule of [
    './accounts',
    './app-updates',
    './core-manager',
    './i2pd-manager',
    './qdn',
  ]) {
    assert.doesNotMatch(source, new RegExp(productionModule.replace('.', '\\.')))
  }
}

function collectV2SourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const sourcePath = `${directory}/${entry.name}`
    if (entry.isDirectory()) return collectV2SourceFiles(sourcePath)
    if (!/\.(?:css|ts|tsx)$/.test(entry.name) || entry.name.endsWith('.test.tsx')) {
      return []
    }
    return [sourcePath]
  })
}

function testRendererSourceHasNoRuntimeEscapeHatches(): void {
  const sourceFiles = [
    ...collectV2SourceFiles('src/v2'),
    'v2-fixture.html',
    'vite.v2-fixture.config.ts',
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

function testFixtureHtmlHasVisibleBootFallback(): void {
  const html = readFileSync('v2-fixture.html', 'utf8')
  assert.match(html, /role="alert"/)
  assert.match(html, /could not start/)
  assert.match(html, /renderer loading failure/)
  assert.match(html, /src="\/src\/v2\/fixture-main\.tsx"/)
  assert.doesNotMatch(html, /src="\.\/assets\//)
}

function testLiveNodeEntryIsCapabilityScoped(): void {
  const preload = readFileSync('electron/home-v2-live-preload.cts', 'utf8')
  const bridge = readFileSync('electron/home-v2-node-bridge.ts', 'utf8')
  const bootstrap = readFileSync('electron/v2-live-main.ts', 'utf8')
  const main = readFileSync('electron/main.ts', 'utf8')
  const html = readFileSync('v2-live.html', 'utf8')
  const config = JSON.parse(
    readFileSync('electron-builder.v2-live.json', 'utf8'),
  ) as {
    appId: string
    directories: { output: string }
    extraMetadata: { main: string }
  }
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Readonly<Record<string, string>>
  }

  assert.equal(config.appId, 'org.qortium.home.v2live')
  assert.equal(config.directories.output, 'dist-release-v2-live')
  assert.equal(config.extraMetadata.main, 'dist-electron/v2-live-main.js')
  assert.match(packageJson.scripts['dist:linux:x64:v2-live'], /--publish never/)
  assert.match(preload, /exposeInMainWorld\('homeV2Nodes'/)
  assert.match(preload, /home-v2-nodes:getSnapshot/)
  assert.match(preload, /home-v2-nodes:setMode/)
  assert.match(preload, /home-v2-nodes:readIdentity/)
  assert.match(preload, /home-v2-nodes:readAvatar/)
  assert.match(preload, /home-v2-nodes:listAppResources/)
  assert.match(preload, /home-v2-accounts:list/)
  assert.doesNotMatch(preload, /qortiumHome|qdn:|core:|sign|wallet/i)
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('accounts:/)
  assert.equal((preload.match(/require\(/g) ?? []).length, 1)
  assert.doesNotMatch(bridge, /apiKey|privateKey|password|seedPhrase|sourceFilename/)
  assert.match(bridge, /authorizedSenderIds/)
  assert.match(bridge, /IDENTITY_RESPONSE_LIMIT/)
  assert.match(bridge, /GROUP_AVATAR_MAX_BYTES/)
  assert.match(bridge, /Unsupported identity read/)
  assert.match(bridge, /assertAuthorized\(event\.sender\)/)
  assert.match(bridge, /function endpointHost/)
  assert.match(bridge, /mode === 'public' && nodeApiUrl/)
  assert.match(bootstrap, /qortium-home-v2-live/)
  assert.match(main, /home-v2-live-preload\.cjs/)
  assert.match(main, /authorizeHomeV2NodeBridge/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /img-src 'self' data: blob:/)
  assert.match(html, /src="\/src\/home-v2-live\/main\.tsx"/)

  const liveSources = collectV2SourceFiles('src/home-v2-live')
  for (const path of liveSources) {
    const source = readFileSync(path, 'utf8')
    for (const forbidden of [
      'window.qortiumHome',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      '../platform',
      'privateKey',
      'seedPhrase',
    ]) {
      assert.equal(source.includes(forbidden), false, `${path} must not contain ${forbidden}`)
    }
  }
}

await testMockHostFailsClosed()
await testPlatformFixtureHostsFailClosed()
testWrongNetworkStopsBeforeAdapter()
testProductModelKeepsSourceQualifiedTabs()
testAndroidAppFrameMessagesStayBounded()
testAppResourceSchemesStaySourceQualified()
testBridgeProtocolsStaySeparate()
testPermissionBrokerScopesAndInvalidation()
testDesktopAndPhoneContracts()
testDualIdentityLookupContract()
testProductMarkAssetsAndColorOwnership()
testStartupStatesAndAppearance()
testAppearanceSettingsAndLegacyMigration()
testPermissionDialogsOnDesktopAndPhone()
testInteractiveFixturePreviewContract()
testFixtureElectronEntryIsIsolated()
testFixtureHtmlHasVisibleBootFallback()
testLiveNodeEntryIsCapabilityScoped()
testRendererSourceHasNoRuntimeEscapeHatches()

console.log('home v2 foundation contract tests passed')
