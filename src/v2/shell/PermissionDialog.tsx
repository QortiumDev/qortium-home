import type {
  PermissionDecision,
  PermissionRequestId,
  PermissionScope,
  PermissionState,
} from '../bridge-permissions'
import { NetworkBadge, networkLabels } from './NetworkBadge'

export interface PermissionDialogProps {
  readonly activeTabId?: string | null
  readonly permissionState: PermissionState
  readonly onResolvePermission?: (
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ) => void
}

const permissionScopeLabels: Readonly<Record<PermissionScope, string>> = {
  'single-request': 'Allow once',
  session: 'Allow for this tab',
  always: 'Always allow for this app',
}

export function PermissionDialog({
  activeTabId,
  permissionState,
  onResolvePermission,
}: PermissionDialogProps) {
  const prompt = permissionState.pending[0]
  if (!prompt || prompt.context.tabId !== activeTabId) return null
  const unifiedAccountRead = prompt.capability === 'account.read'

  return (
    <div className="home-v2-permission-backdrop">
      <section
        className="home-v2-permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-v2-permission-title"
        data-bridge-protocol={prompt.protocol}
        data-bridge-action={prompt.action}
      >
        <div className="home-v2-permission-dialog__header">
          <div>
            <span className="home-v2-protocol-badge">
              {unifiedAccountRead ? 'Qortal + Qortium' : prompt.protocol}
            </span>
            <h2 id="home-v2-permission-title">{prompt.title}</h2>
          </div>
          {unifiedAccountRead ? null : <NetworkBadge network={prompt.context.targetNetwork} />}
        </div>
        <p>{prompt.summary}</p>
        <div className="home-v2-permission-context">
          <span>App</span>
          <strong>{prompt.appTitle}</strong>
          <span>Account</span>
          <strong>{prompt.context.identityId}</strong>
          <span>Network</span>
          <strong>{unifiedAccountRead ? 'Qortal + Qortium' : networkLabels[prompt.context.targetNetwork]}</strong>
          <span>Action</span>
          <strong>{unifiedAccountRead ? 'Read-only account access' : prompt.action}</strong>
        </div>
        <dl className="home-v2-permission-details">
          {prompt.details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
        <div className="home-v2-permission-dialog__actions">
          <button
            type="button"
            className="home-v2-permission-deny"
            autoFocus
            onClick={() =>
              onResolvePermission?.(prompt.id, { approved: false })
            }
          >
            Deny
          </button>
          {prompt.allowedScopes.map((scope) => (
            <button
              key={scope}
              type="button"
              className="home-v2-permission-allow"
              data-permission-scope={scope}
              onClick={() =>
                onResolvePermission?.(prompt.id, {
                  approved: true,
                  scope,
                })
              }
            >
              {permissionScopeLabels[scope]}
            </button>
          ))}
        </div>
        {permissionState.pending.length > 1 ? (
          <small>{permissionState.pending.length - 1} more request queued</small>
        ) : null}
      </section>
    </div>
  )
}
