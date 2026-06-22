import type { ReactNode } from 'react';
import { useAccountAvatar } from './useAccountAvatar';

// Renders an account's QDN avatar (`THUMBNAIL/{name}/avatar`). The resolver polls
// Core for download status and only yields a URL once the resource is READY, so the
// supplied fallback shows until the avatar is genuinely available — a not-yet-fetched
// avatar is polled to completion rather than stuck on the fallback for the session.
export function AccountAvatar({
  name,
  nodeApiUrl,
  nodeEpoch,
  imageClassName,
  fallback,
}: {
  name: string | null | undefined;
  nodeApiUrl: string;
  nodeEpoch: number;
  imageClassName: string;
  fallback: ReactNode;
}) {
  const avatar = useAccountAvatar(name, nodeApiUrl, nodeEpoch);

  if (avatar.url) {
    return <img className={imageClassName} src={avatar.url} alt="" aria-hidden="true" />;
  }

  return <>{fallback}</>;
}
