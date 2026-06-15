import { RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { t } from './i18n';

// Shared header for the Dashboard Core/Home tiles: the title plus a right-aligned
// cluster of icon buttons (refresh + settings gear). Mirrors the refresh idiom of
// SettingsSection so the two surfaces stay visually consistent and uncoupled.
export function DashboardCardHeader({
  isRefreshing = false,
  onOpenSettings,
  onRefresh,
  refreshLabel,
  settingsLabel,
  title,
}: {
  isRefreshing?: boolean;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  refreshLabel?: string;
  settingsLabel?: string;
  title: string;
}) {
  const resolvedRefreshLabel = refreshLabel ?? t('updates.checkForUpdates');
  const resolvedSettingsLabel = settingsLabel ?? t('common.settings');

  return (
    <div className="dashboard-card__header">
      <h2 className="dashboard-card__title">{title}</h2>
      {onRefresh || onOpenSettings ? (
        <div className="dashboard-card__header-actions">
          {onRefresh ? (
            <button
              className="icon-button dashboard-card__header-button"
              disabled={isRefreshing}
              title={resolvedRefreshLabel}
              type="button"
              onClick={onRefresh}
            >
              <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
              <span className="sr-only">{resolvedRefreshLabel}</span>
            </button>
          ) : null}
          {onOpenSettings ? (
            <button
              className="icon-button dashboard-card__header-button"
              title={resolvedSettingsLabel}
              type="button"
              onClick={onOpenSettings}
            >
              <SettingsIcon aria-hidden="true" size={16} strokeWidth={2} />
              <span className="sr-only">{resolvedSettingsLabel}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
