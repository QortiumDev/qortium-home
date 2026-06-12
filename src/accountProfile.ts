const accountProfileCache = new Map<string, Promise<QortiumAccountProfile>>();

function getAccountProfileCacheKey(account: QortiumAccountSummary, nodeApiUrl: string) {
  return `${nodeApiUrl}:${account.id}:${account.address}:${account.label}`;
}

export function getAccountProfile(account: QortiumAccountSummary, nodeApiUrl: string) {
  const cacheKey = getAccountProfileCacheKey(account, nodeApiUrl);
  let profileRequest = accountProfileCache.get(cacheKey);

  if (!profileRequest) {
    profileRequest = window.qortiumHome.accounts.getProfile(account.id).catch((error) => {
      accountProfileCache.delete(cacheKey);
      throw error;
    });
    accountProfileCache.set(cacheKey, profileRequest);
  }

  return profileRequest;
}
