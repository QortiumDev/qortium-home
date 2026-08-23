import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import {
  formatCoreAdminError,
  getOnChainCoreUpdateSummary,
  isOnChainCoreUpdateAttemptActive,
  isOnChainQdnResourceActive,
} from '../onChainCoreUpdateState'
import {
  parseHomeV2CoreOnChainUpdateStatus,
  type HomeV2CoreOnChainUpdateStatus,
  type HomeV2NodeClient,
} from './node-client'

/*
 * The portable node client owns response-size and field-shape validation. The
 * controller parses again at its boundary so alternate HomeV2NodeClient
 * implementations cannot inject an unchecked admin response into the UI.
 */
const POLL_INTERVAL_MS = 5_000

export type HomeV2OnChainCoreUpdateBusyAction = 'check' | 'install' | null

export interface HomeV2OnChainCoreUpdates {
  readonly authenticated: boolean
  readonly available: boolean
  readonly busy: HomeV2OnChainCoreUpdateBusyAction
  readonly canInstall: boolean
  readonly check: () => Promise<void>
  readonly install: () => Promise<void>
  readonly message: string
  readonly status: HomeV2CoreOnChainUpdateStatus | null
  readonly tone: 'danger' | 'neutral' | 'success' | 'warning'
}

interface HomeV2OnChainCoreUpdateOptions {
  readonly authenticated: boolean
  readonly authorityRevision?: number
  readonly available: boolean
}

function shouldPoll(status: HomeV2CoreOnChainUpdateStatus) {
  return !!status.updateAvailable && (
    isOnChainCoreUpdateAttemptActive(status) ||
    isOnChainQdnResourceActive(status)
  )
}

function statusSummary(status: HomeV2CoreOnChainUpdateStatus | null) {
  if (!status) return t('common.unavailable')
  if (!status.updateAvailable) return t('common.upToDate')
  return getOnChainCoreUpdateSummary({ state: 'available', status }) ||
    t('core.onChain.available')
}

export function useHomeV2OnChainCoreUpdates(
  client: HomeV2NodeClient | null,
  options: HomeV2OnChainCoreUpdateOptions,
): HomeV2OnChainCoreUpdates {
  const adapterAvailable = options.available &&
    typeof client?.checkCoreUpdate === 'function' &&
    typeof client?.installCoreUpdate === 'function'
  const [busy, setBusy] = useState<HomeV2OnChainCoreUpdateBusyAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<HomeV2CoreOnChainUpdateStatus | null>(null)
  const requestGeneration = useRef(0)
  const checkInFlight = useRef<{
    readonly authorityRevision: number | undefined
    readonly promise: Promise<void>
  } | null>(null)
  const installInFlight = useRef(false)

  const checkInternal = useCallback(async (quiet: boolean) => {
    if (!adapterAvailable || !options.authenticated || !client?.checkCoreUpdate) return
    if (installInFlight.current) return
    const existing = checkInFlight.current
    if (
      existing &&
      existing.authorityRevision === options.authorityRevision
    ) {
      await existing.promise
      return
    }
    const operation = (async () => {
      const generation = ++requestGeneration.current
      if (!quiet) setBusy('check')
      setError(null)
      try {
        const next = parseHomeV2CoreOnChainUpdateStatus(
          await client.checkCoreUpdate!(),
        )
        if (requestGeneration.current === generation) setStatus(next)
      } catch (cause) {
        if (requestGeneration.current === generation) {
          setError(formatCoreAdminError(cause))
        }
      } finally {
        if (!quiet && requestGeneration.current === generation) setBusy(null)
      }
    })()
    checkInFlight.current = {
      authorityRevision: options.authorityRevision,
      promise: operation,
    }
    try {
      await operation
    } finally {
      if (checkInFlight.current?.promise === operation) {
        checkInFlight.current = null
      }
    }
  }, [adapterAvailable, client, options.authenticated, options.authorityRevision])

  const check = useCallback(async () => {
    await checkInternal(false)
  }, [checkInternal])

  const canInstall = !!status?.updateAvailable &&
    status.autoUpdateMode?.toUpperCase() !== 'INSTALL' &&
    !status.downloadStarted &&
    !isOnChainCoreUpdateAttemptActive(status) &&
    !isOnChainQdnResourceActive(status)

  const install = useCallback(async () => {
    if (
      !adapterAvailable ||
      !options.authenticated ||
      !client?.installCoreUpdate ||
      !canInstall
    ) {
      return
    }
    installInFlight.current = true
    const generation = ++requestGeneration.current
    setBusy('install')
    setError(null)
    try {
      const next = parseHomeV2CoreOnChainUpdateStatus(
        await client.installCoreUpdate(),
      )
      if (requestGeneration.current === generation) setStatus(next)
    } catch (cause) {
      if (requestGeneration.current === generation) {
        setError(formatCoreAdminError(cause))
      }
    } finally {
      installInFlight.current = false
      if (requestGeneration.current === generation) setBusy(null)
    }
  }, [adapterAvailable, canInstall, client, options.authenticated])

  useEffect(() => {
    requestGeneration.current += 1
    checkInFlight.current = null
    setBusy(null)
    setError(null)
    setStatus(null)
    if (adapterAvailable && options.authenticated && client) {
      void checkInternal(false)
    }
    return () => {
      requestGeneration.current += 1
    }
  }, [
    adapterAvailable,
    checkInternal,
    client,
    options.authenticated,
    options.authorityRevision,
  ])

  useEffect(() => {
    if (!status || !shouldPoll(status)) return undefined
    const interval = window.setInterval(() => {
      void checkInternal(true)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [checkInternal, status])

  return useMemo(() => {
    const message = !options.authenticated
      ? t('core.onChain.saveApiKey')
      : error ?? (busy === 'install'
        ? t('core.onChain.installStarting')
        : busy === 'check' && !status
          ? t('common.checking')
          : statusSummary(status))
    const tone = error
      ? 'danger' as const
      : status?.updateAvailable
        ? 'warning' as const
        : status
          ? 'success' as const
          : 'neutral' as const

    return {
      authenticated: options.authenticated,
      available: adapterAvailable,
      busy,
      canInstall,
      check,
      install,
      message,
      status,
      tone,
    }
  }, [adapterAvailable, busy, canInstall, check, error, install, options.authenticated, status])
}
