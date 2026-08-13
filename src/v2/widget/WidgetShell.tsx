import { useEffect, useRef, useState } from 'react'

function readParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    widgetId: params.get('widgetId') ?? '',
    renderUrl: params.get('renderUrl') ?? '',
    resourceUrl: params.get('resourceUrl') ?? '',
    nodeOrigin: params.get('nodeOrigin') ?? '',
    accountId: params.get('accountId'),
  }
}

// Deliberately thin. The app runs in a WebContentsView that composites above
// this page, so anything drawn here would sit behind the widget anyway. Its
// only jobs are to be transparent, to ask for the app view, and to surface an
// error if that view cannot be attached.
export function WidgetShell() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const bridge = window.homeV2Apps
    if (!host || !bridge) {
      setError('This widget could not reach Home.')
      return
    }

    const params = readParams()
    if (!params.widgetId || !params.renderUrl) {
      setError('This widget was opened without a target app.')
      return
    }

    const tabId = `widget:${params.widgetId}`
    const show = () => {
      const bounds = host.getBoundingClientRect()
      if (bounds.width < 1 || bounds.height < 1) return
      void bridge
        .show({
          accountId: params.accountId,
          bounds: {
            x: Math.round(bounds.left),
            y: Math.round(bounds.top),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
          },
          displaySettings: {
            accent: 'default',
            language: 'en',
            textSize: 'medium',
            theme: 'dark',
          },
          // qdn-views reads nodeApiUrl and derives the origin itself. Sending
          // nodeOrigin instead leaves it undefined and the show is rejected.
          nodeApiUrl: params.nodeOrigin,
          renderUrl: params.renderUrl,
          resourceUrl: params.resourceUrl,
          tabId,
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'This widget could not start.')
        })
    }

    show()
    const observer = new ResizeObserver(show)
    observer.observe(host)

    return () => {
      observer.disconnect()
      void bridge.destroy({ tabId })
    }
  }, [])

  return <div className="widget-shell" ref={hostRef}>
    {error ? <p className="widget-shell__error" role="alert">{error}</p> : null}
  </div>
}
