import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect } from 'react';

const MENU_ITEM_SELECTOR = 'button[role="menuitem"]:not(:disabled)';

function getMenuItems(menu: HTMLElement | null) {
  return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR)) : [];
}

function focusMenuItem(menu: HTMLElement | null, index: number) {
  const items = getMenuItems(menu);
  const item = items[index];

  item?.focus();
}

type MenuKeyboardOptions<T extends HTMLElement> = {
  getFocusAfterEscape?: () => HTMLElement | null;
  isOpen: boolean;
  menuRef: RefObject<T | null>;
  onClose: () => void;
};

export function useMenuKeyboard<T extends HTMLElement>({
  getFocusAfterEscape,
  isOpen,
  menuRef,
  onClose,
}: MenuKeyboardOptions<T>) {
  useEffect(() => {
    if (isOpen) {
      focusMenuItem(menuRef.current, 0);
    }
  }, [isOpen, menuRef]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const menu = menuRef.current;
      const items = getMenuItems(menu);

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        getFocusAfterEscape?.()?.focus();
        return;
      }

      if (items.length === 0) {
        return;
      }

      const currentIndex = items.findIndex((item) => item === document.activeElement);
      let nextIndex: number | null = null;

      if (event.key === 'ArrowDown') {
        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
      } else if (event.key === 'ArrowUp') {
        nextIndex = currentIndex === -1 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = items.length - 1;
      }

      if (nextIndex === null) {
        return;
      }

      event.preventDefault();
      items[nextIndex]?.focus();
    },
    [getFocusAfterEscape, menuRef, onClose],
  );

  return { onKeyDown };
}
