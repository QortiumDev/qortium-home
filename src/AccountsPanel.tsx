import { Lock, Unlock, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { isNativePlatform } from './platform';

type PendingLoadedWallet = Extract<QortiumSelectWalletResult, { canceled: false }>;

type AccountsPanelProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  isLoadingAccounts: boolean;
  selectedAccountId: string | null;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onSelectedAccountChange: (accountId: string | null) => void;
};

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Account action failed.';
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
    return 'Enter the wallet name.';
  }

  if (findDuplicateWalletName(accounts, walletName, exceptAccountId)) {
    return 'Wallet name already exists.';
  }

  return '';
}

export function AccountsPanel({
  accountsError,
  accountsState,
  isLoadingAccounts,
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
  const [unlockError, setUnlockError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null);
  const [removePassword, setRemovePassword] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [isRemovingAccount, setIsRemovingAccount] = useState(false);
  const [accountsCapabilities, setAccountsCapabilities] = useState<QortiumAccountsCapabilities | null>(null);
  const canCreateWallet = accountsCapabilities?.canCreateWallet ?? !isNativePlatform();
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

  function openCreateDialog() {
    setAccountError('');
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
      setCreateError('Enter the wallet password.');
      return;
    }

    if (!newWalletPasswordConfirm) {
      setCreateError('Confirm the wallet password.');
      return;
    }

    if (newWalletPassword !== newWalletPasswordConfirm) {
      setCreateError('Wallet passwords do not match.');
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

  async function handleLoadWallet() {
    setAccountError('');
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

    if (!activeAccount.isUnlocked) {
      setPassword('');
      setUnlockError('');
      setUnlockingAccountId(activeAccount.id);
      return;
    }

    try {
      onAccountsStateChange(await window.qortiumHome.accounts.lockWallet(activeAccount.id));
    } catch (error) {
      setAccountError(formatError(error));
    }
  }

  function closeUnlockDialog() {
    if (isUnlocking) {
      return;
    }

    setUnlockingAccountId(null);
    setPassword('');
    setUnlockError('');
  }

  async function handleUnlockSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!unlockingAccount) {
      return;
    }

    setUnlockError('');
    setIsUnlocking(true);

    try {
      onAccountsStateChange(await window.qortiumHome.accounts.unlockWallet(unlockingAccount.id, password));
      setUnlockingAccountId(null);
      setPassword('');
      setUnlockError('');
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
      setRemoveError('Enter the wallet password.');
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
    <section className="accounts-panel" aria-label="Accounts">
      <div className="accounts-panel__actions" aria-label="Account actions">
        {canCreateWallet ? (
          <button
            className="button"
            type="button"
            disabled={isLoadingAccounts || isCreatingWallet}
            onClick={openCreateDialog}
          >
            {isCreatingWallet ? 'Creating' : 'New'}
          </button>
        ) : null}
        {canLoadWalletFile ? (
          <button
            className="button"
            type="button"
            disabled={isLoadingAccounts || isLoadingWallet || isSavingLoadedWallet}
            onClick={handleLoadWallet}
          >
            {isLoadingWallet ? 'Loading' : 'Load'}
          </button>
        ) : null}
      </div>

      {hasSavedAccounts ? (
        <div className="account-selector">
          <label className="account-selector__label" htmlFor="selected-wallet">
            Selected wallet
          </label>
          <div className="account-selector__control">
            <select
              className="account-selector__select"
              id="selected-wallet"
              value={activeAccount?.id ?? ''}
              onChange={(event) => handleActiveAccountChange(event.target.value)}
            >
              {accountsState.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
            <button
              aria-label={activeAccount?.isUnlocked ? 'Lock selected wallet' : 'Unlock selected wallet'}
              className={`icon-button account-selector__lock-button${
                activeAccount?.isUnlocked ? ' account-selector__lock-button--unlocked' : ''
              }`}
              disabled={!activeAccount}
              title={activeAccount?.isUnlocked ? 'Lock selected wallet' : 'Unlock selected wallet'}
              type="button"
              onClick={handleLockToggle}
            >
              {activeAccount?.isUnlocked ? <Unlock size={20} /> : <Lock size={20} />}
            </button>
            <button
              aria-label="Remove selected wallet"
              className="icon-button account-selector__remove-button"
              disabled={!activeAccount || isRemovingAccount}
              title="Remove selected wallet"
              type="button"
              onClick={openRemoveDialog}
            >
              <X size={20} />
            </button>
          </div>
          {activeAccount ? (
            <p className="account-selector__address" aria-label="Selected wallet address">
              {activeAccount.address}
            </p>
          ) : null}
        </div>
      ) : null}

      {visibleAccountError ? (
        <p className="accounts-panel__message accounts-panel__message--error">{visibleAccountError}</p>
      ) : null}

      {isCreateDialogOpen ? (
        <div className="modal-backdrop" onMouseDown={closeCreateDialog}>
          <form
            aria-label="Create account"
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleCreateSubmit}
          >
            <h2 className="unlock-dialog__title">New Account</h2>
            <label className="field">
              <span className="field__label">Wallet name</span>
              <input
                autoFocus
                className="field__input"
                type="text"
                value={newWalletName}
                onChange={(event) => setNewWalletName(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="field__input"
                type="password"
                value={newWalletPassword}
                onChange={(event) => setNewWalletPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Confirm password</span>
              <input
                className="field__input"
                type="password"
                value={newWalletPasswordConfirm}
                onChange={(event) => setNewWalletPasswordConfirm(event.target.value)}
              />
            </label>
            {createError ? (
              <p className="accounts-panel__message accounts-panel__message--error">{createError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isCreatingWallet}
                onClick={closeCreateDialog}
              >
                Cancel
              </button>
              <button className="button" type="submit" disabled={isCreatingWallet}>
                {isCreatingWallet ? 'Creating' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingLoadedWallet ? (
        <div className="modal-backdrop" onMouseDown={closeLoadNameDialog}>
          <form
            aria-label="Name loaded wallet"
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleLoadNameSubmit}
          >
            <h2 className="unlock-dialog__title">Name Wallet</h2>
            <p className="unlock-dialog__address">{pendingLoadedWallet.address}</p>
            <label className="field">
              <span className="field__label">Wallet name</span>
              <input
                autoFocus
                className="field__input"
                type="text"
                value={loadWalletName}
                onChange={(event) => setLoadWalletName(event.target.value)}
              />
            </label>
            {loadNameError ? (
              <p className="accounts-panel__message accounts-panel__message--error">{loadNameError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isSavingLoadedWallet}
                onClick={closeLoadNameDialog}
              >
                Cancel
              </button>
              <button className="button" type="submit" disabled={isSavingLoadedWallet}>
                {isSavingLoadedWallet ? 'Saving' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {unlockingAccount ? (
        <div className="modal-backdrop" onMouseDown={closeUnlockDialog}>
          <form
            aria-label="Unlock account"
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleUnlockSubmit}
          >
            <h2 className="unlock-dialog__title">Unlock Account</h2>
            <p className="unlock-dialog__account">{unlockingAccount.label}</p>
            <p className="unlock-dialog__address">{unlockingAccount.address}</p>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                autoFocus
                className="field__input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {unlockError ? (
              <p className="accounts-panel__message accounts-panel__message--error">{unlockError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isUnlocking}
                onClick={closeUnlockDialog}
              >
                Cancel
              </button>
              <button className="button" type="submit" disabled={isUnlocking}>
                {isUnlocking ? 'Unlocking' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {removingAccount ? (
        <div className="modal-backdrop" onMouseDown={closeRemoveDialog}>
          <form
            aria-label="Remove wallet"
            aria-modal="true"
            className="unlock-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleRemoveSubmit}
          >
            <h2 className="unlock-dialog__title">Remove Wallet</h2>
            <p className="unlock-dialog__account">{removingAccount.label}</p>
            <p className="unlock-dialog__address">{removingAccount.address}</p>
            {!removingAccount.isUnlocked ? (
              <label className="field">
                <span className="field__label">Password</span>
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
              <p className="accounts-panel__message accounts-panel__message--error">{removeError}</p>
            ) : null}
            <div className="unlock-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                disabled={isRemovingAccount}
                onClick={closeRemoveDialog}
              >
                Cancel
              </button>
              <button className="button button--danger" type="submit" disabled={isRemovingAccount}>
                {isRemovingAccount ? 'Removing' : 'Remove'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
