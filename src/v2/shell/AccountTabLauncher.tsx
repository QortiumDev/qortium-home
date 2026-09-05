import { useEffect, useRef, useState, type FormEvent } from 'react'
import { t } from '../../i18n'
import type { HomeV2AccountCatalogue } from '../contracts'

export interface AccountTabLauncherProps {
  readonly accountCatalogue: HomeV2AccountCatalogue
  readonly sourceAccountId: string | null
  readonly tabId: string
  readonly resourceLocation: string
  readonly onOpenTabWithAccount: (tabId: string, resourceLocation: string, accountId: string | null) => Promise<void>
}

/** Opens a new instance; the source tab and Home's default account stay intact. */
export function AccountTabLauncher({ accountCatalogue, sourceAccountId, tabId, resourceLocation, onOpenTabWithAccount, onClose }: AccountTabLauncherProps & {
  readonly onClose: () => void
}) {
  const [selection, setSelection] = useState(() => sourceAccountId === null ? 'none'
    : accountCatalogue.accounts.some((account) => account.id === sourceAccountId) ? `account:${sourceAccountId}` : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const targetId = selection.startsWith('account:') ? selection.slice('account:'.length) : null
  const validSelection = selection === 'none'
    || (targetId !== null && accountCatalogue.accounts.some((account) => account.id === targetId))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current || !validSelection) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await onOpenTabWithAccount(tabId, resourceLocation, targetId)
      if (mounted.current) onClose()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t('account.actionFailed'))
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <form className="home-v2-account-tab-launcher" data-home-v2-account-tab-launcher onSubmit={(event) => void submit(event)}>
      <strong>{t('home2.account.openAppNewTab')}</strong>
      <label>
        <span>{t('home2.account.newTabAccount')}</span>
        <select data-home-v2-account-tab-target value={validSelection ? selection : ''} disabled={busy}
          onChange={(event) => { setSelection(event.target.value); setError(null) }}>
          <option value="" disabled>{t('home2.account.chooseNewTabAccount')}</option>
          <option value="none">{t('account.noAccount')}</option>
          {accountCatalogue.accounts.map((account) => <option key={account.id} value={`account:${account.id}`}>{account.label}</option>)}
        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" data-home-v2-account-tab-open disabled={busy || !validSelection} aria-busy={busy}>
        {t('home2.account.openNewTab')}
      </button>
    </form>
  )
}
