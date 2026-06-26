import { Download, Lock, Plus, Unlock, Wallet, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AccountAvatar } from './AccountAvatar';
import { getAccountProfile } from './accountProfile';
import { ModalDialog } from './components/ModalDialog';
import { t } from './i18n';
import { isNativePlatform } from './platform';

type PendingLoadedWallet = Extract<QortiumSelectWalletResult, { canceled: false }>;

type AccountsPanelProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  isLoadingAccounts: boolean;
  nodeApiUrl: string;
  nodeEpoch: number;
  selectedAccountId: string | null;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onSelectedAccountChange: (accountId: string | null) => void;
};

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('account.actionFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function normalizeWalletName(name: string) {
  return name.trim();
}

function findDuplicateWalletName(
  accounts: QortiumAccountSummary[],
  name: string,
  exceptAccountId?: string,
) {
  const nameKey = normalizeWalletName(name).toLowerCase();

  return accounts.find(
    (account) =>
      account.id !== exceptAccountId && normalizeWalletName(account.label).toLowerCase() === nameKey,
  );
}

function validateWalletName(
  accounts: QortiumAccountSummary[],
  name: string,
  exceptAccountId?: string,
) {
  const walletName = normalizeWalletName(name);

  if (!walletName) {
    return t('account.enterWalletName');
  }

  if (findDuplicateWalletName(accounts, walletName, exceptAccountId)) {
    return t('account.walletNameExists');
  }

  return '';
}

export function AccountsPanel({
  accountsError,
  accountsState,
  isLoadingAccounts,
  nodeApiUrl,
  nodeEpoch,
  selectedAccountId,
  onAccountsStateChange,
  onSelectedAccountChange,
}: AccountsPanelProps) {
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [pendingLoadedWallet, setPendingLoadedWallet] = useState<PendingLoadedWallet | null>(null);
  const [loadWalletName, setLoadWalletName] = useState('');
  const [loadNameError, setLoadNameError] = useState('');
  const [isSavingLoadedWallet, setIsSavingLoadedWallet] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletPassword, setNewWalletPassword] = useState('');
  const [newWalletPasswordConfirm, setNewWalletPasswordConfirm] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [unlockingAccountId, setUnlockingAccountId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [accountError, setAccountError] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isExportingWallet, setIsExportingWallet] = useState(false);
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [addAddressAfterUnlock, setAddAddressAfterUnlock] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [importWalletName, setImportWalletName] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importPasswordConfirm, setImportPasswordConfirm] = useState('');
  const [importError, setImportError] = useState('');
  const [importPreviewAddress, setImportPreviewAddress] = useState('');
  const [isImportingWallet, setIsImportingWallet] = useState(false);
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null);
  const [removePassword, setRemovePassword] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [isRemovingAccount, setIsRemovingAccount] = useState(false);
  const [accountsCapabilities, setAccountsCapabilities] = useState<QortiumAccountsCapabilities | null>(null);
  const canCreateWallet = accountsCapabilities?.canCreateWallet ?? !isNativePlatform();
  const canExportWalletFile = accountsCapabilities?.canExportWalletFile ?? false;
  const canLoadWalletFile = accountsCapabilities?.canLoadWalletFile ?? true;

  useEffect(() => {
    let isDisposed = false;

    window.qortiumHome.accounts.getCapabilities?.()
      .then((capabilities) => {
        if (!isDisposed) {
          setAccountsCapabilities(capabilities);
        }
      })
      .catch((error) => {
        console.warn('Unable to load account capabilities.', error);
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  const activeAccount = useMemo(
    () => accountsState.accounts.find((account) => account.id === selectedAccountId),
    [accountsState.accounts, selectedAccountId],
  );
  const [activeProfile, setActiveProfile] = useState<QortiumAccountProfile | null>(null);

  useEffect(() => {
    let isDisposed = false;

    setActiveProfile(null);

    if (!activeAccount) {
      return () => {
        isDisposed = true;
      };
    }

    getAccountProfile(activeAccount, nodeApiUrl, nodeEpoch)
      .then((profile) => {
        if (!isDisposed) {
          setActiveProfile(profile);
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setActiveProfile(null);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [activeAccount, nodeApiUrl, nodeEpoch]);
  const walletAccounts = useMemo(
    () =>
      accountsState.accounts
        .filter((account) => account.walletId === activeAccount?.walletId)
        .sort((first, second) => first.addressIndex - second.addressIndex),
    [accountsState.accounts, activeAccount?.walletId],
  );
  const walletOptions = useMemo(
    () => accountsState.accounts.filter((account) => account.addressIndex === 0),
    [accountsState.accounts],
  );
  const unlockingAccount = useMemo(
    () => accountsState.accounts.find((account) => account.id === unlockingAccountId),
    [accountsState.accounts, unlockingAccountId],
  );
  const removingAccount = useMemo(
    () => accountsState.accounts.find((account) => account.id === removingAccountId),
    [accountsState.accounts, removingAccountId],
  );
  const hasSavedAccounts = accountsState.accounts.length > 0;
  const visibleAccountError = accountError || accountsError;

  useEffect(() => {
    let isDisposed = false;

    if (!importPrivateKey.trim()) {
      setImportPreviewAddress('');

      return () => {
        isDisposed = true;
      };
    }

    window.qortiumHome.accounts
      .getAddressFromPrivateKey(importPrivateKey)
      .then((address) => {
        if (!isDisposed) {
          setImportPreviewAddress(address);
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setImportPreviewAddress('');
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [importPrivateKey]);

  function openCreateDialog() {
    setAccountError('');
    setAccountNotice('');
    setCreateError('');
    setNewWalletName('');
    setNewWalletPassword('');
    setNewWalletPasswordConfirm('');
    setIsCreateDialogOpen(true);
  }

  function closeCreateDialog() {
    if (isCreatingWallet) {
      return;
    }

    setIsCreateDialogOpen(false);
    setCreateError('');
    setNewWalletName('');
    setNewWalletPassword('');
    setNewWalletPasswordConfirm('');
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError('');

    const walletNameError = validateWalletName(accountsState.accounts, newWalletName);

    if (walletNameError) {
      setCreateError(walletNameError);
      return;
    }

    if (!newWalletPassword) {
      setCreateError(t('account.enterWalletPassword'));
      return;
    }

    if (!newWalletPasswordConfirm) {
      setCreateError(t('account.confirmWalletPassword'));
      return;
    }

    if (newWalletPassword !== newWalletPasswordConfirm) {
      setCreateError(t('account.passwordsDoNotMatch'));
      return;
    }

    setIsCreatingWallet(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.createWallet(
        normalizeWalletName(newWalletName),
        newWalletPassword,
      );

      if (!nextAccountsState.canceled) {
        const savedAccountsState = {
          accounts: nextAccountsState.accounts,
          activeAccountId: nextAccountsState.activeAccountId,
        };

        onAccountsStateChange(savedAccountsState);
        onSelectedAccountChange(savedAccountsState.activeAccountId);
      }

      setIsCreateDialogOpen(false);
      setNewWalletName('');
      setNewWalletPassword('');
      setNewWalletPasswordConfirm('');
    } catch (error) {
      setCreateError(formatError(error));
    } finally {
      setIsCreatingWallet(false);
    }
  }

  function openImportDialog() {
    setAccountError('');
    setAccountNotice('');
    setImportError('');
    setImportPrivateKey('');
    setImportWalletName('');
    setImportPassword('');
    setImportPasswordConfirm('');
    setImportPreviewAddress('');
    setIsImportDialogOpen(true);
  }

  function closeImportDialog() {
    if (isImportingWallet) {
      return;
    }

    setIsImportDialogOpen(false);
    setImportError('');
    setImportPrivateKey('');
    setImportWalletName('');
    setImportPassword('');
    setImportPasswordConfirm('');
    setImportPreviewAddress('');
  }

  async function handleImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError('');

    if (!importPrivateKey.trim()) {
      setImportError(t('account.enterPrivateKey'));
      return;
    }

    const walletNameError = validateWalletName(accountsState.accounts, importWalletName);

    if (walletNameError) {
      setImportError(walletNameError);
      return;
    }

    if (!importPassword) {
      setImportError(t('account.enterWalletPassword'));
      return;
    }

    if (!importPasswordConfirm) {
      setImportError(t('account.confirmWalletPassword'));
      return;
    }

    if (importPassword !== importPasswordConfirm) {
      setImportError(t('account.passwordsDoNotMatch'));
      return;
    }

    setIsImportingWallet(true);

    try {
      const result = await window.qortiumHome.accounts.importPrivateKeyWallet(
        normalizeWalletName(importWalletName),
        importPrivateKey.trim(),
        importPassword,
      );

      if (!result.canceled) {
        const savedAccountsState = {
          accounts: result.accounts,
          activeAccountId: result.activeAccountId,
        };

        onAccountsStateChange(savedAccountsState);
        onSelectedAccountChange(savedAccountsState.activeAccountId);
      }

      setIsImportDialogOpen(false);
      setImportPrivateKey('');
      setImportWalletName('');
      setImportPassword('');
      setImportPasswordConfirm('');
      setImportPreviewAddress('');
    } catch (error) {
      setImportError(formatError(error));
    } finally {
      setIsImportingWallet(false);
    }
  }

  async function handleLoadWallet() {
    setAccountError('');
    setAccountNotice('');
    setLoadNameError('');
    setIsLoadingWallet(true);

    try {
      const selectedWallet = await window.qortiumHome.accounts.selectWalletFile();

      if (!selectedWallet.canceled) {
        setPendingLoadedWallet(selectedWallet);
        setLoadWalletName(selectedWallet.suggestedName);
      }
    } catch (error) {
      setAccountError(formatError(error));
    } finally {
      setIsLoadingWallet(false);
    }
  }

  function discardPendingLoadedWallet(wallet: PendingLoadedWallet) {
    window.qortiumHome.accounts.discardLoadedWallet(wallet.token).catch((error) => {
      console.warn('Unable to discard pending wallet load.', error);
    });
  }

  function closeLoadNameDialog() {
    if (isSavingLoadedWallet) {
      return;
    }

    if (pendingLoadedWallet) {
      discardPendingLoadedWallet(pendingLoadedWallet);
    }

    setPendingLoadedWallet(null);
    setLoadWalletName('');
    setLoadNameError('');
  }

  async function handleLoadNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pendingLoadedWallet) {
      return;
    }

    setLoadNameError('');

    const walletNameError = validateWalletName(
      accountsState.accounts,
      loadWalletName,
      pendingLoadedWallet.accountId,
    );

    if (walletNameError) {
      setLoadNameError(walletNameError);
      return;
    }

    setIsSavingLoadedWallet(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.saveLoadedWallet(
        pendingLoadedWallet.token,
        normalizeWalletName(loadWalletName),
      );

      onAccountsStateChange(nextAccountsState);
      onSelectedAccountChange(nextAccountsState.activeAccountId);
      setPendingLoadedWallet(null);
      setLoadWalletName('');
    } catch (error) {
      setLoadNameError(formatError(error));
    } finally {
      setIsSavingLoadedWallet(false);
    }
  }

  async function handleActiveAccountChange(accountId: string) {
    setAccountError('');
    setAccountNotice('');

    try {
      const nextAccountsState = await window.qortiumHome.accounts.setActiveAccount(accountId);

      onAccountsStateChange(nextAccountsState);
      onSelectedAccountChange(nextAccountsState.activeAccountId);
    } catch (error) {
      setAccountError(formatError(error));
    }
  }

  async function handleLockToggle() {
    if (!activeAccount) {
      return;
    }

    setAccountError('');
    setAccountNotice('');

    if (!activeAccount.isUnlocked) {
      setPassword('');
      setUnlockError('');
      setAddAddressAfterUnlock(false);
      setUnlockingAccountId(activeAccount.id);
      return;
    }

    try {
      onAccountsStateChange(await window.qortiumHome.accounts.lockWallet(activeAccount.id));
    } catch (error) {
      setAccountError(formatError(error));
    }
  }

  async function performAddAddress(accountId: string) {
    setIsAddingAddress(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.addDerivedAddress(accountId);

      onAccountsStateChange(nextAccountsState);
      onSelectedAccountChange(nextAccountsState.activeAccountId);
    } catch (error) {
      setAccountError(formatError(error));
    } finally {
      setIsAddingAddress(false);
    }
  }

  function handleAddAddress() {
    if (!activeAccount || isAddingAddress) {
      return;
    }

    setAccountError('');
    setAccountNotice('');

    if (!activeAccount.isUnlocked) {
      setPassword('');
      setUnlockError('');
      setAddAddressAfterUnlock(true);
      setUnlockingAccountId(activeAccount.id);
      return;
    }

    void performAddAddress(activeAccount.id);
  }

  async function removeDerivedAddress(accountId: string) {
    setAccountError('');
    setAccountNotice('');
    setIsRemovingAccount(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.removeWallet(accountId);

      onAccountsStateChange(nextAccountsState);
      onSelectedAccountChange(nextAccountsState.activeAccountId);
    } catch (error) {
      setAccountError(formatError(error));
    } finally {
      setIsRemovingAccount(false);
    }
  }

  function handleRemoveClick() {
    if (!activeAccount) {
      return;
    }

    // Derived addresses are recoverable by re-adding, so no password dialog.
    if (activeAccount.addressIndex > 0) {
      void removeDerivedAddress(activeAccount.id);
      return;
    }

    openRemoveDialog();
  }

  async function handleExportWallet() {
    if (!activeAccount) {
      return;
    }

    setAccountError('');
    setAccountNotice('');
    setIsExportingWallet(true);

    try {
      const result = await window.qortiumHome.accounts.exportWallet(activeAccount.id);

      if (!result.canceled) {
        setAccountNotice(t('account.savedWalletBackup', { fileName: result.fileName }));
      }
    } catch (error) {
      setAccountError(formatError(error));
    } finally {
      setIsExportingWallet(false);
    }
  }

  function closeUnlockDialog() {
    if (isUnlocking) {
      return;
    }

    setUnlockingAccountId(null);
    setPassword('');
    setUnlockError('');
    setAddAddressAfterUnlock(false);
  }

  async function handleUnlockSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!unlockingAccount) {
      return;
    }

    const unlockingId = unlockingAccount.id;
    const shouldAddAddress = addAddressAfterUnlock;

    setUnlockError('');
    setIsUnlocking(true);

    try {
      onAccountsStateChange(await window.qortiumHome.accounts.unlockWallet(unlockingId, password));
      setUnlockingAccountId(null);
      setPassword('');
      setUnlockError('');
      setAddAddressAfterUnlock(false);

      if (shouldAddAddress) {
        await performAddAddress(unlockingId);
      }
    } catch (error) {
      setUnlockError(formatError(error));
    } finally {
      setIsUnlocking(false);
    }
  }

  function openRemoveDialog() {
    if (!activeAccount) {
      return;
    }

    setAccountError('');
    setAccountNotice('');
    setRemoveError('');
    setRemovePassword('');
    setRemovingAccountId(activeAccount.id);
  }

  function closeRemoveDialog() {
    if (isRemovingAccount) {
      return;
    }

    setRemovingAccountId(null);
    setRemovePassword('');
    setRemoveError('');
  }

  async function handleRemoveSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!removingAccount) {
      return;
    }

    if (!removingAccount.isUnlocked && !removePassword) {
      setRemoveError(t('account.enterWalletPassword'));
      return;
    }

    setRemoveError('');
    setIsRemovingAccount(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.removeWallet(
        removingAccount.id,
        removingAccount.isUnlocked ? undefined : removePassword,
      );

      onAccountsStateChange(nextAccountsState);
      onSelectedAccountChange(nextAccountsState.activeAccountId);
      setRemovingAccountId(null);
      setRemovePassword('');
      setRemoveError('');
    } catch (error) {
      setRemoveError(formatError(error));
    } finally {
      setIsRemovingAccount(false);
    }
  }

  return (
    <section className="accounts-panel" aria-label={t('account.title')}>
      {isLoadingAccounts ? (
        <div className="accounts-panel__skeleton" aria-busy="true">
          <p className="sr-only">{t('account.loadingWallets')}</p>
          <span className="skeleton" aria-hidden="true" />
          <span className="skeleton" aria-hidden="true" />
        </div>
      ) : !hasSavedAccounts ? (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">
            <Wallet size={26} strokeWidth={2} />
          </span>
          <p className="accounts-panel__message">{t('account.noWalletsYet')}</p>
        </div>
      ) : null}
      <div className="accounts-panel__actions" aria-label={t('account.actionsLabel')}>
        {canCreateWallet ? (
          <button
            className={`button${!isLoadingAccounts && !hasSavedAccounts ? ' button--primary' : ''}`}
            type="button"
            disabled={isLoadingAccounts || isCreatingWallet}
            onClick={openCreateDialog}
          >
            {isCreatingWallet ? t('common.creating') : t('account.newWalletButton')}
          </button>
        ) : null}
        {canLoadWalletFile ? (
          <button
            className="button"
            type="button"
            disabled={isLoadingAccounts || isLoadingWallet || isSavingLoadedWallet}
            onClick={handleLoadWallet}
          >
            {isLoadingWallet ? t('common.loading') : t('account.loadWalletButton')}
          </button>
        ) : null}
        {canCreateWallet ? (
          <button
            className="button"
            type="button"
            disabled={isLoadingAccounts || isImportingWallet}
            onClick={openImportDialog}
          >
            {t('account.importWalletButton')}
          </button>
        ) : null}
      </div>

      {hasSavedAccounts ? (
        <div className="account-selector">
          <label className="account-selector__label" htmlFor="selected-wallet">
            {t('account.selectedWallet')}
          </label>
          <div className="account-selector__control">
            <select
              className="select account-selector__select"
              id="selected-wallet"
              value={activeAccount?.walletId ?? ''}
              onChange={(event) => handleActiveAccountChange(event.target.value)}
            >
              {walletOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
            <div className="account-selector__buttons">
              {canExportWalletFile ? (
                <button
                  aria-label={t('account.exportSelectedWallet')}
                  className="icon-button account-selector__export-button"
                  disabled={!activeAccount || isExportingWallet}
                  title={t('account.exportSelectedWallet')}
                  type="button"
                  onClick={handleExportWallet}
                >
                  <Download size={20} />
                </button>
              ) : null}
              <button
                aria-label={
                  activeAccount?.isUnlocked ? t('account.lockSelectedWallet') : t('account.unlockSelectedWallet')
                }
                className={`icon-button account-selector__lock-button${
                  activeAccount?.isUnlocked ? ' account-selector__lock-button--unlocked' : ''
                }`}
                disabled={!activeAccount}
                title={activeAccount?.isUnlocked ? t('account.lockSelectedWallet') : t('account.unlockSelectedWallet')}
                type="button"
                onClick={handleLockToggle}
              >
                {activeAccount?.isUnlocked ? <Unlock size={20} /> : <Lock size={20} />}
              </button>
              <button
                aria-label={t('account.removeSelectedWallet')}
                className="icon-button account-selector__remove-button"
                disabled={!activeAccount || isRemovingAccount}
                title={t('account.removeSelectedWallet')}
                type="button"
                onClick={handleRemoveClick}
              >
                <X size={20} />
              </button>
            </div>
          </div>
          {activeAccount ? (
            <div className="account-selector__identity">
              <AccountAvatar
                name={activeProfile?.name ?? null}
                nodeApiUrl={nodeApiUrl}
                nodeEpoch={nodeEpoch}
                imageClassName="account-selector__avatar"
                fallback={null}
              />
              <div className="account-selector__identity-text">
                {activeProfile?.name ? (
                  <p className="account-selector__name">{activeProfile.name}</p>
                ) : null}
                {activeAccount.supportsDerivedAddresses ? (
                  <div className="account-selector__address-row">
                    <select
                      aria-label={t('account.selectedAddress')}
                      className="select account-selector__address-select"
                      value={activeAccount.id}
                      onChange={(event) => handleActiveAccountChange(event.target.value)}
                    >
                      {walletAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.addressIndex}: {account.address}
                        </option>
                      ))}
                    </select>
                    <button
                      aria-label={t('account.addAddress')}
                      className="icon-button account-selector__add-address-button"
                      disabled={isAddingAddress}
                      title={t('account.addAddress')}
                      type="button"
                      onClick={handleAddAddress}
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                ) : (
                  <p className="account-selector__address" aria-label={t('account.selectedWalletAddress')}>
                    {activeAccount.address}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {visibleAccountError ? (
        <p className="accounts-panel__message accounts-panel__message--error" role="alert">{visibleAccountError}</p>
      ) : null}
      {accountNotice ? (
        <p className="accounts-panel__message" role="status" aria-live="polite">
          {accountNotice}
        </p>
      ) : null}

      {isCreateDialogOpen ? (
        <ModalDialog onDismiss={closeCreateDialog}>
          <form
            aria-label={t('account.newAccountTitle')}
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onSubmit={handleCreateSubmit}
          >
            <h2 className="unlock-dialog__title">{t('account.newAccountTitle')}</h2>
            <label className="field">
              <span className="field__label">{t('account.walletName')}</span>
              <input
                autoFocus
                className="field__input"
                type="text"
                value={newWalletName}
                onChange={(event) => setNewWalletName(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">{t('common.password')}</span>
              <input
                className="field__input"
                type="password"
                value={newWalletPassword}
                onChange={(event) => setNewWalletPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">{t('account.confirmPassword')}</span>
              <input
                className="field__input"
                type="password"
                value={newWalletPasswordConfirm}
                onChange={(event) => setNewWalletPasswordConfirm(event.target.value)}
              />
            </label>
            {createError ? (
              <p className="accounts-panel__message accounts-panel__message--error" role="alert">{createError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isCreatingWallet}
                onClick={closeCreateDialog}
              >
                {t('common.cancel')}
              </button>
              <button className="button button--primary" type="submit" disabled={isCreatingWallet}>
                {isCreatingWallet ? t('common.creating') : t('common.create')}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {isImportDialogOpen ? (
        <ModalDialog onDismiss={closeImportDialog}>
          <form
            aria-label={t('account.importWalletTitle')}
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onSubmit={handleImportSubmit}
          >
            <h2 className="unlock-dialog__title">{t('account.importWalletTitle')}</h2>
            <label className="field">
              <span className="field__label">{t('account.privateKey')}</span>
              <input
                autoFocus
                autoComplete="off"
                className="field__input"
                type="password"
                value={importPrivateKey}
                onChange={(event) => setImportPrivateKey(event.target.value)}
              />
            </label>
            {importPreviewAddress ? (
              <p className="unlock-dialog__address">{importPreviewAddress}</p>
            ) : null}
            <label className="field">
              <span className="field__label">{t('account.walletName')}</span>
              <input
                className="field__input"
                type="text"
                value={importWalletName}
                onChange={(event) => setImportWalletName(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">{t('common.password')}</span>
              <input
                className="field__input"
                type="password"
                value={importPassword}
                onChange={(event) => setImportPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">{t('account.confirmPassword')}</span>
              <input
                className="field__input"
                type="password"
                value={importPasswordConfirm}
                onChange={(event) => setImportPasswordConfirm(event.target.value)}
              />
            </label>
            {importError ? (
              <p className="accounts-panel__message accounts-panel__message--error" role="alert">{importError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isImportingWallet}
                onClick={closeImportDialog}
              >
                {t('common.cancel')}
              </button>
              <button className="button button--primary" type="submit" disabled={isImportingWallet}>
                {isImportingWallet ? t('common.loading') : t('account.importWalletButton')}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {pendingLoadedWallet ? (
        <ModalDialog onDismiss={closeLoadNameDialog}>
          <form
            aria-label={t('account.nameLoadedWalletLabel')}
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onSubmit={handleLoadNameSubmit}
          >
            <h2 className="unlock-dialog__title">{t('account.nameWalletTitle')}</h2>
            <p className="unlock-dialog__address">{pendingLoadedWallet.address}</p>
            <label className="field">
              <span className="field__label">{t('account.walletName')}</span>
              <input
                autoFocus
                className="field__input"
                type="text"
                value={loadWalletName}
                onChange={(event) => setLoadWalletName(event.target.value)}
              />
            </label>
            {loadNameError ? (
              <p className="accounts-panel__message accounts-panel__message--error" role="alert">{loadNameError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isSavingLoadedWallet}
                onClick={closeLoadNameDialog}
              >
                {t('common.cancel')}
              </button>
              <button className="button button--primary" type="submit" disabled={isSavingLoadedWallet}>
                {isSavingLoadedWallet ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {unlockingAccount ? (
        <ModalDialog onDismiss={closeUnlockDialog}>
          <form
            aria-label={t('account.unlockAccountTitle')}
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onSubmit={handleUnlockSubmit}
          >
            <h2 className="unlock-dialog__title">{t('account.unlockAccountTitle')}</h2>
            <p className="unlock-dialog__account">{unlockingAccount.label}</p>
            <p className="unlock-dialog__address">{unlockingAccount.address}</p>
            <label className="field">
              <span className="field__label">{t('common.password')}</span>
              <input
                autoFocus
                className="field__input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {unlockError ? (
              <p className="accounts-panel__message accounts-panel__message--error" role="alert">{unlockError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isUnlocking}
                onClick={closeUnlockDialog}
              >
                {t('common.cancel')}
              </button>
              <button className="button button--primary" type="submit" disabled={isUnlocking}>
                {isUnlocking ? t('common.unlocking') : t('common.unlock')}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {removingAccount ? (
        <ModalDialog onDismiss={closeRemoveDialog}>
          <form
            aria-label={t('account.removeWalletTitle')}
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onSubmit={handleRemoveSubmit}
          >
            <h2 className="unlock-dialog__title">{t('account.removeWalletTitle')}</h2>
            <p className="unlock-dialog__account">{removingAccount.label}</p>
            <p className="unlock-dialog__address">{removingAccount.address}</p>
            {!removingAccount.isUnlocked ? (
              <label className="field">
                <span className="field__label">{t('common.password')}</span>
                <input
                  autoFocus
                  className="field__input"
                  type="password"
                  value={removePassword}
                  onChange={(event) => setRemovePassword(event.target.value)}
                />
              </label>
            ) : null}
            {removeError ? (
              <p className="accounts-panel__message accounts-panel__message--error" role="alert">{removeError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isRemovingAccount}
                onClick={closeRemoveDialog}
              >
                {t('common.cancel')}
              </button>
              <button className="button button--danger" type="submit" disabled={isRemovingAccount}>
                {isRemovingAccount ? t('common.removing') : t('common.remove')}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}
    </section>
  );
}
