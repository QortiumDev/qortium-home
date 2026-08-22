import { useEffect, useState } from 'react'
import type {
  HomeV2CoreMaintenanceRelease,
  HomeV2CoreMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import {
  parseHomeV2CoreMaintenanceActionResult,
  parseHomeV2CoreMaintenanceRelease,
  parseHomeV2CoreMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import type { HomeV2CoreManagement } from './CoreManagerCards'

export function CoreMaintenancePanel({ management }: { readonly management: HomeV2CoreManagement }) {
  const client = window.homeV2CoreManagers
  const [status, setStatus] = useState<HomeV2CoreMaintenanceStatus | null>(null)
  const [release, setRelease] = useState<HomeV2CoreMaintenanceRelease | null>(null)
  const [busy, setBusy] = useState<'check' | 'core' | 'java' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = async () => {
    if (!client) return
    setStatus(parseHomeV2CoreMaintenanceStatus(await client.getMaintenanceStatus()))
  }

  useEffect(() => {
    void refresh().catch(() => setNotice('Core maintenance status is unavailable.'))
  }, [client])

  if (!client || !status) return null

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
      setStatus(result.status)
      setRelease(null)
      setNotice(result.outcome === 'completed'
        ? 'Qortium Core maintenance completed.'
        : result.code === 'release-changed'
          ? 'The release changed. Check again before installing.'
          : 'Qortium Core maintenance was not completed.')
      management.onRefresh?.()
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
      setStatus(result.status)
      setNotice(result.outcome === 'completed'
        ? 'Managed Java installation completed.'
        : 'Managed Java installation was not completed.')
      management.onRefresh?.()
    } catch {
      setNotice('Managed Java installation failed.')
    } finally {
      setBusy(null)
    }
  }

  const coreVersion = status.core.installedVersion ?? 'Not installed'
  const javaVersion = status.java.version
    ? `${status.java.version} (${status.java.source})`
    : status.java.source === 'missing' ? 'Not available' : status.java.source

  return (
    <section className="home-v2-core-maintenance" aria-labelledby="core-maintenance-title">
      <div className="home-v2-settings-panel__heading">
        <h3 id="core-maintenance-title">Qortium Core maintenance</h3>
        <p>Install a verified Preview release or update an existing Home-managed Core.</p>
      </div>
      <div className="home-v2-setting-row">
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
      </div>
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
      {status.core.runtime !== 'stopped' && release?.action !== 'none' ? (
        <p className="home-v2-core-notice">Stop Qortium Core before installing or updating it.</p>
      ) : null}
      {notice ? <p className="home-v2-core-notice" role="status">{notice}</p> : null}
    </section>
  )
}
