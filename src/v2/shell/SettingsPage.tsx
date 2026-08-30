import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import type { HomeV2AppearanceSettings } from '../appearance'
import type {
  AccountSessionSummary,
  NetworkId,
  NodeConnectionMode,
  NodeSummary,
  VisibleAppIconLoader,
} from '../contracts'
import {
  validateCustomNewTabAddress,
  type NewTabPreference,
} from '../new-tab-preference'
import {
  AppearanceSettingsPage,
  type AppearanceSettingsPageProps,
} from './AppearanceSettingsPage'
import {
  CoreManagerCards,
  type HomeV2CoreManagement,
} from './CoreManagerCards'
import { HomeUpdateSettings } from './HomeUpdateSettings'
import { CoreMaintenancePanel } from './CoreMaintenancePanel'
import { QortalMaintenancePanel } from './QortalMaintenancePanel'
import { TransportMaintenancePanel } from './TransportMaintenancePanel'
import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import type { HomeV2MaintenanceControllers } from '../../home-v2-live/maintenance-controllers'
import type { HomeV2QdnSettingsManagement } from '../../home-v2-live/qdn-settings-client'
import { QdnAppsSettings } from './QdnAppsSettings'
import type { HomeV2NotificationPolicyState } from '../../home-v2-live/notification-policy-client'
import type {
  HomeV2WindowBehaviorChange,
  HomeV2WindowBehaviorState,
} from '../../home-v2-live/window-behavior-client'
import type { HomeV2OnChainCoreUpdates } from '../../home-v2-live/on-chain-core-update-controller'
import { OnChainCoreUpdateSettings } from './OnChainCoreUpdateSettings'

export type HomeV2SettingsSectionId =
  | 'general'
  | 'core'
  | 'appearance'
  | 'qdn-apps'
  | 'account'

export type HomeV2SettingsSectionTarget =
  | HomeV2SettingsSectionId
  | 'notifications'

// Notification controls moved into QDN Apps before Home 2.1. Keep the former
// target available to first-party callers without exposing URL routing.
export function resolveHomeV2SettingsSectionTarget(
  section: HomeV2SettingsSectionTarget,
): HomeV2SettingsSectionId {
  return section === 'notifications' ? 'qdn-apps' : section
}

type SettingsNetworkNodes = Readonly<
  Record<NetworkId, Pick<NodeSummary, 'lastEnabledMode' | 'mode'>>
>

const DEFAULT_SETTINGS_NODES: SettingsNetworkNodes = {
  qortium: { lastEnabledMode: 'local', mode: 'local' },
  qortal: { lastEnabledMode: 'local', mode: 'disabled' },
}

export interface SettingsPageProps extends AppearanceSettingsPageProps {
  readonly appearance: HomeV2AppearanceSettings
  readonly account: AccountSessionSummary
  readonly nodes?: SettingsNetworkNodes
  readonly newTabPreference: NewTabPreference
  readonly coreManagement?: HomeV2CoreManagement
  // The app's single set of maintenance controllers. Settings renders the full
  // surface of each one, so it takes the controllers themselves rather than the
  // dashboard tile's trimmed slice inside `coreManagement`.
  readonly maintenance?: HomeV2MaintenanceControllers
  readonly appUpdates?: HomeV2AppUpdates
  readonly onChainCoreUpdates?: HomeV2OnChainCoreUpdates
  readonly qdnAppsManagement?: HomeV2QdnSettingsManagement
  // Names the account a durable QDN app grant is bound to.
  readonly resolveAccountLabel?: (accountId: string) => string | null
  readonly notificationPolicy?: HomeV2NotificationPolicyState | null
  readonly windowBehavior?: HomeV2WindowBehaviorState | null
  readonly requestedSection?: HomeV2SettingsSectionTarget
  readonly onSetAppNotifications?: (enabled: boolean) => Promise<void>
  readonly onSetWindowBehavior?: (change: HomeV2WindowBehaviorChange) => Promise<void>
  // Carries the PRODUCT, not just a tag. It used to be a bare tagName, which
  // is why every release-notes link in Home 2 could only ever mean the Home
  // app: the product was hard-coded at the one call site that built the
  // target. Core releases have notes too, and the page already knows how to
  // fetch them.
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
  readonly onRestartWelcome?: () => void
  readonly onSetNewTabPreference?: (preference: NewTabPreference) => void
  readonly onSetNodeMode?: (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => void | Promise<void>
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
}

function NetworkAvailabilitySettings({
  nodes,
  onSetNodeMode,
}: Pick<SettingsPageProps, 'nodes' | 'onSetNodeMode'>) {
  const resolvedNodes = nodes ?? DEFAULT_SETTINGS_NODES
  const [busyNetwork, setBusyNetwork] = useState<NetworkId | null>(null)
  const [errorNetwork, setErrorNetwork] = useState<NetworkId | null>(null)

  const setEnabled = async (network: NetworkId, enabled: boolean) => {
    if (!onSetNodeMode || busyNetwork) return
    setBusyNetwork(network)
    setErrorNetwork(null)
    try {
      await onSetNodeMode(
        network,
        enabled ? resolvedNodes[network].lastEnabledMode : 'disabled',
      )
    } catch {
      setErrorNetwork(network)
    } finally {
      setBusyNetwork(null)
    }
  }

  return (
    <div className="home-v2-network-availability">
      <div className="home-v2-setting-group-heading">
        <strong>{t('connections.title')}</strong>
        <span>{t('home2.node.connectionMode')}</span>
      </div>
      {(['qortium', 'qortal'] as const).map((network) => {
        const enabled = resolvedNodes[network].mode !== 'disabled'
        const networkLabel = network === 'qortium' ? 'Qortium' : 'Qortal'
        return (
          <div
            className="home-v2-setting-row"
            data-home-v2-network-setting={network}
            key={network}
          >
            <div className="home-v2-setting-row__copy">
              <strong>{networkLabel}</strong>
              <span>
                {t('home2.node.connectionModeFor', { network: networkLabel })}
              </span>
              {busyNetwork === network ? (
                <span role="status">{t('common.saving')}</span>
              ) : errorNetwork === network ? (
                <span role="alert">{t('node.updateSettingsFailed')}</span>
              ) : null}
            </div>
            <div className="home-v2-setting-row__control">
              <label>
                <input
                  aria-label={t('home2.node.connectionModeFor', {
                    network: networkLabel,
                  })}
                  checked={enabled}
                  disabled={!onSetNodeMode || busyNetwork !== null}
                  role="switch"
                  type="checkbox"
                  onChange={(event) => void setEnabled(network, event.target.checked)}
                />
                {t(
                  enabled
                    ? 'home2.settings.enabled'
                    : 'home2.settings.disabled',
                )}
              </label>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * What closing the main window does.
 *
 * Both settings belong to the main process — it is what has to act on them, at
 * a moment when no renderer can be asked — so this group has no local copy: it
 * shows what the bridge reported and re-renders on what a change returns.
 */
function WindowBehaviorSettings({
  windowBehavior,
  onSetWindowBehavior,
}: Pick<SettingsPageProps, 'windowBehavior' | 'onSetWindowBehavior'>) {
  const [busySetting, setBusySetting] = useState<string | null>(null)
  const [failedSetting, setFailedSetting] = useState<string | null>(null)

  // Desktop only. Android and the browser preview have no window to close and
  // no tray to close it to, so the group is absent there rather than disabled.
  if (!windowBehavior) return null

  const rows = [
    {
      change: (checked: boolean): HomeV2WindowBehaviorChange => ({ closeToTray: checked }),
      enabled: windowBehavior.closeToTray,
      hint: t('home2.settings.closeToTrayDescription'),
      key: 'close-to-tray',
      label: t('home2.settings.closeToTray'),
    },
    {
      change: (checked: boolean): HomeV2WindowBehaviorChange => ({
        warnOnCloseWithMultipleTabs: checked,
      }),
      enabled: windowBehavior.warnOnCloseWithMultipleTabs,
      hint: t('home2.settings.warnOnCloseTabsDescription'),
      key: 'warn-on-close-tabs',
      label: t('home2.settings.warnOnCloseTabs'),
    },
  ]

  const apply = async (key: string, change: HomeV2WindowBehaviorChange) => {
    if (!onSetWindowBehavior || busySetting) return
    setBusySetting(key)
    setFailedSetting(null)
    try {
      await onSetWindowBehavior(change)
    } catch {
      setFailedSetting(key)
    } finally {
      setBusySetting(null)
    }
  }

  return (
    <div className="home-v2-window-behavior">
      <div className="home-v2-setting-group-heading">
        <strong>{t('home2.settings.window')}</strong>
        <span>{t('home2.settings.windowDescription')}</span>
      </div>
      {rows.map((row) => (
        <div
          className="home-v2-setting-row"
          data-home-v2-window-setting={row.key}
          key={row.key}
        >
          <div className="home-v2-setting-row__copy">
            <strong>{row.label}</strong>
            <span>{row.hint}</span>
            {busySetting === row.key ? (
              <span role="status">{t('common.saving')}</span>
            ) : failedSetting === row.key ? (
              <span role="alert">{t('common.error')}</span>
            ) : null}
          </div>
          <div className="home-v2-setting-row__control">
            <label>
              <input
                aria-label={row.label}
                checked={row.enabled}
                disabled={!onSetWindowBehavior || busySetting !== null}
                role="switch"
                type="checkbox"
                onChange={(event) =>
                  void apply(row.key, row.change(event.target.checked))
                }
              />
              {t(
                row.enabled ? 'home2.settings.enabled' : 'home2.settings.disabled',
              )}
            </label>
          </div>
        </div>
      ))}
    </div>
  )
}

function GeneralSettings({
  nodes,
  newTabPreference,
  notificationPolicy,
  onSetAppNotifications,
  onSetNewTabPreference,
  onRestartWelcome,
  onSetNodeMode,
  windowBehavior,
  onSetWindowBehavior,
}: Pick<
  SettingsPageProps,
  | 'newTabPreference'
  | 'nodes'
  | 'notificationPolicy'
  | 'onSetAppNotifications'
  | 'onSetNewTabPreference'
  | 'onRestartWelcome'
  | 'onSetNodeMode'
  | 'windowBehavior'
  | 'onSetWindowBehavior'
>) {
  const [selectedKind, setSelectedKind] = useState(newTabPreference.kind)
  const [customAddress, setCustomAddress] = useState(
    newTabPreference.kind === 'custom' ? newTabPreference.address : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [notificationMutationStatus, setNotificationMutationStatus] = useState<
    'idle' | 'saving' | 'error'
  >('idle')

  useEffect(() => {
    setSelectedKind(newTabPreference.kind)
    if (newTabPreference.kind === 'custom') {
      setCustomAddress(newTabPreference.address)
    }
    setError(null)
  }, [newTabPreference])

  const selectKind = (kind: NewTabPreference['kind']) => {
    setSelectedKind(kind)
    setError(null)
    if (kind === 'search' || kind === 'dashboard') {
      onSetNewTabPreference?.({ kind })
    }
  }

  const saveCustomAddress = () => {
    try {
      const address = validateCustomNewTabAddress(customAddress)
      onSetNewTabPreference?.({ address, kind: 'custom' })
      setCustomAddress(address)
      setError(null)
    } catch {
      setError(t('home2.settings.invalidNewTabAddress'))
    }
  }

  return (
    <section
      className="home-v2-settings-panel"
      aria-labelledby="general-settings-title"
    >
      <div className="home-v2-settings-panel__heading">
        <h2 id="general-settings-title">{t('home2.settings.general')}</h2>
        <p>{t('home2.settings.newTabDescription')}</p>
      </div>
      <NetworkAvailabilitySettings
        nodes={nodes}
        onSetNodeMode={onSetNodeMode}
      />
      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>{t('home2.settings.newTab')}</strong>
          <span>{t('home2.settings.newTabHelp')}</span>
        </div>
        <div className="home-v2-setting-row__control home-v2-new-tab-setting">
          <select
            aria-label={t('home2.settings.newTabOpens')}
            disabled={!onSetNewTabPreference}
            value={selectedKind}
            onChange={(event) =>
              selectKind(event.target.value as NewTabPreference['kind'])
            }
          >
            <option value="search">{t('home2.settings.searchPage')}</option>
            <option value="dashboard">{t('common.dashboard')}</option>
            <option value="custom">{t('home2.settings.customAddress')}</option>
          </select>
          {selectedKind === 'custom' ? (
            <div className="home-v2-new-tab-custom-address">
              <input
                aria-label={t('home2.settings.customAddressLabel')}
                autoComplete="off"
                disabled={!onSetNewTabPreference}
                placeholder="qdn://APP/Help or home://dashboard"
                spellCheck={false}
                value={customAddress}
                onChange={(event) => {
                  setCustomAddress(event.target.value)
                  setError(null)
                }}
              />
              <button
                type="button"
                className="home-v2-primary-button"
                disabled={!onSetNewTabPreference || !customAddress.trim()}
                onClick={saveCustomAddress}
              >
                {t('common.save')}
              </button>
            </div>
          ) : null}
          {error ? <span role="alert">{error}</span> : null}
        </div>
      </div>
      <div
        className="home-v2-setting-row"
        data-home-v2-notification-policy={notificationPolicy?.status ?? 'loading'}
      >
        <div className="home-v2-setting-row__copy">
          <strong>{t('display.appNotificationsLabel')}</strong>
          <span>{t('display.appNotificationsHint')}</span>
          {notificationPolicy?.status === 'corrupt' ? (
            <span role="alert">{t('notifications.corrupt')}</span>
          ) : notificationPolicy?.status === 'unavailable' ? (
            <span role="alert">{t('notifications.unavailable')}</span>
          ) : notificationMutationStatus === 'error' ? (
            <span role="alert">{t('common.error')}</span>
          ) : notificationMutationStatus === 'saving' ? (
            <span role="status">{t('common.saving')}</span>
          ) : notificationPolicy ? null : (
            <span role="status">{t('common.loading')}</span>
          )}
        </div>
        <div className="home-v2-setting-row__control">
          <label>
            <input
              aria-label={t('display.appNotificationsLabel')}
              checked={notificationPolicy?.enabled ?? false}
              disabled={
                notificationPolicy?.status !== 'available' ||
                !onSetAppNotifications ||
                notificationMutationStatus === 'saving'
              }
              role="switch"
              type="checkbox"
              onChange={async (event) => {
                if (!onSetAppNotifications) return
                setNotificationMutationStatus('saving')
                try {
                  await onSetAppNotifications(event.target.checked)
                  setNotificationMutationStatus('idle')
                } catch {
                  setNotificationMutationStatus('error')
                }
              }}
            />
            {t(
              notificationPolicy?.enabled
                ? 'display.appNotificationsOn'
                : 'display.appNotificationsOff',
            )}
          </label>
        </div>
      </div>
      <WindowBehaviorSettings
        windowBehavior={windowBehavior}
        onSetWindowBehavior={onSetWindowBehavior}
      />
      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>{t('welcome.restart')}</strong>
          <span>{t('welcome.restartDescription')}</span>
        </div>
        <div className="home-v2-setting-row__control">
          <button
            className="home-v2-link-button"
            disabled={!onRestartWelcome}
            type="button"
            onClick={onRestartWelcome}
          >
            {t('welcome.restart')}
          </button>
        </div>
      </div>
    </section>
  )
}

export function SettingsPage(props: SettingsPageProps) {
  const nodes = props.nodes ?? DEFAULT_SETTINGS_NODES
  const enabledNetworks = (['qortium', 'qortal'] as const).filter(
    (network) => nodes[network].mode !== 'disabled',
  )
  const qortiumEnabled = enabledNetworks.includes('qortium')
  const networkCoreAvailable =
    !!props.coreManagement?.available && enabledNetworks.length > 0
  const coreAvailable =
    networkCoreAvailable ||
    !!props.appUpdates?.available ||
    (qortiumEnabled && !!props.onChainCoreUpdates?.available)
  const qdnAppsAvailable =
    qortiumEnabled &&
    !!props.qdnAppsManagement?.available &&
    !!props.qdnAppsManagement.client
  const accountAvailable = props.account.state !== 'none'
  const resolvedRequestedSection = resolveHomeV2SettingsSectionTarget(
    props.requestedSection ?? 'general',
  )
  const requestedSection =
    (resolvedRequestedSection === 'core' && !coreAvailable) ||
    (resolvedRequestedSection === 'qdn-apps' && !qdnAppsAvailable) ||
    (resolvedRequestedSection === 'account' && !accountAvailable)
      ? 'general'
      : resolvedRequestedSection
  const [section, setSection] = useState<HomeV2SettingsSectionId>(
    requestedSection,
  )
  useEffect(() => setSection(requestedSection), [requestedSection])
  const sectionAvailable = (candidate: HomeV2SettingsSectionId) =>
    (candidate !== 'core' || coreAvailable) &&
    (candidate !== 'qdn-apps' || qdnAppsAvailable) &&
    (candidate !== 'account' || accountAvailable)
  const activeSection = sectionAvailable(section) ? section : 'general'
  useEffect(() => {
    if (!sectionAvailable(section)) setSection('general')
  }, [accountAvailable, coreAvailable, qdnAppsAvailable, section])
  const sections: ReadonlyArray<{
    readonly id: HomeV2SettingsSectionId
    readonly label: string
  }> = [
    { id: 'general', label: t('home2.settings.general') },
    ...(coreAvailable
      ? [{ id: 'core' as const, label: t('core.runtimeLabel') }]
      : []),
    { id: 'appearance', label: t('home2.settings.appearance') },
    ...(qdnAppsAvailable
      ? [{ id: 'qdn-apps' as const, label: t('qdnApps.sectionTitle') }]
      : []),
    ...(!accountAvailable
      ? []
      : [{ id: 'account' as const, label: t('account.menuLabel') }]),
  ]

  return (
    <section className="home-v2-settings-shell">
      <header className="home-v2-page-heading">
        <h1>{t('common.settings')}</h1>
      </header>
      <div className="home-v2-settings-layout">
        <nav
          className="home-v2-settings-nav"
          aria-label={t('home2.settings.sections')}
        >
          {sections.map((candidate) => (
            <button
              type="button"
              aria-current={activeSection === candidate.id ? 'page' : undefined}
              key={candidate.id}
              onClick={() => setSection(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </nav>
        <div className="home-v2-settings-content">
          {activeSection === 'general' ? (
            <GeneralSettings
              nodes={nodes}
              newTabPreference={props.newTabPreference}
              notificationPolicy={props.notificationPolicy}
              onSetAppNotifications={props.onSetAppNotifications}
              onSetNewTabPreference={props.onSetNewTabPreference}
              onRestartWelcome={props.onRestartWelcome}
              onSetNodeMode={props.onSetNodeMode}
              windowBehavior={props.windowBehavior}
              onSetWindowBehavior={props.onSetWindowBehavior}
            />
          ) : activeSection === 'core' &&
            (props.coreManagement?.available ||
              props.appUpdates?.available ||
              props.onChainCoreUpdates?.available) ? (
            <div className="home-v2-runtime-settings">
              {/* One section PER NETWORK, each complete.
                *
                * These used to share a single "Core management" section: both
                * networks' cards, then both networks' maintenance, then the
                * Qortium-ONLY transport panel, and then Qortal's panel after
                * it. Read down the page, Qortal's controls appeared underneath
                * Qortium-only controls, inside what looked like one Qortium
                * block -- which is exactly what the tester reported.
                *
                * Splitting by network means each heading owns everything for
                * that network and nothing for the other, so there is no order
                * in which one appears to be nested in the other. */}
              {networkCoreAvailable && props.coreManagement && qortiumEnabled ? (
                <section
                  className="home-v2-settings-panel home-v2-core-settings"
                  aria-labelledby="core-settings-title"
                >
                  <div className="home-v2-settings-panel__heading">
                    <h2 id="core-settings-title">{t('home2.core.qortiumTitle')}</h2>
                    <p>{t('home2.core.settingsDescription')}</p>
                  </div>
                  <CoreManagerCards
                    management={props.coreManagement}
                    networks={['qortium']}
                  />
                  <CoreMaintenancePanel
                    onOpenReleaseNotes={props.onOpenReleaseNotes}
                    maintenance={props.maintenance?.core}
                    networks={['qortium']}
                  />
                  <TransportMaintenancePanel maintenance={props.maintenance?.transport} />
                </section>
              ) : null}
              {networkCoreAvailable && props.coreManagement &&
                enabledNetworks.includes('qortal') ? (
                <section
                  className="home-v2-settings-panel home-v2-core-settings"
                  aria-labelledby="qortal-core-settings-title"
                >
                  <div className="home-v2-settings-panel__heading">
                    <h2 id="qortal-core-settings-title">{t('home2.core.qortalTitle')}</h2>
                    <p>{t('home2.core.settingsDescription')}</p>
                  </div>
                  <CoreManagerCards
                    management={props.coreManagement}
                    networks={['qortal']}
                  />
                  <CoreMaintenancePanel
                    onOpenReleaseNotes={props.onOpenReleaseNotes}
                    maintenance={props.maintenance?.core}
                    networks={['qortal']}
                  />
                  <QortalMaintenancePanel maintenance={props.maintenance?.qortal} />
                </section>
              ) : null}
              {qortiumEnabled && props.onChainCoreUpdates?.available ? (
                <OnChainCoreUpdateSettings updates={props.onChainCoreUpdates} />
              ) : null}
              {props.appUpdates?.available ? (
                <HomeUpdateSettings
                  updates={props.appUpdates}
                  onOpenReleaseNotes={props.onOpenReleaseNotes}
                />
              ) : null}
            </div>
          ) : activeSection === 'qdn-apps' &&
            props.qdnAppsManagement?.available &&
            props.qdnAppsManagement.client ? (
            <QdnAppsSettings
              client={props.qdnAppsManagement.client}
              loadVisibleAppIcon={props.loadVisibleAppIcon}
              resolveAccountLabel={props.resolveAccountLabel}
            />
          ) : activeSection === 'appearance' || activeSection === 'account' ? (
            <AppearanceSettingsPage
              {...props}
              section={activeSection}
              showHeading={false}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}
