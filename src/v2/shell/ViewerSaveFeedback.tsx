import { useCallback, useSyncExternalStore } from 'react'
import { t } from '../../i18n'
import { viewerSaveStore, type ViewerSaveKey, type ViewerSaveState } from './viewer-save-state'

export function useViewerSave(key: ViewerSaveKey) {
  const subscribe = useCallback((listener: () => void) => viewerSaveStore.subscribe(key, listener), [key])
  const snapshot = useCallback(() => viewerSaveStore.snapshot(key), [key])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  const run = useCallback((filename: string, operation: () => Promise<{ canceled: boolean }>) =>
    viewerSaveStore.run(key, filename, operation), [key])
  return { state, run, busy: state.phase === 'saving' }
}

export function ViewerSaveFeedback({ state }: { state: ViewerSaveState }) {
  const label = state.phase === 'saving' ? t('common.saving')
    : state.phase === 'saved' ? t('viewer.download.saved')
    : state.phase === 'canceled' ? t('home2.resourceViewer.saveCanceled')
    : state.phase === 'error' ? t('viewer.download.saveFailed') : ''
  return <div className="home-v2-viewer-save-feedback" data-save-phase={state.phase}>
    <span role="status" aria-live="polite" aria-atomic="true">
      {state.phase !== 'error' && label ? `${label} — ${state.filename}` : ''}
    </span>
    {state.phase === 'error' ? <span role="alert">{label} — {state.filename}. {t('home2.resourceViewer.saveRetry')}</span> : null}
  </div>
}
