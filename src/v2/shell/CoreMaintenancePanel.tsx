import { useEffect, useRef, useState } from 'react'
import type {
  HomeV2CoreMaintenanceRelease,
  HomeV2CoreMaintenanceStatus,
  HomeV2CoreUpdatePolicy,
  HomeV2CoreUpdatePolicyState,
} from '../../home-v2-live/core-manager-client'
import {
  parseHomeV2CoreMaintenanceActionResult,
  parseHomeV2CoreMaintenanceRelease,
  parseHomeV2CoreMaintenanceStatus,
  parseHomeV2CoreUpdatePolicySetResult,
  parseHomeV2CoreUpdatePolicyState,
} from '../../home-v2-live/core-manager-client'
import { t } from '../../i18n'
import type { NetworkId } from '../contracts'
import type { HomeV2CoreManagement } from './CoreManagerCards'

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

export function CoreMaintenancePanel({
  management,
  networks = ['qortium', 'qortal'],
}: {
  readonly management: HomeV2CoreManagement
  readonly networks?: readonly NetworkId[]
}) {
  const client = window.homeV2CoreManagers
  const qortiumEnabled = networks.includes('qortium')
  const qortalEnabled = networks.includes('qortal')
  const [status, setStatus] = useState<HomeV2CoreMaintenanceStatus | null>(null)
  const [policy, setPolicy] = useState<HomeV2CoreUpdatePolicyState | null>(null)
  const [release, setRelease] = useState<HomeV2CoreMaintenanceRelease | null>(null)
  const [busy, setBusy] = useState<'check' | 'core' | 'java' | 'policy' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [initialLoadFailed, setInitialLoadFailed] = useState(false)
  const disposed = useRef(false)
  const statusRef = useRef<HomeV2CoreMaintenanceStatus | null>(null)
  const policyRef = useRef<HomeV2CoreUpdatePolicyState | null>(null)
  const requestSequence = useRef(0)
  const policyWriteRevision = useRef(0)
  const pendingPolicyWrites = useRef(0)
  const policyWrites = useRef<Promise<void>>(Promise.resolve())

  const refresh = async () => {
    if (!client || pendingPolicyWrites.current > 0) return
    const sequence = ++requestSequence.current
    const writeRevision = policyWriteRevision.current
    try {
      const [nextStatusValue, nextPolicyValue] = await Promise.all([
        client.getMaintenanceStatus(),
        client.getUpdatePolicy(),
      ])
      if (disposed.current || sequence !== requestSequence.current ||
        writeRevision !== policyWriteRevision.current || pendingPolicyWrites.current > 0) return
      const nextStatus = parseHomeV2CoreMaintenanceStatus(nextStatusValue)
      const nextPolicy = parseHomeV2CoreUpdatePolicyState(nextPolicyValue)
      statusRef.current = nextStatus
      policyRef.current = nextPolicy
      setStatus(nextStatus)
      setPolicy(nextPolicy)
      setInitialLoadFailed(false)
    } catch (error) {
      if (!disposed.current && sequence === requestSequence.current && !statusRef.current) {
        setInitialLoadFailed(true)
      }
      throw error
    }
  }

  useEffect(() => {
    disposed.current = false
    void refresh().catch(() => undefined)
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 30_000)
    return () => {
      disposed.current = true
      window.clearInterval(interval)
      requestSequence.current += 1
      policyWriteRevision.current += 1
    }
  }, [client])

  useEffect(() => {
    setRelease(null)
    setNotice(null)
  }, [qortalEnabled, qortiumEnabled])

  if (!client || networks.length === 0) return null
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

  const check = async () => {
    setBusy('check')
    setNotice(null)
    try {
      const next = parseHomeV2CoreMaintenanceRelease(await client.checkMaintenanceRelease())
      setRelease(next)
      setNotice(!next.available
        ? 'No verified release is available.'
        : next.action === 'none'
          ? `${next.tag} is not newer than the installed Core.`
          : `${next.tag} is ready for ${next.action === 'initial-install' ? 'installation' : 'update'}.`)
    } catch {
      setRelease(null)
      setNotice('The Qortium Core release check failed.')
    } finally {
      setBusy(null)
    }
  }

  const runCore = async () => {
    if (!release?.tag || release.action === 'none') return
    setBusy('core')
    setNotice(null)
    try {
      const result = parseHomeV2CoreMaintenanceActionResult(await client.runMaintenanceAction(
        release.action,
        { channel: release.channel, expectedTag: release.tag },
      ))
      statusRef.current = result.status
      setStatus(result.status)
      setRelease(null)
      setNotice(result.outcome === 'completed'
        ? 'Qortium Core maintenance completed.'
        : result.code === 'release-changed'
          ? 'The release changed. Check again before installing.'
          : 'Qortium Core maintenance was not completed.')
      management.onRefresh?.()
      void refresh().catch(() => undefined)
    } catch {
      setNotice('Qortium Core maintenance failed.')
    } finally {
      setBusy(null)
    }
  }

  const installJava = async () => {
    setBusy('java')
    setNotice(null)
    try {
      const result = parseHomeV2CoreMaintenanceActionResult(
        await client.runMaintenanceAction('install-java'),
      )
      statusRef.current = result.status
      setStatus(result.status)
      setNotice(result.outcome === 'completed'
        ? 'Managed Java installation completed.'
        : 'Managed Java installation was not completed.')
      management.onRefresh?.()
      void refresh().catch(() => undefined)
    } catch {
      setNotice('Managed Java installation failed.')
    } finally {
      setBusy(null)
    }
  }

  const setUpdatePolicy = (
    field: 'coreUpdatePolicy' | 'javaUpdatePolicy' | 'qortalUpdatePolicy',
    value: HomeV2CoreUpdatePolicy,
  ) => {
    if (!policyRef.current) return
    const revision = ++policyWriteRevision.current
    pendingPolicyWrites.current += 1
    setBusy('policy')
    setNotice(null)
    requestSequence.current += 1

    const write = async () => {
      try {
        const current = policyRef.current
        if (!current) throw new Error('Core update policy is unavailable.')
        let result = parseHomeV2CoreUpdatePolicySetResult(
          await client.setUpdatePolicy(current.generation, field, value),
        )
        policyRef.current = result.state
        if (result.outcome === 'conflict' && result.state[field] !== value) {
          result = parseHomeV2CoreUpdatePolicySetResult(
            await client.setUpdatePolicy(result.state.generation, field, value),
          )
          policyRef.current = result.state
        }
        if (result.state[field] !== value ||
          (result.outcome !== 'saved' && result.outcome !== 'conflict')) {
          throw new Error('Core update policy changed again in another Home window.')
        }
        if (!disposed.current && revision === policyWriteRevision.current) {
          setPolicy(result.state)
          setRelease(null)
          setNotice('Automatic update policy saved.')
        }
      } catch {
        try {
          const latest = parseHomeV2CoreUpdatePolicyState(await client.getUpdatePolicy())
          policyRef.current = latest
          if (!disposed.current && revision === policyWriteRevision.current) setPolicy(latest)
        } catch {
          // Keep the last confirmed renderer state if reconciliation is unavailable.
        }
        if (!disposed.current && revision === policyWriteRevision.current) {
          setNotice('The automatic update policy could not be saved.')
        }
      } finally {
        pendingPolicyWrites.current -= 1
        if (!disposed.current && revision === policyWriteRevision.current &&
          pendingPolicyWrites.current === 0) {
          setBusy(null)
        }
      }
    }

    policyWrites.current = policyWrites.current
      .catch(() => undefined)
      .then(write)
    void policyWrites.current.catch(() => undefined)
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
          <button type="button" disabled={busy !== null} onClick={() => void check()}>
            {busy === 'check' ? 'Checking…' : 'Check release'}
          </button>
          {release?.tag && release.action !== 'none' ? (
            <button className="home-v2-primary-button" type="button"
              disabled={busy !== null || status.core.runtime !== 'stopped'} onClick={() => void runCore()}>
              {busy === 'core' ? 'Working…' : release.action === 'initial-install' ? 'Install Core' : 'Update Core'}
            </button>
          ) : null}
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
