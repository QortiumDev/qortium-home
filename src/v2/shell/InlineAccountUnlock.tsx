import { useEffect, useRef, useState, type FormEvent } from 'react'
import { t } from '../../i18n'
import { translateMainProcessMessage } from '../../mainProcessMessage'

export interface InlineUnlockSubmission {
  readonly password?: string
  readonly useRememberedUnlock: boolean
}

/** Typed field state belongs to the open menu; a submitted unlock may outlive it. */
export function InlineAccountUnlock({ rememberedUnlockAvailable = false, onSubmit, onCancel }: {
  readonly rememberedUnlockAvailable?: boolean
  readonly onSubmit: (value: InlineUnlockSubmission) => Promise<void>
  readonly onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [remembered, setRemembered] = useState(rememberedUnlockAvailable)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const useRememberedUnlock = rememberedUnlockAvailable && remembered
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    const value = { password: useRememberedUnlock ? undefined : password, useRememberedUnlock }
    setPassword('')
    try {
      await onSubmit(value)
      // A tab switch/dismissal may have mounted a different menu meanwhile.
      if (mounted.current) onCancel()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error
        ? translateMainProcessMessage(cause.message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
        : t('account.actionFailed'))
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <form className="home-v2-inline-unlock" onSubmit={(event) => void submit(event)}>
      {rememberedUnlockAvailable ? (
        <label className="home-v2-inline-unlock__remember">
          <input autoFocus={useRememberedUnlock} type="checkbox" checked={useRememberedUnlock} disabled={busy}
            onChange={(event) => setRemembered(event.target.checked)} />
          <span>{t('home2.accountDialog.useRememberedUnlock')}</span>
        </label>
      ) : null}
      {!useRememberedUnlock ? (
        <label>
          <span>{t('common.password')}</span>
          <input autoFocus autoComplete="current-password" type="password" required value={password}
            disabled={busy} onChange={(event) => setPassword(event.target.value)} />
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="home-v2-inline-unlock__actions">
        <button type="button" onClick={onCancel}>{busy ? t('home2.common.close') : t('common.cancel')}</button>
        <button type="submit" aria-busy={busy} disabled={busy}>
          {busy ? t('common.unlocking') : t('common.unlock')}
        </button>
      </div>
    </form>
  )
}
