import { useEffect, useState, type FormEvent } from 'react';
import { t } from './i18n';
import { DEFAULT_PREFERRED_APPS, parsePreferredAppUrl, type PreferredApps } from './preferredApps';
import { SettingsSection } from './SettingsSection';

type Props = {
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  onBookmarksManagerChange: (bookmarksManager: string) => void;
  preferredApps: PreferredApps;
};

export function PreferredAppsSettingsPanel({
  isExpanded,
  onBookmarksManagerChange,
  onExpandedChange,
  preferredApps,
}: Props) {
  const [bookmarksManager, setBookmarksManager] = useState(preferredApps.bookmarksManager);
  const [error, setError] = useState('');

  useEffect(() => {
    setBookmarksManager(preferredApps.bookmarksManager);
  }, [preferredApps.bookmarksManager]);

  function save(event: FormEvent) {
    event.preventDefault();
    try {
      onBookmarksManagerChange(parsePreferredAppUrl(bookmarksManager));
      setError('');
    } catch {
      setError(t('preferredApps.invalidAddress'));
    }
  }

  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={t('bookmarks.manage')}
      title={t('preferredApps.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <form className="preferred-apps-settings" onSubmit={save}>
        <p className="field__hint">{t('preferredApps.description')}</p>
        <label className="field">
          <span className="field__label">{t('preferredApps.bookmarksManager')}</span>
          <input
            aria-describedby={error ? 'preferred-apps-error' : undefined}
            className="field__input"
            dir="ltr"
            value={bookmarksManager}
            spellCheck={false}
            onChange={(event) => {
              setBookmarksManager(event.target.value);
              setError('');
            }}
          />
        </label>
        {error ? <p className="field__error" id="preferred-apps-error" role="alert">{error}</p> : null}
        <div className="preferred-apps-settings__actions">
          <button className="button button--primary" type="submit">{t('common.save')}</button>
          <button className="button" type="button" onClick={() => {
            setBookmarksManager(DEFAULT_PREFERRED_APPS.bookmarksManager);
            onBookmarksManagerChange(DEFAULT_PREFERRED_APPS.bookmarksManager);
            setError('');
          }}>{t('preferredApps.useDefault')}</button>
        </div>
      </form>
    </SettingsSection>
  );
}
