/**
 * Makes the stored account selection follow the tab group the user is in,
 * one vault call at a time.
 *
 * The vault round-trip is asynchronous (and slower on Android), so a naive
 * "select the group's account on every tab change" races: A → B → A in quick
 * succession, or closing B's tab while its select is still in flight, could
 * leave B as the durable selection, and a failed select would never be
 * retried. This controller serialises the follow: at most one select is in
 * flight; every completion — success or failure — re-reads the live target
 * (the ACTIVE group's account against the CURRENT selection) and issues one
 * more select if they still differ. So the last active group always wins,
 * and nothing counts as followed until the vault has confirmed it. A select
 * that fails for an unchanged target is retried a bounded number of times
 * with backoff; after that the follower stops until the next `sync()`.
 */
export interface TabGroupFollowerOptions {
  /**
   * The account the selection should switch to right now, or null when the
   * active group's account is the selected one (or names no account to
   * follow). Read live on every call — never cached.
   */
  readonly target: () => string | null
  /** Selects the account in the vault and commits the resulting state. */
  readonly select: (accountId: string) => Promise<void>
  /** Retries for an unchanged target after a failed select. Default 2. */
  readonly retries?: number
  /** Base backoff before a retry, doubled each time. Default 250 ms. */
  readonly backoffMs?: number
  /** Injectable for tests. Default: setTimeout. */
  readonly delay?: (ms: number) => Promise<void>
  readonly onFailure?: (error: unknown, accountId: string) => void
}

export interface TabGroupFollower {
  /** Call whenever the active tab may have changed. Cheap and re-entrant. */
  sync(): void
  /** True while a select is in flight or a retry is pending. */
  readonly busy: boolean
  /** Stops any pending retry; an in-flight select still commits. */
  dispose(): void
}

export function createTabGroupFollower(options: TabGroupFollowerOptions): TabGroupFollower {
  const retries = options.retries ?? 2
  const backoffMs = options.backoffMs ?? 250
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let running = false
  let pending = false
  let disposed = false

  const run = async () => {
    running = true
    try {
      let failures = 0
      let lastTarget: string | null = null
      for (;;) {
        if (disposed) return
        pending = false
        const target = options.target()
        if (!target) return
        // A NEW target resets the retry budget: the user moved on, and the
        // failures belonged to the old one.
        if (target !== lastTarget) failures = 0
        lastTarget = target
        try {
          await options.select(target)
        } catch (error) {
          failures += 1
          options.onFailure?.(error, target)
          if (failures > retries) return
          await delay(backoffMs * 2 ** (failures - 1))
        }
        // Loop: re-read the live target after every completion. A sync()
        // that arrived meanwhile is covered by the re-read; a target that now
        // matches the selection ends the loop.
      }
    } finally {
      running = false
      // A sync() that landed after the last re-read but before `running`
      // cleared would otherwise be lost.
      if (pending && !disposed) void run()
    }
  }

  return {
    sync() {
      if (disposed) return
      if (running) {
        pending = true
        return
      }
      void run()
    },
    get busy() {
      return running
    },
    dispose() {
      disposed = true
    },
  }
}
