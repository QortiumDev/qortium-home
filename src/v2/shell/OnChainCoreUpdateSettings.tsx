import { t } from '../../i18n'
import type { HomeV2OnChainCoreUpdates } from '../../home-v2-live/on-chain-core-update-controller'

export function OnChainCoreUpdateSettings({
  updates,
}: {
  readonly updates: HomeV2OnChainCoreUpdates
}) {
  const busy = updates.busy !== null

  return (
    <section
      aria-busy={busy}
      aria-labelledby="on-chain-core-update-title"
      className="home-v2-settings-panel home-v2-on-chain-core-updates"
      data-home-v2-on-chain-core-updates
    >
      <div className="home-v2-settings-panel__heading">
        <h2 id="on-chain-core-update-title">{t('core.sectionTitle')}</h2>
        <p aria-live="polite" data-tone={updates.tone} role="status">
          {updates.message}
        </p>
      </div>

      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>{t('core.approvedUpdateLabel')}</strong>
          <span>{t('core.updateChannel.onChain')}</span>
        </div>
        <div className="home-v2-setting-row__control home-v2-update-controls">
          <button
            className="home-v2-secondary-button"
            data-home-v2-on-chain-core-update-action="check"
            disabled={busy || !updates.authenticated}
            type="button"
            onClick={() => void updates.check()}
          >
            {updates.busy === 'check'
              ? t('common.checking')
              : t('updates.checkForUpdates')}
          </button>
          {updates.canInstall ? (
            <button
              className="home-v2-primary-button"
              data-home-v2-on-chain-core-update-action="install"
              disabled={busy || !updates.authenticated}
              type="button"
              onClick={() => void updates.install()}
            >
              {updates.busy === 'install'
                ? t('common.installing')
                : t('core.installApprovedUpdate')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
