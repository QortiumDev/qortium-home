import type {
  PermissionDecision,
  PermissionRequestId,
  PermissionScope,
  PermissionState,
} from '../bridge-permissions'
import { NetworkBadge, networkLabels } from './NetworkBadge'

export interface PermissionDialogProps {
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
  permissionState,
  onResolvePermission,
}: PermissionDialogProps) {
  const prompt = permissionState.pending[0]
  if (!prompt) return null

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
            <span className="home-v2-protocol-badge">{prompt.protocol}</span>
            <h2 id="home-v2-permission-title">{prompt.title}</h2>
          </div>
          <NetworkBadge network={prompt.context.targetNetwork} />
        </div>
        <p>{prompt.summary}</p>
        <div className="home-v2-permission-context">
          <span>App</span>
          <strong>{prompt.appTitle}</strong>
          <span>Identity</span>
          <strong>{prompt.context.identityId}</strong>
          <span>Network</span>
          <strong>{networkLabels[prompt.context.targetNetwork]}</strong>
          <span>Action</span>
          <strong>{prompt.action}</strong>
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
