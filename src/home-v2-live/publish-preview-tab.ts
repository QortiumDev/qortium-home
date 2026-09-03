import type { AppDescriptor, AppTabContext } from '../v2/contracts'
import type { AppTab } from '../v2/product-model'
import { parseAppResourceLocation } from '../v2/resource-location'
import { sanitizeHomeV2AppTitle } from '../v2/app-frame-messages'

/**
 * The renderer half of PREVIEW_QDN_PUBLISH_SOURCE.
 *
 * The bridge returns `true` to the app the moment it has sent the
 * `open-publish-preview` IPC, so nothing downstream can report a preview that
 * never opens: the app has already been told it did. That is how 2.1.0 shipped
 * with previews silently doing nothing -- the shell resolved the requesting
 * app out of `HomeV2Snapshot.apps`, which the live shell never populates (it is
 * a fixture-only field), so the lookup always missed and the payload was
 * dropped without a word.
 *
 * The decision therefore lives here, in one pure function, so it can be tested
 * without a shell: given the IPC payload and the tabs that are actually open,
 * either an app tab to open or null.
 */

export interface HomeV2PublishPreviewOpen {
  readonly app: AppDescriptor
  readonly context: AppTabContext
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The AppDescriptor for a tab that is already open, rebuilt from the tab
 * itself.
 *
 * An open app tab already carries everything a descriptor needs -- its app id,
 * its title and its resource location -- and rebuilding from the tab is also
 * the tighter rule: a descriptor derived this way can only ever name the app
 * whose tab asked for it, which is what the open-app reducer's
 * assertAppTabTarget goes on to require.
 *
 * Returns null when the tab's own resource location no longer parses, or
 * disagrees with the tab's source chain -- the same checks openAddress makes
 * before building a descriptor of its own.
 */
export function appDescriptorForOpenTab(
  tab: AppTab,
  requestedTitle?: unknown,
): AppDescriptor | null {
  let parsed: ReturnType<typeof parseAppResourceLocation>
  try {
    parsed = parseAppResourceLocation(tab.context.resourceLocation)
  } catch {
    return null
  }
  if (parsed.sourceNetwork !== tab.context.sourceNetwork) return null
  return {
    id: tab.context.appId,
    title: sanitizeHomeV2AppTitle(requestedTitle) ?? tab.title,
    description: `QDN app from ${parsed.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium'}.`,
    category: 'utility',
    sourceNetwork: parsed.sourceNetwork,
    resourceIdentity: parsed.identity,
    targetNetworks: [parsed.sourceNetwork],
    placement: 'recommended',
  }
}

/**
 * What to open for an `open-publish-preview` payload, or null to ignore it.
 *
 * `tabId` is the id the caller has already minted for the new tab; the preview
 * is a SEPARATE tab from the app that asked for it, and `previewUrl`
 * participates in tab identity (contextsIdentifySameTab), so it never replaces
 * that app.
 */
export function resolveHomeV2PublishPreviewOpen(
  value: unknown,
  tabs: readonly AppTab[],
  tabId: AppTabContext['tabId'],
): HomeV2PublishPreviewOpen | null {
  if (!isRecord(value)) return null
  const previewUrl = typeof value.previewUrl === 'string' ? value.previewUrl : ''
  const sourceTabId = typeof value.sourceTabId === 'string' ? value.sourceTabId : ''
  // The binding id is REQUIRED, not optional. A payload without one names no
  // credential, so nothing downstream could ever re-check it -- and a tab
  // opened that way would persist as a preview that restore has to guess
  // about. Refusing here is the only place that guess can be avoided
  // (security review, 2026-09-02).
  const previewTrustRevision =
    typeof value.previewTrustRevision === 'string' ? value.previewTrustRevision : ''
  if (!previewUrl || !sourceTabId || !previewTrustRevision) return null
  const source = tabs.find((tab) => tab.id === sourceTabId)
  if (!source) return null
  const app = appDescriptorForOpenTab(source, value.title)
  if (!app) return null
  return {
    app,
    context: {
      ...source.context,
      // The binding id of the credential the preview was built against,
      // carried onto the tab so a LATER session can re-bind it to the same
      // node and credential rather than to a URL shape
      // (src/v2/product-model.ts), and so AppTabStage can re-check it on every
      // render. Both hosts supply it; a payload without one was refused above.
      previewTrustRevision,
      previewUrl,
      tabId,
    },
  }
}
