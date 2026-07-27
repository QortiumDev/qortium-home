// QDN services whose multi-file resources Home can execute as browser content.
// This is deliberately narrower than the public-service catalogue: GAME can
// hold native binaries too, but Home only gives it a browser surface when the
// published resource has an HTML entry point. Nothing here grants a manager
// capability or provides a native-launch path.
export const QDN_BROWSER_ARCHIVE_SERVICES = ['APP', 'WEBSITE', 'GAME'] as const;

export type QdnBrowserArchiveService = (typeof QDN_BROWSER_ARCHIVE_SERVICES)[number];

export function isQdnBrowserArchiveService(value: string): value is QdnBrowserArchiveService {
  return (QDN_BROWSER_ARCHIVE_SERVICES as readonly string[]).includes(value);
}
