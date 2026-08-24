import { Copy, ExternalLink, X } from 'lucide-react'
import { useRef } from 'react'
import { t } from '../../i18n'
import { useMenuKeyboard } from '../../useMenuKeyboard'
import './home-v2-context-menu.css'

export interface HomeV2ContextMenuPresentationItem {
  readonly action: string
  readonly group: 'copy' | 'open'
  readonly label: string
}

export interface HomeV2ContextMenuProps {
  readonly items: readonly HomeV2ContextMenuPresentationItem[]
  readonly onAction: (action: string) => void
  readonly onDismiss: () => void
  readonly targetKind: string
  readonly targetLabel: string
}

export function HomeV2ContextMenu({
  items,
  onAction,
  onDismiss,
  targetKind,
  targetLabel,
}: HomeV2ContextMenuProps) {
  const menuRef = useRef<HTMLElement>(null)
  const keyboard = useMenuKeyboard({
    isOpen: true,
    menuRef,
    onClose: onDismiss,
  })
  return (
    <div
      className="home-v2-context-menu-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <section
        ref={menuRef}
        className="home-v2-context-menu"
        role="menu"
        aria-label={`${targetKind} actions for ${targetLabel}`}
        onKeyDown={keyboard.onKeyDown}
      >
        <header>
          <div>
            <span>{targetKind}</span>
            <strong>{targetLabel}</strong>
          </div>
          <button
            type="button"
            className="home-v2-context-menu__close"
            aria-label={t('common.cancel')}
            onClick={onDismiss}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="home-v2-context-menu__items">
          {items.map((item, index) => {
            const previous = items[index - 1]
            const Icon = item.group === 'open' ? ExternalLink : Copy
            return (
              <div key={item.action}>
                {previous && previous.group !== item.group ? <div role="separator" /> : null}
                <button type="button" role="menuitem" onClick={() => onAction(item.action)}>
                  <Icon aria-hidden="true" size={19} />
                  {item.label}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
