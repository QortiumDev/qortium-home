import { useState, type FormEvent } from 'react'

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
  const titles: Record<AccountDialogMode, string> = {
    create: 'Create account',
    'enable-remember': 'Enable remembered unlock',
    'import-private-key': 'Import private key',
    'import-wallet-label': 'Import wallet file',
    'remove-account': 'Remove account',
    rename: 'Rename account',
    unlock: 'Unlock account',
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
            <span className="home-v2-eyebrow">Account</span>
            <h2 id="home-v2-account-dialog-title">{titles[mode]}</h2>
          </div>
          <button type="button" className="home-v2-dialog-close" aria-label="Close" disabled={busy} onClick={onCancel}>×</button>
        </header>
        <form onSubmit={submit}>
          {mode === 'remove-account' ? (
            <p>Remove <strong>{accountLabel}</strong> from this device? Keep an exported wallet backup before continuing.</p>
          ) : null}
          {mode === 'enable-remember' ? (
            <p>Confirm the account password once. Home will store only device-encrypted unlock material, never the password.</p>
          ) : null}
          {needsLabel ? (
            <label>
              <span>Account label</span>
              <input autoFocus maxLength={120} required value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
          ) : null}
          {mode === 'import-private-key' ? (
            <label>
              <span>Private key</span>
              <textarea autoComplete="off" maxLength={256} required rows={3} value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} />
            </label>
          ) : null}
          {mode === 'unlock' && rememberedUnlockAvailable ? (
            <label className="home-v2-checkbox-row">
              <input type="checkbox" checked={useRememberedUnlock} onChange={(event) => setUseRememberedUnlock(event.target.checked)} />
              <span>Use device-protected remembered unlock</span>
            </label>
          ) : null}
          {needsPassword ? (
            <label>
              <span>{mode === 'remove-account' ? 'Password (required while locked)' : 'Password'}</span>
              <input autoComplete={needsNewPassword ? 'new-password' : 'current-password'} autoFocus={!needsLabel} required={mode !== 'remove-account'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          ) : null}
          {needsNewPassword ? (
            <label>
              <span>Confirm password</span>
              <input autoComplete="new-password" required type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
            </label>
          ) : null}
          {error ? <p className="home-v2-dialog-error" role="alert">{error}</p> : null}
          <footer>
            <button type="button" className="home-v2-secondary-button" disabled={busy} onClick={onCancel}>Cancel</button>
            <button type="submit" className={mode === 'remove-account' ? 'home-v2-danger-button' : 'home-v2-primary-button'} disabled={busy}>
              {busy ? 'Working…' : mode === 'remove-account' ? 'Remove account' : 'Continue'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
