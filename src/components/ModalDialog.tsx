import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

type ModalDialogProps = {
  children: ReactNode;
  onDismiss: () => void;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function ModalDialog({ children, onDismiss }: ModalDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    backdropRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onDismiss();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const backdrop = backdropRef.current;

    if (!backdrop) {
      return;
    }

    const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !backdrop.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !backdrop.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
    >
      {children}
    </div>
  );
}
