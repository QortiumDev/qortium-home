import { useEffect, useRef, useState } from 'react'

/**
 * Open/closed state for a chrome popover, with the dismissal rules every one of
 * them needs: a pointer press outside closes it, Escape closes it. Shared so
 * the toolbar menus cannot drift apart on the details that make a popover feel
 * broken when they are missed.
 */
export function useDismissablePopover<Element extends HTMLElement>() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
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
