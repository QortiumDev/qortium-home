import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import type { HomeV2AppUpdatePolicy } from '../../home-v2-live/app-update-preferences'
import { formatUpdateBytes } from '../../home-v2-live/app-update-controller'
import { t } from '../../i18n'

export function homeUpdateStatusText(updates: HomeV2AppUpdates) {
  const result = updates.result
  if (updates.busy === 'check') return t('common.checking')
  if (!updates.preferencesLoaded) return t('common.loading')
  if (!result && updates.homeUpdatePolicy === 'off') return t('updates.homeUpdatePolicy.off')
  if (!result) return t('common.unavailable')
  if (result.state === 'available') {
    return t('updates.available', {
      platform: result.platform.label,
      tag: result.release?.tagName ?? '',
    })
  }
  if (result.state === 'up-to-date') {
    return t('updates.upToDateOnChannel', { channel: updates.channel })
  }
  if (result.state === 'no-compatible-asset') {
    return t('updates.noCompatibleAsset', {
      platform: result.platform.label,
      tag: result.release?.tagName ?? '',
    })
  }
  return updates.message?.text ?? t('updates.checkReleasesFailed')
}
export function HomeUpdateSettings({
  onOpenReleaseNotes,
  updates,
}: {
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
  readonly updates: HomeV2AppUpdates
}) {
  const result = updates.result
  const isAndroid = updates.isAndroid
  const busy = updates.busy !== null
  return (
    <section
      className="home-v2-settings-panel home-v2-app-updates"
      data-home-v2-app-updates={isAndroid ? 'android' : 'desktop'}
      aria-busy={busy}
      aria-labelledby="home-update-settings-title"
    >
      <div className="home-v2-settings-panel__heading">
        <h2 id="home-update-settings-title">{t('common.appName')}</h2>
        <p aria-live="polite" role="status">{homeUpdateStatusText(updates)}</p>
      </div>

      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong id="home-update-policy-label">{t('updates.homeUpdatePolicyLabel')}</strong>
          <span id="home-update-policy-description">{updates.homeUpdatePolicy === 'auto-download'
            ? t('updates.homeUpdatePolicy.autoDownload')
            : updates.homeUpdatePolicy === 'notify'
              ? t('updates.homeUpdatePolicy.notify')
              : t('updates.homeUpdatePolicy.off')}</span>
        </div>
        <select
          aria-label={t('updates.homeUpdatePolicyLabel')}
          aria-labelledby="home-update-policy-label"
          aria-describedby="home-update-policy-description"
          data-home-v2-update-policy
          disabled={busy || !updates.preferencesLoaded}
          value={updates.homeUpdatePolicy}
          onChange={(event) =>
            updates.setHomeUpdatePolicy(event.target.value as HomeV2AppUpdatePolicy)
          }
        >
          <option value="off">{t('updates.homeUpdatePolicy.off')}</option>
          <option value="notify">{t('updates.homeUpdatePolicy.notify')}</option>
          <option value="auto-download" disabled={isAndroid}>
            {t('updates.homeUpdatePolicy.autoDownload')}
          </option>
        </select>
      </div>

      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>{t('updates.releaseChannelLabel')}</strong>
          <span>{t('updates.checkForUpdates')}</span>
        </div>
        <div className="home-v2-setting-row__control home-v2-update-controls">
          <select
            aria-label={t('updates.releaseChannelLabel')}
            disabled={busy || !updates.preferencesLoaded}
            value={updates.channel}
            onChange={(event) =>
              updates.setChannel(event.target.value as 'prerelease' | 'stable')
            }
          >
            <option value="stable">{t('updates.channelStable')}</option>
            <option value="prerelease">{t('updates.channelPrerelease')}</option>
          </select>
          <button
            className="home-v2-secondary-button"
            data-home-v2-update-action="check"
            disabled={busy || !updates.preferencesLoaded}
            type="button"
            onClick={() => void updates.check()}
          >
            {updates.busy === 'check' ? t('common.checking') : t('updates.checkForUpdates')}
          </button>
        </div>
      </div>

      <dl className="home-v2-update-details">
        <div><dt>{t('common.current')}</dt><dd>{result?.currentVersion ?? '-'}</dd></div>
        <div><dt>{t('common.platform')}</dt><dd>{result?.platform.label ?? '-'}</dd></div>
        {result?.release ? (
          <div><dt>{t('common.latest')}</dt><dd>{result.release.tagName}</dd></div>
        ) : null}
        {result?.asset ? (
          <>
            <div><dt>{t('updates.assetLabel')}</dt><dd>{result.asset.name}</dd></div>
            <div><dt>{t('common.size')}</dt><dd>{updates.formattedSize}</dd></div>
            <div><dt>{t('updates.verifiedLabel')}</dt><dd>{t('common.yes')}</dd></div>
          </>
        ) : null}
        {updates.download ? (
          <div><dt>{t('common.downloaded')}</dt><dd>{updates.download.fileName}</dd></div>
        ) : null}
      </dl>

      {updates.progress ? (
        <div
          className="home-v2-core-progress"
          data-home-v2-update-progress={updates.progress.action}
        >
          <div
            aria-label={updates.progress.message}
            aria-valuemax={updates.progress.percent === null ? undefined : 100}
            aria-valuemin={updates.progress.percent === null ? undefined : 0}
            aria-valuenow={updates.progress.percent ?? undefined}
            className="home-v2-core-progress__track"
            data-indeterminate={updates.progress.percent === null ? 'true' : undefined}
            role="progressbar"
          >
            <div
              className="home-v2-core-progress__fill"
              style={updates.progress.percent === null
                ? undefined
                : { width: `${updates.progress.percent}%` }}
            />
          </div>
          <span className="home-v2-core-progress__message">
            {/* Bytes as well as percent: a download with no content-length
                still shows movement, which is the case 1.x covered and
                "Downloading…" did not. */}
            {updates.progress.totalBytes === null
              ? `${updates.progress.message} (${formatUpdateBytes(updates.progress.receivedBytes)})`
              : `${updates.progress.message} ${updates.progress.percent}% (${
                formatUpdateBytes(updates.progress.receivedBytes)
              } / ${formatUpdateBytes(updates.progress.totalBytes)})`}
          </span>
        </div>
      ) : null}

      <div className="home-v2-update-actions">
        {result?.state === 'available' && result.asset?.digestAvailable && !updates.download ? (
          <button
            className="home-v2-primary-button"
            data-home-v2-update-action="download"
            disabled={busy}
            type="button"
            onClick={() => void updates.downloadUpdate()}
          >
            {updates.busy === 'download' ? t('common.downloading') : t('updates.downloadUpdate')}
          </button>
        ) : null}
        {updates.download?.canOpen ? (
          <button
            className="home-v2-primary-button"
            data-home-v2-update-action="open"
            disabled={busy}
            type="button"
            onClick={() => void updates.openDownloaded()}
          >
            {isAndroid ? t('updates.installApk') : t('common.openFile')}
          </button>
        ) : null}
        {!isAndroid && updates.download?.canReveal ? (
          <button
            className="home-v2-secondary-button"
            data-home-v2-update-action="reveal"
            disabled={busy}
            type="button"
            onClick={() => void updates.revealDownloaded()}
          >
            {t('updates.showFile')}
          </button>
        ) : null}
        {result?.release ? (
          <button
            className="home-v2-link-button"
            data-home-v2-update-action="release"
            disabled={busy}
            type="button"
            onClick={() => onOpenReleaseNotes
              ? onOpenReleaseNotes({ product: 'home', tagName: result.release!.tagName })
              : void updates.openReleasePage()}
          >
            {t('releaseNotes.open')}
          </button>
        ) : null}
      </div>

      {updates.message ? (
        <p
          className="home-v2-update-message"
          data-tone={updates.message.tone}
          role="status"
        >
          {updates.message.text}
        </p>
      ) : null}
    </section>
  )
}
