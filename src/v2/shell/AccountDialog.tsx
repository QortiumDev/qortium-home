import { useState, type FormEvent } from 'react'
import { t, type TranslationKey } from '../../i18n'

export type AccountDialogMode =
  | 'create'
  | 'enable-remember'
  | 'import-private-key'
  | 'import-wallet-label'
  | 'remove-account'
  | 'rename'
  | 'unlock'

export interface AccountDialogSubmission {
  label?: string
  password?: string
  passwordConfirmation?: string
  privateKey?: string
  useRememberedUnlock?: boolean
}

export function AccountDialog({
  accountLabel,
  busy,
  error,
  mode,
  rememberedUnlockAvailable,
  suggestedLabel,
  onCancel,
  onSubmit,
}: {
  readonly accountLabel?: string
  readonly busy?: boolean
  readonly error?: string | null
  readonly mode: AccountDialogMode
  readonly rememberedUnlockAvailable?: boolean
  readonly suggestedLabel?: string
  readonly onCancel: () => void
  readonly onSubmit: (value: AccountDialogSubmission) => void
}) {
  const [label, setLabel] = useState(suggestedLabel ?? accountLabel ?? '')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [useRememberedUnlock, setUseRememberedUnlock] = useState(
    mode === 'unlock' && rememberedUnlockAvailable === true,
  )
  const titleKeys: Record<AccountDialogMode, TranslationKey> = {
    create: 'home2.accountDialog.title.create',
    'enable-remember': 'home2.accountDialog.title.enableRemember',
    'import-private-key': 'home2.accountDialog.title.importPrivateKey',
    'import-wallet-label': 'home2.accountDialog.title.importWalletFile',
    'remove-account': 'home2.accountDialog.title.removeAccount',
    rename: 'home2.accountDialog.title.renameAccount',
    unlock: 'home2.accountDialog.title.unlockAccount',
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({ label, password, passwordConfirmation, privateKey, useRememberedUnlock })
  }
  const needsLabel = mode === 'create' || mode === 'import-private-key' || mode === 'import-wallet-label' || mode === 'rename'
  const needsNewPassword = mode === 'create' || mode === 'import-private-key'
  const needsPassword = needsNewPassword || mode === 'enable-remember' || mode === 'remove-account' || (mode === 'unlock' && !useRememberedUnlock)
  return (
    <div className="home-v2-dialog-backdrop" role="presentation">
      <section className="home-v2-dialog home-v2-account-dialog" role="dialog" aria-modal="true" aria-labelledby="home-v2-account-dialog-title">
        <header>
          <div>
            <span className="home-v2-eyebrow">{t('account.menuLabel')}</span>
            <h2 id="home-v2-account-dialog-title">{t(titleKeys[mode])}</h2>
          </div>
          <button type="button" className="home-v2-dialog-close" aria-label={t('home2.common.close')} disabled={busy} onClick={onCancel}>×</button>
        </header>
        <form onSubmit={submit}>
          {mode === 'remove-account' ? (
            <p>{t('home2.accountDialog.removePrompt', { account: accountLabel ?? '' })}</p>
          ) : null}
          {mode === 'enable-remember' ? (
            <p>{t('home2.accountDialog.enableRememberDescription')}</p>
          ) : null}
          {needsLabel ? (
            <label>
              <span>{t('home2.accountDialog.accountLabel')}</span>
              <input autoFocus maxLength={120} required value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
          ) : null}
          {mode === 'import-private-key' ? (
            <label>
              <span>{t('account.privateKey')}</span>
              <textarea autoComplete="off" maxLength={256} required rows={3} value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} />
            </label>
          ) : null}
          {mode === 'unlock' && rememberedUnlockAvailable ? (
            <label className="home-v2-checkbox-row">
              <input type="checkbox" checked={useRememberedUnlock} onChange={(event) => setUseRememberedUnlock(event.target.checked)} />
              <span>{t('home2.accountDialog.useRememberedUnlock')}</span>
            </label>
          ) : null}
          {needsPassword ? (
            <label>
              <span>{mode === 'remove-account' ? t('home2.accountDialog.passwordRequiredWhileLocked') : t('common.password')}</span>
              <input autoComplete={needsNewPassword ? 'new-password' : 'current-password'} autoFocus={!needsLabel} required={mode !== 'remove-account'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          ) : null}
          {needsNewPassword ? (
            <label>
              <span>{t('account.confirmPassword')}</span>
              <input autoComplete="new-password" required type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
            </label>
          ) : null}
          {error ? <p className="home-v2-dialog-error" role="alert">{error}</p> : null}
          <footer>
            <button type="button" className="home-v2-secondary-button" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
            <button type="submit" className={mode === 'remove-account' ? 'home-v2-danger-button' : 'home-v2-primary-button'} disabled={busy}>
              {busy ? t('home2.common.working') : mode === 'remove-account' ? t('home2.accountDialog.removeAccount') : t('home2.common.continue')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
