import { useEffect, useRef, useState } from 'react'

/**
 * Open/closed state for a chrome popover, with the dismissal rules every one of
 * them needs: a pointer press outside closes it, Escape closes it. Shared so
 * the toolbar menus cannot drift apart on the details that make a popover feel
 * broken when they are missed.
 *
 * `onOpenChange` reports the popover's open state upward, restoring the hook
 * Home 1.x's `Popover` had (src/components/Popover.tsx). The toolbar needs it
 * because app pages are native views composited over the renderer: a popover
 * that overlaps one is only visible while that view is suspended, so something
 * above has to know a menu is open. The callback lives in a ref so a caller
 * passing a fresh closure every render cannot re-fire it.
 */
export function useDismissablePopover<Element extends HTMLElement>(
  onOpenChange?: (open: boolean) => void,
) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<Element | null>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    onOpenChangeRef.current?.(open)
    // Unmounting while open must still report closed, or whatever the report
    // drives — a suspended app view — stays stuck in the open state with no
    // popover left to close.
    return () => {
      if (open) onOpenChangeRef.current?.(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Restore focus only for the dismissed menu that currently contains it.
        // Do not steal focus from another tab or another open popover.
        if (containerRef.current?.contains(document.activeElement)) {
          containerRef.current.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus()
        }
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismissKey)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismissKey)
    }
  }, [open])

  return { containerRef, open, setOpen }
}
