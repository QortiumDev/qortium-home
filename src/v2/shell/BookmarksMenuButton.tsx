import { Bookmark } from 'lucide-react'
import { t } from '../../i18n'
import {
  BOOKMARK_TOOLBAR_VISIBILITIES,
  type BookmarkToolbarVisibility,
} from '../../bookmarkToolbar'
import { useDismissablePopover } from './useDismissablePopover'

export interface BookmarksMenuButtonProps {
  /** Whether the address currently shown is already saved. */
  readonly isBookmarked: boolean
  readonly disabled?: boolean
  readonly onToggle: () => void | Promise<void>
  readonly onManage?: () => void | Promise<void>
  readonly toolbarVisibility?: BookmarkToolbarVisibility
  readonly onSetToolbarVisibility?: (
    visibility: BookmarkToolbarVisibility,
  ) => void | Promise<void>
  /** Reports the menu's open state so the chrome can suspend the app view. */
  readonly onOpenChange?: (open: boolean) => void
}

/**
 * The toolbar bookmarks control, restoring Home 1.x's `BookmarksPopover`
 * (src/TopBar.tsx:1189) between reload and Home. The menu keeps 1.x's first
 * three entries — toggle the current page, reach the manager, choose when the
 * toolbar shows. The bookmark tree itself is not listed here, because Home 2
 * delegates browsing and editing to the Bookmarks app.
 */
export function BookmarksMenuButton({
  isBookmarked,
  disabled,
  onToggle,
  onManage,
  toolbarVisibility,
  onSetToolbarVisibility,
  onOpenChange,
}: BookmarksMenuButtonProps) {
  const { containerRef, open, setOpen } =
    useDismissablePopover<HTMLDivElement>(onOpenChange)

  const run = (action?: () => void | Promise<void>) => () => {
    setOpen(false)
    if (action) void Promise.resolve(action()).catch(() => undefined)
  }

  const label = isBookmarked
    ? t('bookmarks.removeFromBookmarks')
    : t('bookmarks.addToBookmarks')

  return (
    <div className="home-v2-bookmarks-menu" ref={containerRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('bookmarks.menuLabel')}
        className={`home-v2-bookmarks-button${isBookmarked ? ' is-bookmarked' : ''}`}
        disabled={disabled}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        <Bookmark
          aria-hidden="true"
          size={18}
          strokeWidth={2}
          // Filled when saved: the same at-a-glance signal 1.x gave with its
          // `--active` modifier.
          fill={isBookmarked ? 'currentColor' : 'none'}
        />
      </button>
      {open ? (
        <div
          aria-label={t('bookmarks.menuLabel')}
          className="home-v2-bookmarks-menu__panel"
          role="menu"
        >
          <button type="button" role="menuitem" onClick={run(onToggle)}>
            {label}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onManage}
            onClick={run(onManage)}
          >
            {t('bookmarks.manage')}
          </button>
          {toolbarVisibility && onSetToolbarVisibility ? (
            <>
              <hr />
              <strong>{t('bookmarks.toolbarVisibility')}</strong>
              {BOOKMARK_TOOLBAR_VISIBILITIES.map((visibility) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={toolbarVisibility === visibility}
                  key={visibility}
                  onClick={run(() => onSetToolbarVisibility(visibility))}
                >
                  {t(`bookmarks.toolbarVisibility.${visibility}`)}
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
