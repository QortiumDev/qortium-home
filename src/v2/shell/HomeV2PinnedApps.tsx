import { useRef, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { DashboardPin } from '../../dashboardPins'
import { getDashboardPinDisplay } from '../../dashboardPinDisplay'
import { t } from '../../i18n'
import './home-v2-pinned-apps.css'

export type HomeV2PinnedAppsStatus = 'error' | 'loading' | 'ready'
export type HomeV2PinnedAppsMoveDirection = 'earlier' | 'later'

export interface HomeV2PinnedAppsDraft {
  readonly displayUrl: string
  readonly title: string
}

export interface HomeV2PinnedAppsProps {
  readonly pins: readonly DashboardPin[]
  readonly status: HomeV2PinnedAppsStatus
  readonly error?: string | null
  readonly busy?: boolean
  readonly allowAdd?: boolean
  readonly onOpen: (pin: DashboardPin) => void | Promise<void>
  readonly onAdd: (draft: HomeV2PinnedAppsDraft) => void | Promise<void>
  readonly onRename: (
    pin: DashboardPin,
    title: string,
  ) => void | Promise<void>
  readonly onRemove: (pin: DashboardPin) => void | Promise<void>
  readonly onMove: (
    pinId: string,
    direction: HomeV2PinnedAppsMoveDirection,
  ) => void | Promise<void>
  readonly onRetry?: () => void | Promise<void>
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return t('common.error')
}

export function HomeV2PinnedApps({
  pins,
  status,
  error,
  busy = false,
  allowAdd = true,
  onOpen,
  onAdd,
  onRename,
  onRemove,
  onMove,
  onRetry,
}: HomeV2PinnedAppsProps) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [addAddress, setAddAddress] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [renamingPinId, setRenamingPinId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const controlsDisabled = busy || pendingAction !== null

  function closeAddForm() {
    setAddAddress('')
    setAddTitle('')
    setShowAddForm(false)
    setActionError(null)
    requestAnimationFrame(() => addButtonRef.current?.focus())
  }

  function closeRenameForm(pinId: string) {
    setRenamingPinId(null)
    setRenameTitle('')
    setActionError(null)
    requestAnimationFrame(() => {
      const button = [...(sectionRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-pin-rename-id]',
      ) ?? [])].find((candidate) => candidate.dataset.pinRenameId === pinId)
      button?.focus()
    })
  }

  async function runAction(
    actionId: string,
    action: () => void | Promise<void>,
    onSuccess?: () => void,
  ) {
    if (controlsDisabled) return
    setPendingAction(actionId)
    setActionError(null)
    try {
      await action()
      onSuccess?.()
    } catch (actionFailure) {
      setActionError(getErrorMessage(actionFailure))
    } finally {
      setPendingAction(null)
    }
  }

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const displayUrl = addAddress.trim()
    if (!displayUrl) {
      setActionError(t('bookmarks.invalidUrl'))
      return
    }
    const title = addTitle.trim()
    void runAction(
      'add',
      () => onAdd({ displayUrl, title }),
      closeAddForm,
    )
  }

  function startRename(pin: DashboardPin) {
    const display = getDashboardPinDisplay(pin)
    setActionError(null)
    setRenamingPinId(pin.id)
    setRenameTitle(pin.customLabel?.trim() || display.shortLabel)
  }

  function submitRename(
    event: FormEvent<HTMLFormElement>,
    pin: DashboardPin,
  ) {
    event.preventDefault()
    void runAction(
      `rename:${pin.id}`,
      () => onRename(pin, renameTitle.trim()),
      () => closeRenameForm(pin.id),
    )
  }

  return (
    <section
      ref={sectionRef}
      className="home-v2-pinned-apps"
      aria-labelledby="pinned-apps-title"
      aria-busy={status === 'loading' || controlsDisabled}
    >
      <div className="home-v2-section-heading">
        <div>
          <h2 id="pinned-apps-title">{t('home2.dashboard.pinnedApps')}</h2>
        </div>
        {allowAdd ? <button
          ref={addButtonRef}
          type="button"
          className="home-v2-link-button home-v2-pinned-apps__add-button"
          aria-expanded={showAddForm && status === 'ready'}
          aria-label={`${t('common.create')} ${t('home2.dashboard.pinnedApps')}`}
          disabled={status !== 'ready' || controlsDisabled}
          onClick={() => {
            setActionError(null)
            setShowAddForm((shown) => !shown)
          }}
        >
          <Plus aria-hidden="true" size={17} />
          {t('common.create')}
        </button> : null}
      </div>

      {allowAdd && showAddForm && status === 'ready' ? (
        <form className="home-v2-pinned-apps__form" onSubmit={submitAdd}>
          <label>
            <span>{t('bookmarks.urlLabel')}</span>
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
            <span>{t('bookmarks.titleLabel')}</span>
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
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="home-v2-primary-button"
              disabled={controlsDisabled || !addAddress.trim()}
            >
              {pendingAction === 'add' ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      ) : null}

      {actionError ? (
        <p className="home-v2-pinned-apps__error" role="alert">
          {actionError}
        </p>
      ) : null}

      {status === 'loading' ? (
        <p className="home-v2-pinned-apps__state" role="status">
          {t('common.loading')}…
        </p>
      ) : status === 'error' ? (
        <div className="home-v2-pinned-apps__state" role="alert">
          <p>{error?.trim() || t('common.error')}</p>
          {onRetry ? (
            <button
              type="button"
              className="home-v2-secondary-button"
              disabled={controlsDisabled}
              onClick={() => void runAction('retry', onRetry)}
            >
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : pins.length === 0 ? (
        <p className="home-v2-pinned-apps__state">
          {t('bookmarks.emptyPins')}
        </p>
      ) : (
        <div className="home-v2-pinned-apps__grid">
          {pins.map((pin, index) => {
            const display = getDashboardPinDisplay(pin)
            const Icon = display.Icon
            const isRenaming = renamingPinId === pin.id
            const titleId = `home-v2-pin-${index}-title`
            return (
              <article
                className="home-v2-pinned-apps__card"
                key={pin.id}
                aria-labelledby={titleId}
              >
                <button
                  type="button"
                  className="home-v2-pinned-apps__open"
                  disabled={controlsDisabled}
                  aria-label={t('common.openItem', {
                    target: display.shortLabel,
                  })}
                  onClick={() =>
                    void runAction(`open:${pin.id}`, () => onOpen(pin))
                  }
                >
                  <span className="home-v2-pinned-apps__icon" aria-hidden="true">
                    <Icon size={27} strokeWidth={1.8} />
                  </span>
                  <span className="home-v2-pinned-apps__copy">
                    <strong id={titleId}>{display.shortLabel}</strong>
                    <small dir="ltr">{pin.displayUrl}</small>
                  </span>
                </button>

                {isRenaming ? (
                  <form
                    className="home-v2-pinned-apps__rename"
                    onSubmit={(event) => submitRename(event, pin)}
                  >
                    <label>
                      <span>{t('dashboard.renamePinLabel', { label: display.shortLabel })}</span>
                      <input
                        autoFocus
                        value={renameTitle}
                        onChange={(event) => setRenameTitle(event.target.value)}
                      />
                    </label>
                    <div className="home-v2-pinned-apps__form-actions">
                      <button
                        type="button"
                        className="home-v2-secondary-button"
                        disabled={controlsDisabled}
                        onClick={() => closeRenameForm(pin.id)}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="submit"
                        className="home-v2-primary-button"
                        disabled={controlsDisabled}
                      >
                        {pendingAction === `rename:${pin.id}`
                          ? t('common.saving')
                          : t('common.save')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div
                    className="home-v2-pinned-apps__actions"
                    aria-label={t('dashboard.pinMenuLabel')}
                    role="group"
                  >
                    <button
                      type="button"
                      aria-label={`${t('common.back')}: ${display.shortLabel}`}
                      disabled={controlsDisabled || index === 0}
                      onClick={() =>
                        void runAction(`move:${pin.id}:earlier`, () =>
                          onMove(pin.id, 'earlier'),
                        )
                      }
                    >
                      <ArrowUp aria-hidden="true" size={17} />
                      <span>{t('common.back')}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`${t('common.forward')}: ${display.shortLabel}`}
                      disabled={controlsDisabled || index === pins.length - 1}
                      onClick={() =>
                        void runAction(`move:${pin.id}:later`, () =>
                          onMove(pin.id, 'later'),
                        )
                      }
                    >
                      <ArrowDown aria-hidden="true" size={17} />
                      <span>{t('common.forward')}</span>
                    </button>
                    <button
                      type="button"
                      data-pin-rename-id={pin.id}
                      aria-label={t('dashboard.renamePinLabel', {
                        label: display.shortLabel,
                      })}
                      disabled={controlsDisabled}
                      onClick={() => startRename(pin)}
                    >
                      <Pencil aria-hidden="true" size={16} />
                      <span>{t('dashboard.renamePin')}</span>
                    </button>
                    <button
                      type="button"
                      className="home-v2-pinned-apps__remove"
                      aria-label={t('dashboard.removePin', {
                        label: display.shortLabel,
                      })}
                      disabled={controlsDisabled}
                      onClick={() =>
                        void runAction(`remove:${pin.id}`, () => onRemove(pin))
                      }
                    >
                      <Trash2 aria-hidden="true" size={16} />
                      <span>{t('common.remove')}</span>
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
