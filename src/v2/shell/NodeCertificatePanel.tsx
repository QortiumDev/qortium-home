import { useCallback, useEffect, useRef, useState } from 'react'
import type { HomeV2NodeCertificateStatus } from '../../home-v2-live/node-client'

// Confirming a remote node's certificate by hand, in the Home 2 shell.
//
// Home pins the certificate of every non-loopback HTTPS node it talks to,
// whoever issued it: a public CA vouches for a domain name, not for the
// machine being the node you meant, and Home would otherwise send that node's
// API key. Until the fingerprint is confirmed the route stays offline. The
// legacy shell had this panel (src/NodeCertificateConfirmation.tsx); the v2
// shell shipped without it, so a custom HTTPS node could never come online
// (found live 2026-09-13).

export interface NodeCertificatePanelProps {
  readonly nodeApiUrl: string
  readonly client: {
    getCertificateStatus?(nodeApiUrl: string): Promise<HomeV2NodeCertificateStatus>
    confirmCertificate?(nodeApiUrl: string, fingerprint: string): Promise<HomeV2NodeCertificateStatus>
    forgetCertificate?(nodeApiUrl: string): Promise<HomeV2NodeCertificateStatus>
  }
  /** Called after a confirm or forget so the caller can re-check the route. */
  readonly onChanged?: () => void
}

// Same loopback set as the main process (electron/node-ca-bootstrap.ts): all
// of 127/8, IPv6 ::1 and "localhost" never need a pin.
function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

export function needsCertificateConfirmation(nodeApiUrl: string) {
  try {
    const url = new URL(nodeApiUrl.trim())
    if (url.protocol !== 'https:') return false
    return !isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return 'The certificate check failed.'
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export function NodeCertificatePanel({ client, nodeApiUrl, onChanged }: NodeCertificatePanelProps) {
  const [status, setStatus] = useState<HomeV2NodeCertificateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = typeof client.getCertificateStatus === 'function'
  // Nothing is contacted until the user asks: reading the certificate opens a
  // TLS connection to whatever is typed, and a draft URL may be a typo or a
  // host the user never meant to reach (second-model review of #571). A
  // request counter drops answers that arrive for an earlier URL.
  const requestSerial = useRef(0)

  const refresh = useCallback(async () => {
    if (!supported) return
    const serial = ++requestSerial.current
    setBusy(true)
    setError(null)
    try {
      const next = (await client.getCertificateStatus?.(nodeApiUrl)) ?? null
      if (serial !== requestSerial.current) return
      setStatus(next)
    } catch (caught) {
      if (serial !== requestSerial.current) return
      setStatus(null)
      setError(describeError(caught))
    } finally {
      if (serial === requestSerial.current) setBusy(false)
    }
  }, [client, nodeApiUrl, supported])

  // A URL edit invalidates whatever was shown for the previous one.
  useEffect(() => {
    requestSerial.current += 1
    setStatus(null)
    setError(null)
    setBusy(false)
  }, [nodeApiUrl])

  if (!supported) return null

  const presented = status?.presented?.fingerprint ?? null
  const mismatch = !!status?.confirmedFingerprint && !!presented && !status.matchesConfirmed

  const run = async (action: () => Promise<HomeV2NodeCertificateStatus> | undefined) => {
    setBusy(true)
    setError(null)
    try {
      setStatus((await action()) ?? null)
      onChanged?.()
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="home-v2-node-certificate" data-home-v2-node-certificate={nodeApiUrl}>
      <h3>Certificate</h3>
      <p>
        Home pins the certificate of a custom HTTPS node, whoever issued it, and only talks to this
        node — or sends it an API key — once you confirm the fingerprint it presents is the one the
        node itself shows. Trust is saved the moment you confirm, whether or not you save the address.
      </p>
      {status?.confirmedFingerprint ? (
        <p className="home-v2-node-certificate__row">
          <span>Confirmed</span>
          <code>{status.confirmedFingerprint}</code>
        </p>
      ) : null}
      {presented ? (
        <p className="home-v2-node-certificate__row">
          <span>Presented</span>
          <code>{presented}</code>
        </p>
      ) : null}
      {status?.observeError ? (
        <p className="home-v2-node-certificate__state" role="alert">
          Home could not reach {status.host} to read its certificate: {status.observeError}
        </p>
      ) : mismatch ? (
        <p className="home-v2-node-certificate__state" role="alert">
          This node now presents a different certificate than the one you confirmed. Confirm the new
          one only if you changed it yourself.
        </p>
      ) : status?.matchesConfirmed ? (
        <p className="home-v2-node-certificate__state" role="status">Confirmed — Home trusts this certificate.</p>
      ) : status ? (
        <p className="home-v2-node-certificate__state" role="status">Not confirmed yet.</p>
      ) : busy ? (
        <p className="home-v2-node-certificate__state" role="status">Reading the certificate…</p>
      ) : (
        <p className="home-v2-node-certificate__state" role="status">
          Home has not read this node's certificate yet. Checking connects to the address above.
        </p>
      )}
      {presented && !status?.matchesConfirmed ? (
        <>
          <p>On the machine running the node, print the fingerprint and compare it:</p>
          <code className="home-v2-node-certificate__command">{status?.verifyCommand}</code>
        </>
      ) : null}
      {error ? <p className="home-v2-node-certificate__state" role="alert">{error}</p> : null}
      <div className="home-v2-node-certificate__actions">
        {presented && !status?.matchesConfirmed ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-certificate-action="confirm"
            disabled={busy}
            onClick={() => void run(() => client.confirmCertificate?.(nodeApiUrl, presented))}
          >
            The fingerprints match — trust it
          </button>
        ) : null}
        {status?.confirmedFingerprint ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            data-home-v2-node-certificate-action="forget"
            disabled={busy}
            onClick={() => void run(() => client.forgetCertificate?.(nodeApiUrl))}
          >
            Forget
          </button>
        ) : null}
        <button
          type="button"
          className="home-v2-link-button"
          data-home-v2-node-certificate-action="refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {status ? 'Check again' : 'Check the certificate'}
        </button>
      </div>
    </section>
  )
}
