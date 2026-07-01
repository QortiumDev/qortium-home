import { useMemo } from 'react';
import type { QdnImageResolutionState } from './useQdnImageResource';
import { useQdnImageResource, type QdnImageResource } from './useQdnImageResource';

// Shared resolver for account avatars (the QDN `THUMBNAIL/{name}/avatar` resource).
// It keeps the previous ready image visible while reconnects or node changes are
// revalidated, and only falls back when Core reports a terminal empty/missing state.
export type AccountAvatarState = QdnImageResolutionState;

export type AccountAvatarResolution = {
  state: AccountAvatarState;
  url: string | null;
};

const AVATAR_MAX_BYTES = 1024 * 1024;

export function useAccountAvatar(
  name: string | null | undefined,
  nodeApiUrl: string,
  nodeEpoch: number,
): AccountAvatarResolution {
  const resource = useMemo<QdnImageResource | null>(() => {
    if (!name) {
      return null;
    }

    return {
      cacheKey: `avatar:THUMBNAIL:${name}:avatar`,
      identifier: 'avatar',
      maxBytes: AVATAR_MAX_BYTES,
      name,
      service: 'THUMBNAIL',
    };
  }, [name]);

  return useQdnImageResource(resource, nodeApiUrl, nodeEpoch);
}
