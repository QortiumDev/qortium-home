import { useMemo, useReducer, useRef, useState } from 'react'
import type {
  AccountSessionState,
  AppDescriptor,
  HomeV2Snapshot,
  NetworkId,
  NodeConnectionMode,
  NodeSummary,
  TabId,
} from '../contracts'
import {
  createPermissionState,
  invalidatePermissionState,
  queuePermissionPrompt,
  resolvePermissionPrompt,
  type PermissionDecision,
  type PermissionPrompt,
  type PermissionRequestId,
} from '../bridge-permissions'
import { createProductState, reduceProductState } from '../product-model'
import {
  HomeV2Prototype,
  type HomeV2Layout,
  type HomeV2Theme,
} from '../shell/HomeV2Prototype'
import {
  createAndroidFixtureHost,
  createElectronFixtureHost,
  type FixturePlatform,
} from '../test-kit/MockHost'
import {
  fixtureIds,
  fixtureOperationContext,
  homeV2Fixture,
  qdnPermissionPromptFixture,
  qortalPermissionPromptFixture,
} from '../test-kit/fixtures'
import './fixture-preview.css'

type PreviewPlatform = Exclude<FixturePlatform, 'generic'>

function nodeForMode(
  node: NodeSummary,
  mode: NodeConnectionMode,
): NodeSummary {
  if (mode === 'disabled') {
    return {
      ...node,
      mode,
      state: 'offline',
      statusText: 'Disabled',
      label: 'No connection',
    }
  }
  if (mode === 'public') {
    return {
      ...node,
      mode,
      state: 'online',
      statusText: 'Ready',
      label: 'Public node',
    }
  }
  if (mode === 'custom') {
    return {
      ...node,
      mode,
      state: 'online',
      statusText: 'Ready',
      label: 'Custom node',
    }
  }
  return {
    ...node,
    mode,
    state: node.network === 'qortal' ? 'syncing' : 'online',
    statusText: node.network === 'qortal' ? 'Syncing 96%' : 'Ready',
    label: `Local ${node.network === 'qortal' ? 'Qortal Core' : 'Qortium Core'}`,
  }
}

function nextRequest(
  prompt: PermissionPrompt,
  sequence: number,
): PermissionPrompt {
  return {
    ...prompt,
    id: `${prompt.id}:${sequence}` as PermissionRequestId,
  }
}

export function HomeV2FixturePreview() {
  const [productState, dispatchProduct] = useReducer(
    reduceProductState,
    undefined,
    createProductState,
  )
  const [permissionState, setPermissionState] = useState(createPermissionState)
  const [layout, setLayout] = useState<HomeV2Layout>('desktop')
  const [theme, setTheme] = useState<HomeV2Theme>('light')
  const [accountState, setAccountState] =
    useState<AccountSessionState>('unlocked')
  const [rememberUnlock, setRememberUnlock] = useState(true)
  const [lockOnExit, setLockOnExit] = useState(true)
  const [nodeModes, setNodeModes] = useState<
    Readonly<Record<NetworkId, NodeConnectionMode>>
  >({ qortal: 'local', qortium: 'local' })
  const [platform, setPlatform] = useState<PreviewPlatform>('electron')
  const [status, setStatus] = useState(
    'Fixture ready. No live services are connected.',
  )
  const sequence = useRef(0)
  const snapshot = useMemo<HomeV2Snapshot>(
    () => ({
      ...homeV2Fixture,
      account: {
        ...homeV2Fixture.account,
        state: accountState,
        selectedIdentityId:
          accountState === 'none' ? null : fixtureIds.identity,
        rememberUnlock,
        lockOnExit,
        manuallyLocked: accountState === 'locked',
      },
      nodes: {
        qortal: nodeForMode(homeV2Fixture.nodes.qortal, nodeModes.qortal),
        qortium: nodeForMode(homeV2Fixture.nodes.qortium, nodeModes.qortium),
      },
    }),
    [accountState, lockOnExit, nodeModes, rememberUnlock],
  )
  const host = useMemo(
    () =>
      platform === 'electron'
        ? createElectronFixtureHost(snapshot)
        : createAndroidFixtureHost(snapshot),
    [platform, snapshot],
  )

  const openApp = (app: AppDescriptor, targetNetwork: NetworkId) => {
    sequence.current += 1
    const tabId = `fixture:preview:${sequence.current}` as TabId
    dispatchProduct({
      type: 'open-app',
      app,
      context: fixtureOperationContext(app.id, targetNetwork, tabId),
      tabId,
    })
    setStatus(`${app.title} opened in a synthetic ${targetNetwork} tab.`)
  }

  const closeTab = (tabId: TabId) => {
    setPermissionState((current) =>
      invalidatePermissionState(current, { kind: 'tab-closed', tabId }),
    )
    dispatchProduct({ type: 'close-tab', tabId })
    setStatus('Fixture tab closed; tab-scoped permissions were cleared.')
  }

  const navigate = (
    destination: 'activity' | 'apps' | 'dashboard' | 'settings',
  ) => {
    if (productState.activeTabId) {
      setPermissionState((current) =>
        invalidatePermissionState(current, {
          kind: 'navigation-changed',
          tabId: productState.activeTabId as TabId,
        }),
      )
    }
    dispatchProduct({ type: 'navigate', destination })
    setStatus(`${destination[0].toUpperCase()}${destination.slice(1)} selected.`)
  }

  const queuePrompt = (prompt: PermissionPrompt) => {
    sequence.current += 1
    setPermissionState((current) =>
      queuePermissionPrompt(current, nextRequest(prompt, sequence.current)),
    )
    setStatus(`${prompt.protocol} ${prompt.action} is waiting for a decision.`)
  }

  const resolvePrompt = (
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ) => {
    setStatus(
      decision.approved
        ? `Fixture request allowed (${decision.scope}). Nothing was executed.`
        : 'Fixture request denied. Nothing was executed.',
    )
    setPermissionState(
      (current) => resolvePermissionPrompt(current, requestId, decision).state,
    )
  }

  const resetSecurityState = () => {
    setPermissionState((current) =>
      invalidatePermissionState(current, { kind: 'locked' }),
    )
    setStatus('Fixture locked; pending requests and grants were cleared.')
    setAccountState((current) => (current === 'none' ? current : 'locked'))
  }

  const setNodeMode = (network: NetworkId, mode: NodeConnectionMode) => {
    setNodeModes((current) => ({ ...current, [network]: mode }))
    setStatus(
      `${network === 'qortal' ? 'Qortal' : 'Qortium'} set to ${mode} mode.`,
    )
  }

  return (
    <div className={`home-v2-fixture-preview home-v2-fixture-preview--${layout}`}>
      <header className="home-v2-fixture-toolbar">
        <div>
          <strong>Home 2.0 interactive fixture</strong>
          <span>No network, wallet, node, signing, Core, or Reticulum access</span>
        </div>
        <div className="home-v2-fixture-toolbar__controls">
          <fieldset>
            <legend>Layout</legend>
            {(['desktop', 'phone'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={layout === candidate ? 'is-active' : ''}
                aria-pressed={layout === candidate}
                onClick={() => setLayout(candidate)}
              >
                {candidate}
              </button>
            ))}
          </fieldset>
          <fieldset>
            <legend>Theme</legend>
            {(['light', 'dark'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={theme === candidate ? 'is-active' : ''}
                aria-pressed={theme === candidate}
                onClick={() => setTheme(candidate)}
              >
                {candidate}
              </button>
            ))}
          </fieldset>
          <fieldset>
            <legend>Account</legend>
            {(['none', 'locked', 'unlocked'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={accountState === candidate ? 'is-active' : ''}
                aria-pressed={accountState === candidate}
                onClick={() => {
                  setAccountState(candidate)
                  setStatus(`${candidate} account startup state selected.`)
                }}
              >
                {candidate}
              </button>
            ))}
          </fieldset>
          <fieldset>
            <legend>Host fake</legend>
            {(['electron', 'android'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={platform === candidate ? 'is-active' : ''}
                aria-pressed={platform === candidate}
                onClick={() => {
                  setPlatform(candidate)
                  setStatus(`${candidate} fail-closed host selected.`)
                }}
              >
                {candidate}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={() => queuePrompt(qdnPermissionPromptFixture)}
          >
            Try qdnRequest
          </button>
          <button
            type="button"
            onClick={() => queuePrompt(qortalPermissionPromptFixture)}
          >
            Try qortalRequest
          </button>
          <button type="button" onClick={resetSecurityState}>
            Lock fixture
          </button>
        </div>
        <p role="status">
          <span>{host.platform} host</span>
          <span>{permissionState.grants.length} saved fixture grants</span>
          {status}
        </p>
      </header>
      <div className="home-v2-fixture-stage">
        <HomeV2Prototype
          snapshot={snapshot}
          productState={productState}
          permissionState={permissionState}
          layout={layout}
          theme={theme}
          onOpenApp={openApp}
          onActivateTab={(tabId) => {
            dispatchProduct({ type: 'activate-tab', tabId })
            setStatus('Synthetic app tab selected.')
          }}
          onCloseTab={closeTab}
          onNavigate={navigate}
          onResolvePermission={resolvePrompt}
          onSetNodeMode={setNodeMode}
          onAddAccount={() => {
            setAccountState('locked')
            setStatus('Synthetic account selected in a locked state.')
          }}
          onUnlockAccount={() => {
            setAccountState('unlocked')
            setStatus('Synthetic account unlocked. No credential was used.')
          }}
          onLockAccount={resetSecurityState}
          onToggleRememberUnlock={() =>
            setRememberUnlock((current) => !current)
          }
          onToggleLockOnExit={() => setLockOnExit((current) => !current)}
        />
      </div>
    </div>
  )
}
