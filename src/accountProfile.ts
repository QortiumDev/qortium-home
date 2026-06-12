const accountProfileCache = new Map<string, Promise<QortiumAccountProfile>>();

function getAccountProfileCacheKey(account: QortiumAccountSummary, nodeApiUrl: string, nodeEpoch: number) {
  return `${nodeEpoch}:${nodeApiUrl}:${account.id}:${account.address}:${account.label}`;
}

export function getAccountProfile(account: QortiumAccountSummary, nodeApiUrl: string, nodeEpoch: number) {
  const cacheKey = getAccountProfileCacheKey(account, nodeApiUrl, nodeEpoch);
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
