import type { HomeV2CoreUpdatePolicy } from '../../home-v2-live/core-manager-client'
import type { HomeV2CoreMaintenance } from '../../home-v2-live/core-maintenance-controller'
import { coreReleaseGate } from '../../home-v2-live/core-release-offer'
import { CoreProgressBar } from './HomeV2NodeCoreSection'
import { useScopedIds } from './dom-ids'
import { t } from '../../i18n'
import type { NetworkId } from '../contracts'

function corePolicyDescription(policy: HomeV2CoreUpdatePolicy) {
  if (policy === 'off') return 'Scheduled Qortium Core release checks are off.'
  if (policy === 'notify') {
    return 'Home checks the installed channel and reports a newer verified release without installing it.'
  }
  return 'Home installs a strictly newer verified release only after Qortium Core is proven stopped, without changing its channel.'
}

function javaPolicyDescription(policy: HomeV2CoreUpdatePolicy) {
  if (policy === 'off') return 'Scheduled managed-Java release checks are off.'
  if (policy === 'notify') {
    return 'Home reports a newer managed-Java generation without installing it.'
  }
  return 'Home installs only a verified newer immutable generation of the existing managed Java runtime.'
}

function qortalPolicyDescription(policy: HomeV2CoreUpdatePolicy) {
  if (policy === 'off') return 'Scheduled Qortal Core release checks are off.'
  if (policy === 'notify') {
    return 'Home reports a newer stable release only for a Home-managed GitHub install.'
  }
  return 'Home installs a strictly newer stable release only when its Home-managed Qortal Core is proven stopped. Adopted and node-native installs are never changed.'
}

/**
 * The Qortium/Qortal Core maintenance panel. It owns no state: the controller
 * is instantiated once per app and passed in, so this panel and the dashboard
 * tile always show the same busy flag, the same notice and the same release.
 */
export function CoreMaintenancePanel({
  maintenance,
  networks = ['qortium', 'qortal'],
  onOpenReleaseNotes,
  showJavaPolicy = true,
}: {
  readonly maintenance?: HomeV2CoreMaintenance
  readonly networks?: readonly NetworkId[]
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
  /**
   * Whether this instance owns the managed-Java update policy.
   *
   * Java belongs to the MACHINE, not to a network, but Settings renders one
   * panel per enabled network — so the same policy appeared twice on one page,
   * under two different network headings. The Qortal panel gives it up
   * whenever a Qortium panel is on the page to carry it.
   */
  readonly showJavaPolicy?: boolean
}) {
  const id = useScopedIds()
  const qortiumEnabled = networks.includes('qortium')
  const qortalEnabled = networks.includes('qortal')

  if (!maintenance?.available || networks.length === 0) return null
  const {
    busy,
    canRevealInstall,
    check,
    initialLoadFailed,
    installJava,
    notice,
    policy,
    confirmDowngrade,
    pendingDowngrade,
    installOnChainUpdate,
    refreshHelpers,
    release,
    revealInstall,
    runCore,
    selectedReleaseTag,
    setSelectedReleaseTag,
    setUpdatePolicy,
    status,
  } = maintenance

  if (!status || !policy) {
    return (
      <section className="home-v2-core-maintenance" aria-busy={!initialLoadFailed}
        aria-labelledby={id('core-maintenance-title')}>
        <div className="home-v2-settings-panel__heading">
          <h3 id={id('core-maintenance-title')}>Core maintenance</h3>
          {initialLoadFailed ? (
            <p className="home-v2-core-notice" role="alert">
              Core maintenance status is unavailable.
            </p>
          ) : <p role="status">Loading Core maintenance status…</p>}
        </div>
      </section>
    )
  }

  // The install gate, computed ONCE for the button, its label and the notice
  // below. They used to disagree twice over: the button offered "Update and
  // restart Core" while the notice underneath still told the reader to stop
  // Core first, and both were derived from `release.action` while `runCore()`
  // installed the effective offer instead -- which can be a DOWNGRADE while
  // `action` reads 'strict-update'. One derivation now feeds the label, the
  // enablement, the notice, the release-notes link and the mutation, here and
  // on the dashboard tile and the toolbar node menu.
  const gate = coreReleaseGate(release, selectedReleaseTag, status)
  const releaseBlocked = qortiumEnabled && gate.blocked
  // The checked tag is still worth linking when nothing is installable from it
  // ("already up to date"), so this falls back to it rather than disappearing.
  const releaseNotesTag = gate.offer?.tag ?? release?.tag ?? null

  const coreVersion = status.core.installedVersion ?? 'Not installed'
  const javaVersion = status.java.version
    ? `${status.java.version} (${status.java.source})`
    : status.java.source === 'missing' ? 'Not available' : status.java.source

  return (
    <section className="home-v2-core-maintenance" aria-busy={busy !== null}
      aria-labelledby={id('core-maintenance-title')}>
      <div className="home-v2-settings-panel__heading">
        <h3 id={id('core-maintenance-title')}>
          {qortiumEnabled
            ? 'Qortium Core maintenance'
            : 'Qortal Core maintenance'}
        </h3>
        <p>Review verified releases and automatic maintenance policies.</p>
      </div>
      {qortiumEnabled && status.core.installedVersion ? (
        <div className="home-v2-setting-row">
          <div className="home-v2-setting-row__copy">
            <strong id={id('qortium-core-update-policy-label')}>{t('core.coreUpdatePolicyLabel')}</strong>
            <span id={id('qortium-core-update-policy-description')}>
              {corePolicyDescription(policy.coreUpdatePolicy)}
            </span>
          </div>
          <select aria-labelledby={id('qortium-core-update-policy-label')}
            aria-describedby={id('qortium-core-update-policy-description')}
            data-home-v2-core-update-policy disabled={busy !== null}
            value={policy.coreUpdatePolicy}
            onChange={(event) => void setUpdatePolicy(
              'coreUpdatePolicy',
              event.target.value as HomeV2CoreUpdatePolicy,
            )}>
            <option value="off">{t('core.updatePolicy.off')}</option>
            <option value="notify">{t('core.updatePolicy.notify')}</option>
            <option value="install">{t('core.updatePolicy.install')}</option>
          </select>
        </div>
      ) : null}
      {showJavaPolicy && status.java.source === 'managed' ? (
        <div className="home-v2-setting-row">
          <div className="home-v2-setting-row__copy">
            <strong id={id('managed-java-update-policy-label')}>{t('core.javaUpdatePolicyLabel')}</strong>
            <span id={id('managed-java-update-policy-description')}>
              {javaPolicyDescription(policy.javaUpdatePolicy)}
            </span>
          </div>
          <select aria-labelledby={id('managed-java-update-policy-label')}
            aria-describedby={id('managed-java-update-policy-description')}
            data-home-v2-java-update-policy disabled={busy !== null}
            value={policy.javaUpdatePolicy}
            onChange={(event) => void setUpdatePolicy(
              'javaUpdatePolicy',
              event.target.value as HomeV2CoreUpdatePolicy,
            )}>
            <option value="off">{t('core.updatePolicy.off')}</option>
            <option value="notify">{t('core.updatePolicy.notify')}</option>
            <option value="install">{t('core.updatePolicy.install')}</option>
          </select>
        </div>
      ) : null}
      {qortalEnabled ? <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong id={id('qortal-core-update-policy-label')}>{t('core.qortalUpdatePolicyLabel')}</strong>
          <span id={id('qortal-core-update-policy-description')}>
            {qortalPolicyDescription(policy.qortalUpdatePolicy)}
          </span>
        </div>
        <select aria-labelledby={id('qortal-core-update-policy-label')}
          aria-describedby={id('qortal-core-update-policy-description')}
          data-home-v2-qortal-update-policy disabled={busy !== null}
          value={policy.qortalUpdatePolicy}
          onChange={(event) => void setUpdatePolicy(
            'qortalUpdatePolicy',
            event.target.value as HomeV2CoreUpdatePolicy,
          )}>
          <option value="off">{t('core.updatePolicy.off')}</option>
          <option value="notify">{t('core.updatePolicy.notify')}</option>
          <option value="install">{t('core.updatePolicy.install')}</option>
        </select>
      </div> : null}
      {policy.settingsIssue ? (
        <p className="home-v2-core-notice" role="alert">
          Stored update policies are unavailable. Automatic checks are off until you save a new policy.
        </p>
      ) : qortiumEnabled && policy.activity.core.state === 'pending-safe-state' ? (
        <p className="home-v2-core-notice" role="status">
          A verified Core update is waiting for Qortium Core to stop safely.
        </p>
      ) : qortalEnabled && policy.activity.qortal.state === 'pending-safe-state' ? (
        <p className="home-v2-core-notice" role="status">
          A verified Qortal Core update is waiting for Home-managed Qortal Core to stop safely.
        </p>
      ) : (qortiumEnabled && policy.activity.core.state === 'available') ||
        policy.activity.java.state === 'available' ? (
        <p className="home-v2-core-notice" role="status">
          {qortiumEnabled && policy.activity.core.version
            ? `Qortium Core ${policy.activity.core.version} is available.`
            : `Managed Java ${policy.activity.java.version ?? ''} is available.`}
        </p>
      ) : qortalEnabled && policy.activity.qortal.state === 'available' ? (
        <p className="home-v2-core-notice" role="status">
          Qortal Core {policy.activity.qortal.version ?? ''} is available.
        </p>
      ) : policy.activity.issue ? (
        <p className="home-v2-core-notice" role="alert">
          The last automatic maintenance pass did not complete.
        </p>
      ) : null}
      {qortiumEnabled ? <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>Qortium Core</strong>
          <span>{coreVersion}{status.core.channel ? ` · ${status.core.channel}` : ''}</span>
          {status.core.runtimeBlockedReason ? (
            // The status already said "runtime-blocked"; this says WHY, which
            // is the difference between a dead end and something actionable.
            <small data-home-v2-core-runtime-blocked role="status">
              {status.core.runtimeBlockedReason}
            </small>
          ) : null}
          {status.core.nodeAutoUpdateMode ? (
            <small data-home-v2-core-auto-update-mode={status.core.nodeAutoUpdateMode}>
              {t('home2.core.nodeAutoUpdateMode', { mode: status.core.nodeAutoUpdateMode })}
            </small>
          ) : null}
          {pendingDowngrade ? (
        // Going backwards is never implicit. The prompt names both versions,
        // because "downgrade?" without them is not something anyone can answer.
        <div className="home-v2-core-notice" role="alert" data-home-v2-core-downgrade-confirm>
          <p>
            {t('home2.core.downgradeConfirm', {
              installed: pendingDowngrade.installedVersion,
              target: pendingDowngrade.targetVersion,
            })}
          </p>
          <button className="home-v2-danger-button" type="button"
            disabled={busy !== null}
            onClick={() => void confirmDowngrade()}>
            {t('home2.core.downgradeConfirmAction')}
          </button>
        </div>
      ) : null}
      {status.capabilities.canRefreshHelpers && status.core.helpersOutOfSyncVersion ? (
        // The remedy that belongs with the "Modified since install" notice
        // below: 1.x offered this, Home 2 collected the fact and offered
        // nothing to do about it.
        //
        // "Helpers" are everything in a Core release EXCEPT the jar -- the
        // settings template carrying the bootstrap peer list, and the chain
        // config. Drift is computed by Home, not reported by the node: it reads
        // the installed jar's semver and compares against the matching GitHub
        // release. That lookup is a network call, so drift can be genuinely
        // UNKNOWN offline, which is why the status is null rather than false.
        <p className="home-v2-core-notice" data-home-v2-core-helpers-out-of-sync role="status">
          <span>
            {t('home2.core.helpersOutOfSync', { version: status.core.helpersOutOfSyncVersion })}
          </span>
          {' '}
          <button className="home-v2-link-button" type="button"
            disabled={busy !== null}
            onClick={() => void refreshHelpers()}>
            {t('home2.core.helpersRefresh')}
          </button>
        </p>
      ) : null}
      {status.core.installModified ? (
            // 1.x said so plainly and used it to offer a way back. Home 2 never
            // showed it at all, so a tampered or damaged install was invisible.
            <small data-home-v2-core-install-modified role="status">
              {t('home2.core.installModified')}
            </small>
          ) : null}
          {status.core.update ? (
            // Which SOURCE the waiting update comes from. An on-chain update is
            // installed by the node itself from a dev-group approved, QDN-pinned
            // manifest -- Home never downloads that binary -- so saying "update
            // available" without saying where would hide who does the work.
            <small data-home-v2-core-update-source={status.core.update.source}>
              {status.core.update.source === 'on-chain'
                ? t(status.core.update.action === 'installing'
                    ? 'home2.core.updateInstallingQdn'
                    : 'home2.core.updateAvailableQdn', { version: status.core.update.version })
                : t(status.core.update.action === 'installing'
                    ? 'home2.core.updateInstallingGithub'
                    : 'home2.core.updateAvailableGithub', { version: status.core.update.version })}
            </small>
          ) : null}
          {status.core.updateSources &&
            (status.core.updateSources.github || status.core.updateSources.onChain) ? (
            // What EACH source offers, so "nothing newer on the chain" is
            // distinguishable from "the chain was not consulted". The row above
            // names only the winner, and during a rollout the two sources
            // routinely disagree.
            <small data-home-v2-core-update-sources>
              {[
                status.core.updateSources.onChain
                  ? t('home2.core.updateSourceQdn', {
                      version: status.core.updateSources.onChain.commit
                        ? `${status.core.updateSources.onChain.version} (${status.core.updateSources.onChain.commit.slice(0, 12)})`
                        : status.core.updateSources.onChain.version,
                    })
                  : t('home2.core.updateSourceQdnNone'),
                status.core.updateSources.github
                  ? t('home2.core.updateSourceGithub', {
                      version: status.core.updateSources.github.version,
                    })
                  : t('home2.core.updateSourceGithubNone'),
              ].join(' · ')}
            </small>
          ) : null}
          {status.core.localApiUrl ? (
            // The node's own address, so other tools can be pointed at it. Not
            // a secret and deliberately not the API KEY, which this contract
            // does redact: this is a loopback URL on a published port.
            <small data-home-v2-core-local-api-url>
              {t('home2.core.localApiUrl', { url: status.core.localApiUrl })}
            </small>
          ) : null}
          {status.core.installedTag || status.core.installedCommit ? (
            // Which BUILD, not just which version: 1.x showed these, and two
            // builds of one version are otherwise indistinguishable. The
            // install path and jar path stay out of the RENDERER, which this
            // contract redacts on purpose — but that never required the folder
            // itself to be unreachable: Show install folder below opens it from
            // the main process without sending a path here.
            <small data-home-v2-core-build>
              {[
                status.core.installedTag,
                status.core.installedCommit
                  ? status.core.installedCommit.slice(0, 12)
                  : null,
              ].filter(Boolean).join(' · ')}
            </small>
          ) : null}
        </div>
        <div className="home-v2-setting-row__control home-v2-core-maintenance__actions">
          <button className="home-v2-secondary-button" type="button" disabled={busy !== null} onClick={() => void check()}>
            {busy === 'check' ? 'Checking…' : 'Check release'}
          </button>
          {status.capabilities.canInstallOnChainUpdate ? (
            // Asks the NODE to install it. Home downloads nothing, so this is
            // not the same action as the release install beside it.
            <button className="home-v2-secondary-button" type="button"
              data-home-v2-core-install-on-chain
              disabled={busy !== null}
              onClick={() => void installOnChainUpdate()}>
              {t('home2.core.installFromQdn')}
            </button>
          ) : null}
          {canRevealInstall && status.core.installedVersion ? (
            <button className="home-v2-secondary-button" type="button"
              data-home-v2-core-reveal-install
              onClick={() => void revealInstall()}>
              Show install folder
            </button>
          ) : null}
          {release && (release.offers.length > 1 ||
            release.offers.some((offer) => offer.relation === 'downgrade')) ? (
            // Home 2 previously installed whatever channel was already
            // installed. Both are offered now: the newest stable always, and a
            // prerelease only when it is strictly newer than that stable.
            <label className="home-v2-account-select">
              <span>{t('home2.core.releaseChoice')}</span>
              <select
                aria-label={t('home2.core.releaseChoice')}
                data-home-v2-core-release-choice
                disabled={busy !== null}
                value={selectedReleaseTag ?? release.offers[0].tag}
                onChange={(event) => setSelectedReleaseTag(event.target.value)}
              >
                {release.offers.map((offer) => (
                  <option key={`${offer.channel}:${offer.tag}`} value={offer.tag}>
                    {offer.relation === 'downgrade'
                      ? t('home2.core.releaseOlder', { tag: offer.tag })
                      : offer.channel === 'prerelease'
                        ? t('home2.core.releasePrerelease', { tag: offer.tag })
                        : t('home2.core.releaseStable', { tag: offer.tag })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {gate.offer ? (
            // The button describes the offer that will actually install: the
            // one the user picked, else the newest stable. `release.action`
            // describes only the forward move on the checked channel, so a
            // release offered ONLY as a downgrade has no action at all and a
            // downgrade can sit first while `action` reads 'strict-update'.
            <button className="home-v2-primary-button" type="button"
              data-home-v2-core-release-target={gate.offer.tag}
              disabled={busy !== null || releaseBlocked} onClick={() => void runCore()}>
              {busy === 'core'
                ? 'Working…'
                : gate.offer.relation === 'downgrade'
                  ? t('home2.core.downgradeStart')
                  : gate.offer.relation === 'initial-install'
                    ? 'Install Core'
                    : gate.restartsCore ? 'Update and restart Core' : 'Update Core'}
            </button>
          ) : null}
          {releaseNotesTag && onOpenReleaseNotes ? (
            // The notes for the release that would install, not for whichever
            // tag the last check happened to name.
            <button
              className="home-v2-link-button"
              data-home-v2-core-release-notes={releaseNotesTag}
              type="button"
              onClick={() => onOpenReleaseNotes({ product: 'core', tagName: releaseNotesTag })}
            >
              {t('releaseNotes.open')}
            </button>
          ) : null}
        </div>
        <CoreProgressBar progress={maintenance.progress} />
      </div> : null}
      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>Managed Java</strong>
          <span>{javaVersion}</span>
        </div>
        <div className="home-v2-setting-row__control">
          <button type="button" className="home-v2-secondary-button"
            disabled={busy !== null || !status.capabilities.canInstallJava} onClick={() => void installJava()}>
            {busy === 'java'
              ? 'Installing…'
              // Name the version being installed, as 1.x did. A bare
              // "Update Java" does not say WHAT it is about to put on the
              // machine; the target falls back to the generic wording only when
              // the Core cannot report it.
              : status.java.targetMajorVersion === null
                ? (status.java.source === 'managed' ? 'Update Java' : 'Install Java')
                : status.java.source === 'managed'
                  ? t('home2.core.javaUpdateToVersion', { version: status.java.targetMajorVersion })
                  : t('home2.core.javaInstallVersion', { version: status.java.targetMajorVersion })}
          </button>
        </div>
      </div>
      {releaseBlocked ? (
        // 'unknown' is NOT 'running': telling someone to stop a Core Home
        // cannot see is how they end up stopping it again and being told the
        // same thing. The gate stays closed either way, but the reason has to
        // be truthful about which case it is.
        <p className="home-v2-core-notice">
          {gate.blockedReason === 'core-state-unknown'
            ? t('home2.nodeCore.coreStateUnknown')
            : t('home2.nodeCore.stopCoreFirst')}
        </p>
      ) : null}
      {notice ? <p className="home-v2-core-notice" role="status">{notice}</p> : null}
    </section>
  )
}
