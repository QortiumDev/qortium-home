import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  defaultHomeV2Appearance,
  homeV2AccentOptions,
  homeV2LanguageOptions,
  homeV2UiOptions,
  migrateLegacyAppearance,
  resolveHomeV2SystemLanguage,
  stepHomeV2TextSize,
} from './appearance'
import {
  createPermissionPrompt,
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
import { DEFAULT_NEW_TAB_PREFERENCE } from './new-tab-preference'
import {
  createProductState,
  ProductModelError,
  reduceProductState,
  restoreProductState,
  type ProductState,
} from './product-model'
import {
  readHomeV2AppNavigationMessage,
  readHomeV2AppTitleMessage,
  sanitizeHomeV2AppTitle,
} from './app-frame-messages'
import { HomeV2FixturePreview } from './fixture/HomeV2FixturePreview'
import { AppearanceSettingsPage } from './shell/AppearanceSettingsPage'
import { HomeV2Prototype } from './shell/HomeV2Prototype'
import {
  resolveHomeV2SettingsSectionTarget,
  SettingsPage,
} from './shell/SettingsPage'
import { PermissionDialog } from './shell/PermissionDialog'
import type { HomeV2CoreManagement } from './shell/CoreManagerCards'
import {
  createHomeV2ShellState,
  parseHomeV2ShellState,
  serializeHomeV2ShellState,
} from '../home-v2-live/shell-state'
import type { DualIdentityLookupResult, TabId } from './contracts'
import {
  parseHomeV2MenuCommand,
  parseHomeV2TextSizeCommand,
} from './menu-commands'
import { planStartPageLaunch } from '../home-v2-live/start-page-launch'
import { HOME_V2_NOTIFICATION_POLICY_SCHEMA } from '../home-v2-live/notification-policy-client'
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
  // Unsafe or unparseable tabs restore to the default single dashboard tab.
  // Compared structurally rather than by deepEqual: every internal tab now
  // carries its own generated id, so two independently created states are
  // never deeply equal even when they represent the same thing.
  const unsafeRestored = restoreProductState({ tabs: [{ id: '../../unsafe' }] })
  assert.equal(unsafeRestored.entries.length, 1)
  assert.equal(unsafeRestored.entries[0].kind, 'internal')
  assert.equal(unsafeRestored.destination, 'dashboard')
  assert.equal(unsafeRestored.tabs.length, 0)

  const dashboard = reduceProductState(withBothSources, {
    type: 'navigate',
    destination: 'dashboard',
  })
  assert.equal(dashboard.tabs.length, 2)
  assert.equal(
    dashboard.entries.find((entry) => entry.id === dashboard.activeTabId)?.kind,
    'internal',
    'an internal page is showing, so no app tab is active',
  )
  assert.equal(dashboard.destination, 'dashboard')

  const newTab = reduceProductState(withBothSources, {
    type: 'navigate',
    destination: 'newtab',
  })
  assert.equal(newTab.tabs.length, 2)
  assert.equal(
    newTab.entries.find((entry) => entry.id === newTab.activeTabId)?.kind,
    'internal',
    'an internal page is showing, so no app tab is active',
  )
  assert.equal(newTab.destination, 'newtab')
  const restoredNewTab = restoreProductState(
    JSON.parse(JSON.stringify(newTab)),
  )
  assert.equal(restoredNewTab.destination, 'newtab')
  assert.equal(
    restoredNewTab.entries.find((entry) => entry.id === restoredNewTab.activeTabId)?.kind,
    'internal',
    'an internal page is showing, so no app tab is active',
  )
  assert.equal(restoredNewTab.tabs.length, 2)

  // A persisted state can no longer force the shell onto a transient page:
  // destination is derived from the restored tabs, and `transient` always
  // starts clear, so release notes / docs / onboarding never come back on
  // their own however the saved payload was written.
  for (const transientDestination of ['releases', 'core-docs', 'welcome', 'future-page'] as const) {
    const restored = restoreProductState({
      ...JSON.parse(JSON.stringify(newTab)),
      destination: transientDestination,
    })
    assert.equal(restored.transient, null)
    assert.equal(restored.destination, 'newtab')
    assert.ok(
      restored.entries.every(
        (entry) => entry.kind === 'app' || entry.page !== ('welcome' as never),
      ),
      'transient pages must never restore as tabs',
    )
  }

  const restoredFutureDestination = restoreProductState({
    ...JSON.parse(JSON.stringify(newTab)),
    destination: 'future-page',
  })
  assert.equal(restoredFutureDestination.destination, 'newtab')
  assert.equal(
    restoredFutureDestination.entries.find((entry) => entry.id === restoredFutureDestination.activeTabId)?.kind,
    'internal',
    'an internal page is showing, so no app tab is active',
  )
  assert.equal(restoredFutureDestination.tabs.length, 2)

  const afterClose = reduceProductState(
    reduceProductState(dashboard, {
      type: 'activate-tab',
      tabId: fixtureIds.chatTab,
    }),
    { type: 'close-tab', tabId: fixtureIds.chatTab },
  )
  assert.equal(afterClose.tabs.length, 1)
  assert.equal(afterClose.activeTabId, fixtureIds.qortalCompatTab)

  // One mixed tab strip: internal pages and app tabs share a single ordered
  // list, a page may be open more than once, and transient pages never take a
  // tab (owner decision #17 plus the 2026-08-24 review).
  const kinds = (state: ProductState) =>
    state.entries.map((entry) => (entry.kind === 'internal' ? entry.page : 'app'))
  const pageId = (state: ProductState, page: string) =>
    state.entries.find((entry) => entry.kind === 'internal' && entry.page === page)!.id

  assert.deepEqual(kinds(dashboard), ['dashboard', 'app', 'app'])
  const settingsOpen = reduceProductState(dashboard, {
    type: 'navigate',
    destination: 'settings',
  })
  assert.deepEqual(kinds(settingsOpen), ['dashboard', 'app', 'app', 'settings'])
  assert.equal(settingsOpen.destination, 'settings')
  assert.equal(settingsOpen.activeTabId, pageId(settingsOpen, 'settings'))

  // navigate focuses an open page instead of stacking duplicates...
  const backToDashboard = reduceProductState(settingsOpen, {
    type: 'navigate',
    destination: 'dashboard',
  })
  assert.deepEqual(kinds(backToDashboard), ['dashboard', 'app', 'app', 'settings'])
  assert.equal(backToDashboard.destination, 'dashboard')

  // ...while open-internal always adds another instance (the "+" route).
  const twoSettings = reduceProductState(settingsOpen, {
    type: 'open-internal',
    page: 'settings',
    tabId: ('home-v2:tab:settings-2' as TabId),
  })
  assert.deepEqual(kinds(twoSettings), [
    'dashboard',
    'app',
    'app',
    'settings',
    'settings',
  ])
  assert.equal(twoSettings.activeTabId, 'home-v2:tab:settings-2')
  assert.equal(twoSettings.destination, 'settings')

  // Closing the active tab falls to its neighbour, whatever kind that is.
  const afterSettingsClose = reduceProductState(twoSettings, {
    type: 'close-tab',
    tabId: ('home-v2:tab:settings-2' as TabId),
  })
  assert.deepEqual(kinds(afterSettingsClose), ['dashboard', 'app', 'app', 'settings'])
  assert.equal(afterSettingsClose.destination, 'settings')

  // The strip is never left empty.
  let emptied = createProductState()
  emptied = reduceProductState(emptied, {
    type: 'close-tab',
    tabId: emptied.activeTabId,
  })
  assert.deepEqual(kinds(emptied), ['dashboard'])

  // Transient pages render full-window and take no tab.
  // Welcome is an ordinary closable tab (owner decision 2026-08-24), unlike
  // the release-notes and Core-docs pages which stay full-window.
  const welcome = reduceProductState(settingsOpen, {
    type: 'navigate',
    destination: 'welcome',
  })
  assert.equal(welcome.destination, 'welcome')
  assert.equal(welcome.transient, null)
  assert.deepEqual(kinds(welcome), [...kinds(settingsOpen), 'welcome'])
  assert.equal(welcome.activeTabId, pageId(welcome, 'welcome'))
  // ...but it must never come back on a later launch: onboarding state is
  // tracked separately and a restored welcome tab would render its error page.
  const restoredWithoutWelcome = restoreProductState(
    JSON.parse(JSON.stringify(welcome)),
  )
  assert.deepEqual(kinds(restoredWithoutWelcome), kinds(settingsOpen))

  const stillTransient = reduceProductState(settingsOpen, {
    type: 'navigate',
    destination: 'releases',
  })
  assert.equal(stillTransient.transient, 'releases')
  assert.deepEqual(kinds(stillTransient), kinds(settingsOpen))
  const leftWelcome = reduceProductState(stillTransient, {
    type: 'activate-tab',
    tabId: pageId(stillTransient, 'dashboard'),
  })
  assert.equal(leftWelcome.transient, null)
  assert.equal(leftWelcome.destination, 'dashboard')

  // Reordering crosses kinds: an app tab can move ahead of an internal page.
  const reordered = reduceProductState(settingsOpen, {
    type: 'reorder-tab',
    tabId: fixtureIds.chatTab,
    toIndex: 0,
  })
  assert.deepEqual(kinds(reordered), ['app', 'dashboard', 'app', 'settings'])
  assert.equal(
    reduceProductState(settingsOpen, {
      type: 'reorder-tab',
      tabId: fixtureIds.chatTab,
      toIndex: 1,
    }),
    settingsOpen,
    'reordering to the same index must not churn state',
  )
  const clampedReorder = reduceProductState(settingsOpen, {
    type: 'reorder-tab',
    tabId: pageId(settingsOpen, 'dashboard'),
    toIndex: 99,
  })
  assert.deepEqual(kinds(clampedReorder), ['app', 'app', 'settings', 'dashboard'])
  assert.throws(
    () =>
      reduceProductState(settingsOpen, {
        type: 'reorder-tab',
        tabId: ('home-v2:tab:missing' as TabId),
        toIndex: 0,
      }),
    (error) => {
      assert.ok(error instanceof ProductModelError)
      assert.equal(error.code, 'TAB_NOT_FOUND')
      return true
    },
  )

  // Restore round-trips the mixed order and drops nothing valid.
  const restoredEntries = restoreProductState(
    JSON.parse(JSON.stringify(settingsOpen)),
  )
  assert.deepEqual(kinds(restoredEntries), kinds(settingsOpen))
  assert.equal(restoredEntries.destination, 'settings')
  assert.equal(restoredEntries.transient, null)

  // Pre-unified saved states (separate internalPages + tabs) migrate.
  const legacyProduct = {
    activeTabId: fixtureIds.chatTab,
    destination: 'tab',
    internalPages: ['dashboard', 'settings', 'releases', 'future-page'],
    tabs: JSON.parse(JSON.stringify(settingsOpen.tabs)),
  }
  const migrated = restoreProductState(legacyProduct)
  assert.deepEqual(kinds(migrated), ['dashboard', 'settings', 'app', 'app'])
  assert.equal(migrated.activeTabId, fixtureIds.chatTab)
  assert.equal(migrated.destination, 'tab')
  const migratedWithoutPages = restoreProductState({
    activeTabId: null,
    tabs: JSON.parse(JSON.stringify(settingsOpen.tabs)),
  })
  assert.deepEqual(kinds(migratedWithoutPages), ['dashboard', 'app', 'app'])

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

  const unifiedQortalPrompt = createPermissionPrompt({
    ...qortalPermissionPromptFixture,
    capability: 'account.read',
    allowedScopes: ['single-request', 'session'],
  })
  const unifiedState = resolvePermissionPrompt(
    queuePermissionPrompt(createPermissionState(), unifiedQortalPrompt),
    unifiedQortalPrompt.id,
    { approved: true, scope: 'session' },
  ).state
  const unifiedQortiumPrompt = createPermissionPrompt({
    ...unifiedQortalPrompt,
    id: fixtureIds.qdnPermissionRequest,
    protocol: 'qdnRequest',
    action: 'GET_SELECTED_ACCOUNT',
    context: {
      ...unifiedQortalPrompt.context,
      nodeProfileRef: qdnPermissionPromptFixture.context.nodeProfileRef,
      targetNetwork: 'qortium',
    },
  })
  assert.equal(
    hasPermissionGrant(unifiedState, unifiedQortiumPrompt),
    true,
    'one account.read approval must cover both Home protocols and chains',
  )
  assert.equal(
    invalidatePermissionState(unifiedState, { kind: 'locked' }).grants.length,
    1,
    'locking must preserve read-only account consent',
  )
  assert.equal(
    invalidatePermissionState(unifiedState, {
      kind: 'node-changed',
      network: 'qortal',
    }).grants.length,
    1,
    'node changes must preserve read-only account consent',
  )
  assert.equal(
    invalidatePermissionState(unifiedState, {
      kind: 'navigation-changed',
      tabId: unifiedQortalPrompt.context.tabId,
    }).grants.length,
    1,
    'same-app navigation must preserve read-only account consent',
  )
  assert.equal(
    invalidatePermissionState(unifiedState, {
      kind: 'tab-closed',
      tabId: unifiedQortalPrompt.context.tabId,
    }).grants.length,
    0,
    'closing the tab must revoke read-only account consent',
  )

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
    invalidatePermissionState(qortalAlways, {
      kind: 'node-changed',
      network: 'qortium',
    }).grants.length,
    1,
  )
  assert.equal(
    invalidatePermissionState(qortalAlways, {
      kind: 'node-changed',
      network: 'qortal',
    }).grants.length,
    0,
  )
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
  const lookup = createDualIdentityLookup()
  const selectedAccountLookup: DualIdentityLookupResult = {
    ...lookup,
    networks: {
      qortium: {
        ...lookup.networks.qortium,
        primaryName: 'Zulu selected account',
      },
      qortal: {
        ...lookup.networks.qortal,
        primaryName: 'Yankee selected account',
      },
    },
  }
  const pinnedApps = {
    pins: [
      {
        createdAt: 1,
        displayUrl: 'qdn://APP/Chat/Chat',
        id: 'qdn://APP/Chat/Chat',
        label: 'Chat',
      },
      {
        createdAt: 2,
        displayUrl: 'qdn://APP/Wallets/Wallets',
        id: 'qdn://APP/Wallets/Wallets',
        label: 'Wallets',
      },
    ],
    status: 'ready' as const,
    onAdd: () => undefined,
    onMove: () => undefined,
    onReorder: () => undefined,
    onOpen: () => undefined,
    onRemove: () => undefined,
    onRename: () => undefined,
  }
  const desktop = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={homeV2ProductFixture}
      permissionState={createPermissionState()}
      layout="desktop"
      pinnedApps={pinnedApps}
      selectedAccountLookup={selectedAccountLookup}
    />,
  )
  const phone = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={homeV2ProductFixture}
      permissionState={createPermissionState()}
      layout="phone"
      pinnedApps={pinnedApps}
      selectedAccountLookup={selectedAccountLookup}
    />,
  )

  assert.match(desktop, /data-layout="desktop"/)
  assert.match(desktop, /data-theme="dark"/)
  assert.match(phone, /data-layout="phone"/)
  const assertNetworkOrder = (html: string, className: string): void => {
    const qortium = html.indexOf(
      `class="${className}" data-network="qortium"`,
    )
    const qortal = html.indexOf(`class="${className}" data-network="qortal"`)
    assert.notEqual(qortium, -1, `${className} must render Qortium`)
    assert.notEqual(qortal, -1, `${className} must render Qortal`)
    assert.ok(qortium < qortal, `${className} must render Qortium first`)
  }
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
    assert.doesNotMatch(html, /home-v2-window-brand/)
    assert.doesNotMatch(html, />Home</)
    assert.match(html, />Qortal</)
    assert.match(html, />Qortium</)
    assert.match(html, />AliceQ</)
    assert.match(html, />Alice</)
    assert.match(html, />Pinned apps</)
    assert.doesNotMatch(html, />Account lookup</)
    assert.doesNotMatch(html, /aria-label="Account address or name"/)
    assert.match(
      html,
      /data-network="qortium"[\s\S]*?home-v2-presence__avatar" data-loading="false" aria-hidden="true">Z<\/div>/,
    )
    assert.match(
      html,
      /data-network="qortal"[\s\S]*?home-v2-presence__avatar" data-loading="false" aria-hidden="true">Y<\/div>/,
    )
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
    // Network buttons are the chain mark alone: no visible label, but the name
    // and status must survive as the accessible name (owner request).
    assert.match(html, /class="home-v2-node-pill"[^>]*aria-label="Qortium: /)
    // They open a menu in place rather than navigating to the Dashboard, so
    // reading a status no longer costs the page you were on (owner request).
    // Attribute order follows the JSX spread, so match the whole opening tag
    // rather than assuming class comes first.
    const openingTag = (markup: string, className: string) =>
      new RegExp(`<button[^>]*class="${className}"[^>]*>`).exec(markup)?.[0] ?? ''
    const nodePillTag = openingTag(html, 'home-v2-node-pill')
    const accountTag = openingTag(html, 'home-v2-account-button')
    assert.match(nodePillTag, /aria-haspopup="menu"/)
    assert.match(nodePillTag, /aria-expanded="false"/)
    assert.match(accountTag, /aria-haspopup="menu"/)
    // The account button is avatars plus a lock glyph and nothing else (owner
    // request), so the label it used to print has to survive as the accessible
    // name and the tooltip.
    assert.match(accountTag, /aria-label="Alice · Unlocked"/)
    assert.match(accountTag, /title="Alice · Unlocked"/)
    const accountButtonBody = (() => {
      const start = html.indexOf(accountTag)
      return html.slice(start + accountTag.length, html.indexOf('</button>', start))
    })()
    // Nothing inside is readable copy: the avatar stack and the lock glyph are
    // aria-hidden decoration.
    assert.doesNotMatch(accountButtonBody, /Alice/)
    assert.doesNotMatch(accountButtonBody, /Locked|Unlocked/)
    assert.match(accountButtonBody, /home-v2-account-avatars/)
    // Unlocked fixture, so the open padlock: the glyph is the state signal.
    assert.match(accountButtonBody, /home-v2-account-lock/)
    assert.match(accountButtonBody, /lucide-lock-open/)
    // Closed by default: no panel is in the markup until the button is used.
    assert.doesNotMatch(html, /home-v2-chrome-menu__panel/)
    assert.doesNotMatch(html, /class="home-v2-node-pill"[^>]*>[^<]*Qortium</)
    // Tab badges use the compact, icon-only variant.
    assert.match(html, /home-v2-network--compact/)
    assertNetworkOrder(html, 'home-v2-node-pill')
    assertNetworkOrder(html, 'home-v2-node-card')
    assertNetworkOrder(html, 'home-v2-presence')
  }
}

function createDualIdentityLookup(): DualIdentityLookupResult {
  const qortalAddress = 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH'
  const qortiumAddress = 'QwbXDZs6N7YmfTaHoHX2FCTiDtUjsLH22E'
  return {
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
}

function testDualIdentityLookupContract(): void {
  const lookup = createDualIdentityLookup()
  const productState = reduceProductState(homeV2ProductFixture, {
    type: 'navigate',
    destination: 'newtab',
  })
  for (const layout of ['desktop', 'phone'] as const) {
    const html = renderToStaticMarkup(
      <HomeV2Prototype
        snapshot={homeV2Fixture}
        productState={productState}
        permissionState={createPermissionState()}
        layout={layout}
        identityLookup={lookup}
        identityLookupInput="SharedName"
        onIdentityLookupInput={() => undefined}
        onIdentityLookupSubmit={() => undefined}
      />,
    )
    assert.match(html, /value="home:\/\/newtab"/)
    assert.match(html, /aria-label="New tab"/)
    assert.match(html, />Registered accounts</)
    assert.match(html, /aria-label="Account address or name"/)
    assert.match(html, /data-lookup-state="conflict"/)
    assert.match(html, />Name conflict</)
    assert.match(html, /results are not merged/)
    assert.match(html, new RegExp(lookup.networks.qortal.address ?? ''))
    assert.match(html, new RegExp(lookup.networks.qortium.address ?? ''))
    assert.match(html, /qortal_avatar/)
    const qortium = html.search(
      /class="home-v2-identity-network"[^>]*data-network="qortium"/,
    )
    const qortal = html.search(
      /class="home-v2-identity-network"[^>]*data-network="qortal"/,
    )
    assert.notEqual(qortium, -1, 'new-tab lookup must identify Qortium results')
    assert.notEqual(qortal, -1, 'new-tab lookup must identify Qortal results')
    assert.ok(qortium < qortal, 'new-tab lookup must render Qortium first')
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
  assert.doesNotMatch(css, /home-v2-window-brand/)
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
      vaultState={{
        accounts: [{
          addresses: [{
            address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
            id: 'wallet:main',
            index: 0,
            label: 'Primary address',
          }],
          id: 'wallet:main',
          isUnlocked: false,
          label: 'Main account',
          security: { lockOnExit: true, manuallyLocked: false, rememberUnlock: false },
          supportsDerivedAddresses: true,
        }],
        readiness: 'ready',
        recoveryMessage: null,
        secureStorageAvailable: true,
        selectedAccountId: 'wallet:main',
        selectedAddressId: 'wallet:main',
        version: 2,
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
  assert.doesNotMatch(
    css,
    /\.home-v2-browser-controls button:nth-child\(-n \+ 2\)[\s\S]*?display:\s*none/,
  )
  assert.doesNotMatch(css, /--v2-bg: #e6dac8/)
  assert.doesNotMatch(css, /--v2-bg: #211e1c/)
  assert.doesNotMatch(css, /--v2-qortal: #73566d/)
  assert.doesNotMatch(css, /--v2-qortium: #805d49/)
  assert.doesNotMatch(css, /#225b44/i)
}

function testSettingsScaffoldAndNewTabPreference(): void {
  const settingsState = reduceProductState(createProductState(), {
    type: 'navigate',
    destination: 'settings',
  })

  for (const layout of ['desktop', 'phone'] as const) {
    const html = renderToStaticMarkup(
      <HomeV2Prototype
        snapshot={homeV2Fixture}
        productState={settingsState}
        permissionState={createPermissionState()}
        layout={layout}
        newTabPreference={DEFAULT_NEW_TAB_PREFERENCE}
        notificationPolicy={{
          enabled: true,
          generation: 0,
          schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
          status: 'available',
          version: 1,
        }}
        onSetAppNotifications={async () => undefined}
        onSetNewTabPreference={() => undefined}
      />,
    )
    assert.match(html, new RegExp(`data-layout="${layout}"`))
    assert.match(html, /aria-label="Settings sections"/)
    const general = html.indexOf('>General</button>')
    const appearance = html.indexOf('>Appearance</button>')
    const account = html.indexOf('>Account</button>')
    assert.notEqual(general, -1)
    assert.notEqual(appearance, -1)
    assert.notEqual(account, -1)
    assert.ok(general < appearance && appearance < account)
    assert.match(html, /aria-current="page">General<\/button>/)
    assert.match(html, /<h2 id="general-settings-title">General<\/h2>/)
    assert.match(html, />New tab</)
    assert.match(html, /aria-label="New tab opens"/)
    assert.match(html, /data-home-v2-notification-policy="available"/)
    assert.match(html, /aria-label="App notifications"/)
    assert.match(html, /role="switch"/)
    // Dashboard is the default new-tab target (owner decision 2026-08-24).
    assert.match(html, /value="dashboard" selected="">Dashboard<\/option>/)
    assert.match(html, />Search page<\/option>/)
    assert.match(html, />Custom address<\/option>/)
    assert.doesNotMatch(html, /aria-label="Theme"/)
    assert.doesNotMatch(html, /aria-label="Custom new-tab address"/)
  }

  const customHtml = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={settingsState}
      permissionState={createPermissionState()}
      layout="desktop"
      newTabPreference={{
        address: 'qdn://APP/NameOnly',
        kind: 'custom',
      }}
      onSetNewTabPreference={() => undefined}
    />,
  )
  assert.match(customHtml, /aria-label="Custom new-tab address"/)
  assert.ok(customHtml.includes('value="qdn://APP/NameOnly"'))
  assert.match(customHtml, />Save</)

  const noAccountHtml = renderToStaticMarkup(
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
      layout="phone"
    />,
  )
  assert.doesNotMatch(noAccountHtml, />Account<\/button>/)

  const browserChromeSource = readFileSync(
    'src/v2/shell/BrowserChrome.tsx',
    'utf8',
  )
  assert.match(browserChromeSource, /newTabPreference\.kind === 'dashboard'/)
  assert.match(browserChromeSource, /newTabPreference\.kind === 'custom'/)
  assert.match(browserChromeSource, /setAddress\(newTabPreference\.address\)/)
  assert.match(browserChromeSource, /newTabDisabled=\{navigationDisabled\}/)
}

function testCoreManagementRenderingAndAndroidDegrade(): void {
  const coreManagement: HomeV2CoreManagement = {
    available: true,
    busyActions: { qortal: null, qortium: null },
    lastActions: { qortal: null, qortium: null },
    statuses: {
      qortium: {
        capabilities: { canStart: false, canStop: true },
        control: 'full',
        install: 'home-managed',
        issue: null,
        network: 'qortium',
        revision: 1,
        runtime: 'running',
        schema: 'home-v2-core-manager',
      },
      qortal: {
        capabilities: { canStart: true, canStop: false },
        control: 'api-only',
        install: 'adopted',
        issue: null,
        network: 'qortal',
        revision: 1,
        runtime: 'stopped',
        schema: 'home-v2-core-manager',
      },
    },
    onAction: () => undefined,
    onRefresh: () => undefined,
  }
  const dashboard = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={createProductState()}
      permissionState={createPermissionState()}
      layout="desktop"
      coreManagement={coreManagement}
    />,
  )
  const managementStart = dashboard.indexOf('data-home-v2-core-management="desktop"')
  const qortium = dashboard.indexOf('data-network="qortium"', managementStart)
  const qortal = dashboard.indexOf('data-network="qortal"', managementStart)
  assert.ok(managementStart >= 0 && qortium > managementStart && qortal > qortium)
  assert.match(dashboard, /Qortium Core running · managed by Home/)
  assert.match(dashboard, />Stop Core</)
  assert.match(dashboard, /Adopted Qortal Core · stopped/)
  assert.match(dashboard, />Start Core</)
  assert.match(dashboard, /aria-label="Settings: Core management"/)

  const qortalDisabledSnapshot = {
    ...homeV2Fixture,
    nodes: {
      ...homeV2Fixture.nodes,
      qortal: {
        ...homeV2Fixture.nodes.qortal,
        mode: 'disabled' as const,
        state: 'offline' as const,
      },
    },
  }
  const qortalDisabledDashboard = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={qortalDisabledSnapshot}
      productState={createProductState()}
      permissionState={createPermissionState()}
      layout="desktop"
      coreManagement={coreManagement}
    />,
  )
  assert.match(
    qortalDisabledDashboard,
    /class="home-v2-node-card" data-network="qortium"/,
  )
  assert.doesNotMatch(
    qortalDisabledDashboard,
    /class="home-v2-(?:node-card|core-card|presence)" data-network="qortal"/,
  )
  // A disabled network's toolbar pill is hidden entirely, not shown greyed.
  assert.match(
    qortalDisabledDashboard,
    /class="home-v2-node-pill" data-network="qortium"/,
  )
  assert.doesNotMatch(
    qortalDisabledDashboard,
    /class="home-v2-node-pill" data-network="qortal"/,
  )

  const qortiumDisabledSnapshot = {
    ...homeV2Fixture,
    nodes: {
      ...homeV2Fixture.nodes,
      qortium: {
        ...homeV2Fixture.nodes.qortium,
        mode: 'disabled' as const,
        state: 'offline' as const,
      },
    },
  }
  const qortiumDisabledDashboard = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={qortiumDisabledSnapshot}
      productState={createProductState()}
      permissionState={createPermissionState()}
      layout="desktop"
      coreManagement={coreManagement}
      pinnedApps={{
        pins: [
          {
            createdAt: 1,
            customLabel: 'Hidden QDN Pin',
            displayUrl: 'qdn://APP/Hidden/Hidden',
            id: 'qdn://APP/Hidden/Hidden',
            label: 'Hidden',
          },
          {
            createdAt: 2,
            customLabel: 'Global Home Pin',
            displayUrl: 'home://bookmarks',
            id: 'home://bookmarks',
            label: 'Bookmarks',
          },
        ],
        status: 'ready',
        onAdd: () => undefined,
        onMove: () => undefined,
        onReorder: () => undefined,
        onOpen: () => undefined,
        onRemove: () => undefined,
        onRename: () => undefined,
      }}
    />,
  )
  assert.match(
    qortiumDisabledDashboard,
    /class="home-v2-node-card" data-network="qortal"/,
  )
  assert.doesNotMatch(
    qortiumDisabledDashboard,
    /class="home-v2-(?:node-card|core-card|presence)" data-network="qortium"/,
  )
  assert.match(qortiumDisabledDashboard, /Global Home Pin/)
  assert.doesNotMatch(qortiumDisabledDashboard, /Hidden QDN Pin/)

  const css = readFileSync('src/v2/shell/home-v2-prototype.css', 'utf8')
  for (const selector of [
    '.home-v2-node-grid',
    '.home-v2-core-grid',
    '.home-v2-presence-list',
  ]) {
    const rule = new RegExp(
      `${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`,
    ).exec(css)
    assert.ok(rule, `${selector} must define its own layout`)
    assert.match(
      rule[1],
      /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*360px\),\s*1fr\)\)/,
      `${selector} must expand a sole enabled network and share space when both are enabled`,
    )
    assert.doesNotMatch(
      rule[1],
      /repeat\(2,/,
      `${selector} must not reserve an empty network column`,
    )
  }

  const settingsState = reduceProductState(createProductState(), {
    type: 'navigate',
    destination: 'settings',
  })
  const settings = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={settingsState}
      permissionState={createPermissionState()}
      layout="desktop"
      coreManagement={coreManagement}
    />,
  )
  const general = settings.indexOf('>General</button>')
  const runtime = settings.indexOf('>Runtime</button>')
  const appearance = settings.indexOf('>Appearance</button>')
  assert.ok(general >= 0 && runtime > general && appearance > runtime)

  const targetedSettings = renderToStaticMarkup(
    <SettingsPage
      account={homeV2Fixture.account}
      appearance={homeV2Fixture.appearance}
      nodes={homeV2Fixture.nodes}
      newTabPreference={DEFAULT_NEW_TAB_PREFERENCE}
      requestedSection="appearance"
    />,
  )
  assert.match(targetedSettings, /aria-current="page">Appearance<\/button>/)
  assert.match(targetedSettings, /aria-label="Theme"/)
  assert.equal(resolveHomeV2SettingsSectionTarget('core'), 'core')
  assert.equal(
    resolveHomeV2SettingsSectionTarget('notifications'),
    'qdn-apps',
  )
  assert.equal(stepHomeV2TextSize('medium', 'increase'), 'large')
  assert.equal(stepHomeV2TextSize('medium', 'decrease'), 'small')
  assert.equal(stepHomeV2TextSize('extra-small', 'decrease'), 'extra-small')
  assert.equal(stepHomeV2TextSize('huge', 'increase'), 'huge')
  assert.equal(
    parseHomeV2TextSizeCommand('text-size-increase'),
    'text-size-increase',
  )
  assert.equal(parseHomeV2TextSizeCommand('new-tab'), null)
  assert.equal(parseHomeV2MenuCommand('new-tab'), 'new-tab')
  assert.equal(parseHomeV2MenuCommand('reopen-closed-tab'), 'reopen-closed-tab')
  assert.equal(parseHomeV2MenuCommand('close-tab'), 'close-tab')
  assert.equal(parseHomeV2MenuCommand('go-back'), 'go-back')
  assert.equal(parseHomeV2MenuCommand('go-forward'), 'go-forward')
  assert.equal(parseHomeV2MenuCommand('reload-tab'), 'reload-tab')
  assert.equal(parseHomeV2MenuCommand('focus-address-bar'), 'focus-address-bar')
  assert.equal(parseHomeV2MenuCommand('text-size-reset'), 'text-size-reset')
  assert.equal(parseHomeV2MenuCommand('toggle-devtools'), null)
  assert.equal(parseHomeV2MenuCommand(7), null)

  // F3 start-page launch plan: restored tabs win, onboarding suppresses,
  // dead account bindings fall back to the current account.
  const startPages = [
    { accountId: 'wallet:Qa', displayUrl: 'qdn://APP/Chat/Chat' },
    { accountId: 'wallet:Qgone', displayUrl: 'qdn://APP/Trust/Trust' },
    { accountId: null, displayUrl: '  ' },
    { accountId: null, displayUrl: 'home://apps' },
  ]
  assert.deepEqual(
    planStartPageLaunch({
      appTabCount: 0,
      onboardingInProgress: false,
      startPages,
      knownAccountIds: ['wallet:Qa'],
    }),
    [
      { accountId: 'wallet:Qa', displayUrl: 'qdn://APP/Chat/Chat' },
      { accountId: null, displayUrl: 'qdn://APP/Trust/Trust' },
      { accountId: null, displayUrl: 'home://apps' },
    ],
  )
  assert.deepEqual(
    planStartPageLaunch({
      appTabCount: 2,
      onboardingInProgress: false,
      startPages,
      knownAccountIds: ['wallet:Qa'],
    }),
    [],
  )
  assert.deepEqual(
    planStartPageLaunch({
      appTabCount: 0,
      onboardingInProgress: true,
      startPages,
      knownAccountIds: ['wallet:Qa'],
    }),
    [],
  )

  const unavailableTarget = renderToStaticMarkup(
    <SettingsPage
      account={{ ...homeV2Fixture.account, state: 'none' }}
      appearance={homeV2Fixture.appearance}
      nodes={homeV2Fixture.nodes}
      newTabPreference={DEFAULT_NEW_TAB_PREFERENCE}
      requestedSection="notifications"
    />,
  )
  assert.match(unavailableTarget, /aria-current="page">General<\/button>/)
  assert.match(unavailableTarget, /<h2 id="general-settings-title">General<\/h2>/)

  const android = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={createProductState()}
      permissionState={createPermissionState()}
      layout="phone"
      coreManagement={{ ...coreManagement, available: false }}
    />,
  )
  assert.doesNotMatch(android, /data-home-v2-core-management/)
  assert.doesNotMatch(android, />Start Core|>Stop Core/)
  assert.doesNotMatch(android, /home-v2-qortal-maintenance|Qortal Core maintenance/)
}

function testAppearanceSettingsAndLegacyMigration(): void {
  const settingsState = reduceProductState(createProductState(), {
    type: 'navigate',
    destination: 'settings',
  })
  const shellHtml = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={settingsState}
      permissionState={createPermissionState()}
      layout="desktop"
    />,
  )
  const html = renderToStaticMarkup(
    <AppearanceSettingsPage
      appearance={homeV2Fixture.appearance}
      account={homeV2Fixture.account}
    />,
  )

  assert.match(shellHtml, /data-theme-preference="dark"/)
  assert.match(shellHtml, /data-accent="clay"/)
  assert.match(shellHtml, /data-text-size="medium"/)
  assert.match(shellHtml, /data-language="system"/)
  assert.match(shellHtml, /data-resolved-language="en"/)
  assert.match(shellHtml, /lang="en" dir="ltr"/)
  assert.match(shellHtml, /--v2-app-zoom:1/)
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
  // The interface-style control is back by owner decision: Home 2 had removed
  // it and forced every app to Modern. It offers the same three values as
  // Home 1.x and defaults to Classic.
  assert.match(html, /aria-label="UI Style"/)
  assert.match(html, /<option value="classic" selected="">Classic<\/option>/)
  assert.match(html, />Modern<\/option>/)
  assert.match(html, />Fun<\/option>/)

  const noAccountSettings = renderToStaticMarkup(
    <AppearanceSettingsPage
      appearance={homeV2Fixture.appearance}
      account={{
        ...homeV2Fixture.account,
        state: 'none',
        selectedIdentityId: null,
      }}
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
    // Carried over rather than discarded: Home 2 used to drop the interface
    // style on migration, which silently moved every 1.x user to Modern.
    ui: 'fun',
  })
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
  assert.deepEqual(
    migrateLegacyAppearance({ theme: 'system' }, 'light'),
    {
      ...defaultHomeV2Appearance,
      theme: 'system',
      resolvedTheme: 'light',
    },
  )
  assert.equal(migrateLegacyAppearance({ appZoom: 400 }).appZoom, 200)
  assert.equal(migrateLegacyAppearance({ appZoom: 20 }).appZoom, 50)

  // Interface style: Home 2 shipped every app forced to 'modern' and dropped
  // the user's choice on migration. The default is Classic, matching
  // DEFAULT_UI, and a legacy choice must survive.
  assert.equal(defaultHomeV2Appearance.ui, 'classic')
  assert.equal(migrateLegacyAppearance(null).ui, 'classic')
  assert.equal(migrateLegacyAppearance({ ui: 'modern' }).ui, 'modern')
  assert.equal(migrateLegacyAppearance({ ui: 'nonsense' }).ui, 'classic')
  assert.deepEqual(
    homeV2UiOptions.map((option) => option.value),
    ['classic', 'modern', 'fun'],
  )
  // The choice is worthless if it is not persisted across restarts.
  assert.equal(
    serializeHomeV2ShellState({
      ...createHomeV2ShellState('dark', 'en'),
      appearance: { ...defaultHomeV2Appearance, ui: 'fun' },
    }).appearance.ui,
    'fun',
  )
  // Every surface that tells an app which design system to use must read the
  // setting; a literal 'modern' here is the regression this restored.
  for (const file of [
    'src/v2/shell/AppTabStage.tsx',
    'src/v2/shell/HomeV2ResourceViewer.tsx',
    'src/v2/shell/HomeV2CoreApiDocsPage.tsx',
    'src/home-v2-live/HomeV2LiveApp.tsx',
  ]) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      source,
      /ui:\s*'modern'|'uiStyle',\s*'modern'/,
      `${file} hardcodes the modern UI style instead of reading appearance.ui`,
    )
  }

  const css = readFileSync('src/v2/shell/home-v2-prototype.css', 'utf8')
  assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*height:\s*100%;[^}]*margin:\s*0;/)
  const desktopViewportRule = /\.home-v2-page-viewport\s*\{([^}]*)\}/.exec(css)
  assert.ok(desktopViewportRule)
  assert.match(desktopViewportRule[1], /width:\s*calc\(100% - 36px\)/)
  assert.doesNotMatch(desktopViewportRule[1], /1180px|max-width/)
}

function testPermissionDialogsOnDesktopAndPhone(): void {
  const render = (
    layout: 'desktop' | 'phone',
    permissionState:
      | typeof qdnPermissionStateFixture
      | typeof qortalPermissionStateFixture,
  ) =>
    renderToStaticMarkup(
      <div data-layout={layout}>
        <PermissionDialog
          activeTabId={permissionState.pending[0]?.context.tabId ?? null}
          permissionState={permissionState}
        />
      </div>,
    )

  const hiddenOnWrongTab = renderToStaticMarkup(
    <PermissionDialog
      activeTabId={fixtureIds.tab}
      permissionState={qdnPermissionStateFixture}
    />,
  )
  assert.doesNotMatch(hiddenOnWrongTab, /role="dialog"/)

  const hiddenOnDashboard = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={homeV2ProductFixture}
      permissionState={qdnPermissionStateFixture}
      layout="desktop"
    />,
  )
  assert.doesNotMatch(hiddenOnDashboard, /role="dialog"/)

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

function testProductionHomeV2EntryIsCapabilityScoped(): void {
  const preload = readFileSync('electron/home-v2-live-preload.cts', 'utf8')
  const bridge = readFileSync('electron/home-v2-node-bridge.ts', 'utf8')
  const authorizedSenders = readFileSync('electron/home-v2-authorized-senders.ts', 'utf8')
  const coreManagerBridge = readFileSync('electron/home-v2-core-manager-bridge.ts', 'utf8')
  const coreDocsBridge = readFileSync('electron/home-v2-core-docs-bridge.ts', 'utf8')
  const retainedViewerBridge = readFileSync('electron/home-v2-retained-viewer-bridge.ts', 'utf8')
  const coreManager = readFileSync('electron/core-manager.ts', 'utf8')
  const i2pdManager = readFileSync('electron/i2pd-manager.ts', 'utf8')
  const appStage = readFileSync('src/v2/shell/AppTabStage.tsx', 'utf8')
  const bootstrap = readFileSync('electron/home-v2-main.ts', 'utf8')
  const main = readFileSync('electron/main.ts', 'utf8')
  const qortalNodeSettings = readFileSync('electron/qortal-node-settings.ts', 'utf8')
  const qortiumNodeSettings = readFileSync('electron/node-settings.ts', 'utf8')
  const homeV2LiveApp = readFileSync('src/home-v2-live/HomeV2LiveApp.tsx', 'utf8')
  const androidHtml = readFileSync('src/home-v2-live/android/index.html', 'utf8')
  const platform = readFileSync('src/platform.ts', 'utf8')
  const html = readFileSync('v2-live.html', 'utf8')
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    build: { appId: string }
    main: string
    scripts: Readonly<Record<string, string>>
  }

  assert.equal(packageJson.build.appId, 'org.qortium.home')
  assert.doesNotMatch(
    homeV2LiveApp,
    /Account integration is not enabled in this build|Not connected in this build/,
  )
  assert.match(
    homeV2LiveApp,
    /Capacitor\.isNativePlatform\(\)[\s\S]{0,100}Capacitor\.getPlatform\(\) === 'android'/,
    'Home 2 QDN settings may use Preferences only in the native Android host',
  )
  assert.equal(packageJson.main, 'dist-electron/home-v2-main.js')
  assert.equal(packageJson.scripts['dist:linux:x64:v2-live'], undefined)
  const androidV2VaultStart = platform.indexOf('// Home v2 public CHAT writes')
  assert.notEqual(androidV2VaultStart, -1)
  const androidV2VaultSource = platform.slice(androidV2VaultStart)
  assert.match(androidV2VaultSource, /const ANDROID_HOME_V2_NODE_API_KEY = '';/)
  assert.doesNotMatch(
    androidV2VaultSource,
    /readNodeSettings\(/,
    'Home 2 Android vault helpers must keep the portable node client route authoritative instead of rediscovering the legacy route',
  )
  assert.doesNotMatch(
    androidV2VaultSource,
    /getSendablePlatformNodeApiKey\(/,
    'Home 2 Android vault helpers must not graft a legacy node API key onto the portable route',
  )
  assert.doesNotMatch(
    androidV2VaultSource,
    /resolveNodeApiUrl\(/,
    'Home 2 Android vault helpers must not independently select a second Qortium node',
  )
  assert.doesNotMatch(
    homeV2LiveApp,
    /action:\s*['"]FETCH_NODE_API['"][\s\S]{0,300}\/chat\/private\//,
    'Android private-group validation must stay behind the permissioned vault instead of bypassing the generic read allowlist',
  )
  assert.match(
    androidHtml,
    /worker-src 'self'/,
    'Android Home must permit its same-origin memory-PoW worker',
  )
  assert.doesNotMatch(androidHtml, /worker-src (?!'self')/)
  assert.match(preload, /exposeInMainWorld\('homeV2Nodes'/)
  assert.match(preload, /home-v2-nodes:getSnapshot/)
  assert.match(preload, /home-v2-nodes:setMode/)
  assert.match(preload, /home-v2-nodes:readIdentity/)
  assert.match(preload, /home-v2-nodes:readAvatar/)
  assert.match(preload, /home-v2-nodes:listAppResources/)
  assert.match(preload, /exposeInMainWorld\('homeV2CoreManagers'/)
  assert.match(preload, /home-v2-core-manager:getStatus/)
  assert.match(preload, /home-v2-core-manager:start/)
  assert.match(preload, /home-v2-core-manager:stop/)
  assert.match(preload, /home-v2-qortal-adoption:list/)
  assert.match(preload, /home-v2-qortal-adoption:browse/)
  assert.match(preload, /home-v2-qortal-adoption:select/)
  assert.match(preload, /exposeInMainWorld\('homeV2QdnSettings'/)
  assert.match(preload, /home-v2-qdn-settings:get/)
  assert.match(preload, /home-v2-qdn-settings:set-assignment/)
  assert.match(preload, /home-v2-qdn-settings:set-muted/)
  assert.match(preload, /home-v2-qdn-settings:revoke/)
  assert.match(preload, /home-v2-qdn-settings:changed/)
  assert.match(preload, /exposeInMainWorld\('homeV2NotificationPolicy'/)
  assert.match(preload, /home-v2-notification-policy:get/)
  assert.match(preload, /home-v2-notification-policy:set/)
  assert.match(preload, /home-v2-notification-policy:changed/)
  assert.match(preload, /exposeInMainWorld\('homeV2MenuCommands'/)
  assert.match(preload, /isHomeV2MenuCommand\(value\)/)
  assert.match(preload, /'reopen-closed-tab'/)
  assert.match(preload, /'focus-address-bar'/)
  assert.match(preload, /ipcRenderer\.on\('menu:command'/)
  assert.match(preload, /exposeInMainWorld\('homeV2Zoom'/)
  assert.match(preload, /home-v2-zoom:step/)
  assert.match(preload, /home-v2-zoom:set/)
  assert.match(preload, /ipcRenderer\.on\('zoom:changed'/)
  assert.match(preload, /qdn-views:capture/)
  assert.match(preload, /home-v2-accounts:list/)
  assert.match(preload, /exposeInMainWorld\('homeV2Vault'/)
  assert.doesNotMatch(preload, /qortiumHome|core:|['"]sign(?:Transaction)?['"]/i)
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('accounts:/)
  assert.equal((preload.match(/require\(/g) ?? []).length, 1)
  assert.doesNotMatch(bridge, /apiKey|seedPhrase|sourceFilename/)
  assert.match(bridge, /assertAuthorizedHomeV2Sender\(event\)/)
  assert.match(authorizedSenders, /senderFrame !== sender\.mainFrame/)
  assert.match(authorizedSenders, /did-start-navigation/)
  assert.match(coreManagerBridge, /assertAuthorizedHomeV2Sender/)
  assert.match(coreDocsBridge, /home-v2-core-docs:enable/)
  assert.match(coreDocsBridge, /assertAuthorizedHomeV2Sender\(event\)/)
  assert.match(coreDocsBridge, /node\.mode !== 'local'/)
  assert.match(coreDocsBridge, /readRunningLocalCoreApiKeyFor/)
  assert.match(coreDocsBridge, /\/admin\/settings/)
  assert.match(coreDocsBridge, /\/admin\/restart/)
  assert.match(retainedViewerBridge, /home-v2-retained-viewer:saveBytes/)
  assert.match(retainedViewerBridge, /assertAuthorizedHomeV2Sender\(event\)/)
  assert.match(retainedViewerBridge, /value\.bytes instanceof Uint8Array/)
  assert.match(retainedViewerBridge, /value\.bytes\.byteLength > RETAINED_VIEWER_MAX_BYTES/)
  assert.doesNotMatch(coreManagerBridge, /core:status|core:progress/)
  assert.match(coreManager, /if \(!legacyCoreManagerRendererEventsEnabled\) return/)
  assert.match(coreManager, /startForHomeV2:[\s\S]{0,160}publishEvents: false/)
  assert.match(coreManager, /stopForHomeV2:[\s\S]{0,160}publishEvents: false/)
  assert.match(i2pdManager, /if \(!legacyI2pdRendererEventsEnabled\) return/)
  assert.match(bridge, /IDENTITY_RESPONSE_LIMIT/)
  assert.match(bridge, /GROUP_AVATAR_MAX_BYTES/)
  assert.match(bridge, /Unsupported identity read/)
  assert.match(bridge, /function endpointHost/)
  assert.match(bridge, /mode === 'public' && nodeApiUrl/)
  assert.match(bootstrap, /QORTIUM_HOME_V2/)
  assert.match(main, /home-v2-live-preload\.cjs/)
  assert.match(main, /authorizeHomeV2Sender/)
  assert.match(main, /registerHomeV2CoreManagerBridgeIpcHandlers/)
  assert.match(main, /registerHomeV2QdnSettingsBridgeIpcHandlers/)
  assert.match(
    main,
    /await registerHomeV2NotificationPolicyBridgeIpcHandlers\(\);[\s\S]{0,160}registerHomeV2AppBridgeIpcHandlers\(\);/,
    'Home 2 must initialize the persisted notification gate before exposing app delivery',
  )
  assert.match(main, /disableLegacyCoreManagerRendererEvents/)
  assert.match(main, /disableLegacyI2pdRendererEvents/)
  assert.match(main, /HOME_V2_SHELL_PARTITION/)
  assert.match(main, /partition: HOME_V2_SHELL_PARTITION/)
  assert.doesNotMatch(
    homeV2LiveApp,
    /loadDisplaySettings/,
    'Home 2 notification delivery must not consult the legacy display settings store',
  )
  assert.match(appStage, /capture\(\{ tabId: resolved\.tab\.id \}\)/)
  assert.match(appStage, /suspendedRef/)
  assert.match(appStage, /home-v2-app-stage__snapshot/)
  // Cleanup may skip hiding the native view only when the SAME tab is
  // suspending; a departing tab must still be hidden or it paints over the
  // trusted prompt when a background tab's request force-activates it.
  assert.match(appStage, /resolvedTabIdRef/)
  assert.match(appStage, /sameTabSuspending/)
  // While a prompt owns a still-open tab, tab-away navigation must be refused
  // synchronously: repairing it afterwards unmounts and reloads the Android
  // app iframe, killing the pending request.
  const prototypeSource = readFileSync('src/v2/shell/HomeV2Prototype.tsx', 'utf8')
  assert.match(prototypeSource, /overlayOwnerTabId/)
  assert.match(prototypeSource, /onActivateTab=\{guardedActivateTab\}/)
  assert.match(prototypeSource, /onNavigate=\{guardedNavigate\}/)
  assert.match(
    qortalNodeSettings,
    /DEFAULT_LOCAL_URL = 'https:\/\/127\.0\.0\.1:12391'/,
  )
  assert.match(qortalNodeSettings, /ensureNodeCa\(nodeApiUrl, null\)/)
  assert.match(
    qortiumNodeSettings,
    /DEFAULT_LOCAL_NODE_API_URL = 'https:\/\/127\.0\.0\.1:24891'/,
  )
  assert.match(qortiumNodeSettings, /chooseResolvedLocalSettingsWrite/)
  // The API-key refresh clears its working copy but must present the true
  // pre-refresh settings as the compare-and-swap expectation, and its stale
  // no-key write must go through the same policy rather than writeNodeSettings.
  assert.match(qortiumNodeSettings, /expected: NodeSettings = settings/)
  assert.match(
    qortiumNodeSettings,
    /writeResolvedLocalApiKey\(expected, resolvedSettings\)/,
  )
  assert.match(
    qortiumNodeSettings,
    /return writeResolvedLocalApiKey\(settings, refreshedSettings\)/,
  )
  assert.doesNotMatch(qortiumNodeSettings, /writeNodeSettings\(refreshedSettings\)/)
  assert.match(platform, /getPrivateKeyAddress:\s*getAddressFromPrivateKey/)
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
      'seedPhrase',
    ]) {
      assert.equal(source.includes(forbidden), false, `${path} must not contain ${forbidden}`)
    }
  }
}

// Pins the Home v2 permission-hardening fixes (security review findings 1
// and 8, plus the round-2 Sol re-review closing findings #1/#2/#3/#5/#6 on
// top): Fix A binds a loaded app view's in-view navigation, and its
// permission grants, to the resource it was launched for, with its
// identifier resolved the way Core actually resolves it (re-review #1); on
// Android the launch identity is now ALSO enforced at the trusted native
// proxy layer, not just the app-controlled self-report (re-review #2); the
// desktop live-resource recheck now reads the TRUSTED live URL, not a
// bookkeeping field that could go stale (re-review #3); a managed-archive
// resource's identity is computed from the same real (symlink-resolved)
// path used for its containment check (re-review #5); Fix B bounds how
// often a granted tab can broadcast chat sends, keyed by sender/window too
// so a restored/duplicate tab id cannot borrow another window's budget
// (re-review #6 covers the bypass tests, in the *.test.ts files below).
// Regression risk on all of this is high (it hardens an already-shipped
// signing/account-read model), so this locks the wiring in place rather than
// only the underlying pure-function unit tests (electron/qdn-resource-
// identity.test.ts, electron/home-v2-send-rate-limiter.test.ts,
// src/v2/shell/render-path-identity.test.ts, and the Android
// QdnRenderProxyTest.java/QdnBridgeWebViewClientTest.java JUnit suites
// already cover the algorithms).
function testGrantIdentityAndSendRateLimitHardening(): void {
  const resourceIdentity = readFileSync('electron/qdn-resource-identity.ts', 'utf8')
  const qdnViews = readFileSync('electron/qdn-views.ts', 'utf8')
  const qdnArchiveRender = readFileSync('electron/qdn-archive-render.ts', 'utf8')
  const appBridge = readFileSync('electron/home-v2-app-bridge.ts', 'utf8')
  const sessionGrants = readFileSync('electron/home-v2-session-grants.ts', 'utf8')
  const rateLimiter = readFileSync('electron/home-v2-send-rate-limiter.ts', 'utf8')
  const appTabStage = readFileSync('src/v2/shell/AppTabStage.tsx', 'utf8')
  const renderPathIdentity = readFileSync('src/v2/shell/render-path-identity.ts', 'utf8')
  const androidAppHost = readFileSync('src/home-v2-live/android-app-host.ts', 'utf8')
  const liveApp = readFileSync('src/home-v2-live/HomeV2LiveApp.tsx', 'utf8')
  const qdnRenderProxy = readFileSync('android/app/src/main/java/org/qortium/home/QdnRenderProxy.java', 'utf8')
  const qdnRenderProxyPlugin = readFileSync(
    'android/app/src/main/java/org/qortium/home/QdnRenderProxyPlugin.java',
    'utf8',
  )
  const qdnBridgeWebViewClient = readFileSync(
    'android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
    'utf8',
  )

  // Fix A, desktop primary defense: in-view navigation is bound to the
  // launch resource identity, not just the node origin/service allowlist.
  assert.match(resourceIdentity, /export function isQdnRenderUrlSameAppResource/)
  // Re-review #1: the identifier itself must be resolved the way Core does —
  // ?identifier= query wins, else a non-"default" first path segment.
  assert.match(resourceIdentity, /function resolveCandidateIdentifier/)
  assert.match(resourceIdentity, /searchParams\.get\('identifier'\)/)
  assert.match(renderPathIdentity, /function resolveCandidateIdentifier/)
  assert.match(qdnViews, /function isAllowedInViewNavigation/)
  for (const handler of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    const eventBlock = new RegExp(
      `on\\('${handler}',[\\s\\S]{0,220}?isAllowedInViewNavigation`,
    )
    assert.match(qdnViews, eventBlock, `${handler} must gate through isAllowedInViewNavigation`)
  }
  assert.match(
    qdnViews,
    /const updateCurrentUrl = \(url: string\) => \{[\s\S]{0,1000}entry\.currentUrl = url;[\s\S]{0,400}isAllowedInViewNavigation\(url, entry\)/,
    'updateCurrentUrl must record the committed URL unconditionally (re-review #3), THEN gate ' +
      'the nav snapshot send through isAllowedInViewNavigation',
  )
  assert.match(qdnViews, /qdn-views:navigate'[\s\S]{0,600}isAllowedInViewNavigation/)

  // Re-review #3: the permission-time live-resource recheck must read the
  // TRUSTED live URL (webContents.getURL()), not a bookkeeping field that a
  // missed/misordered event could leave stale.
  assert.match(qdnViews, /function getTrustedCurrentUrl/)
  assert.match(qdnViews, /webContents\.getURL\(\)/)
  assert.match(qdnViews, /currentUrl: getTrustedCurrentUrl\(entry\)/)

  // Re-review #5: a managed-archive resource's cache-dir identity is derived
  // from the same real (symlink-resolved) path its own containment check
  // uses, not the lexical URL path.
  assert.match(qdnArchiveRender, /export function getRealPathIfAvailable/)
  assert.match(qdnViews, /getRealPathIfAvailable/)

  // Fix A, desktop defense-in-depth: the live currentUrl must resolve to the
  // same app resource as the granted resourceUrl, checked BEFORE a session
  // grant is honored and again after the permission decision.
  assert.match(appBridge, /function liveResourceMatchesGrant/)
  assert.match(
    appBridge,
    // Budget widened when the permissionless-read early return and the durable
    // chat.send grant check were added between these two points. The ordering
    // property is what matters and is unchanged: the stale-resource check
    // still runs BEFORE any grant (session or durable) is honored.
    /liveResourceMatchesGrant\(context\)[\s\S]{0,3200}sessionAccountReadGrants\.has\(grantKey\)/,
  )
  // The durable chat.send grant must also sit after the stale-resource check.
  assert.match(
    appBridge,
    /liveResourceMatchesGrant\(context\)[\s\S]{0,3200}hasQdnAppCapability\(appGrantKey, 'chat\.send'\)/,
  )
  assert.match(appBridge, /liveResourceMatchesGrant\(freshContext\)/)
  assert.match(appBridge, /isQdnViewVisible\(context\.windowId, context\.tabId\)/)
  assert.match(qdnViews, /if \(!window\.isDestroyed\(\) && window\.isFocused\(\)\)/)
  assert.match(qdnViews, /qdn-views:updateBridgeStates/)
  assert.match(
    qdnViews,
    /qdn-views:updateAccountState'[\s\S]{0,1600}return queueQdnViewStateDelivery\(entry\)/,
    'account-state IPC must not resolve before the app view receives the unlock state',
  )
  assert.match(appTabStage, /bridge\.updateBridgeStates/)
  assert.match(sessionGrants, /return 'account\.read'/)
  assert.match(sessionGrants, /HOME_V2_ACCOUNT_READ_ACTIONS/)
  assert.match(sessionGrants, /return 'chat\.public\.mutate'/)
  assert.match(sessionGrants, /return 'chat\.direct\.mutate'/)
  assert.match(sessionGrants, /return 'chat\.private-group\.mutate'/)

  // Fix A, Android: the requestApp dispatcher still tracks the iframe's
  // self-reported live navigation location, now as UX/consistency
  // defense-in-depth rather than the security boundary (round 6 — see
  // below).
  assert.match(appTabStage, /liveResourcePathRef/)
  assert.match(appTabStage, /isSameRenderResourcePath/)
  assert.match(appTabStage, /navigated away from its launch resource/)
  assert.match(renderPathIdentity, /export function isSameRenderResourcePath/)
  // Round 6 (owner-directed redesign, ending the round-2/4/5
  // identifier-confusion class): the bridge token / injection / CSP-strip
  // gate no longer compares identifiers AT ALL — the tab's EXACT
  // shell-computed render document URL (resolved.url, with the constant
  // homeV2Bridge marker folded in BEFORE either the authorize() call or the
  // iframe src is built, so the registered and requested documents can never
  // independently drift — see AndroidAppStage's own doc comment) is
  // registered with the trusted native proxy layer BEFORE the iframe is
  // ever created, and only a byte-for-byte (normalized) match to it is ever
  // bridge-eligible.
  assert.match(
    appTabStage,
    /const authorizedDocument = new URL\(resolved\.url\)\s*\n\s*authorizedDocument\.searchParams\.set\('homeV2Bridge', '1'\)/,
    'the authorized document URL registered natively must be built ONCE and reused, verbatim, for ' +
      'the iframe src — not independently recomputed',
  )
  assert.match(
    appTabStage,
    /authorizeHomeV2AndroidAppOrigin\(resolved\.nodeApiUrl, authorizedDocument\.toString\(\)\)/,
    'authorize() must register the EXACT shell-computed document URL, not a caller-derived ' +
      'name/identifier pair that could drift from it',
  )
  assert.doesNotMatch(
    appTabStage,
    /resolveLaunchIdentifier\(resolved\.identity\.identifier, resolved\.url\),\s*\n\s*new URL\(resolved\.url\)\.pathname,/,
    'the old caller-computed appName/appIdentifier/initialPathname authorize() call must be gone',
  )
  assert.match(
    appTabStage,
    /identifier: resolveLaunchIdentifier\(resolved\.identity\.identifier, resolved\.url\),/,
    'the (now UX-only) launchIdentity self-report check may still use resolveLaunchIdentifier',
  )
  assert.match(renderPathIdentity, /export function resolveLaunchIdentifier/)
  assert.match(
    appTabStage,
    /import \{ isSameRenderResourcePath, resolveLaunchIdentifier \} from '\.\/render-path-identity'/,
  )
  assert.match(
    androidAppHost,
    /authorizeHomeV2AndroidAppOrigin\(origin: string, authorizedDocumentUrl: string\)/,
    'android-app-host.ts must register a single trusted document URL, not separate ' +
      'appName/appIdentifier/initialPathname fields',
  )
  assert.match(qdnRenderProxyPlugin, /call\.getString\("authorizedDocumentUrl"\)/)
  assert.doesNotMatch(qdnRenderProxyPlugin, /call\.getString\("appName"\)/)
  assert.doesNotMatch(qdnRenderProxyPlugin, /call\.getString\("initialPathname"\)/)
  assert.match(qdnRenderProxy, /static class AuthorizedDocument|final class AuthorizedDocument/)
  assert.doesNotMatch(
    qdnRenderProxy,
    /final String initialPathname;/,
    'round 6 deletes the initial-path pathname exemption entirely — the exact-URL match makes it ' +
      "unnecessary (the tab's own first request IS the registered URL by construction)",
  )
  assert.doesNotMatch(
    qdnRenderProxy,
    /static boolean isSameActiveAppTabResource/,
    'the old identifier-comparison-for-token-gating predicate must be gone, not just unused',
  )
  assert.doesNotMatch(
    qdnRenderProxy,
    /static boolean isBridgeEligibleRenderService/,
    'round 6 supersedes the service-only bridge-eligibility check with the exact-URL match',
  )
  assert.match(qdnRenderProxy, /static String resolveCandidateIdentifier/)
  assert.match(
    qdnRenderProxy,
    /static AuthorizedDocument buildAuthorizedDocument\(List<String> segments, String encodedQuery\)/,
  )
  // The round-6 security gate itself: a RENDER document request is
  // bridge-eligible ONLY when its normalized (pathname, filtered query)
  // exactly equals the registered AuthorizedDocument's.
  assert.match(
    qdnRenderProxy,
    /static boolean isExactAuthorizedRenderDocument\(\s*List<String> segments,\s*String encodedQuery,\s*AuthorizedDocument authorized\s*\)/,
  )
  assert.match(
    qdnRenderProxy,
    /authorized\.pathname\.equals\(normalizePathnameFromSegments\(segments\)\)\s*\n\s*&&\s*authorized\.query\.equals\(normalizeQuery\(encodedQuery\)\);/,
  )
  // Normalization: exactly the display params + the bridge token are
  // ignored; nothing else, so an unexpected extra query param fails closed.
  assert.match(
    qdnRenderProxy,
    /"theme",\s*\n\s*"lang",\s*\n\s*"textSize",\s*\n\s*"accent",\s*\n\s*"uiStyle",\s*\n\s*QDN_BRIDGE_TOKEN_QUERY_PARAM/,
  )
  // Round 4's separate, coarser /arbitrary containment (name + identifier,
  // unaffected by the round-6 redesign — /arbitrary requests have a
  // different query shape exact-URL equality was never meant to cover) is
  // preserved, just renamed and stripped of the deleted pathname exemption.
  assert.match(
    qdnRenderProxy,
    /static boolean isAuthorizedAppResource\(\s*List<String> segments,\s*String queryIdentifier,\s*AuthorizedDocument authorized\s*\)/,
  )
  assert.match(
    qdnRenderProxy,
    /\(route == RouteKind\.RENDER \|\| route == RouteKind\.PUBLIC_ARBITRARY\)[\s\S]{0,200}authorization\.homeV2[\s\S]{0,200}isAuthorizedAppResource/,
    'classifyProxyRoute must still enforce the authorized app resource for RENDER AND ' +
      'PUBLIC_ARBITRARY routes on homeV2 origins (Round 4, Defect C: /arbitrary/APP/... can ' +
      'return a full HTML document exactly like /render/... can)',
  )
  assert.match(
    qdnBridgeWebViewClient,
    /QdnRenderProxy\.isProxyUrl\(url\)\) \{[\s\S]{0,1200}classifyProxyRoute\(url\)[\s\S]{0,80}route == QdnRenderProxy\.RouteKind\.DENIED\) \{[\s\S]{0,40}return true;/,
    'shouldOverrideUrlLoading must cancel a subframe navigation classifyProxyRoute would deny',
  )
  // Round 6: shouldCarryBridgeToken is now the SINGLE definition of bridge
  // eligibility, reused (not duplicated) by both serveProxiedQdnRequest and
  // shouldOverrideUrlLoading, and takes the exact-URL inputs directly rather
  // than a service-only signal.
  assert.match(
    qdnBridgeWebViewClient,
    /static boolean shouldCarryBridgeToken\(\s*QdnRenderProxy\.RouteKind route,\s*boolean homeV2,\s*List<String> segments,\s*String encodedQuery,\s*QdnRenderProxy\.AuthorizedDocument authorizedDocument\s*\)/,
  )
  assert.match(
    qdnBridgeWebViewClient,
    /return !homeV2 \|\| QdnRenderProxy\.isExactAuthorizedRenderDocument\(segments, encodedQuery, authorizedDocument\);/,
  )
  assert.match(
    qdnBridgeWebViewClient,
    /String bridgeToken = shouldCarryBridgeToken\(\s*route,\s*QdnRenderProxy\.isHomeV2Origin\(requestUrl\),\s*requestUrl\.getPathSegments\(\),\s*requestUrl\.getEncodedQuery\(\),\s*QdnRenderProxy\.getAuthorizedDocument\(requestUrl\)\s*\)[\s\S]{0,150}: null;/,
    'serveProxiedQdnRequest must gate the bridge token on the exact-URL-aware shouldCarryBridgeToken',
  )
  assert.match(
    qdnBridgeWebViewClient,
    /return route == QdnRenderProxy\.RouteKind\.RENDER\s*&&\s*!shouldCarryBridgeToken\(\s*route,\s*QdnRenderProxy\.isHomeV2Origin\(url\),\s*url\.getPathSegments\(\),\s*url\.getEncodedQuery\(\),\s*QdnRenderProxy\.getAuthorizedDocument\(url\)\s*\);/,
    'shouldOverrideUrlLoading must reuse shouldCarryBridgeToken directly, not a duplicated inline check',
  )
  assert.match(qdnRenderProxy, /static boolean isHomeV2Origin\(Uri url\)/)
  assert.match(qdnRenderProxy, /static AuthorizedDocument getAuthorizedDocument\(Uri url\)/)

  // Round 4, Defect A: the Android app stage is keyed by the active tab id
  // (+ resourceLocation) so React fully unmounts App A's iframe/token/
  // message-listener before App B's fresh instance ever mounts — no render
  // may exist in which a stale iframe/token coexists with an already-
  // updated `resolved` reporting a DIFFERENT tab. DesktopAppStage is
  // deliberately excluded (persistent native WebContentsView).
  assert.match(appTabStage, /export function androidAppStageKey\(productState: ProductState\)/)
  assert.match(
    appTabStage,
    /return <AndroidAppStage key=\{androidAppStageKey\(props\.productState\)\} \{\.\.\.props\} \/>/,
    'the Android branch of AppTabStage must be keyed by androidAppStageKey; DesktopAppStage must not be',
  )
  assert.doesNotMatch(
    appTabStage,
    /return <DesktopAppStage key=/,
    'DesktopAppStage owns a persistent native WebContentsView and must stay unkeyed',
  )

  // Fix B: a shared rate limiter bounds SEND_CHAT_MESSAGE on both platforms,
  // enforced before any node call or proof-of-work.
  assert.match(rateLimiter, /export function createHomeV2SendRateLimiter/)
  assert.match(rateLimiter, /HOME_V2_CHAT_SEND_MIN_INTERVAL_MS/)
  assert.match(rateLimiter, /HOME_V2_CHAT_SEND_WINDOW_MS/)
  assert.match(rateLimiter, /HOME_V2_CHAT_SEND_MAX_PER_WINDOW/)
  assert.match(appBridge, /chatSendRateLimiter\.checkAndRecordSend/)
  assert.match(appBridge, /chatSendRateLimiter\.reset\(\)/)
  // Re-review #6: the rate-limit key must include sender/window identity, as
  // permission grants (accountGrantKey) already do, not just tabId|accountId.
  assert.match(appBridge, /function chatSendRateLimitKey\(sender: WebContents, context: QdnViewContext\)/)
  assert.match(appBridge, /chatSendRateLimitKey\(sender, context\)/)
  assert.match(liveApp, /androidChatSendRateLimiter[\s\S]{0,40}createHomeV2SendRateLimiter/)
  assert.match(liveApp, /androidChatSendRateLimiter\.current\.checkAndRecordSend/)
  assert.match(liveApp, /androidChatSendRateLimiter\.current\.reset\(\)/)
  // H7B: both host surfaces revoke the affected transient app authority on
  // each runtime boundary and retain only opaque signed unknown outcomes
  // across restart. Node invalidation is explicitly network-scoped.
  assert.match(appBridge, /home-v2-app:invalidate-runtime/)
  assert.match(appBridge, /normalizeHomeV2RuntimeInvalidation/)
  assert.match(appBridge, /findStoredHomeV2PendingTransactionConflict/)
  assert.match(appBridge, /recordHomeV2PendingTransaction/)
  assert.match(liveApp, /invalidateAndroidRuntime\('account-changed'\)/)
  assert.match(liveApp, /invalidateAndroidRuntime\('node-changed', null, network\)/)
  assert.doesNotMatch(
    liveApp,
    /handleAppNavigationChanged[\s\S]{0,400}invalidateAndroidRuntime\('navigation-changed'/,
    'same-app route changes must not revoke account-read consent',
  )
  assert.match(liveApp, /invalidateAndroidRuntime\('tab-closed', tabId\)/)
  assert.match(liveApp, /findAndroidHomeV2PendingTransactionConflict/)
  assert.match(liveApp, /recordAndroidHomeV2PendingTransaction/)
}

function testShellStateMigratesAddressSelection(): void {
  const legacy = parseHomeV2ShellState(
    {
      version: 1,
      appearance: {},
      selectedAccountId: 'wallet:Qprimary:2',
      product: createProductState(),
    },
    'light',
    'en',
  )
  assert.equal(legacy.version, 3)
  assert.equal(legacy.onboarding.status, 'skipped')
  assert.equal(legacy.selectedAccountId, 'wallet:Qprimary')
  assert.equal(legacy.selectedAddressId, 'wallet:Qprimary:2')
  assert.deepEqual(serializeHomeV2ShellState(legacy), {
    version: 3,
    appearance: {
      accent: legacy.appearance.accent,
      appZoom: legacy.appearance.appZoom,
      language: legacy.appearance.language,
      textSize: legacy.appearance.textSize,
      theme: legacy.appearance.theme,
      ui: legacy.appearance.ui,
    },
    newTabPreference: DEFAULT_NEW_TAB_PREFERENCE,
    onboarding: legacy.onboarding,
    selectedAccountId: 'wallet:Qprimary',
    selectedAddressId: 'wallet:Qprimary:2',
    product: {
      activeTabId: legacy.product.activeTabId,
      entries: legacy.product.entries,
    },
  })

  const newTabProduct = reduceProductState(homeV2ProductFixture, {
    type: 'navigate',
    destination: 'newtab',
  })
  const serializedNewTab = serializeHomeV2ShellState({
    ...legacy,
    product: newTabProduct,
  })
  assert.equal(serializedNewTab.version, 3)
  assert.equal(
    serializedNewTab.product.entries.filter((entry) => entry.kind === 'app').length,
    2,
  )
  assert.ok(
    serializedNewTab.product.entries.some(
      (entry) => entry.kind === 'internal' && entry.page === 'newtab',
    ),
  )
  const restoredNewTab = parseHomeV2ShellState(
    JSON.parse(JSON.stringify(serializedNewTab)),
    'light',
    'en',
  )
  assert.equal(restoredNewTab.version, 3)
  assert.equal(restoredNewTab.product.destination, 'newtab')
  assert.equal(
    restoredNewTab.product.entries.find(
      (entry) => entry.id === restoredNewTab.product.activeTabId,
    )?.kind,
    'internal',
  )
  assert.equal(restoredNewTab.product.tabs.length, 2)
}

function testBookmarksToolbarButtonAndTabDrop() {
  const emptyToolbarSnapshot = {
    bookmarks: [],
    dashboardPins: [],
    revision: 1,
    schemaVersion: 1 as const,
    startPages: [],
    toolbar: [],
    toolbarVisibility: 'always' as const,
  }
  const chrome = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={createProductState()}
      permissionState={createPermissionState()}
      layout="desktop"
      bookmarkToolbar={{ onOpen: () => Promise.resolve(), snapshot: emptyToolbarSnapshot }}
      onToggleCurrentBookmark={() => undefined}
      onDropTabOnBookmarkToolbar={() => undefined}
    />,
  )
  // The control sits between reload and Home, where Home 1.x put it.
  const reloadIndex = chrome.indexOf('aria-label="Reload"')
  const bookmarksIndex = chrome.indexOf('class="home-v2-bookmarks-button')
  const homeIndex = chrome.indexOf('class="home-v2-home-button"')
  assert.ok(reloadIndex >= 0 && bookmarksIndex >= 0 && homeIndex >= 0)
  assert.ok(
    reloadIndex < bookmarksIndex && bookmarksIndex < homeIndex,
    'the bookmarks button must sit between reload and Home',
  )
  // An empty toolbar still renders, or a dragged tab would have no target.
  assert.match(chrome, /class="home-v2-bookmark-toolbar"[^>]*data-empty="true"/)

  // Without a drop handler there is nothing to drop, so an empty strip stays
  // hidden exactly as before.
  const withoutDrop = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={createProductState()}
      permissionState={createPermissionState()}
      layout="desktop"
      bookmarkToolbar={{ onOpen: () => Promise.resolve(), snapshot: emptyToolbarSnapshot }}
    />,
  )
  assert.doesNotMatch(withoutDrop, /home-v2-bookmark-toolbar/)
  assert.doesNotMatch(withoutDrop, /home-v2-bookmarks-button/)

  // A saved current page shows as bookmarked, and the star reports the state
  // rather than always offering "Add".
  const savedToolbarSnapshot = {
    ...emptyToolbarSnapshot,
    toolbar: [
      {
        createdAt: 1,
        displayUrl: 'home://dashboard',
        id: 'toolbar-dashboard',
        title: 'Dashboard',
        type: 'bookmark' as const,
      },
    ],
  }
  const saved = renderToStaticMarkup(
    <HomeV2Prototype
      snapshot={homeV2Fixture}
      productState={createProductState()}
      permissionState={createPermissionState()}
      layout="desktop"
      bookmarkToolbar={{ onOpen: () => Promise.resolve(), snapshot: savedToolbarSnapshot }}
      onToggleCurrentBookmark={() => undefined}
      onDropTabOnBookmarkToolbar={() => undefined}
    />,
  )
  assert.match(saved, /home-v2-bookmarks-button is-bookmarked/)
  assert.match(saved, /title="Remove from Bookmarks"/)
  assert.match(chrome, /title="Add to Bookmarks"/)

  // The tab strip owns the drop gesture, hit-testing the toolbar the way 1.x
  // did rather than reordering tabs while the pointer is over it.
  const tabStripSource = readFileSync('src/v2/shell/TabStrip.tsx', 'utf8')
  assert.match(tabStripSource, /home-v2-bookmark-toolbar/)
  assert.match(tabStripSource, /onDropOnBookmarkToolbar/)
  assert.doesNotMatch(
    tabStripSource,
    // The comment explaining why capture is avoided must not trip this; only
    // an actual call counts.
    /\.setPointerCapture\(/,
    'the drop hit-test must not reintroduce pointer capture (PR #351 regression)',
  )
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
testSettingsScaffoldAndNewTabPreference()
testCoreManagementRenderingAndAndroidDegrade()
testAppearanceSettingsAndLegacyMigration()
testPermissionDialogsOnDesktopAndPhone()
testInteractiveFixturePreviewContract()
testFixtureElectronEntryIsIsolated()
testFixtureHtmlHasVisibleBootFallback()
testProductionHomeV2EntryIsCapabilityScoped()
testShellStateMigratesAddressSelection()
testRendererSourceHasNoRuntimeEscapeHatches()
testGrantIdentityAndSendRateLimitHardening()
testBookmarksToolbarButtonAndTabDrop()

console.log('home v2 foundation contract tests passed')
