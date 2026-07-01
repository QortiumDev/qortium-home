export function normalizeSavedAccountId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const accountId = value.trim();
  return accountId ? accountId : null;
}

export function shouldSaveAccountContext(displayUrl: string) {
  return /^qdn:\/\//i.test(displayUrl.trim());
}

export function getSavedAccountContext(displayUrl: string, accountId: string | null | undefined) {
  if (!shouldSaveAccountContext(displayUrl)) {
    return null;
  }

  return normalizeSavedAccountId(accountId);
}
