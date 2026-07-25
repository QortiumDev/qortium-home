import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

type TabScopedDialogProps = {
  children: ReactNode;
  onDismiss: () => void;
};

/**
 * An app-content overlay rather than a window modal. It deliberately does not
 * trap focus: Home's tab strip remains available while the reader is open.
 */
export function TabScopedDialog({ children, onDismiss }: TabScopedDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    backdropRef.current?.querySelector<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')?.focus();
  }, []);

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onDismiss();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // When the reader is deliberately fullscreen, let the browser handle Esc
      // first so it returns to the tab-scoped reader rather than closing it.
      if (document.fullscreenElement) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    }
  }

  return (
    <div
      className="tab-scoped-dialog-backdrop"
      ref={backdropRef}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
    >
      {children}
    </div>
  );
}
