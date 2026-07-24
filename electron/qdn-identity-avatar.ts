export const LEGACY_NAMED_THUMBNAIL_AVATAR = 'LEGACY_NAMED_THUMBNAIL' as const;

export type LegacyAccountAvatarHint = {
  avatarContract: typeof LEGACY_NAMED_THUMBNAIL_AVATAR | null;
  url: string | null;
};

// RESOLVE_IDENTITIES can batch 500 addresses, so it must not fetch and encode
// 500 avatar bodies. Preserve the established named-thumbnail URL as an
// explicit compatibility hint; pointer-aware apps fetch visible avatars through
// FETCH_ACCOUNT_AVATAR instead.
export function getLegacyAccountAvatarHint(
  nodeApiUrl: string,
  name: string | null | undefined,
): LegacyAccountAvatarHint {
  const normalizedName = name?.trim();
  const normalizedNodeApiUrl = nodeApiUrl.trim().replace(/\/+$/, '');

  if (!normalizedName || !normalizedNodeApiUrl) {
    return { avatarContract: null, url: null };
  }

  return {
    avatarContract: LEGACY_NAMED_THUMBNAIL_AVATAR,
    url:
      `${normalizedNodeApiUrl}/arbitrary/THUMBNAIL/` +
      `${encodeURIComponent(normalizedName)}/avatar?async=true`,
  };
}
