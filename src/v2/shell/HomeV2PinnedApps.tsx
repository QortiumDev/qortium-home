import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowDown, ArrowUp, Compass, Copy, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import {
  reorderDashboardPins,
  type DashboardPin,
  type DashboardPinDropPosition,
} from "../../dashboardPins";
import { getDashboardPinDisplay } from "../../dashboardPinDisplay";
import { t } from "../../i18n";
import { useMenuKeyboard } from "../../useMenuKeyboard";
import type { HomeV2ContextMenuPresentationItem } from "./HomeV2ContextMenu";
import { HomeV2AppIcon, getHomeV2AppIconTarget } from "./HomeV2AppIcon";
import type { VisibleAppIconLoader } from "../contracts";
import "./home-v2-pinned-apps.css";

export type HomeV2PinnedAppsStatus = "error" | "loading" | "ready";
export type HomeV2PinnedAppsMoveDirection = "earlier" | "later";

export interface HomeV2PinnedAppsDraft {
  readonly displayUrl: string;
  readonly title: string;
}

export interface HomeV2PinnedAppsProps {
  readonly pins: readonly DashboardPin[];
  readonly status: HomeV2PinnedAppsStatus;
  readonly error?: string | null;
  readonly busy?: boolean;
  readonly allowAdd?: boolean;
  readonly getContextMenuItems?: (
    pin: DashboardPin,
  ) => readonly HomeV2ContextMenuPresentationItem[];
  readonly onOpen: (pin: DashboardPin) => void | Promise<void>;
  readonly onContextMenuAction?: (
    pin: DashboardPin,
    action: string,
  ) => void | Promise<void>;
  readonly onAdd: (draft: HomeV2PinnedAppsDraft) => void | Promise<void>;
  /** Opens the assigned Explore app so people can find apps to pin. */
  readonly onFindMoreApps?: () => void | Promise<void>;
  readonly onRename: (pin: DashboardPin, title: string) => void | Promise<void>;
  readonly onRemove: (pin: DashboardPin) => void | Promise<void>;
  readonly onMove: (
    pinId: string,
    direction: HomeV2PinnedAppsMoveDirection,
  ) => void | Promise<void>;
  readonly onReorder: (
    pinId: string,
    targetPinId: string,
    dropPosition: DashboardPinDropPosition,
  ) => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
  readonly loadVisibleAppIcon?: VisibleAppIconLoader;
}

const PIN_DRAG_START_MIN_DISTANCE_PX = 8;
const PIN_LONG_PRESS_MS = 500;
const PIN_TILE_REM = 4.5;
const PIN_GAP_PX = 10;

type PinMenuState = {
  readonly mode: "actions" | "rename";
  readonly pinId: string;
  readonly x: number;
  readonly y: number;
} | null;

type PinDragState = {
  readonly grabOffsetX: number;
  readonly grabOffsetY: number;
  readonly pinId: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  dragging: boolean;
  longPressed: boolean;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return t("common.error");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function getBalancedColumnCount(
  containerWidth: number,
  count: number,
  tileWidth: number,
): number {
  if (count <= 1) return Math.max(1, count);
  const columnsThatFit = Math.min(
    count,
    Math.max(
      1,
      Math.floor((containerWidth + PIN_GAP_PX) / (tileWidth + PIN_GAP_PX)),
    ),
  );
  return Math.ceil(count / Math.ceil(count / columnsThatFit));
}

export function HomeV2PinnedApps({
  pins,
  status,
  error,
  busy = false,
  allowAdd = true,
  getContextMenuItems,
  onOpen,
  onContextMenuAction,
  onAdd,
  onFindMoreApps,
  onRename,
  onRemove,
  onMove,
  onReorder,
  onRetry,
  loadVisibleAppIcon,
}: HomeV2PinnedAppsProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addAddress, setAddAddress] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [menu, setMenu] = useState<PinMenuState>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draggedPinId, setDraggedPinId] = useState<string | null>(null);
  const [workingPins, setWorkingPins] = useState<DashboardPin[] | null>(null);
  const [listWidth, setListWidth] = useState(0);
  const sectionRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const menuFocusTargetRef = useRef<HTMLButtonElement | null>(null);
  const pinElementsRef = useRef(new Map<string, HTMLLIElement>());
  const dragStateRef = useRef<PinDragState | null>(null);
  const workingPinsRef = useRef<DashboardPin[] | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressedClickPinIdRef = useRef<string | null>(null);
  const appliedTranslateRef = useRef({ x: 0, y: 0 });
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const controlsDisabled = busy || pendingAction !== null;
  const renderedPins = workingPins ?? [...pins];

  const listMaxWidth = useMemo(() => {
    if (listWidth <= 0 || renderedPins.length === 0) return undefined;
    const rootFontSize =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
      16;
    const tileWidth = PIN_TILE_REM * rootFontSize;
    const columns = getBalancedColumnCount(
      listWidth,
      renderedPins.length,
      tileWidth,
    );
    return columns * tileWidth + (columns - 1) * PIN_GAP_PX;
  }, [listWidth, renderedPins.length]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function resetDrag() {
    const activePinId = dragStateRef.current?.pinId ?? draggedPinId;
    const draggedElement = activePinId
      ? pinElementsRef.current.get(activePinId)
      : null;
    if (draggedElement) draggedElement.style.transform = "";
    appliedTranslateRef.current = { x: 0, y: 0 };
    dragStateRef.current = null;
    workingPinsRef.current = null;
    setDraggedPinId(null);
    setWorkingPins(null);
  }

  function releasePointer(pointerId: number) {
    const list = listRef.current;
    if (list?.hasPointerCapture?.(pointerId))
      list.releasePointerCapture(pointerId);
  }

  function scheduleSuppressionClear() {
    window.setTimeout(() => {
      suppressedClickPinIdRef.current = null;
    }, 0);
  }

  function closeAddForm() {
    setAddAddress("");
    setAddTitle("");
    setShowAddForm(false);
    setActionError(null);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function closeMenu(restoreFocus = false) {
    const focusTarget = menuFocusTargetRef.current;
    setMenu(null);
    setRenameTitle("");
    if (restoreFocus) requestAnimationFrame(() => focusTarget?.focus());
  }

  async function runAction(
    actionId: string,
    action: () => void | Promise<void>,
    onSuccess?: () => void,
  ) {
    if (controlsDisabled) return;
    setPendingAction(actionId);
    setActionError(null);
    try {
      await action();
      onSuccess?.();
    } catch (actionFailure) {
      setActionError(getErrorMessage(actionFailure));
    } finally {
      setPendingAction(null);
    }
  }

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayUrl = addAddress.trim();
    if (!displayUrl) {
      setActionError(t("bookmarks.invalidUrl"));
      return;
    }
    void runAction(
      "add",
      () => onAdd({ displayUrl, title: addTitle.trim() }),
      closeAddForm,
    );
  }

  function submitRename(event: FormEvent<HTMLFormElement>, pin: DashboardPin) {
    event.preventDefault();
    void runAction(
      `rename:${pin.id}`,
      () => onRename(pin, renameTitle.trim()),
      () => closeMenu(true),
    );
  }

  function openMenuAt(
    pin: DashboardPin,
    x: number,
    y: number,
    focusTarget: HTMLButtonElement | null,
  ) {
    if (controlsDisabled) return;
    const menuWidth = 192;
    const menuHeight = 190;
    menuFocusTargetRef.current = focusTarget;
    setActionError(null);
    setRenameTitle(getDashboardPinDisplay(pin).shortLabel);
    setMenu({
      mode: "actions",
      pinId: pin.id,
      x: clamp(x, 8, window.innerWidth - menuWidth - 8),
      y: clamp(y, 8, window.innerHeight - menuHeight - 8),
    });
  }

  function commitOrder(order: readonly DashboardPin[], pinId: string) {
    if (order.every((pin, index) => pin.id === pins[index]?.id)) return;
    const finalIndex = order.findIndex((pin) => pin.id === pinId);
    if (finalIndex < 0) return;
    if (finalIndex === 0) {
      const target = order[1];
      if (target) {
        void runAction(`reorder:${pinId}`, () =>
          onReorder(pinId, target.id, "before"),
        );
      }
      return;
    }
    void runAction(`reorder:${pinId}`, () =>
      onReorder(pinId, order[finalIndex - 1].id, "after"),
    );
  }

  function applyDragTranslate(clientX: number, clientY: number) {
    const drag = dragStateRef.current;
    const element = drag ? pinElementsRef.current.get(drag.pinId) : null;
    if (!drag || !element) return;
    const bounds = element.getBoundingClientRect();
    const baseLeft = bounds.left - appliedTranslateRef.current.x;
    const baseTop = bounds.top - appliedTranslateRef.current.y;
    const next = {
      x: clientX - baseLeft - drag.grabOffsetX,
      y: clientY - baseTop - drag.grabOffsetY,
    };
    appliedTranslateRef.current = next;
    element.style.transform = `translate(${next.x}px, ${next.y}px) scale(1.04)`;
  }

  function nearestDropTarget(clientX: number, clientY: number) {
    const drag = dragStateRef.current;
    const order = workingPinsRef.current;
    if (!drag || !order) return null;
    let nearest: { pinId: string; position: DashboardPinDropPosition } | null =
      null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const pin of order) {
      if (pin.id === drag.pinId) continue;
      const bounds = pinElementsRef.current
        .get(pin.id)
        ?.getBoundingClientRect();
      if (!bounds) continue;
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const distance = Math.hypot(clientX - centerX, (clientY - centerY) * 4);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = {
          pinId: pin.id,
          position: clientX < centerX ? "before" : "after",
        };
      }
    }
    return nearest;
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLLIElement>,
    pin: DashboardPin,
  ) {
    if (controlsDisabled || menu) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragStateRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      dragging: false,
      grabOffsetX: event.clientX - bounds.left,
      grabOffsetY: event.clientY - bounds.top,
      pinId: pin.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      longPressed: false,
    };
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    listRef.current?.setPointerCapture?.(event.pointerId);
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      const drag = dragStateRef.current;
      if (!drag || drag.pinId !== pin.id || drag.dragging) return;
      drag.longPressed = true;
      suppressedClickPinIdRef.current = pin.id;
      openMenuAt(
        pin,
        event.clientX,
        event.clientY,
        pinElementsRef.current
          .get(pin.id)
          ?.querySelector<HTMLButtonElement>(".home-v2-pinned-apps__open") ??
          null,
      );
      clearLongPressTimer();
    }, PIN_LONG_PRESS_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLUListElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.longPressed) return;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    if (!drag.dragging) {
      const distance = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      );
      if (distance < PIN_DRAG_START_MIN_DISTANCE_PX) return;
      clearLongPressTimer();
      drag.dragging = true;
      const initialOrder = [...pins];
      workingPinsRef.current = initialOrder;
      setWorkingPins(initialOrder);
      setDraggedPinId(drag.pinId);
    }
    applyDragTranslate(event.clientX, event.clientY);
    const target = nearestDropTarget(event.clientX, event.clientY);
    const currentOrder = workingPinsRef.current;
    if (!target || !currentOrder) return;
    const nextOrder = reorderDashboardPins(
      currentOrder,
      drag.pinId,
      target.pinId,
      target.position,
    );
    if (nextOrder === currentOrder) return;
    workingPinsRef.current = nextOrder;
    setWorkingPins(nextOrder);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLUListElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    const pin = pins.find((candidate) => candidate.id === drag.pinId) ?? null;
    const isTap = !drag.dragging && !drag.longPressed;
    if ((drag.dragging || drag.longPressed || isTap) && pin) {
      suppressedClickPinIdRef.current = pin.id;
    }
    if (drag.dragging) {
      const finalOrder = workingPinsRef.current ?? [...pins];
      suppressedClickPinIdRef.current = drag.pinId;
      commitOrder(finalOrder, drag.pinId);
    }
    resetDrag();
    releasePointer(event.pointerId);
    scheduleSuppressionClear();
    if (isTap && pin) {
      void runAction(`open:${pin.id}`, () => onOpen(pin));
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLUListElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    if (drag.dragging || drag.longPressed) {
      suppressedClickPinIdRef.current = drag.pinId;
    }
    resetDrag();
    releasePointer(event.pointerId);
    scheduleSuppressionClear();
  }

  useLayoutEffect(() => {
    const element = sectionRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setListWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (draggedPinId) {
      applyDragTranslate(lastPointerRef.current.x, lastPointerRef.current.y);
    }
  }, [draggedPinId, workingPins]);

  useEffect(() => {
    if (!menu) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    }
    function closeOnViewportChange() {
      closeMenu();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [menu]);

  useEffect(() => {
    if (menu?.mode === "rename") {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [menu?.mode]);

  useEffect(() => () => clearLongPressTimer(), []);

  const menuKeyboard = useMenuKeyboard({
    getFocusAfterEscape: () => menuFocusTargetRef.current,
    isOpen: menu?.mode === "actions",
    menuRef,
    onClose: () => closeMenu(),
  });
  const menuPin = menu
    ? (pins.find((pin) => pin.id === menu.pinId) ?? null)
    : null;
  const menuPinIndex = menuPin
    ? pins.findIndex((pin) => pin.id === menuPin.id)
    : -1;
  const menuContextItems = menuPin && getContextMenuItems && onContextMenuAction
    ? getContextMenuItems(menuPin)
    : [];

  return (
    <section
      ref={sectionRef}
      className="home-v2-pinned-apps"
      aria-labelledby="pinned-apps-title"
      aria-busy={status === "loading" || controlsDisabled}
    >
      <div className="home-v2-section-heading">
        <div>
          <h2 id="pinned-apps-title">{t("home2.dashboard.pinnedApps")}</h2>
        </div>
        {onFindMoreApps ? (
          <button
            type="button"
            className="home-v2-link-button home-v2-pinned-apps__find-button"
            disabled={controlsDisabled}
            onClick={() => void onFindMoreApps()}
          >
            <Compass aria-hidden="true" size={17} />
            {t("home2.apps")}
          </button>
        ) : null}
        {allowAdd ? (
          <button
            ref={addButtonRef}
            type="button"
            className="home-v2-link-button home-v2-pinned-apps__add-button"
            aria-expanded={showAddForm && status === "ready"}
            aria-label={`${t("common.create")} ${t("home2.dashboard.pinnedApps")}`}
            disabled={status !== "ready" || controlsDisabled}
            onClick={() => {
              setActionError(null);
              setShowAddForm((shown) => !shown);
            }}
          >
            <Plus aria-hidden="true" size={17} />
            {t("common.create")}
          </button>
        ) : null}
      </div>

      {allowAdd && showAddForm && status === "ready" ? (
        <form className="home-v2-pinned-apps__form" onSubmit={submitAdd}>
          <label>
            <span>{t("bookmarks.urlLabel")}</span>
            <input
              autoFocus
              autoComplete="off"
              dir="ltr"
              placeholder="qdn://APP/Name/identifier"
              spellCheck={false}
              value={addAddress}
              onChange={(event) => setAddAddress(event.target.value)}
            />
          </label>
          <label>
            <span>{t("bookmarks.titleLabel")}</span>
            <input
              autoComplete="off"
              value={addTitle}
              onChange={(event) => setAddTitle(event.target.value)}
            />
          </label>
          <div className="home-v2-pinned-apps__form-actions">
            <button
              type="button"
              className="home-v2-secondary-button"
              disabled={controlsDisabled}
              onClick={closeAddForm}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="home-v2-primary-button"
              disabled={controlsDisabled || !addAddress.trim()}
            >
              {pendingAction === "add" ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      ) : null}

      {actionError ? (
        <p className="home-v2-pinned-apps__error" role="alert">
          {actionError}
        </p>
      ) : null}

      {status === "loading" ? (
        <p className="home-v2-pinned-apps__state" role="status">
          {t("common.loading")}…
        </p>
      ) : status === "error" ? (
        <div className="home-v2-pinned-apps__state" role="alert">
          <p>{error?.trim() || t("common.error")}</p>
          {onRetry ? (
            <button
              type="button"
              className="home-v2-secondary-button"
              disabled={controlsDisabled}
              onClick={() => void runAction("retry", onRetry)}
            >
              {t("common.retry")}
            </button>
          ) : null}
        </div>
      ) : pins.length === 0 ? (
        <p className="home-v2-pinned-apps__state">{t("bookmarks.emptyPins")}</p>
      ) : (
        <ul
          ref={listRef}
          className="home-v2-pinned-apps__grid"
          style={{ maxWidth: listMaxWidth }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
        >
          {renderedPins.map((pin) => {
            const display = getDashboardPinDisplay(pin);
            const Icon = display.Icon;
            const appIconTarget = getHomeV2AppIconTarget(pin.displayUrl);
            return (
              <li
                key={pin.id}
                ref={(element) => {
                  if (element) pinElementsRef.current.set(pin.id, element);
                  else pinElementsRef.current.delete(pin.id);
                }}
                className={`home-v2-pinned-apps__card${
                  draggedPinId === pin.id
                    ? " home-v2-pinned-apps__card--dragging"
                    : ""
                }`}
                data-pin-id={pin.id}
                onPointerDown={(event) => handlePointerDown(event, pin)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenuAt(
                    pin,
                    event.clientX,
                    event.clientY,
                    event.currentTarget.querySelector("button"),
                  );
                }}
              >
                <button
                  type="button"
                  className="home-v2-pinned-apps__open"
                  disabled={controlsDisabled}
                  aria-haspopup="menu"
                  aria-label={t("common.openItem", {
                    target: display.shortLabel,
                  })}
                  title={t("common.openItem", { target: display.shortLabel })}
                  onClick={() => {
                    if (suppressedClickPinIdRef.current === pin.id) {
                      suppressedClickPinIdRef.current = null;
                      return;
                    }
                    void runAction(`open:${pin.id}`, () => onOpen(pin));
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    ) {
                      event.preventDefault();
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      openMenuAt(
                        pin,
                        bounds.left,
                        bounds.bottom,
                        event.currentTarget,
                      );
                    }
                  }}
                >
                  <span
                    className="home-v2-pinned-apps__icon"
                    aria-hidden="true"
                  >
                    {appIconTarget ? (
                      <HomeV2AppIcon
                        displayUrl={pin.displayUrl}
                        loader={loadVisibleAppIcon}
                        size={38}
                        variant="pin"
                      />
                    ) : (
                      <Icon size={32} strokeWidth={1.8} />
                    )}
                  </span>
                  <span className="home-v2-pinned-apps__copy">
                    {display.shortLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {menu && menuPin ? (
        <div
          ref={menuRef}
          className="home-v2-pinned-apps__menu"
          role={menu.mode === "actions" ? "menu" : undefined}
          aria-label={t("dashboard.pinMenuLabel")}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={
            menu.mode === "actions" ? menuKeyboard.onKeyDown : undefined
          }
        >
          {menu.mode === "rename" ? (
            <form
              className="home-v2-pinned-apps__rename"
              onSubmit={(event) => submitRename(event, menuPin)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu(true);
                }
              }}
            >
              <label>
                <span>
                  {t("dashboard.renamePinLabel", {
                    label: getDashboardPinDisplay(menuPin).shortLabel,
                  })}
                </span>
                <input
                  ref={renameInputRef}
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                />
              </label>
              <div className="home-v2-pinned-apps__form-actions">
                <button
                  type="button"
                  className="home-v2-secondary-button"
                  disabled={controlsDisabled}
                  onClick={() => closeMenu(true)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="home-v2-primary-button"
                  disabled={controlsDisabled}
                >
                  {pendingAction === `rename:${menuPin.id}`
                    ? t("common.saving")
                    : t("common.save")}
                </button>
              </div>
            </form>
          ) : (
            <>
              {menuContextItems.length > 0
                ? menuContextItems.map((item) => {
                    const Icon = item.group === "open" ? ExternalLink : Copy;
                    return (
                      <button
                        key={item.action}
                        type="button"
                        role="menuitem"
                        disabled={controlsDisabled}
                        onClick={() =>
                          void runAction(
                            `context:${menuPin.id}:${item.action}`,
                            () => onContextMenuAction!(menuPin, item.action),
                            () => closeMenu(true),
                          )
                        }
                      >
                        <Icon aria-hidden="true" size={17} />
                        {item.label}
                      </button>
                    );
                  })
                : null}
              {menuContextItems.length > 0 ? (
                <div className="home-v2-pinned-apps__menu-separator" role="separator" />
              ) : null}
              <button
                type="button"
                role="menuitem"
                aria-label={`${t("common.back")}: ${getDashboardPinDisplay(menuPin).shortLabel}`}
                disabled={controlsDisabled || menuPinIndex === 0}
                onClick={() =>
                  void runAction(
                    `move:${menuPin.id}:earlier`,
                    () => onMove(menuPin.id, "earlier"),
                    () => closeMenu(true),
                  )
                }
              >
                <ArrowUp aria-hidden="true" size={17} />
                {t("common.back")}
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label={`${t("common.forward")}: ${getDashboardPinDisplay(menuPin).shortLabel}`}
                disabled={controlsDisabled || menuPinIndex === pins.length - 1}
                onClick={() =>
                  void runAction(
                    `move:${menuPin.id}:later`,
                    () => onMove(menuPin.id, "later"),
                    () => closeMenu(true),
                  )
                }
              >
                <ArrowDown aria-hidden="true" size={17} />
                {t("common.forward")}
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label={t("dashboard.renamePinLabel", {
                  label: getDashboardPinDisplay(menuPin).shortLabel,
                })}
                disabled={controlsDisabled}
                onClick={() => setMenu({ ...menu, mode: "rename" })}
              >
                <Pencil aria-hidden="true" size={16} />
                {t("dashboard.renamePin")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="home-v2-pinned-apps__remove"
                aria-label={t("dashboard.removePin", {
                  label: getDashboardPinDisplay(menuPin).shortLabel,
                })}
                disabled={controlsDisabled}
                onClick={() =>
                  void runAction(
                    `remove:${menuPin.id}`,
                    () => onRemove(menuPin),
                    () => closeMenu(),
                  )
                }
              >
                <Trash2 aria-hidden="true" size={16} />
                {t("common.remove")}
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
