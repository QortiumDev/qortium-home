import { Copy, ExternalLink, Folder } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  BookmarkManagerFolder,
  BookmarkManagerLink,
  BookmarkManagerSnapshot,
  BookmarkManagerTreeItem,
} from '../../bookmarkManagerContract'
import { shouldShowBookmarkToolbar } from '../../bookmarkToolbar'
import { getDashboardPinDisplay } from '../../dashboardPinDisplay'
import { t } from '../../i18n'
import type { VisibleAppIconLoader } from '../contracts'
import type { HomeV2ContextMenuPresentationItem } from './HomeV2ContextMenu'
import { HomeV2AppIcon, getHomeV2AppIconTarget } from './HomeV2AppIcon'

const LONG_PRESS_MS = 500

type ToolbarMenu = {
  readonly link: BookmarkManagerLink
  readonly x: number
  readonly y: number
} | null

type FolderMenu = {
  readonly folder: BookmarkManagerFolder
  readonly x: number
  readonly y: number
} | null

function toolbarErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return t('common.error')
}

export interface HomeV2BookmarkToolbarProps {
  readonly disabled?: boolean
  readonly isDashboardRoute: boolean
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  readonly onContextMenuAction?: (
    link: BookmarkManagerLink,
    action: string,
  ) => void | Promise<void>
  readonly getContextMenuItems?: (
    link: BookmarkManagerLink,
  ) => readonly HomeV2ContextMenuPresentationItem[]
  readonly onOpen: (link: BookmarkManagerLink) => void | Promise<void>
  /** Surfaces toolbar open/context-action failures (they have no inline alert). */
  readonly onActionError?: (message: string) => void
  readonly snapshot: BookmarkManagerSnapshot | null
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function LinkIcon({
  displayUrl,
  loadVisibleAppIcon,
  title,
}: {
  readonly displayUrl: string
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  readonly title: string
}) {
  if (getHomeV2AppIconTarget(displayUrl)) {
    return (
      <HomeV2AppIcon
        displayUrl={displayUrl}
        loader={loadVisibleAppIcon}
        size={20}
        variant="tab"
      />
    )
  }
  const display = getDashboardPinDisplay({
    createdAt: 0,
    customLabel: title,
    displayUrl,
    id: displayUrl,
    label: title || displayUrl,
  })
  const Icon = display.Icon
  return <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
}

function ToolbarLink({
  accountLabel,
  disabled,
  item,
  loadVisibleAppIcon,
  menuItem = false,
  onOpen,
  onActionError,
  onOpenMenu,
}: {
  readonly accountLabel?: string
  readonly disabled: boolean
  readonly item: BookmarkManagerLink
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  readonly menuItem?: boolean
  readonly onOpen: (link: BookmarkManagerLink) => void | Promise<void>
  readonly onActionError?: (message: string) => void
  readonly onOpenMenu: (
    link: BookmarkManagerLink,
    x: number,
    y: number,
  ) => void
}) {
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }
  useEffect(() => clearTimer, [])
  const startLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.pointerType === 'mouse') return
    longPressed.current = false
    clearTimer()
    const { clientX, clientY } = event
    timer.current = window.setTimeout(() => {
      timer.current = null
      longPressed.current = true
      onOpenMenu(item, clientX, clientY)
    }, LONG_PRESS_MS)
  }
  return (
    <button
      className="home-v2-bookmark-toolbar__item"
      data-bookmark-id={item.id}
      disabled={disabled}
      role={menuItem ? 'menuitem' : undefined}
      title={item.displayUrl}
      type="button"
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false
          return
        }
        void Promise.resolve(onOpen(item)).catch((error) =>
          onActionError?.(toolbarErrorMessage(error)),
        )
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenMenu(item, event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          onOpenMenu(item, bounds.left, bounds.bottom)
        }
      }}
      onPointerCancel={clearTimer}
      onPointerDown={startLongPress}
      onPointerLeave={clearTimer}
      onPointerUp={clearTimer}
    >
      {accountLabel ? (
        <span
          className="home-v2-bookmark-toolbar__account"
          title={accountLabel}
          aria-label={accountLabel}
        >
          {accountLabel.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
      ) : null}
      <LinkIcon
        displayUrl={item.displayUrl}
        loadVisibleAppIcon={loadVisibleAppIcon}
        title={item.title}
      />
      <span>{item.title || item.displayUrl}</span>
    </button>
  )
}

function ToolbarItems({
  accountLabels,
  disabled,
  items,
  loadVisibleAppIcon,
  onOpenFolder,
  onOpen,
  onActionError,
  onOpenMenu,
}: {
  readonly accountLabels: ReadonlyMap<string, string>
  readonly disabled: boolean
  readonly items: readonly BookmarkManagerTreeItem[]
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  readonly onActionError?: (message: string) => void
  readonly onOpenFolder: (
    folder: BookmarkManagerFolder,
    x: number,
    y: number,
  ) => void
  readonly onOpen: (link: BookmarkManagerLink) => void | Promise<void>
  readonly onOpenMenu: (
    link: BookmarkManagerLink,
    x: number,
    y: number,
  ) => void
}) {
  return (
    <div className="home-v2-bookmark-toolbar__items">
      {items.map((item) =>
        item.type === 'folder' ? (
          <button
            className="home-v2-bookmark-toolbar__item home-v2-bookmark-toolbar__folder"
            data-bookmark-folder-id={item.id}
            disabled={disabled}
            key={item.id}
            type="button"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              onOpenFolder(item, bounds.left, bounds.bottom + 4)
            }}
          >
            <Folder aria-hidden="true" size={18} strokeWidth={1.9} />
            <span>{item.title}</span>
          </button>
        ) : (
          <ToolbarLink
            onActionError={onActionError}
            accountLabel={item.accountId
              ? accountLabels.get(item.accountId)
              : undefined}
            disabled={disabled}
            item={item}
            key={item.id}
            loadVisibleAppIcon={loadVisibleAppIcon}
            onOpen={onOpen}
            onOpenMenu={onOpenMenu}
          />
        ),
      )}
    </div>
  )
}

function FolderMenuItems({
  accountLabels,
  disabled,
  items,
  loadVisibleAppIcon,
  onOpen,
  onActionError,
  onOpenMenu,
}: {
  readonly accountLabels: ReadonlyMap<string, string>
  readonly disabled: boolean
  readonly items: readonly BookmarkManagerTreeItem[]
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  readonly onActionError?: (message: string) => void
  readonly onOpen: (link: BookmarkManagerLink) => void | Promise<void>
  readonly onOpenMenu: (
    link: BookmarkManagerLink,
    x: number,
    y: number,
  ) => void
}) {
  return (
    <div className="home-v2-bookmark-toolbar__menu-items" role="menu">
      {items.map((item) =>
        item.type === 'folder' ? (
          <details
            className="home-v2-bookmark-toolbar__nested-folder"
            data-bookmark-folder-id={item.id}
            key={item.id}
          >
            <summary>
              <Folder aria-hidden="true" size={17} strokeWidth={1.9} />
              <span>{item.title}</span>
            </summary>
            <FolderMenuItems
              onActionError={onActionError}
              accountLabels={accountLabels}
              disabled={disabled}
              items={item.children}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onOpen={onOpen}
              onOpenMenu={onOpenMenu}
            />
          </details>
        ) : (
          <ToolbarLink
            onActionError={onActionError}
            accountLabel={item.accountId
              ? accountLabels.get(item.accountId)
              : undefined}
            disabled={disabled}
            item={item}
            key={item.id}
            loadVisibleAppIcon={loadVisibleAppIcon}
            menuItem
            onOpen={onOpen}
            onOpenMenu={onOpenMenu}
          />
        ),
      )}
    </div>
  )
}

export function HomeV2BookmarkToolbar({
  disabled = false,
  getContextMenuItems,
  isDashboardRoute,
  loadVisibleAppIcon,
  onContextMenuAction,
  onOpen,
  onActionError,
  snapshot,
}: HomeV2BookmarkToolbarProps) {
  const [menu, setMenu] = useState<ToolbarMenu>(null)
  const [folderMenu, setFolderMenu] = useState<FolderMenu>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const visible = !!snapshot &&
    snapshot.toolbar.length > 0 &&
    shouldShowBookmarkToolbar(snapshot.toolbarVisibility, isDashboardRoute)
  const accountLabels = new Map(
    (snapshot?.availableAccounts ?? []).map((account) => [account.id, account.label]),
  )
  const menuItems = menu && getContextMenuItems
    ? getContextMenuItems(menu.link)
    : []

  useEffect(() => {
    if (visible) return
    setMenu(null)
    setFolderMenu(null)
  }, [visible])

  useEffect(() => {
    if (!menu && !folderMenu) return undefined
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenu(null)
        setFolderMenu(null)
      }
    }
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null)
        setFolderMenu(null)
      }
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismissKey)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', dismissKey)
    }
  }, [folderMenu, menu])

  if (!visible) return null

  const openMenu = (link: BookmarkManagerLink, x: number, y: number) => {
    const items = getContextMenuItems?.(link) ?? []
    if (items.length === 0) return
    setFolderMenu(null)
    setMenu({
      link,
      x: clamp(x, 8, window.innerWidth - 230),
      y: clamp(y, 8, window.innerHeight - 180),
    })
  }

  return (
    <nav
      aria-label={t('bookmarks.folder.toolbar')}
      className="home-v2-bookmark-toolbar"
      data-toolbar-visibility={snapshot.toolbarVisibility}
    >
      <ToolbarItems
        onActionError={onActionError}
        accountLabels={accountLabels}
        disabled={disabled}
        items={snapshot.toolbar}
        loadVisibleAppIcon={loadVisibleAppIcon}
        onOpenFolder={(folder, x, y) => {
          setMenu(null)
          setFolderMenu({
            folder,
            x: clamp(x, 8, window.innerWidth - 280),
            y: clamp(y, 8, window.innerHeight - 320),
          })
        }}
        onOpen={onOpen}
        onOpenMenu={openMenu}
      />
      {folderMenu ? (
        <div
          aria-label={folderMenu.folder.title}
          className="home-v2-bookmark-toolbar__folder-menu"
          ref={menuRef}
          role="menu"
          style={{ left: folderMenu.x, top: folderMenu.y }}
        >
          <FolderMenuItems
              onActionError={onActionError}
            accountLabels={accountLabels}
            disabled={disabled}
            items={folderMenu.folder.children}
            loadVisibleAppIcon={loadVisibleAppIcon}
            onOpen={(link) => {
              setFolderMenu(null)
              return onOpen(link)
            }}
            onOpenMenu={openMenu}
          />
        </div>
      ) : null}
      {menu && menuItems.length > 0 ? (
        <div
          className="home-v2-bookmark-toolbar__context-menu"
          ref={menuRef}
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {menuItems.map((item) => {
            const Icon = item.group === 'open' ? ExternalLink : Copy
            return (
              <button
                key={item.action}
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenu(null)
                  void Promise.resolve(
                    onContextMenuAction?.(menu.link, item.action),
                  ).catch((error) =>
                    onActionError?.(toolbarErrorMessage(error)),
                  )
                }}
              >
                <Icon aria-hidden="true" size={17} />
                {item.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </nav>
  )
}
