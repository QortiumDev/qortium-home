import { ChevronDown, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

type SettingsSectionProps = {
  children: ReactNode;
  defaultExpanded?: boolean;
  isExpanded?: boolean;
  isRefreshing?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
  onRefresh?: () => void;
  refreshLabel?: string;
  summary?: ReactNode;
  title: string;
};

export function SettingsSection({
  children,
  defaultExpanded = false,
  isExpanded: controlledExpanded,
  isRefreshing = false,
  onExpandedChange,
  onRefresh,
  refreshLabel,
  summary,
  title,
}: SettingsSectionProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const isExpanded = controlledExpanded ?? uncontrolledExpanded;

  function setExpanded(nextExpanded: boolean) {
    if (controlledExpanded === undefined) {
      setUncontrolledExpanded(nextExpanded);
    }

    onExpandedChange?.(nextExpanded);
  }

  return (
    <section className="settings-section" aria-label={title}>
      <div className="settings-section__header">
        <button
          aria-expanded={isExpanded}
          className="settings-section__toggle"
          type="button"
          onClick={() => setExpanded(!isExpanded)}
        >
          <ChevronDown
            aria-hidden="true"
            className={`settings-section__chevron${isExpanded ? ' settings-section__chevron--expanded' : ''}`}
            size={18}
            strokeWidth={2}
          />
          <span className="settings-section__title">{title}</span>
          {summary ? <span className="settings-section__summary">{summary}</span> : null}
        </button>
        {onRefresh ? (
          <button
            className="icon-button settings-section__refresh"
            disabled={isRefreshing}
            title={refreshLabel}
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
            <span className="sr-only">{refreshLabel}</span>
          </button>
        ) : null}
      </div>
      {isExpanded ? <div className="settings-section__body">{children}</div> : null}
    </section>
  );
}
