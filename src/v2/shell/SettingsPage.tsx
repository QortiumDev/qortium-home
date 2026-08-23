import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import type { HomeV2AppearanceSettings } from '../appearance'
import type { AccountSessionSummary } from '../contracts'
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
import type { HomeV2QdnSettingsManagement } from '../../home-v2-live/qdn-settings-client'
import { QdnAppsSettings } from './QdnAppsSettings'
import type { HomeV2NotificationPolicyState } from '../../home-v2-live/notification-policy-client'
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

export interface SettingsPageProps extends AppearanceSettingsPageProps {
  readonly appearance: HomeV2AppearanceSettings
  readonly account: AccountSessionSummary
  readonly newTabPreference: NewTabPreference
  readonly coreManagement?: HomeV2CoreManagement
  readonly appUpdates?: HomeV2AppUpdates
  readonly onChainCoreUpdates?: HomeV2OnChainCoreUpdates
  readonly qdnAppsManagement?: HomeV2QdnSettingsManagement
  readonly notificationPolicy?: HomeV2NotificationPolicyState | null
  readonly requestedSection?: HomeV2SettingsSectionTarget
  readonly onSetAppNotifications?: (enabled: boolean) => Promise<void>
  readonly onOpenReleaseNotes?: (tagName: string) => void
  readonly onRestartWelcome?: () => void
  readonly onSetNewTabPreference?: (preference: NewTabPreference) => void
}

function GeneralSettings({
  newTabPreference,
  notificationPolicy,
  onSetAppNotifications,
  onSetNewTabPreference,
  onRestartWelcome,
}: Pick<
  SettingsPageProps,
  | 'newTabPreference'
  | 'notificationPolicy'
  | 'onSetAppNotifications'
  | 'onSetNewTabPreference'
  | 'onRestartWelcome'
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
  const coreAvailable =
    !!props.coreManagement?.available ||
    !!props.appUpdates?.available ||
    !!props.onChainCoreUpdates?.available
  const qdnAppsAvailable =
    !!props.qdnAppsManagement?.available && !!props.qdnAppsManagement.client
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
              newTabPreference={props.newTabPreference}
              notificationPolicy={props.notificationPolicy}
              onSetAppNotifications={props.onSetAppNotifications}
              onSetNewTabPreference={props.onSetNewTabPreference}
              onRestartWelcome={props.onRestartWelcome}
            />
          ) : activeSection === 'core' &&
            (props.coreManagement?.available ||
              props.appUpdates?.available ||
              props.onChainCoreUpdates?.available) ? (
            <div className="home-v2-runtime-settings">
              {props.coreManagement?.available ? (
                <section
                  className="home-v2-settings-panel home-v2-core-settings"
                  aria-labelledby="core-settings-title"
                >
                  <div className="home-v2-settings-panel__heading">
                    <h2 id="core-settings-title">{t('home2.core.title')}</h2>
                    <p>{t('home2.core.settingsDescription')}</p>
                  </div>
                  <CoreManagerCards management={props.coreManagement} />
                  <CoreMaintenancePanel management={props.coreManagement} />
                  <TransportMaintenancePanel management={props.coreManagement} />
                  <QortalMaintenancePanel management={props.coreManagement} />
                </section>
              ) : null}
              {props.onChainCoreUpdates?.available ? (
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
            <QdnAppsSettings client={props.qdnAppsManagement.client} />
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
