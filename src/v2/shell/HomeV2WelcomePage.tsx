import { Capacitor } from '@capacitor/core'
import {
  ChevronLeft,
  ChevronRight,
  Globe2,
  LayoutDashboard,
  Palette,
  Server,
  UserRound,
} from 'lucide-react'
import { t } from '../../i18n'
import type {
  HomeV2AccountCatalogue,
  HomeV2Snapshot,
  HomeV2VaultState,
  NodeConnectionMode,
} from '../contracts'
import type { HomeV2MaintenanceControllers } from '../../home-v2-live/maintenance-controllers'
import type {
  HomeV2OnboardingState,
  HomeV2OnboardingStep,
} from '../../home-v2-live/onboarding-state'
import { CoreManagerCards, type HomeV2CoreManagement } from './CoreManagerCards'
import { CoreMaintenancePanel } from './CoreMaintenancePanel'
import { TransportMaintenancePanel } from './TransportMaintenancePanel'

export interface HomeV2WelcomePageProps {
  readonly accountCatalogue?: HomeV2AccountCatalogue
  readonly coreManagement?: HomeV2CoreManagement
  // Onboarding offers the same install/update controls Settings does, so it
  // takes the app's maintenance controllers by the same prop path rather than
  // building a second set of them for the length of the welcome step.
  readonly maintenance?: HomeV2MaintenanceControllers
  readonly onboarding: HomeV2OnboardingState
  readonly snapshot: HomeV2Snapshot
  readonly vaultState?: HomeV2VaultState
  readonly onAccountAction?: (action: 'create' | 'import' | 'private') => void
  readonly onComplete?: (destination: 'appearance' | 'dashboard') => void
  readonly onConfigureCustomNode?: () => void
  readonly onOpenNames?: () => void
  readonly onSetNodeMode?: (mode: NodeConnectionMode) => void
  readonly onSkip?: () => void
  readonly onStepChange?: (step: HomeV2OnboardingStep) => void
}

const STEP_KEYS = {
  account: 'welcome.step.account',
  finish: 'welcome.step.finish',
  node: 'welcome.step.node',
} as const

export function HomeV2WelcomePage(props: HomeV2WelcomePageProps) {
  const step = props.onboarding.currentStep
  const node = props.snapshot.nodes.qortium
  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  const accountSelected = props.snapshot.account.state !== 'none'

  const selectNode = (mode: NodeConnectionMode) => {
    if (mode === 'custom') {
      props.onConfigureCustomNode?.()
      return
    }
    props.onSetNodeMode?.(mode)
  }

  return (
    <section className="home-v2-welcome" aria-label={t('welcome.title')}>
      <header className="home-v2-welcome__header">
        <div>
          <span className="home-v2-eyebrow">home://welcome</span>
          <h1>{t(STEP_KEYS[step])}</h1>
          <p>{t('welcome.subtitle')}</p>
        </div>
        <button className="home-v2-link-button" type="button" onClick={props.onSkip}>
          {t('welcome.skip')}
        </button>
      </header>

      <ol className="home-v2-welcome__steps" aria-label={t('welcome.title')}>
        {(['node', 'account', 'finish'] as const).map((candidate, index) => (
          <li key={candidate} data-current={candidate === step ? 'true' : 'false'}>
            <span>{index + 1}</span>
            {t(STEP_KEYS[candidate])}
          </li>
        ))}
      </ol>

      <div className="home-v2-welcome__panel">
        {step === 'node' ? (
          <>
            <div className="home-v2-welcome__intro">
              <h2>{t('welcome.node.title')}</h2>
              <p>{t('welcome.node.subtitle')}</p>
            </div>
            <div className="home-v2-welcome__choices">
              {!isAndroid ? (
                <button
                  aria-pressed={node.mode === 'local'}
                  data-selected={node.mode === 'local' ? 'true' : 'false'}
                  type="button"
                  onClick={() => selectNode('local')}
                >
                  <Server aria-hidden="true" size={22} />
                  <span>
                    <strong>{t('welcome.node.local.title')}</strong>
                    <small>{t('welcome.node.local.description')}</small>
                    <em>{t('welcome.node.local.recommended')}</em>
                  </span>
                </button>
              ) : null}
              <button
                aria-pressed={node.mode === 'public'}
                data-selected={node.mode === 'public' ? 'true' : 'false'}
                type="button"
                onClick={() => selectNode('public')}
              >
                <Globe2 aria-hidden="true" size={22} />
                <span>
                  <strong>{t('welcome.node.network.title')}</strong>
                  <small>{t('welcome.node.network.description')}</small>
                </span>
              </button>
              <button
                aria-pressed={node.mode === 'custom'}
                data-selected={node.mode === 'custom' ? 'true' : 'false'}
                type="button"
                onClick={() => selectNode('custom')}
              >
                <Server aria-hidden="true" size={22} />
                <span>
                  <strong>{t('welcome.node.custom.title')}</strong>
                  <small>{t('welcome.node.custom.description')}</small>
                </span>
              </button>
            </div>
            {node.mode === 'public' ? (
              <p className="home-v2-welcome__notice">{t('welcome.node.networkNotice')}</p>
            ) : null}
            {!isAndroid && node.mode === 'local' && props.coreManagement?.available ? (
              <div className="home-v2-welcome__runtime">
                {/* Onboarding sets up the Qortium node; Settings > Runtime is
                    where Qortal Core is managed. Without this the welcome step
                    listed a Qortal Core card, which made no sense here. */}
                <CoreManagerCards
                  management={props.coreManagement}
                  networks={['qortium']}
                />
                <CoreMaintenancePanel
                  maintenance={props.maintenance?.core}
                  networks={['qortium']}
                />
                <TransportMaintenancePanel maintenance={props.maintenance?.transport} />
              </div>
            ) : null}
          </>
        ) : step === 'account' ? (
          <>
            <div className="home-v2-welcome__intro">
              <h2>{t('welcome.account.title')}</h2>
              <p>{t('welcome.account.subtitle')}</p>
            </div>
            <div className="home-v2-welcome__account-summary">
              <UserRound aria-hidden="true" size={28} />
              <div>
                <strong>
                  {accountSelected
                    ? props.snapshot.identity.displayLabel
                    : t('account.noAccountSelected')}
                </strong>
                <span>{t('welcome.account.walletOptions')}</span>
              </div>
            </div>
            <div className="home-v2-welcome__account-actions">
              <button disabled={!props.onAccountAction} type="button" onClick={() => props.onAccountAction?.('create')}>
                {t('home2.account.create')}
              </button>
              <button disabled={!props.onAccountAction} type="button" onClick={() => props.onAccountAction?.('import')}>
                {t('home2.account.import')}
              </button>
              <button disabled={!props.onAccountAction} type="button" onClick={() => props.onAccountAction?.('private')}>
                {t('home2.account.importPrivateKey')}
              </button>
            </div>
            <div className="home-v2-welcome__guidance">
              <p>{t('welcome.account.privateKeyNotice')}</p>
              <p>{t('welcome.account.multiAddress')}</p>
            </div>
            <div className="home-v2-welcome__optional">
              <div>
                <h3>{t('welcome.account.nameTitle')}</h3>
                <p>{t('welcome.account.nameDescription')}</p>
              </div>
              <button className="home-v2-link-button" type="button" onClick={props.onOpenNames}>
                {t('welcome.account.openNames')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="home-v2-welcome__intro">
              <h2>{t('welcome.finish.title')}</h2>
              <p>{t('welcome.finish.subtitle')}</p>
            </div>
            <div className="home-v2-welcome__finish-actions">
              <button type="button" onClick={() => props.onComplete?.('appearance')}>
                <Palette aria-hidden="true" size={24} />
                <span><strong>{t('welcome.finish.customize')}</strong><small>{t('welcome.finish.customizeDescription')}</small></span>
                <ChevronRight aria-hidden="true" size={20} />
              </button>
              <button type="button" onClick={() => props.onComplete?.('dashboard')}>
                <LayoutDashboard aria-hidden="true" size={24} />
                <span><strong>{t('welcome.finish.dashboard')}</strong><small>{t('welcome.finish.dashboardDescription')}</small></span>
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            </div>
          </>
        )}

        <footer className="home-v2-welcome__footer">
          {step === 'node' ? <span /> : (
            <button className="home-v2-secondary-button" type="button" onClick={() => props.onStepChange?.(step === 'finish' ? 'account' : 'node')}>
              <ChevronLeft aria-hidden="true" size={18} /> {t('welcome.back')}
            </button>
          )}
          {step === 'finish' ? null : (
            <button className="home-v2-primary-button" type="button" onClick={() => props.onStepChange?.(step === 'node' ? 'account' : 'finish')}>
              {t('welcome.next')} <ChevronRight aria-hidden="true" size={18} />
            </button>
          )}
        </footer>
      </div>
    </section>
  )
}
