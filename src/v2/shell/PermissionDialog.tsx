import type {
  PermissionDecision,
  PermissionRequestId,
  PermissionScope,
  PermissionState,
} from '../bridge-permissions'
import { t, type TranslationKey } from '../../i18n'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { HomeV2AppIcon } from './HomeV2AppIcon'
import type { VisibleAppIconLoader } from '../contracts'

export interface PermissionDialogProps {
  readonly activeTabId?: string | null
  readonly permissionState: PermissionState
  readonly onResolvePermission?: (
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ) => void
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
}

const permissionScopeLabelKeys: Readonly<Record<PermissionScope, TranslationKey>> = {
  'single-request': 'home2.permission.allowOnce',
  session: 'home2.permission.allowForTab',
  always: 'home2.permission.alwaysAllowForApp',
}

export function PermissionDialog({
  activeTabId,
  permissionState,
  onResolvePermission,
  loadVisibleAppIcon,
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
          <HomeV2AppIcon
            displayUrl={prompt.appIdentityKey}
            loader={loadVisibleAppIcon}
            size={36}
            variant="row"
          />
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
          <span>{t('home2.permission.app')}</span>
          <strong>{prompt.appTitle}</strong>
          <span>{t('account.menuLabel')}</span>
          <strong>{prompt.context.identityId}</strong>
          <span>{t('home2.permission.network')}</span>
          <strong>{unifiedAccountRead ? 'Qortal + Qortium' : networkLabels[prompt.context.targetNetwork]}</strong>
          <span>{t('home2.permission.action')}</span>
          <strong>{unifiedAccountRead ? t('home2.permission.readOnlyAccountAccess') : prompt.action}</strong>
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
            {t('home2.permission.deny')}
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
              {t(permissionScopeLabelKeys[scope])}
            </button>
          ))}
        </div>
        {permissionState.pending.length > 1 ? (
          <small>{t('home2.permission.moreRequestsQueued', { count: permissionState.pending.length - 1 })}</small>
        ) : null}
      </section>
    </div>
  )
}
