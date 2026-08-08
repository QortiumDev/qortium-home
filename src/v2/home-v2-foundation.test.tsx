import assert from 'node:assert/strict'
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
  createProductState,
  ProductModelError,
  reduceProductState,
} from './product-model'
import { HomeV2FixturePreview } from './fixture/HomeV2FixturePreview'
import { HomeV2Prototype } from './shell/HomeV2Prototype'
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
  assert.match(desktop, /data-theme="light"/)
  assert.match(phone, /data-layout="phone"/)
  for (const html of [desktop, phone]) {
    assert.match(html, /class="home-v2-browser-chrome"/)
    assert.match(html, /aria-label="Browser tabs"/)
    assert.match(html, /value="home:\/\/dashboard"/)
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
    assert.match(html, /fixture:tab:chat:qortal/)
    assert.match(html, /fixture:tab:chat:qortium/)
    assert.doesNotMatch(html, /role="dialog"/)
  }
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

await testMockHostFailsClosed()
await testPlatformFixtureHostsFailClosed()
testWrongNetworkStopsBeforeAdapter()
testProductModelKeepsNetworkQualifiedTabs()
testBridgeProtocolsStaySeparate()
testPermissionBrokerScopesAndInvalidation()
testDesktopAndPhoneContracts()
testStartupStatesAndAppearance()
testAppearanceSettingsAndLegacyMigration()
testPermissionDialogsOnDesktopAndPhone()
testInteractiveFixturePreviewContract()
testFixtureElectronEntryIsIsolated()
testFixtureHtmlHasVisibleBootFallback()
testRendererSourceHasNoRuntimeEscapeHatches()

console.log('home v2 foundation contract tests passed')
