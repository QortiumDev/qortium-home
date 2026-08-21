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

export type HomeV2SettingsSectionId = 'general' | 'appearance' | 'account'

export interface SettingsPageProps extends AppearanceSettingsPageProps {
  readonly appearance: HomeV2AppearanceSettings
  readonly account: AccountSessionSummary
  readonly newTabPreference: NewTabPreference
  readonly onSetNewTabPreference?: (preference: NewTabPreference) => void
}

function GeneralSettings({
  newTabPreference,
  onSetNewTabPreference,
}: Pick<SettingsPageProps, 'newTabPreference' | 'onSetNewTabPreference'>) {
  const [selectedKind, setSelectedKind] = useState(newTabPreference.kind)
  const [customAddress, setCustomAddress] = useState(
    newTabPreference.kind === 'custom' ? newTabPreference.address : '',
  )
  const [error, setError] = useState<string | null>(null)

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
    </section>
  )
}

export function SettingsPage(props: SettingsPageProps) {
  const [section, setSection] = useState<HomeV2SettingsSectionId>('general')
  const sections: ReadonlyArray<{
    readonly id: HomeV2SettingsSectionId
    readonly label: string
  }> = [
    { id: 'general', label: t('home2.settings.general') },
    { id: 'appearance', label: t('home2.settings.appearance') },
    ...(props.account.state === 'none'
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
              aria-current={section === candidate.id ? 'page' : undefined}
              key={candidate.id}
              onClick={() => setSection(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </nav>
        <div className="home-v2-settings-content">
          {section === 'general' ? (
            <GeneralSettings
              newTabPreference={props.newTabPreference}
              onSetNewTabPreference={props.onSetNewTabPreference}
            />
          ) : (
            <AppearanceSettingsPage
              {...props}
              section={section}
              showHeading={false}
            />
          )}
        </div>
      </div>
    </section>
  )
}
