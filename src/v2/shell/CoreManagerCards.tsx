import { useState } from 'react'
import type {
  HomeV2CoreActionCode,
  HomeV2CoreManagerBusyActions,
  HomeV2CoreManagerLastActions,
  HomeV2CoreManagerStatus,
  HomeV2CoreManagerStatuses,
} from '../../home-v2-live/node-core-controller'
import { t, type TranslationKey } from '../../i18n'
import type { NetworkId } from '../contracts'
import { NetworkBadge, networkLabels } from './NetworkBadge'

export interface HomeV2CoreManagement {
  readonly available: boolean
  readonly busyActions: HomeV2CoreManagerBusyActions
  readonly lastActions: HomeV2CoreManagerLastActions
  readonly statuses: HomeV2CoreManagerStatuses
  readonly onAction?: (network: NetworkId, action: 'start' | 'stop') => void
  readonly onRefresh?: () => void
}

const actionCodeMessageKeys = {
  'action-not-allowed': 'home2.core.action.notAllowed',
  'action-unconfirmed': 'home2.core.action.unconfirmed',
  'api-key-unavailable': 'home2.core.action.authUnavailable',
  'install-missing': 'common.notInstalled',
  'install-unknown': 'home2.core.installUnknown',
  'java-unavailable': 'core.javaMissing',
  'manager-unavailable': 'common.unavailable',
  'operation-blocked': 'home2.core.action.blocked',
  'operation-failed': 'core.actionFailed',
  'operation-in-progress': 'home2.core.action.inProgress',
  'ownership-unproven': 'home2.core.action.ownershipUnproven',
  'runtime-blocked': 'core.statusRuntimeBlocked',
  'runtime-unknown': 'home2.core.runtimeUnknown',
  'status-unavailable': 'home2.core.statusUnavailable',
  'target-changed': 'home2.core.action.targetChanged',
  'unsupported-platform': 'common.unavailable',
} satisfies Record<HomeV2CoreActionCode, TranslationKey>

const issueMessageKeys = {
  'install-missing': 'common.notInstalled',
  'install-unknown': 'home2.core.installUnknown',
  'manager-unavailable': 'common.unavailable',
  'runtime-blocked': 'core.statusRuntimeBlocked',
  'runtime-unknown': 'home2.core.runtimeUnknown',
  'status-unavailable': 'home2.core.statusUnavailable',
  'unsupported-platform': 'common.unavailable',
} satisfies Record<
  NonNullable<HomeV2CoreManagerStatus['issue']>,
  TranslationKey
>

function coreStatusText(status: HomeV2CoreManagerStatus) {
  const label = `${networkLabels[status.network]} Core`
  if (status.runtime === 'running') {
    if (status.control === 'full') {
      return t('home2.core.managedByHome', { network: networkLabels[status.network] })
    }
    if (status.control === 'api-only') {
      return t('home2.core.apiControl', { network: networkLabels[status.network] })
    }
    return t('home2.core.controlsUnavailable', {
      network: networkLabels[status.network],
    })
  }
  if (status.runtime === 'stopped') {
    if (status.install === 'adopted') {
      return t('home2.core.adoptedStopped', {
        network: networkLabels[status.network],
      })
    }
    if (status.install === 'home-managed') {
      return t('home2.core.installedStopped', {
        network: networkLabels[status.network],
      })
    }
    return `${label} stopped`
  }
  if (status.control === 'observe-only') {
    return t('home2.core.statusAvailableControlsUnavailable')
  }
  return t('common.unavailable')
}

function actionNotice(lastAction: HomeV2CoreManagerLastActions[NetworkId]) {
  if (!lastAction) return null
  if (lastAction.failed || !lastAction.result) return t('core.actionFailed')
  const { action, result } = lastAction
  let message: string
  if (result.outcome !== 'completed') {
    message = result.code
      ? t(actionCodeMessageKeys[result.code])
      : t('core.actionFailed')
  } else {
    const expectedRuntime = action === 'start' ? 'running' : 'stopped'
    message = result.status.runtime !== expectedRuntime
      ? t('home2.core.action.completedCurrentStatus', {
          status: result.status.runtime,
        })
      : action === 'start'
        ? t('core.startCompleted')
        : t('core.stopCompleted')
  }
  return result.warning === 'operation-lock-release-failed'
    ? `${message} ${t('home2.core.action.lockReleaseFailed')}`
    : message
}

function CoreManagerCard({
  management,
  network,
}: {
  readonly management: HomeV2CoreManagement
  readonly network: NetworkId
}) {
  const [confirmApiStop, setConfirmApiStop] = useState(false)
  const status = management.statuses[network]
  const busyAction = management.busyActions[network]
  const busy = busyAction !== null
  const startBusy = Object.values(management.busyActions).includes('start')
  const lastAction = management.lastActions[network]
  const notice = actionNotice(lastAction)
  const statusText = coreStatusText(status)
  const issueText = status.issue ? t(issueMessageKeys[status.issue]) : null
  const invokeAction = (action: 'start' | 'stop') => {
    setConfirmApiStop(false)
    management.onAction?.(network, action)
  }
  const requestStop = () => {
    if (status.control === 'api-only') {
      setConfirmApiStop(true)
      return
    }
    invokeAction('stop')
  }

  return (
    <article
      className="home-v2-core-card"
      data-network={network}
      data-runtime={status.runtime}
      data-control={status.control}
    >
      <header>
        <div>
          <NetworkBadge network={network} />
          <h3>{networkLabels[network]} Core</h3>
        </div>
        <span className="home-v2-core-runtime" data-runtime={status.runtime}>
          <span className="home-v2-status-dot" aria-hidden="true" />
          {status.runtime === 'running'
            ? t('core.runtimeRunning')
            : status.runtime === 'stopped'
              ? t('common.stopped')
              : t('common.unavailable')}
        </span>
      </header>
      <div className="home-v2-core-card__body">
        <strong>{statusText}</strong>
        {issueText && issueText !== statusText ? <small>{issueText}</small> : null}
        {notice ? (
          <span className="home-v2-core-notice" role="status">
            {notice}
          </span>
        ) : null}
      </div>
      {confirmApiStop ? (
        <div className="home-v2-core-confirm" role="alertdialog">
          <strong>
            {t('home2.core.confirmExternalTitle', {
              network: networkLabels[network],
            })}
          </strong>
          <p>
            {t('home2.core.confirmExternalBody')}
          </p>
          <div>
            <button
              autoFocus
              type="button"
              onClick={() => setConfirmApiStop(false)}
            >
              {t('common.cancel')}
            </button>
            <button type="button" onClick={() => invokeAction('stop')}>
              {t('core.stopCore')}
            </button>
          </div>
        </div>
      ) : null}
      <footer className="home-v2-core-card__actions">
        <button
          type="button"
          className="home-v2-link-button"
          disabled={busy}
          onClick={() => management.onRefresh?.()}
        >
          {t('common.refresh')}
        </button>
        {status.capabilities.canStart ? (
          <button
            type="button"
            className="home-v2-primary-button"
            disabled={busy || startBusy}
            onClick={() => invokeAction('start')}
          >
            {busyAction === 'start' ? t('common.starting') : t('core.startCore')}
          </button>
        ) : status.capabilities.canStop ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            disabled={busy}
            onClick={requestStop}
          >
            {busyAction === 'stop' ? t('common.stopping') : t('core.stopCore')}
          </button>
        ) : null}
      </footer>
    </article>
  )
}

export function CoreManagerCards({
  management,
  networks = ['qortium', 'qortal'],
}: {
  readonly management?: HomeV2CoreManagement
  readonly networks?: readonly NetworkId[]
}) {
  if (!management?.available || networks.length === 0) return null
  return (
    <div className="home-v2-core-grid" data-home-v2-core-management="desktop">
      {networks.map((network) => (
        <CoreManagerCard
          key={network}
          management={management}
          network={network}
        />
      ))}
    </div>
  )
}
