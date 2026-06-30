import { X } from 'lucide-react';
import { t } from './i18n';
import { SettingsSection } from './SettingsSection';

type StartPagesPanelProps = {
  isExpanded: boolean;
  pages: string[];
  onExpandedChange: (isExpanded: boolean) => void;
  onRemove: (displayUrl: string) => void;
};

export function StartPagesPanel({ isExpanded, pages, onExpandedChange, onRemove }: StartPagesPanelProps) {
  const summary = pages.length === 0
    ? t('startPages.notSet')
    : t('startPages.summary', { count: pages.length });

  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={summary}
      title={t('startPages.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <div className="start-pages-settings">
        {pages.length === 0 ? (
          <p className="start-pages-settings__empty">{t('startPages.emptyHint')}</p>
        ) : (
          <ul className="start-pages-settings__list">
            {pages.map((displayUrl) => (
              <li key={displayUrl} className="start-pages-settings__item">
                <span className="start-pages-settings__url">{displayUrl}</span>
                <button
                  className="start-pages-settings__remove"
                  title={t('startPages.removePage')}
                  type="button"
                  onClick={() => onRemove(displayUrl)}
                >
                  <X aria-hidden="true" size={16} strokeWidth={2} />
                  <span className="sr-only">{t('startPages.removePage')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="start-pages-settings__hint">{t('startPages.addHint')}</p>
      </div>
    </SettingsSection>
  );
}
