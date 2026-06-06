import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

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
        <section className={popoverClassName} id={contentId} role={contentRole} aria-label={contentLabel}>
          {typeof children === 'function' ? children({ close }) : children}
        </section>
      ) : null}
    </div>
  );
}
