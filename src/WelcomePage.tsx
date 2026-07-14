import { Capacitor } from '@capacitor/core';
import {
  ChevronLeft,
  ChevronRight,
  Globe2,
  LayoutDashboard,
  Palette,
  Rocket,
  Server,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AccountsPanel } from './AccountsPanel';
import { CoreManagerPanel } from './CoreManagerPanel';
import type { CoreManagerState } from './coreManagerState';
import { t } from './i18n';
import { useI2pConnections } from './i2pState';
import { useI2pdManager } from './i2pdManagerState';
import { NodeConnectionSettings } from './NodeConnection';
import type { OnChainCoreUpdateController } from './onChainCoreUpdateState';
import { I2pRouterButton, TransportModeSelect } from './TransportControls';
import type { WelcomeState, WelcomeStep } from './welcomeState';

type WelcomePageProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  connectionRefreshEpoch: number;
  coreManager: CoreManagerState;
  isLoadingAccounts: boolean;
  nodeEpoch: number;
  nodeSettings: QortiumNodeSettings;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onComplete: (destination: 'apps' | 'dashboard' | 'display') => Promise<void>;
  onOpenNamesApp: () => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
  onSelectedAccountChange: (accountId: string | null) => void;
  onSkip: () => Promise<void>;
  onStepChange: (step: WelcomeStep) => Promise<void>;
  onChainCoreUpdate: OnChainCoreUpdateController;
  selectedAccountId: string | null;
  state: WelcomeState;
};

type NodeChoice = QortiumNodeSettingsMode;

const WELCOME_STEP_KEYS = {
  account: 'welcome.step.account',
  finish: 'welcome.step.finish',
  node: 'welcome.step.node',
} as const;

function formatError(error: unknown) {
  return error instanceof Error ? error.message : t('welcome.error');
}

export function WelcomePage({
  accountsError,
  accountsState,
  connectionRefreshEpoch,
  coreManager,
  isLoadingAccounts,
  nodeEpoch,
  nodeSettings,
  onAccountsStateChange,
  onComplete,
  onOpenNamesApp,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
  onSelectedAccountChange,
  onSkip,
  onStepChange,
  onChainCoreUpdate,
  selectedAccountId,
  state,
}: WelcomePageProps) {
  const isNativePlatform = Capacitor.isNativePlatform();
  const [step, setStep] = useState<WelcomeStep>(state.currentStep);
  const [nodeChoice, setNodeChoice] = useState<NodeChoice>(
    isNativePlatform && nodeSettings.mode === 'local' ? 'network' : nodeSettings.mode,
  );
  const [isCoreManagerExpanded, setIsCoreManagerExpanded] = useState(true);
  const [isSavingNodeChoice, setIsSavingNodeChoice] = useState(false);
  const [isSavingWelcome, setIsSavingWelcome] = useState(false);
  const [error, setError] = useState('');
  const isManagedNode = nodeSettings.mode === 'local';
  const canManageCustomTransports = nodeSettings.mode === 'custom' && nodeSettings.apiKey.trim().length > 0;
  const canManageTransports = isManagedNode || canManageCustomTransports;
  const connections = useI2pConnections(nodeSettings.nodeApiUrl, connectionRefreshEpoch);
  const i2pdManager = useI2pdManager(isManagedNode);

  useEffect(() => {
    setStep(state.currentStep);
  }, [state.currentStep]);

  async function changeStep(nextStep: WelcomeStep) {
    setError('');
    setIsSavingWelcome(true);

    try {
      await onStepChange(nextStep);
      setStep(nextStep);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsSavingWelcome(false);
    }
  }

  async function chooseNode(nextChoice: NodeChoice) {
    setError('');
    setNodeChoice(nextChoice);

    if (nextChoice === 'custom') {
      return;
    }

    setIsSavingNodeChoice(true);
    try {
      const settings = await onSaveNodeSettings({ mode: nextChoice });
      onResolvedNodeApiUrl(settings.nodeApiUrl);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsSavingNodeChoice(false);
    }
  }

  async function skipWelcome() {
    setError('');
    setIsSavingWelcome(true);

    try {
      await onSkip();
    } catch (caught) {
      setError(formatError(caught));
      setIsSavingWelcome(false);
    }
  }

  async function completeWelcome(destination: 'apps' | 'dashboard' | 'display') {
    setError('');
    setIsSavingWelcome(true);

    try {
      await onComplete(destination);
    } catch (caught) {
      setError(formatError(caught));
      setIsSavingWelcome(false);
    }
  }

  return (
    <div className="welcome-page">
      <header className="welcome-page__header">
        <div>
          <p className="welcome-page__eyebrow">{t('welcome.title')}</p>
          <h1>{t(WELCOME_STEP_KEYS[step])}</h1>
          <p className="welcome-page__subtitle">{t('welcome.subtitle')}</p>
        </div>
        <button className="button button--secondary" disabled={isSavingWelcome} type="button" onClick={() => void skipWelcome()}>
          {t('welcome.skip')}
        </button>
      </header>

      <ol className="welcome-page__steps" aria-label={t('welcome.title')}>
        {(['node', 'account', 'finish'] as const).map((item, index) => (
          <li className={item === step ? 'welcome-page__step welcome-page__step--current' : 'welcome-page__step'} key={item}>
            <span>{index + 1}</span>
            {t(WELCOME_STEP_KEYS[item])}
          </li>
        ))}
      </ol>

      <section className="welcome-page__panel" aria-live="polite">
        {step === 'node' ? (
          <>
            <div className="welcome-page__intro">
              <h2>{t('welcome.node.title')}</h2>
              <p>{t('welcome.node.subtitle')}</p>
            </div>

            <div className="welcome-node-choices">
              {!isNativePlatform ? (
                <button
                  aria-pressed={nodeChoice === 'local'}
                  className={`welcome-node-choice${nodeChoice === 'local' ? ' welcome-node-choice--selected' : ''}`}
                  disabled={isSavingNodeChoice}
                  type="button"
                  onClick={() => void chooseNode('local')}
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
                aria-pressed={nodeChoice === 'network'}
                className={`welcome-node-choice${nodeChoice === 'network' ? ' welcome-node-choice--selected' : ''}`}
                disabled={isSavingNodeChoice}
                type="button"
                onClick={() => void chooseNode('network')}
              >
                <Globe2 aria-hidden="true" size={22} />
                <span>
                  <strong>{t('welcome.node.network.title')}</strong>
                  <small>{t('welcome.node.network.description')}</small>
                </span>
              </button>
              <button
                aria-pressed={nodeChoice === 'custom'}
                className={`welcome-node-choice${nodeChoice === 'custom' ? ' welcome-node-choice--selected' : ''}`}
                disabled={isSavingNodeChoice}
                type="button"
                onClick={() => void chooseNode('custom')}
              >
                <Server aria-hidden="true" size={22} />
                <span>
                  <strong>{t('welcome.node.custom.title')}</strong>
                  <small>{t('welcome.node.custom.description')}</small>
                </span>
              </button>
            </div>

            {nodeChoice === 'network' ? <p className="welcome-page__notice">{t('welcome.node.networkNotice')}</p> : null}

            {nodeChoice === 'custom' ? (
              <NodeConnectionSettings
                initialMode="custom"
                nodeSettings={nodeSettings}
                onResolvedNodeApiUrl={onResolvedNodeApiUrl}
                onSaveNodeSettings={onSaveNodeSettings}
              />
            ) : null}

            {!isNativePlatform && nodeChoice === 'local' ? (
              <CoreManagerPanel
                connectionRefreshEpoch={connectionRefreshEpoch}
                coreManager={coreManager}
                isExpanded={isCoreManagerExpanded}
                nodeSettings={nodeSettings}
                onChainCoreUpdate={onChainCoreUpdate}
                onExpandedChange={setIsCoreManagerExpanded}
                onOpenReleaseNotes={() => undefined}
                onResolvedNodeApiUrl={onResolvedNodeApiUrl}
                onSaveNodeSettings={onSaveNodeSettings}
                showNodeConnection={false}
                showTransportControls={false}
              />
            ) : null}

            {canManageTransports ? (
              <div className="welcome-transport">
                <h3>{t('welcome.node.transportTitle')}</h3>
                {isManagedNode ? (
                  <I2pRouterButton
                    connections={connections}
                    isManagedNode
                    manager={i2pdManager}
                    showStatus
                  />
                ) : (
                  <p className="welcome-page__hint">{t('welcome.node.customTransportHint')}</p>
                )}
                <TransportModeSelect
                  connections={connections}
                  isManagedNode={isManagedNode}
                  label={t('connections.modeLabel')}
                  manager={i2pdManager}
                  showWarning
                />
              </div>
            ) : null}
          </>
        ) : step === 'account' ? (
          <>
            <div className="welcome-page__intro">
              <h2>{t('welcome.account.title')}</h2>
              <p>{t('welcome.account.subtitle')}</p>
            </div>
            <div className="welcome-account__guidance">
              <p>{t('welcome.account.walletOptions')}</p>
              <p>{t('welcome.account.privateKeyNotice')}</p>
              <p>{t('welcome.account.multiAddress')}</p>
            </div>
            <AccountsPanel
              accountsError={accountsError}
              accountsState={accountsState}
              isLoadingAccounts={isLoadingAccounts}
              nodeApiUrl={nodeSettings.nodeApiUrl}
              nodeEpoch={nodeEpoch}
              selectedAccountId={selectedAccountId}
              onAccountsStateChange={onAccountsStateChange}
              onSelectedAccountChange={onSelectedAccountChange}
            />
            <div className="welcome-page__optional">
              <div>
                <h3>{t('welcome.account.nameTitle')}</h3>
                <p>{t('welcome.account.nameDescription')}</p>
              </div>
              <button className="button button--secondary" type="button" onClick={onOpenNamesApp}>
                {t('welcome.account.openNames')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="welcome-page__intro">
              <h2>{t('welcome.finish.title')}</h2>
              <p>{t('welcome.finish.subtitle')}</p>
            </div>
            <div className="welcome-finish-actions">
              <button className="welcome-finish-action" disabled={isSavingWelcome} type="button" onClick={() => void completeWelcome('display')}>
                <Palette aria-hidden="true" size={24} />
                <span>
                  <strong>{t('welcome.finish.customize')}</strong>
                  <small>{t('welcome.finish.customizeDescription')}</small>
                </span>
                <ChevronRight aria-hidden="true" size={20} />
              </button>
              <button className="welcome-finish-action" disabled={isSavingWelcome} type="button" onClick={() => void completeWelcome('apps')}>
                <Rocket aria-hidden="true" size={24} />
                <span>
                  <strong>{t('welcome.finish.explore')}</strong>
                  <small>{t('welcome.finish.exploreDescription')}</small>
                </span>
                <ChevronRight aria-hidden="true" size={20} />
              </button>
              <button className="welcome-finish-action" disabled={isSavingWelcome} type="button" onClick={() => void completeWelcome('dashboard')}>
                <LayoutDashboard aria-hidden="true" size={24} />
                <span>
                  <strong>{t('welcome.finish.dashboard')}</strong>
                  <small>{t('welcome.finish.dashboardDescription')}</small>
                </span>
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            </div>
          </>
        )}

        {error ? <p className="welcome-page__error" role="alert">{error}</p> : null}

        {step !== 'finish' ? (
          <footer className="welcome-page__footer">
            {step === 'account' ? (
              <button className="button button--secondary" disabled={isSavingWelcome} type="button" onClick={() => void changeStep('node')}>
                <ChevronLeft aria-hidden="true" size={18} />
                {t('welcome.back')}
              </button>
            ) : <span />}
            <button className="button button--primary" disabled={isSavingWelcome || isSavingNodeChoice} type="button" onClick={() => void changeStep(step === 'node' ? 'account' : 'finish')}>
              {t('welcome.next')}
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
