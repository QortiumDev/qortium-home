import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

// Mirrors ModalDialog's focusable set so an open popover (account menu, node menu,
// history menu) can move focus in, trap Tab, and restore focus to its trigger.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

type PopoverTriggerProps = {
  close: () => void;
  contentId: string;
  isOpen: boolean;
  open: () => void;
  toggle: () => void;
};

type PopoverContentProps = {
  close: () => void;
};

type PopoverProps = {
  children: ReactNode | ((props: PopoverContentProps) => ReactNode);
  className?: string;
  contentClassName?: string;
  contentId: string;
  contentLabel: string;
  contentRole?: 'dialog' | 'menu';
  onOpenChange?: (isOpen: boolean) => void;
  renderTrigger: (props: PopoverTriggerProps) => ReactNode;
};

export function Popover({
  children,
  className,
  contentClassName,
  contentId,
  contentLabel,
  contentRole = 'dialog',
  onOpenChange,
  renderTrigger,
}: PopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    onOpenChangeRef.current?.(isOpen);

    return () => {
      if (isOpen) {
        onOpenChangeRef.current?.(false);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  // On open, remember the trigger and move focus into the panel; on close, restore
  // focus to the trigger — but only if focus is still inside the panel (or was
  // dropped to <body>), so clicking onto another control isn't yanked back.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }

    return () => {
      const previous = previouslyFocusedRef.current;
      const active = document.activeElement;
      if (previous && (active === document.body || panel?.contains(active ?? null))) {
        previous.focus();
      }
    };
  }, [isOpen]);

  function trapTabKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') {
      return;
    }

    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  const popoverClassName = ['popover-panel', contentClassName].filter(Boolean).join(' ');
  const close = () => setIsOpen(false);

  return (
    <div className={className} ref={containerRef}>
      {renderTrigger({
        close,
        contentId,
        isOpen,
        open: () => setIsOpen(true),
        toggle: () => setIsOpen((current) => !current),
      })}

      {isOpen ? (
        <section
          className={popoverClassName}
          id={contentId}
          ref={panelRef}
          role={contentRole}
          aria-label={contentLabel}
          tabIndex={-1}
          onKeyDown={trapTabKey}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </section>
      ) : null}
    </div>
  );
}
