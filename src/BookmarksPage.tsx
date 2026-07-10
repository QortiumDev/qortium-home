import {
  Folder,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { BOOKMARK_TOOLBAR_VISIBILITIES } from '../electron/bookmark-toolbar';
import { BookmarkDisplayIcon, getBookmarkDisplay } from './bookmarkDisplay';
import type {
  BookmarkFolderId,
  BookmarkFolderRequest,
  BookmarkLink,
  BookmarkRootId,
  BookmarkRootMoveRequest,
  BookmarkTreeItem,
  BookmarkUpdateRequest,
  BookmarksState,
} from './bookmarks';
import type { DashboardPin } from './dashboardPins';
import { t } from './i18n';
import { parseAppAddress } from './routes';
import { SavedAccountSelector } from './SavedAccountContext';
import type { StartPage } from './startPages';

const BOOKMARK_DRAG_MIME = 'application/x-qortium-bookmark';
const TOUCH_DRAG_DELAY_MS = 420;
const TOUCH_DRAG_MOVE_CANCEL_PX = 12;

type BookmarksPageProps = {
  accountsState: QortiumAccountsState;
  bookmarksState: BookmarksState;
  dashboardPins: DashboardPin[];
  nodeApiUrl: string;
  nodeEpoch: number;
  startPages: StartPage[];
  onAddBookmark: (folderId: BookmarkFolderId, request: BookmarkUpdateRequest, parentFolderId?: string | null) => boolean;
  onAddBookmarkFolder: (folderId: BookmarkFolderId, request: BookmarkFolderRequest, parentFolderId?: string | null) => boolean;
  onAddDashboardPin: (request: BookmarkUpdateRequest) => boolean;
  onAddStartPage: (request: BookmarkUpdateRequest) => boolean;
  onMoveBookmarkItem: (request: BookmarkRootMoveRequest) => void;
  onOpenAddress: (displayUrl: string, accountId?: string | null) => void;
  onRemoveBookmark: (folderId: BookmarkFolderId, bookmarkId: string) => void;
  onRemoveDashboardPin: (pinId: string) => void;
  onRemoveStartPage: (displayUrl: string) => void;
  onToolbarVisibilityChange: (visibility: BookmarksState['toolbarVisibility']) => void;
  onUpdateBookmark: (folderId: BookmarkFolderId, bookmarkId: string, request: BookmarkUpdateRequest) => boolean;
  onUpdateBookmarkFolder: (folderId: BookmarkFolderId, bookmarkFolderId: string, request: BookmarkFolderRequest) => boolean;
  onUpdateDashboardPin: (pinId: string, request: BookmarkUpdateRequest) => boolean;
  onUpdateStartPage: (displayUrl: string, request: BookmarkUpdateRequest) => boolean;
};

type BookmarkDraft = {
  accountId?: string | null;
  displayUrl: string;
  title: string;
};

type DragPayload = {
  accountId?: string | null;
  displayUrl?: string;
  itemId: string;
  sourceRootId: BookmarkRootId;
  title?: string;
};

type DropTarget = {
  folderId?: string | null;
  itemId?: string | null;
  position?: BookmarkRootMoveRequest['targetPosition'];
  rootId: BookmarkRootId;
};

function isBookmarkRootId(value: string | undefined): value is BookmarkRootId {
  return value === 'pins' || value === 'startPages' || value === 'toolbar' || value === 'bookmarks';
}

function parseDropTarget(element: Element | null): DropTarget | null {
  const target = element?.closest<HTMLElement>('[data-bookmark-drop-root]');
  const rootId = target?.dataset.bookmarkDropRoot;

  if (!target || !isBookmarkRootId(rootId)) {
    return null;
  }

  return {
    folderId: target.dataset.bookmarkDropFolder || null,
    itemId: target.dataset.bookmarkDropItem || null,
    position: target.dataset.bookmarkDropPosition === 'before' ? 'before' : target.dataset.bookmarkDropPosition === 'inside' ? 'inside' : 'after',
    rootId,
  };
}

function buildMoveRequest(payload: DragPayload, target: DropTarget): BookmarkRootMoveRequest | null {
  if (payload.sourceRootId === target.rootId && payload.itemId === target.itemId) {
    return null;
  }

  return {
    accountId: payload.accountId,
    displayUrl: payload.displayUrl,
    itemId: payload.itemId,
    sourceRootId: payload.sourceRootId,
    targetFolderId: target.folderId,
    targetItemId: target.itemId,
    targetPosition: target.position,
    targetRootId: target.rootId,
    title: payload.title,
  };
}

function encodeDragPayload(payload: DragPayload) {
  return JSON.stringify(payload);
}

function decodeDragPayload(value: string): DragPayload | null {
  try {
    const payload = JSON.parse(value) as Partial<DragPayload>;
    return payload.itemId && isBookmarkRootId(payload.sourceRootId) ? payload as DragPayload : null;
  } catch {
    return null;
  }
}

function isValidDisplayUrl(displayUrl: string) {
  return parseAppAddress(displayUrl).success;
}

function BookmarksSection({
  action,
  children,
  id,
  rootId,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  id: string;
  rootId: BookmarkRootId;
  title: string;
}) {
  return (
    <details
      className="bookmarks-page__section"
      aria-labelledby={id}
      data-bookmark-drop-root={rootId}
      data-bookmark-drop-position="inside"
    >
      <summary className="bookmarks-page__section-header">
        <h2 id={id}>{title}</h2>
        {action}
      </summary>
      <div className="bookmarks-page__section-body">{children}</div>
    </details>
  );
}

function DragHandle({
  payload,
  onDropMove,
}: {
  payload: DragPayload;
  onDropMove: (request: BookmarkRootMoveRequest) => void;
}) {
  const touchStateRef = useRef<{
    isActive: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    timer: number;
  } | null>(null);

  function startTouchDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse') {
      return;
    }

    const button = event.currentTarget;
    const timer = window.setTimeout(() => {
      if (!touchStateRef.current || touchStateRef.current.pointerId !== event.pointerId) {
        return;
      }

      touchStateRef.current.isActive = true;
      button.classList.add('bookmarks-page__drag-handle--active');
    }, TOUCH_DRAG_DELAY_MS);

    touchStateRef.current = {
      isActive: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer,
    };
    button.setPointerCapture(event.pointerId);
  }

  function clearTouchDrag(event: PointerEvent<HTMLButtonElement>, shouldDrop: boolean) {
    const touchState = touchStateRef.current;

    if (!touchState || touchState.pointerId !== event.pointerId) {
      return;
    }

    window.clearTimeout(touchState.timer);
    event.currentTarget.classList.remove('bookmarks-page__drag-handle--active');

    if (shouldDrop && touchState.isActive) {
      const target = parseDropTarget(document.elementFromPoint(event.clientX, event.clientY));
      const request = target ? buildMoveRequest(payload, target) : null;

      if (request) {
        onDropMove(request);
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    touchStateRef.current = null;
  }

  return (
    <button
      className="bookmarks-page__drag-handle"
      draggable
      type="button"
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(BOOKMARK_DRAG_MIME, encodeDragPayload(payload));
      }}
      onPointerCancel={(event) => clearTouchDrag(event, false)}
      onPointerDown={startTouchDrag}
      onPointerMove={(event) => {
        const touchState = touchStateRef.current;

        if (!touchState || touchState.pointerId !== event.pointerId || touchState.isActive) {
          return;
        }

        if (Math.hypot(event.clientX - touchState.startX, event.clientY - touchState.startY) > TOUCH_DRAG_MOVE_CANCEL_PX) {
          clearTouchDrag(event, false);
        }
      }}
      onPointerUp={(event) => clearTouchDrag(event, true)}
    >
      <GripVertical aria-hidden="true" size={18} strokeWidth={2} />
    </button>
  );
}

function DropZone({
  children,
  className,
  folderId,
  itemId,
  position = 'after',
  rootId,
  onDropMove,
}: {
  children: ReactNode;
  className?: string;
  folderId?: string | null;
  itemId?: string | null;
  position?: BookmarkRootMoveRequest['targetPosition'];
  rootId: BookmarkRootId;
  onDropMove: (request: BookmarkRootMoveRequest) => void;
}) {
  return (
    <div
      className={className}
      data-bookmark-drop-folder={folderId ?? undefined}
      data-bookmark-drop-item={itemId ?? undefined}
      data-bookmark-drop-position={position}
      data-bookmark-drop-root={rootId}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(BOOKMARK_DRAG_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(event) => {
        const payload = decodeDragPayload(event.dataTransfer.getData(BOOKMARK_DRAG_MIME));
        const target = parseDropTarget(event.currentTarget);
        const request = payload && target ? buildMoveRequest(payload, target) : null;

        if (!request) {
          return;
        }

        event.preventDefault();
        onDropMove(request);
      }}
    >
      {children}
    </div>
  );
}

function BookmarkAddForm({
  accountsState,
  allowFolder = false,
  nodeApiUrl,
  nodeEpoch,
  onAddBookmark,
  onAddBookmarkFolder,
  onCancel,
}: {
  accountsState: QortiumAccountsState;
  allowFolder?: boolean;
  nodeApiUrl: string;
  nodeEpoch: number;
  onAddBookmark: (request: BookmarkUpdateRequest) => boolean;
  onAddBookmarkFolder?: (request: BookmarkFolderRequest) => boolean;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BookmarkDraft>({ displayUrl: '', title: '' });
  const [error, setError] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.displayUrl.trim()) {
      if (!allowFolder || !onAddBookmarkFolder) {
        setError(t('bookmarks.invalidUrl'));
        return;
      }

      if (!onAddBookmarkFolder({ title: draft.title })) {
        setError(t('bookmarks.duplicate'));
        return;
      }

      setDraft({ displayUrl: '', title: '' });
      setError('');
      onCancel();
      return;
    }

    if (!isValidDisplayUrl(draft.displayUrl)) {
      setError(t('bookmarks.invalidUrl'));
      return;
    }

    if (!onAddBookmark(draft)) {
      setError(t('bookmarks.duplicate'));
      return;
    }

    setDraft({ displayUrl: '', title: '' });
    setError('');
    onCancel();
  }

  return (
    <form className="bookmarks-page__add-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">{t('bookmarks.titleLabel')}</span>
        <input
          className="field__input"
          value={draft.title}
          onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }));
            setError('');
          }}
        />
      </label>
      <label className="field">
        <span className="field__label">{t('bookmarks.urlLabel')}</span>
        <input
          className="field__input"
          placeholder={t('address.placeholder')}
          value={draft.displayUrl}
          onChange={(event) => {
            setDraft((current) => ({ ...current, displayUrl: event.target.value }));
            setError('');
          }}
        />
      </label>
      <SavedAccountSelector
        accountId={draft.accountId}
        accountsState={accountsState}
        displayUrl={draft.displayUrl}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        onChange={(accountId) => {
          setDraft((current) => ({ ...current, accountId }));
          setError('');
        }}
      />
      <button className="icon-button bookmarks-page__add-button" type="submit" title={t('bookmarks.addBookmark')}>
        <Plus aria-hidden="true" size={18} strokeWidth={2} />
        <span className="sr-only">{t('bookmarks.addBookmark')}</span>
      </button>
      {error ? <p className="bookmarks-page__error">{error}</p> : null}
    </form>
  );
}

function BookmarkRow({
  accountsState,
  bookmark,
  folderId,
  onDropMove,
  nodeApiUrl,
  nodeEpoch,
  onOpenAddress,
  onRemoveBookmark,
  onUpdateBookmark,
  parentFolderId,
}: {
  accountsState: QortiumAccountsState;
  bookmark: BookmarkLink;
  folderId: BookmarkFolderId;
  onDropMove: (request: BookmarkRootMoveRequest) => void;
  nodeApiUrl: string;
  nodeEpoch: number;
  onOpenAddress: BookmarksPageProps['onOpenAddress'];
  onRemoveBookmark: BookmarksPageProps['onRemoveBookmark'];
  onUpdateBookmark: BookmarksPageProps['onUpdateBookmark'];
  parentFolderId?: string | null;
}) {
  const [draft, setDraft] = useState<BookmarkDraft>({
    accountId: bookmark.accountId ?? null,
    displayUrl: bookmark.displayUrl,
    title: bookmark.title,
  });
  const [error, setError] = useState('');
  const isDirty =
    (draft.accountId ?? null) !== (bookmark.accountId ?? null) ||
    draft.displayUrl !== bookmark.displayUrl ||
    draft.title !== bookmark.title;
  const display = getBookmarkDisplay(bookmark.displayUrl, bookmark.title, nodeApiUrl, nodeEpoch);

  function save() {
    if (!isValidDisplayUrl(draft.displayUrl)) {
      setError(t('bookmarks.invalidUrl'));
      return;
    }

    if (!onUpdateBookmark(folderId, bookmark.id, draft)) {
      setError(t('bookmarks.duplicate'));
      return;
    }

    setError('');
  }

  return (
    <DropZone
      className="bookmarks-page__row"
      folderId={parentFolderId}
      itemId={bookmark.id}
      rootId={folderId}
      onDropMove={onDropMove}
    >
      <DragHandle
        payload={{
          accountId: bookmark.accountId ?? null,
          displayUrl: bookmark.displayUrl,
          itemId: bookmark.id,
          sourceRootId: folderId,
          title: bookmark.title,
        }}
        onDropMove={onDropMove}
      />
      <SavedAccountSelector
        accountId={draft.accountId}
        accountsState={accountsState}
        displayUrl={draft.displayUrl}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        onChange={(accountId) => {
          setDraft((current) => ({ ...current, accountId }));
          setError('');
        }}
      />
      <button
        className="bookmarks-page__open-button"
        title={t('common.openItem', { target: display.label })}
        type="button"
        onClick={() => onOpenAddress(bookmark.displayUrl, bookmark.accountId ?? null)}
      >
        <BookmarkDisplayIcon className="bookmarks-page__item-icon" display={display} size={28} />
      </button>
      <div className="bookmarks-page__row-fields">
        <input
          className="field__input bookmarks-page__title-input"
          aria-label={t('bookmarks.titleLabel')}
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
        <input
          className="field__input bookmarks-page__url-input"
          aria-label={t('bookmarks.urlLabel')}
          value={draft.displayUrl}
          onChange={(event) => {
            setDraft((current) => ({ ...current, displayUrl: event.target.value }));
            setError('');
          }}
        />
      </div>
      <div className="bookmarks-page__row-actions">
        <button className="icon-button bookmarks-page__save-button" disabled={!isDirty} type="button" onClick={save}>
          <Save aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.save')}</span>
        </button>
        <button className="icon-button" type="button" onClick={() => onRemoveBookmark(folderId, bookmark.id)}>
          <Trash2 aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.remove')}</span>
        </button>
      </div>
      {error ? <p className="bookmarks-page__error">{error}</p> : null}
    </DropZone>
  );
}

function DashboardPinRow({
  accountsState,
  nodeApiUrl,
  nodeEpoch,
  onDropMove,
  onOpenAddress,
  onRemoveDashboardPin,
  onUpdateDashboardPin,
  pin,
}: {
  accountsState: QortiumAccountsState;
  nodeApiUrl: string;
  nodeEpoch: number;
  onDropMove: (request: BookmarkRootMoveRequest) => void;
  onOpenAddress: BookmarksPageProps['onOpenAddress'];
  onRemoveDashboardPin: BookmarksPageProps['onRemoveDashboardPin'];
  onUpdateDashboardPin: BookmarksPageProps['onUpdateDashboardPin'];
  pin: DashboardPin;
}) {
  const display = getBookmarkDisplay(pin.displayUrl, pin.customLabel || pin.label, nodeApiUrl, nodeEpoch);
  const [draft, setDraft] = useState<BookmarkDraft>({
    accountId: pin.accountId ?? null,
    displayUrl: pin.displayUrl,
    title: display.label,
  });
  const [error, setError] = useState('');
  const isDirty =
    (draft.accountId ?? null) !== (pin.accountId ?? null) ||
    draft.displayUrl !== pin.displayUrl ||
    draft.title !== display.label;

  function save() {
    if (!isValidDisplayUrl(draft.displayUrl)) {
      setError(t('bookmarks.invalidUrl'));
      return;
    }

    if (!onUpdateDashboardPin(pin.id, draft)) {
      setError(t('bookmarks.duplicate'));
      return;
    }

    setError('');
  }

  return (
    <DropZone className="bookmarks-page__row" itemId={pin.id} rootId="pins" onDropMove={onDropMove}>
      <DragHandle
        payload={{ accountId: pin.accountId ?? null, displayUrl: pin.displayUrl, itemId: pin.id, sourceRootId: 'pins', title: draft.title }}
        onDropMove={onDropMove}
      />
      <SavedAccountSelector
        accountId={draft.accountId}
        accountsState={accountsState}
        displayUrl={draft.displayUrl}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        onChange={(accountId) => {
          setDraft((current) => ({ ...current, accountId }));
          setError('');
        }}
      />
      <button
        className="bookmarks-page__open-button"
        title={t('common.openItem', { target: display.label })}
        type="button"
        onClick={() => onOpenAddress(pin.displayUrl, pin.accountId ?? null)}
      >
        <BookmarkDisplayIcon className="bookmarks-page__item-icon" display={display} size={28} />
      </button>
      <div className="bookmarks-page__row-fields">
        <input
          className="field__input bookmarks-page__title-input"
          aria-label={t('bookmarks.titleLabel')}
          value={draft.title}
          onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }));
            setError('');
          }}
        />
        <input
          className="field__input bookmarks-page__url-input"
          aria-label={t('bookmarks.urlLabel')}
          value={draft.displayUrl}
          onChange={(event) => {
            setDraft((current) => ({ ...current, displayUrl: event.target.value }));
            setError('');
          }}
        />
      </div>
      <div className="bookmarks-page__row-actions">
        <button className="icon-button bookmarks-page__save-button" disabled={!isDirty} type="button" onClick={save}>
          <Save aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.save')}</span>
        </button>
        <button className="icon-button" type="button" onClick={() => onRemoveDashboardPin(pin.id)}>
          <Trash2 aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.remove')}</span>
        </button>
      </div>
      {error ? <p className="bookmarks-page__error">{error}</p> : null}
    </DropZone>
  );
}

function StartPageRow({
  accountsState,
  nodeApiUrl,
  nodeEpoch,
  onDropMove,
  onOpenAddress,
  onRemoveStartPage,
  onUpdateStartPage,
  page,
}: {
  accountsState: QortiumAccountsState;
  nodeApiUrl: string;
  nodeEpoch: number;
  onDropMove: (request: BookmarkRootMoveRequest) => void;
  onOpenAddress: BookmarksPageProps['onOpenAddress'];
  onRemoveStartPage: BookmarksPageProps['onRemoveStartPage'];
  onUpdateStartPage: BookmarksPageProps['onUpdateStartPage'];
  page: StartPage;
}) {
  const display = getBookmarkDisplay(page.displayUrl, page.title, nodeApiUrl, nodeEpoch);
  const [draft, setDraft] = useState<BookmarkDraft>({
    accountId: page.accountId,
    displayUrl: page.displayUrl,
    title: page.title || display.label,
  });
  const [error, setError] = useState('');
  const originalTitle = page.title || display.label;
  const isDirty =
    (draft.accountId ?? null) !== page.accountId ||
    draft.displayUrl !== page.displayUrl ||
    draft.title !== originalTitle;

  function save() {
    if (!isValidDisplayUrl(draft.displayUrl)) {
      setError(t('bookmarks.invalidUrl'));
      return;
    }

    if (!onUpdateStartPage(page.displayUrl, draft)) {
      setError(t('bookmarks.duplicate'));
      return;
    }

    setError('');
  }

  return (
    <DropZone className="bookmarks-page__row" itemId={page.displayUrl} rootId="startPages" onDropMove={onDropMove}>
      <DragHandle
        payload={{ accountId: page.accountId, displayUrl: page.displayUrl, itemId: page.displayUrl, sourceRootId: 'startPages', title: draft.title }}
        onDropMove={onDropMove}
      />
      <SavedAccountSelector
        accountId={draft.accountId}
        accountsState={accountsState}
        displayUrl={draft.displayUrl}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        onChange={(accountId) => {
          setDraft((current) => ({ ...current, accountId }));
          setError('');
        }}
      />
      <button
        className="bookmarks-page__open-button"
        title={t('common.openItem', { target: display.label })}
        type="button"
        onClick={() => onOpenAddress(page.displayUrl, page.accountId)}
      >
        <BookmarkDisplayIcon className="bookmarks-page__item-icon" display={display} size={28} />
      </button>
      <div className="bookmarks-page__row-fields">
        <input
          className="field__input bookmarks-page__title-input"
          aria-label={t('bookmarks.titleLabel')}
          value={draft.title}
          onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }));
            setError('');
          }}
        />
        <input
          className="field__input bookmarks-page__url-input"
          aria-label={t('bookmarks.urlLabel')}
          value={draft.displayUrl}
          onChange={(event) => {
            setDraft((current) => ({ ...current, displayUrl: event.target.value }));
            setError('');
          }}
        />
      </div>
      <div className="bookmarks-page__row-actions">
        <button className="icon-button bookmarks-page__save-button" disabled={!isDirty} type="button" onClick={save}>
          <Save aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.save')}</span>
        </button>
        <button className="icon-button" type="button" onClick={() => onRemoveStartPage(page.displayUrl)}>
          <Trash2 aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.remove')}</span>
        </button>
      </div>
      {error ? <p className="bookmarks-page__error">{error}</p> : null}
    </DropZone>
  );
}

function BookmarkFolderRow({
  accountsState,
  folder,
  folderId,
  onAddBookmark,
  onAddBookmarkFolder,
  onDropMove,
  nodeApiUrl,
  nodeEpoch,
  onOpenAddress,
  onRemoveBookmark,
  onUpdateBookmark,
  onUpdateBookmarkFolder,
  parentFolderId,
}: {
  accountsState: QortiumAccountsState;
  folder: Extract<BookmarkTreeItem, { type: 'folder' }>;
  folderId: BookmarkFolderId;
  onAddBookmark: BookmarksPageProps['onAddBookmark'];
  onAddBookmarkFolder: BookmarksPageProps['onAddBookmarkFolder'];
  onDropMove: (request: BookmarkRootMoveRequest) => void;
  nodeApiUrl: string;
  nodeEpoch: number;
  onOpenAddress: BookmarksPageProps['onOpenAddress'];
  onRemoveBookmark: BookmarksPageProps['onRemoveBookmark'];
  onUpdateBookmark: BookmarksPageProps['onUpdateBookmark'];
  onUpdateBookmarkFolder: BookmarksPageProps['onUpdateBookmarkFolder'];
  parentFolderId?: string | null;
}) {
  const [title, setTitle] = useState(folder.title);
  const [isAdding, setIsAdding] = useState(false);
  const isDirty = title !== folder.title;

  return (
    <DropZone
      className="bookmarks-page__folder"
      folderId={parentFolderId}
      itemId={folder.id}
      rootId={folderId}
      onDropMove={onDropMove}
    >
      <div className="bookmarks-page__folder-heading">
        <DragHandle payload={{ itemId: folder.id, sourceRootId: folderId, title: folder.title }} onDropMove={onDropMove} />
        <Folder aria-hidden="true" size={18} strokeWidth={2} />
        <input
          className="field__input bookmarks-page__folder-title"
          aria-label={t('bookmarks.titleLabel')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button className="icon-button bookmarks-page__save-button" disabled={!isDirty} type="button" onClick={() => onUpdateBookmarkFolder(folderId, folder.id, { title })}>
          <Save aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.save')}</span>
        </button>
        <button className="icon-button" type="button" onClick={() => setIsAdding((value) => !value)}>
          <Plus aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('bookmarks.addBookmark')}</span>
        </button>
        <button className="icon-button" type="button" onClick={() => onRemoveBookmark(folderId, folder.id)}>
          <Trash2 aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('common.remove')}</span>
        </button>
      </div>
      <DropZone
        className="bookmarks-page__folder-body"
        folderId={folder.id}
        position="inside"
        rootId={folderId}
        onDropMove={onDropMove}
      >
        {isAdding ? (
          <BookmarkAddForm
            accountsState={accountsState}
            allowFolder
            nodeApiUrl={nodeApiUrl}
            nodeEpoch={nodeEpoch}
            onAddBookmark={(request) => onAddBookmark(folderId, request, folder.id)}
            onAddBookmarkFolder={(request) => onAddBookmarkFolder(folderId, request, folder.id)}
            onCancel={() => setIsAdding(false)}
          />
        ) : null}
        <BookmarkTree
          folderId={folderId}
          items={folder.children}
          accountsState={accountsState}
          parentFolderId={folder.id}
          onAddBookmark={onAddBookmark}
          onAddBookmarkFolder={onAddBookmarkFolder}
          onDropMove={onDropMove}
          nodeApiUrl={nodeApiUrl}
          nodeEpoch={nodeEpoch}
          onOpenAddress={onOpenAddress}
          onRemoveBookmark={onRemoveBookmark}
          onUpdateBookmark={onUpdateBookmark}
          onUpdateBookmarkFolder={onUpdateBookmarkFolder}
        />
      </DropZone>
    </DropZone>
  );
}

function BookmarkTree({
  accountsState,
  folderId,
  items,
  onAddBookmark,
  onAddBookmarkFolder,
  onDropMove,
  nodeApiUrl,
  nodeEpoch,
  onOpenAddress,
  onRemoveBookmark,
  onUpdateBookmark,
  onUpdateBookmarkFolder,
  parentFolderId = null,
}: {
  accountsState: QortiumAccountsState;
  folderId: BookmarkFolderId;
  items: BookmarkTreeItem[];
  onAddBookmark: BookmarksPageProps['onAddBookmark'];
  onAddBookmarkFolder: BookmarksPageProps['onAddBookmarkFolder'];
  onDropMove: (request: BookmarkRootMoveRequest) => void;
  nodeApiUrl: string;
  nodeEpoch: number;
  onOpenAddress: BookmarksPageProps['onOpenAddress'];
  onRemoveBookmark: BookmarksPageProps['onRemoveBookmark'];
  onUpdateBookmark: BookmarksPageProps['onUpdateBookmark'];
  onUpdateBookmarkFolder: BookmarksPageProps['onUpdateBookmarkFolder'];
  parentFolderId?: string | null;
}) {
  if (items.length === 0) {
    return (
      <DropZone
        className="bookmarks-page__empty-drop"
        folderId={parentFolderId}
        position="inside"
        rootId={folderId}
        onDropMove={onDropMove}
      >
        <p className="bookmarks-page__empty">{t('bookmarks.emptyFolder')}</p>
      </DropZone>
    );
  }

  return (
    <ol className="bookmarks-page__list">
      {items.map((item) => (
        <li key={item.id}>
          {item.type === 'folder' ? (
            <BookmarkFolderRow
              folder={item}
              folderId={folderId}
              accountsState={accountsState}
              parentFolderId={parentFolderId}
              onAddBookmark={onAddBookmark}
              onAddBookmarkFolder={onAddBookmarkFolder}
              onDropMove={onDropMove}
              nodeApiUrl={nodeApiUrl}
              nodeEpoch={nodeEpoch}
              onOpenAddress={onOpenAddress}
              onRemoveBookmark={onRemoveBookmark}
              onUpdateBookmark={onUpdateBookmark}
              onUpdateBookmarkFolder={onUpdateBookmarkFolder}
            />
          ) : (
            <BookmarkRow
              bookmark={item}
              folderId={folderId}
              accountsState={accountsState}
              parentFolderId={parentFolderId}
              onDropMove={onDropMove}
              nodeApiUrl={nodeApiUrl}
              nodeEpoch={nodeEpoch}
              onOpenAddress={onOpenAddress}
              onRemoveBookmark={onRemoveBookmark}
              onUpdateBookmark={onUpdateBookmark}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function BookmarkFolderEditor({
  accountsState,
  folderId,
  items,
  title,
  onAddBookmark,
  onAddBookmarkFolder,
  onDropMove,
  nodeApiUrl,
  nodeEpoch,
  onOpenAddress,
  onRemoveBookmark,
  onUpdateBookmark,
  onUpdateBookmarkFolder,
}: {
  accountsState: QortiumAccountsState;
  folderId: BookmarkFolderId;
  items: BookmarkTreeItem[];
  title: string;
  onAddBookmark: BookmarksPageProps['onAddBookmark'];
  onAddBookmarkFolder: BookmarksPageProps['onAddBookmarkFolder'];
  onDropMove: (request: BookmarkRootMoveRequest) => void;
  nodeApiUrl: string;
  nodeEpoch: number;
  onOpenAddress: BookmarksPageProps['onOpenAddress'];
  onRemoveBookmark: BookmarksPageProps['onRemoveBookmark'];
  onUpdateBookmark: BookmarksPageProps['onUpdateBookmark'];
  onUpdateBookmarkFolder: BookmarksPageProps['onUpdateBookmarkFolder'];
}) {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <BookmarksSection
      action={
        <button
          className="icon-button bookmarks-page__section-action"
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsAdding((value) => !value);
          }}
        >
          <Plus aria-hidden="true" size={17} strokeWidth={2} />
          <span className="sr-only">{t('bookmarks.addBookmark')}</span>
        </button>
      }
      id={`bookmarks-${folderId}-title`}
      rootId={folderId}
      title={title}
    >
      {isAdding ? (
        <BookmarkAddForm
          accountsState={accountsState}
          allowFolder
          nodeApiUrl={nodeApiUrl}
          nodeEpoch={nodeEpoch}
          onAddBookmark={(request) => onAddBookmark(folderId, request)}
          onAddBookmarkFolder={(request) => onAddBookmarkFolder(folderId, request)}
          onCancel={() => setIsAdding(false)}
        />
      ) : null}
      <BookmarkTree
        folderId={folderId}
        items={items}
        accountsState={accountsState}
        onAddBookmark={onAddBookmark}
        onAddBookmarkFolder={onAddBookmarkFolder}
        onDropMove={onDropMove}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        onOpenAddress={onOpenAddress}
        onRemoveBookmark={onRemoveBookmark}
        onUpdateBookmark={onUpdateBookmark}
        onUpdateBookmarkFolder={onUpdateBookmarkFolder}
      />
    </BookmarksSection>
  );
}

export function BookmarksPage({
  accountsState,
  bookmarksState,
  dashboardPins,
  nodeApiUrl,
  nodeEpoch,
  startPages,
  onAddBookmark,
  onAddBookmarkFolder,
  onMoveBookmarkItem,
  onOpenAddress,
  onRemoveBookmark,
  onRemoveDashboardPin,
  onRemoveStartPage,
  onToolbarVisibilityChange,
  onAddDashboardPin,
  onAddStartPage,
  onUpdateBookmark,
  onUpdateBookmarkFolder,
  onUpdateDashboardPin,
  onUpdateStartPage,
}: BookmarksPageProps) {
  const [isAddingPin, setIsAddingPin] = useState(false);
  const [isAddingStartPage, setIsAddingStartPage] = useState(false);

  return (
    <div className="bookmarks-page">
      <header className="bookmarks-page__header">
        <h1>{t('bookmarks.manageTitle')}</h1>
        <label className="bookmarks-page__toolbar-toggle">
          <span>{t('bookmarks.toolbarVisibility')}</span>
          <select
            className="field__select"
            value={bookmarksState.toolbarVisibility}
            onChange={(event) =>
              onToolbarVisibilityChange(event.target.value as BookmarksState['toolbarVisibility'])
            }
          >
            {BOOKMARK_TOOLBAR_VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {t(`bookmarks.toolbarVisibility.${visibility}`)}
              </option>
            ))}
          </select>
        </label>
      </header>

      <BookmarksSection
        action={
          <button
            className="icon-button bookmarks-page__section-action"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsAddingPin((value) => !value);
            }}
          >
            <Plus aria-hidden="true" size={17} strokeWidth={2} />
            <span className="sr-only">{t('bookmarks.addBookmark')}</span>
          </button>
        }
        id="bookmarks-pins-title"
        rootId="pins"
        title={t('bookmarks.folder.pins')}
      >
        {isAddingPin ? (
          <BookmarkAddForm
            accountsState={accountsState}
            nodeApiUrl={nodeApiUrl}
            nodeEpoch={nodeEpoch}
            onAddBookmark={onAddDashboardPin}
            onCancel={() => setIsAddingPin(false)}
          />
        ) : null}
        {dashboardPins.length > 0 ? (
          <ol className="bookmarks-page__list">
            {dashboardPins.map((pin) => (
              <li key={pin.id}>
                <DashboardPinRow
                  accountsState={accountsState}
                  nodeApiUrl={nodeApiUrl}
                  nodeEpoch={nodeEpoch}
                  onDropMove={onMoveBookmarkItem}
                  onOpenAddress={onOpenAddress}
                  onRemoveDashboardPin={onRemoveDashboardPin}
                  onUpdateDashboardPin={onUpdateDashboardPin}
                  pin={pin}
                />
              </li>
            ))}
          </ol>
        ) : (
          <DropZone className="bookmarks-page__empty-drop" rootId="pins" onDropMove={onMoveBookmarkItem}>
            <p className="bookmarks-page__empty">{t('bookmarks.emptyPins')}</p>
          </DropZone>
        )}
      </BookmarksSection>

      <BookmarksSection
        action={
          <button
            className="icon-button bookmarks-page__section-action"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsAddingStartPage((value) => !value);
            }}
          >
            <Plus aria-hidden="true" size={17} strokeWidth={2} />
            <span className="sr-only">{t('bookmarks.addBookmark')}</span>
          </button>
        }
        id="bookmarks-start-title"
        rootId="startPages"
        title={t('bookmarks.folder.startPages')}
      >
        {isAddingStartPage ? (
          <BookmarkAddForm
            accountsState={accountsState}
            nodeApiUrl={nodeApiUrl}
            nodeEpoch={nodeEpoch}
            onAddBookmark={onAddStartPage}
            onCancel={() => setIsAddingStartPage(false)}
          />
        ) : null}
        {startPages.length > 0 ? (
          <ol className="bookmarks-page__list">
            {startPages.map((page) => (
              <li key={page.displayUrl}>
                <StartPageRow
                  accountsState={accountsState}
                  nodeApiUrl={nodeApiUrl}
                  nodeEpoch={nodeEpoch}
                  onDropMove={onMoveBookmarkItem}
                  onOpenAddress={onOpenAddress}
                  onRemoveStartPage={onRemoveStartPage}
                  onUpdateStartPage={onUpdateStartPage}
                  page={page}
                />
              </li>
            ))}
          </ol>
        ) : (
          <DropZone className="bookmarks-page__empty-drop" rootId="startPages" onDropMove={onMoveBookmarkItem}>
            <p className="bookmarks-page__empty">{t('bookmarks.emptyStartPages')}</p>
          </DropZone>
        )}
      </BookmarksSection>

      <BookmarkFolderEditor
        accountsState={accountsState}
        folderId="toolbar"
        items={bookmarksState.toolbar}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        title={t('bookmarks.folder.toolbar')}
        onAddBookmark={onAddBookmark}
        onAddBookmarkFolder={onAddBookmarkFolder}
        onDropMove={onMoveBookmarkItem}
        onOpenAddress={onOpenAddress}
        onRemoveBookmark={onRemoveBookmark}
        onUpdateBookmark={onUpdateBookmark}
        onUpdateBookmarkFolder={onUpdateBookmarkFolder}
      />

      <BookmarkFolderEditor
        accountsState={accountsState}
        folderId="bookmarks"
        items={bookmarksState.bookmarks}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        title={t('bookmarks.folder.bookmarks')}
        onAddBookmark={onAddBookmark}
        onAddBookmarkFolder={onAddBookmarkFolder}
        onDropMove={onMoveBookmarkItem}
        onOpenAddress={onOpenAddress}
        onRemoveBookmark={onRemoveBookmark}
        onUpdateBookmark={onUpdateBookmark}
        onUpdateBookmarkFolder={onUpdateBookmarkFolder}
      />
    </div>
  );
}
