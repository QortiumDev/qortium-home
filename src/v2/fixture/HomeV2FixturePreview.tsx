import { useMemo, useReducer, useRef, useState } from 'react'
import type { AppDescriptor, NetworkId, TabId } from '../contracts'
import {
  createPermissionState,
  invalidatePermissionState,
  queuePermissionPrompt,
  resolvePermissionPrompt,
  type PermissionDecision,
  type PermissionPrompt,
  type PermissionRequestId,
} from '../bridge-permissions'
import { reduceProductState } from '../product-model'
import { HomeV2Prototype, type HomeV2Layout } from '../shell/HomeV2Prototype'
import {
  createAndroidFixtureHost,
  createElectronFixtureHost,
  type FixturePlatform,
} from '../test-kit/MockHost'
import {
  fixtureOperationContext,
  homeV2Fixture,
  homeV2ProductFixture,
  qdnPermissionPromptFixture,
  qortalPermissionPromptFixture,
} from '../test-kit/fixtures'
import './fixture-preview.css'

type PreviewPlatform = Exclude<FixturePlatform, 'generic'>

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
    homeV2ProductFixture,
  )
  const [permissionState, setPermissionState] = useState(createPermissionState)
  const [layout, setLayout] = useState<HomeV2Layout>('desktop')
  const [platform, setPlatform] = useState<PreviewPlatform>('electron')
  const [status, setStatus] = useState('Fixture ready. No live services are connected.')
  const sequence = useRef(0)
  const host = useMemo(
    () =>
      platform === 'electron'
        ? createElectronFixtureHost(homeV2Fixture)
        : createAndroidFixtureHost(homeV2Fixture),
    [platform],
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
          snapshot={homeV2Fixture}
          productState={productState}
          permissionState={permissionState}
          layout={layout}
          onOpenApp={openApp}
          onActivateTab={(tabId) => {
            dispatchProduct({ type: 'activate-tab', tabId })
            setStatus('Synthetic app tab selected.')
          }}
          onCloseTab={closeTab}
          onNavigate={navigate}
          onResolvePermission={resolvePrompt}
        />
      </div>
    </div>
  )
}
