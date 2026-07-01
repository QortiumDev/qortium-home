import type { LucideIcon } from 'lucide-react';
import { AppIcon } from './AppIcon';
import type { AppIconResolution } from './appIconUtils';
import { getAppIconResolution } from './appIconUtils';
import type { DashboardPin } from './dashboardPins';
import { getDashboardPinDisplay } from './dashboardPinDisplay';

export type BookmarkDisplay = {
  Icon: LucideIcon;
  iconResolution: AppIconResolution | null;
  label: string;
};

export function getBookmarkDisplay(
  displayUrl: string,
  title: string | null | undefined,
  nodeApiUrl: string,
  nodeEpoch: number,
): BookmarkDisplay {
  const normalizedTitle = title?.trim() ?? '';
  const customLabel = normalizedTitle && normalizedTitle !== displayUrl ? normalizedTitle : undefined;
  const pinLikeLink: DashboardPin = {
    createdAt: 0,
    customLabel,
    displayUrl,
    id: displayUrl,
    label: normalizedTitle || displayUrl,
  };
  const display = getDashboardPinDisplay(pinLikeLink);

  return {
    Icon: display.Icon,
    iconResolution: getAppIconResolution(displayUrl, nodeApiUrl, nodeEpoch),
    label: display.shortLabel,
  };
}

export function BookmarkDisplayIcon({
  className,
  display,
  size,
}: {
  className?: string;
  display: BookmarkDisplay;
  size: number;
}) {
  if (display.iconResolution) {
    return <AppIcon className={className} resolution={display.iconResolution} size={size} variant="bookmark" />;
  }

  return <display.Icon aria-hidden="true" className={className} size={size} strokeWidth={2} />;
}
