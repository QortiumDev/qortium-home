// A bounded per-(tab, account) rate limit on Home v2's public CHAT write
// actions, shared between desktop (electron/home-v2-app-bridge.ts) and
// Android (src/home-v2-live/HomeV2LiveApp.tsx) so both platforms enforce the
// same constants (this file has no node/electron-only imports, so it bundles
// into the renderer the same way electron/home-v2-app-actions.ts does).
//
// Rationale (security review finding 8): once a tab holds an approved or
// session-granted chat-send permission, nothing previously bounded how many
// times it could be used — an approved (or compromised) app could broadcast
// unlimited back-to-back sends, each paying its own memory-pow cost, pegging
// CPU and spamming the network for the tab's lifetime. This is a ceiling
// layered ON TOP of the existing single-in-flight-PoW guard, not a
// replacement for it, and it only ever gates public CHAT writes — reads and
// the permission prompt itself are never rate-limited.

// A real person sending chat messages by hand rarely exceeds one message
// every few seconds even in a fast back-and-forth; both constants are picked
// to stay generously above that cadence while still bounding an automated
// flood to a small, fixed multiple of normal human pace.
export const HOME_V2_CHAT_SEND_MIN_INTERVAL_MS = 1_500;
export const HOME_V2_CHAT_SEND_WINDOW_MS = 60_000;
export const HOME_V2_CHAT_SEND_MAX_PER_WINDOW = 20;

export const HOME_V2_CHAT_SEND_RATE_LIMITED_MESSAGE = 'Sending too quickly; wait a moment.';

export type HomeV2SendRateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string };

export interface HomeV2SendRateLimiter {
  /**
   * Checks whether a send for `key` is allowed right now and, if so, records
   * it. Call this ONCE per send attempt, before starting proof-of-work — a
   * rejected attempt is not recorded, so it does not itself count against
   * the rolling window.
   */
  checkAndRecordSend(key: string, now?: number): HomeV2SendRateLimitDecision;
  /** Drops all tracked history (e.g. on account lock). */
  reset(): void;
}

export function createHomeV2SendRateLimiter(): HomeV2SendRateLimiter {
  const sendTimestampsByKey = new Map<string, number[]>();

  return {
    checkAndRecordSend(key: string, now = Date.now()): HomeV2SendRateLimitDecision {
      const windowStart = now - HOME_V2_CHAT_SEND_WINDOW_MS;
      const recent = (sendTimestampsByKey.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

      const lastSend = recent[recent.length - 1];
      const tooSoon = lastSend !== undefined && now - lastSend < HOME_V2_CHAT_SEND_MIN_INTERVAL_MS;
      const overCap = recent.length >= HOME_V2_CHAT_SEND_MAX_PER_WINDOW;

      // The pruned (but not yet appended) history is saved even on rejection,
      // so a burst of rejected attempts cannot itself keep resetting the
      // window's prune point.
      sendTimestampsByKey.set(key, recent);

      if (tooSoon || overCap) {
        return { allowed: false, message: HOME_V2_CHAT_SEND_RATE_LIMITED_MESSAGE };
      }

      recent.push(now);
      return { allowed: true };
    },
    reset() {
      sendTimestampsByKey.clear();
    },
  };
}
