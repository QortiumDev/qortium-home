import type { HomeV2CoreUpdatePolicy } from '../../home-v2-live/core-manager-client'
import type { HomeV2CoreMaintenance } from '../../home-v2-live/core-maintenance-controller'
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
}: {
  readonly maintenance?: HomeV2CoreMaintenance
  readonly networks?: readonly NetworkId[]
}) {
  const qortiumEnabled = networks.includes('qortium')
  const qortalEnabled = networks.includes('qortal')

  if (!maintenance?.available || networks.length === 0) return null
  const {
    busy,
    check,
    initialLoadFailed,
    installJava,
    notice,
    policy,
    release,
    runCore,
    setUpdatePolicy,
    status,
  } = maintenance

  if (!status || !policy) {
    return (
      <section className="home-v2-core-maintenance" aria-busy={!initialLoadFailed}
        aria-labelledby="core-maintenance-title">
        <div className="home-v2-settings-panel__heading">
          <h3 id="core-maintenance-title">Core maintenance</h3>
          {initialLoadFailed ? (
            <p className="home-v2-core-notice" role="alert">
              Core maintenance status is unavailable.
            </p>
          ) : <p role="status">Loading Core maintenance status…</p>}
        </div>
      </section>
    )
  }

  const coreVersion = status.core.installedVersion ?? 'Not installed'
  const javaVersion = status.java.version
    ? `${status.java.version} (${status.java.source})`
    : status.java.source === 'missing' ? 'Not available' : status.java.source

  return (
    <section className="home-v2-core-maintenance" aria-busy={busy !== null}
      aria-labelledby="core-maintenance-title">
      <div className="home-v2-settings-panel__heading">
        <h3 id="core-maintenance-title">
          {qortiumEnabled
            ? 'Qortium Core maintenance'
            : 'Qortal Core maintenance'}
        </h3>
        <p>Review verified releases and automatic maintenance policies.</p>
      </div>
      {qortiumEnabled && status.core.installedVersion ? (
        <div className="home-v2-setting-row">
          <div className="home-v2-setting-row__copy">
            <strong id="qortium-core-update-policy-label">{t('core.coreUpdatePolicyLabel')}</strong>
            <span id="qortium-core-update-policy-description">
              {corePolicyDescription(policy.coreUpdatePolicy)}
            </span>
          </div>
          <select aria-labelledby="qortium-core-update-policy-label"
            aria-describedby="qortium-core-update-policy-description"
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
      {status.java.source === 'managed' ? (
        <div className="home-v2-setting-row">
          <div className="home-v2-setting-row__copy">
            <strong id="managed-java-update-policy-label">{t('core.javaUpdatePolicyLabel')}</strong>
            <span id="managed-java-update-policy-description">
              {javaPolicyDescription(policy.javaUpdatePolicy)}
            </span>
          </div>
          <select aria-labelledby="managed-java-update-policy-label"
            aria-describedby="managed-java-update-policy-description"
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
          <strong id="qortal-core-update-policy-label">{t('core.qortalUpdatePolicyLabel')}</strong>
          <span id="qortal-core-update-policy-description">
            {qortalPolicyDescription(policy.qortalUpdatePolicy)}
          </span>
        </div>
        <select aria-labelledby="qortal-core-update-policy-label"
          aria-describedby="qortal-core-update-policy-description"
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
        </div>
        <div className="home-v2-setting-row__control home-v2-core-maintenance__actions">
          <button className="home-v2-secondary-button" type="button" disabled={busy !== null} onClick={() => void check()}>
            {busy === 'check' ? 'Checking…' : 'Check release'}
          </button>
          {release?.tag && release.action !== 'none' ? (() => {
            // Same rule as the dashboard tile, deliberately read from the same
            // capability rather than re-derived: an update to a Home-started
            // Core no longer needs it stopped first. Leaving this panel on the
            // old gate would have shipped the feature half-wired — enabled on
            // the dashboard, disabled in Settings.
            const canUpdateInPlace = release.action !== 'initial-install' &&
              status.capabilities.canUpdateRunningInPlace
            const blocked = status.core.runtime !== 'stopped' && !canUpdateInPlace
            const restarts = canUpdateInPlace && status.core.runtime === 'running'
            return (
              <button className="home-v2-primary-button" type="button"
                disabled={busy !== null || blocked} onClick={() => void runCore()}>
                {busy === 'core'
                  ? 'Working…'
                  : release.action === 'initial-install'
                    ? 'Install Core'
                    : restarts ? 'Update and restart Core' : 'Update Core'}
              </button>
            )
          })() : null}
        </div>
      </div> : null}
      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>Managed Java</strong>
          <span>{javaVersion}</span>
        </div>
        <div className="home-v2-setting-row__control">
          <button type="button" className="home-v2-secondary-button"
            disabled={busy !== null || !status.capabilities.canInstallJava} onClick={() => void installJava()}>
            {busy === 'java' ? 'Installing…' : status.java.source === 'managed' ? 'Update Java' : 'Install Java'}
          </button>
        </div>
      </div>
      {qortiumEnabled && status.core.runtime !== 'stopped' && release?.action !== 'none' ? (
        <p className="home-v2-core-notice">Stop Qortium Core before installing or updating it.</p>
      ) : null}
      {notice ? <p className="home-v2-core-notice" role="status">{notice}</p> : null}
    </section>
  )
}
