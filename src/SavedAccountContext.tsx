import { CircleOff } from 'lucide-react';
import { useId } from 'react';
import { AccountAvatar } from './AccountAvatar';
import { getSavedAccountContext, shouldSaveAccountContext } from './accountContext';
import { useAccountProfile } from './accountProfile';
import { Popover } from './components/Popover';
import { t } from './i18n';

function getDisplayInitial(label: string) {
  return label.trim().charAt(0).toUpperCase() || '?';
}

function SavedAccountIcon({
  account,
  className,
  nodeApiUrl,
  nodeEpoch,
}: {
  account: QortiumAccountSummary | null;
  className: string;
  nodeApiUrl: string;
  nodeEpoch: number;
}) {
  const profile = useAccountProfile(account, nodeApiUrl, nodeEpoch);

  if (!account) {
    return <CircleOff aria-hidden="true" className={`${className} ${className}--empty`} size={18} strokeWidth={2} />;
  }

  const displayName = profile?.name ?? account.label;

  return (
    <span className={`${className} ${account.isUnlocked ? `${className}--unlocked` : ''}`} title={displayName}>
      <AccountAvatar
        name={profile?.name ?? null}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        imageClassName={`${className}-image`}
        fallback={
          <span className={`${className}-fallback`} aria-hidden="true">
            {getDisplayInitial(displayName)}
          </span>
        }
      />
    </span>
  );
}

export function SavedAccountBadge({
  accountId,
  accountsState,
  className = 'saved-account-badge',
  nodeApiUrl,
  nodeEpoch,
}: {
  accountId?: string | null;
  accountsState: QortiumAccountsState;
  className?: string;
  nodeApiUrl: string;
  nodeEpoch: number;
}) {
  const account = accountId ? accountsState.accounts.find((candidate) => candidate.id === accountId) ?? null : null;

  if (!account) {
    return null;
  }

  return (
    <SavedAccountIcon
      account={account}
      className={className}
      nodeApiUrl={nodeApiUrl}
      nodeEpoch={nodeEpoch}
    />
  );
}

export function SavedAccountSelector({
  accountId,
  accountsState,
  displayUrl,
  nodeApiUrl,
  nodeEpoch,
  onChange,
}: {
  accountId?: string | null;
  accountsState: QortiumAccountsState;
  displayUrl: string;
  nodeApiUrl: string;
  nodeEpoch: number;
  onChange: (accountId: string | null) => void;
}) {
  const selectorId = useId();

  if (!shouldSaveAccountContext(displayUrl)) {
    return <span className="saved-account-selector saved-account-selector--placeholder" aria-hidden="true" />;
  }

  const normalizedAccountId = getSavedAccountContext(displayUrl, accountId);
  const account = normalizedAccountId
    ? accountsState.accounts.find((candidate) => candidate.id === normalizedAccountId) ?? null
    : null;

  return (
    <Popover
      className="saved-account-selector"
      contentClassName="saved-account-selector__menu"
      contentId={`saved-account-selector-${selectorId}`}
      contentLabel={t('account.menuLabel')}
      contentRole="menu"
      renderTrigger={({ contentId, isOpen, toggle }) => (
        <button
          aria-controls={isOpen ? contentId : undefined}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          className="saved-account-selector__button"
          title={t('account.menuLabel')}
          type="button"
          onClick={toggle}
        >
          <SavedAccountIcon
            account={account}
            className="saved-account-selector__icon"
            nodeApiUrl={nodeApiUrl}
            nodeEpoch={nodeEpoch}
          />
          <span className="sr-only">{t('account.menuLabel')}</span>
        </button>
      )}
    >
      {({ close }) => (
        <div className="saved-account-selector__content">
          <button
            className={`saved-account-selector__item${!normalizedAccountId ? ' saved-account-selector__item--selected' : ''}`}
            role="menuitemradio"
            aria-checked={!normalizedAccountId}
            type="button"
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            <CircleOff aria-hidden="true" size={18} strokeWidth={2} />
            <span>{t('common.current')}</span>
          </button>
          {accountsState.accounts.map((candidate) => (
            <button
              className={`saved-account-selector__item${candidate.id === normalizedAccountId ? ' saved-account-selector__item--selected' : ''}`}
              key={candidate.id}
              role="menuitemradio"
              aria-checked={candidate.id === normalizedAccountId}
              type="button"
              onClick={() => {
                onChange(candidate.id);
                close();
              }}
            >
              <SavedAccountIcon
                account={candidate}
                className="saved-account-selector__item-icon"
                nodeApiUrl={nodeApiUrl}
                nodeEpoch={nodeEpoch}
              />
              <span>{candidate.label}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
