import { useEffect, useState } from 'react';

const accountProfileCache = new Map<string, Promise<QortiumAccountProfile>>();
const resolvedAccountProfileCache = new Map<string, QortiumAccountProfile>();

function getAccountProfileCacheKey(account: QortiumAccountSummary, nodeApiUrl: string, nodeEpoch: number) {
  return `${nodeEpoch}:${nodeApiUrl}:${account.id}:${account.address}:${account.label}`;
}

function getStableAccountProfileCacheKey(account: QortiumAccountSummary) {
  return `${account.id}:${account.address}:${account.label}`;
}

function readCachedAccountProfile(account: QortiumAccountSummary) {
  return resolvedAccountProfileCache.get(getStableAccountProfileCacheKey(account)) ?? null;
}

export function getAccountProfile(account: QortiumAccountSummary, nodeApiUrl: string, nodeEpoch: number) {
  const cacheKey = getAccountProfileCacheKey(account, nodeApiUrl, nodeEpoch);
  let profileRequest = accountProfileCache.get(cacheKey);

  if (!profileRequest) {
    profileRequest = window.qortiumHome.accounts
      .getProfile(account.id)
      .then((profile) => {
        resolvedAccountProfileCache.set(getStableAccountProfileCacheKey(account), profile);
        return profile;
      })
      .catch((error) => {
        accountProfileCache.delete(cacheKey);
        throw error;
      });
    accountProfileCache.set(cacheKey, profileRequest);
  }

  return profileRequest;
}

export function useAccountProfile(
  account: QortiumAccountSummary | null,
  nodeApiUrl: string,
  nodeEpoch: number,
) {
  const [profile, setProfile] = useState<QortiumAccountProfile | null>(() =>
    account ? readCachedAccountProfile(account) : null,
  );

  useEffect(() => {
    let isDisposed = false;

    if (!account) {
      setProfile(null);
      return () => {
        isDisposed = true;
      };
    }

    const cachedProfile = readCachedAccountProfile(account);

    if (cachedProfile) {
      setProfile(cachedProfile);
    } else {
      setProfile((currentProfile) => (
        currentProfile?.address === account.address ? currentProfile : null
      ));
    }

    getAccountProfile(account, nodeApiUrl, nodeEpoch)
      .then((nextProfile) => {
        if (!isDisposed) {
          setProfile(nextProfile);
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setProfile((currentProfile) => (
            currentProfile?.address === account.address
              ? currentProfile
              : readCachedAccountProfile(account)
          ));
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [account, nodeApiUrl, nodeEpoch]);

  return profile;
}
