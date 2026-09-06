import { useLayoutEffect, type RefObject } from 'react';
import { boundedPosition, type ViewerPosition } from './viewer-position';

// Wait for asynchronous content sizing without polling or capturing a clamped
// loading placeholder as the user's position. User input always wins a restore.
export function useViewerScroll(ref: RefObject<HTMLElement | null>, position: ViewerPosition | undefined, ready: unknown) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!position || !ready || !element) return;
    const target = { ...position.scroll };
    let restoring = true;
    const save = () => {
      if (!restoring) position.scroll = {
        top: boundedPosition(element.scrollTop, 10_000_000),
        left: boundedPosition(element.scrollLeft, 10_000_000),
      };
    };
    const restore = () => {
      if (!restoring) return;
      element.scrollTop = target.top;
      element.scrollLeft = target.left;
      if (Math.abs(element.scrollTop - target.top) < 1 && Math.abs(element.scrollLeft - target.left) < 1) restoring = false;
    };
    const interrupt = () => { restoring = false; };
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', save, { passive: true });
    element.addEventListener('wheel', interrupt, { passive: true });
    element.addEventListener('touchstart', interrupt, { passive: true });
    element.addEventListener('pointerdown', interrupt, { passive: true });
    element.addEventListener('keydown', interrupt);
    restore();
    return () => {
      save();
      observer.disconnect();
      element.removeEventListener('scroll', save);
      element.removeEventListener('wheel', interrupt);
      element.removeEventListener('touchstart', interrupt);
      element.removeEventListener('pointerdown', interrupt);
      element.removeEventListener('keydown', interrupt);
    };
  }, [position, ready, ref]);
}
