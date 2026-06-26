import { X } from 'lucide-react';
import { t } from './i18n';
import { SettingsSection } from './SettingsSection';

type StartupPagesPanelProps = {
  isExpanded: boolean;
  pages: string[];
  onExpandedChange: (isExpanded: boolean) => void;
  onRemove: (displayUrl: string) => void;
};

export function StartupPagesPanel({ isExpanded, pages, onExpandedChange, onRemove }: StartupPagesPanelProps) {
  const summary = pages.length === 0
    ? t('startupPages.notSet')
    : t('startupPages.summary', { count: pages.length });

  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={summary}
      title={t('startupPages.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <div className="startup-pages-settings">
        {pages.length === 0 ? (
          <p className="startup-pages-settings__empty">{t('startupPages.emptyHint')}</p>
        ) : (
          <ul className="startup-pages-settings__list">
            {pages.map((displayUrl) => (
              <li key={displayUrl} className="startup-pages-settings__item">
                <span className="startup-pages-settings__url">{displayUrl}</span>
                <button
                  className="startup-pages-settings__remove"
                  title={t('startupPages.removePage')}
                  type="button"
                  onClick={() => onRemove(displayUrl)}
                >
                  <X aria-hidden="true" size={16} strokeWidth={2} />
                  <span className="sr-only">{t('startupPages.removePage')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="startup-pages-settings__hint">{t('startupPages.addHint')}</p>
      </div>
    </SettingsSection>
  );
}
