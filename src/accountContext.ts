import { SAVED_GUEST_ACCOUNT_ID } from './bookmarkManagerContract';

export function normalizeSavedAccountId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const accountId = value.trim();
  return accountId ? accountId : null;
}

export function shouldSaveAccountContext(displayUrl: string) {
  return /^(qdn|qortal):\/\//i.test(displayUrl.trim());
}

export function getSavedAccountContext(displayUrl: string, accountId: string | null | undefined) {
  if (!shouldSaveAccountContext(displayUrl)) {
    return null;
  }

  return normalizeSavedAccountId(accountId);
}

/** Capture a tab's actual identity; unlike a legacy saved null, null is guest. */
export function captureSavedAccountContext(displayUrl: string, accountId: string | null) {
  if (!shouldSaveAccountContext(displayUrl)) return null;
  return accountId === null ? SAVED_GUEST_ACCOUNT_ID : normalizeSavedAccountId(accountId);
}
