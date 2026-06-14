import { File, FileAudio, FileImage, FileText, FileVideo, Globe2, Home, Server, type LucideIcon } from 'lucide-react';
import type { DashboardPin } from './dashboardPins';
import { t } from './i18n';
import { getQdnViewerKind } from './qdn';
import { parseAppAddress } from './routes';

export type DashboardPinDisplay = {
  Icon: LucideIcon;
  shortLabel: string;
};

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Maps a pinned link to its tile icon and a short, human-friendly label.
// The QDN identifier (or resource name) and home/core page titles replace the
// raw URL; a user's custom rename always wins when present.
export function getDashboardPinDisplay(pin: DashboardPin): DashboardPinDisplay {
  const custom = pin.customLabel?.trim();
  const fallback = custom || pin.label || pin.displayUrl;
  const parsed = parseAppAddress(pin.displayUrl);

  if (!parsed.success) {
    return { Icon: Globe2, shortLabel: fallback };
  }

  const { route } = parsed;

  switch (route.kind) {
    case 'resource': {
      const { identifier, name, service } = route.resource;
      const viewerKind = getQdnViewerKind(service);
      const Icon =
        viewerKind === 'audio'
          ? FileAudio
          : viewerKind === 'video'
            ? FileVideo
            : viewerKind === 'image' || viewerKind === 'gif-repository'
              ? FileImage
              : viewerKind === 'iframe'
                ? Globe2
                : viewerKind === 'download' || viewerKind === 'unsupported'
                  ? File
                  : FileText;
      const decodedIdentifier = identifier ? decodeUrlPart(identifier) : '';
      const derived =
        decodedIdentifier && decodedIdentifier !== 'default' ? decodedIdentifier : decodeUrlPart(name);

      return { Icon, shortLabel: custom || derived || fallback };
    }
    case 'dashboard':
      return { Icon: Home, shortLabel: custom || t('common.dashboard') };
    case 'settings':
      return { Icon: Home, shortLabel: custom || t('common.settings') };
    case 'core-api-docs':
      return { Icon: Server, shortLabel: custom || t('explorer.coreApi') };
    case 'node-api': {
      const path = route.path.replace(/^\/+/, '');

      return { Icon: Server, shortLabel: custom || path || fallback };
    }
    case 'preview':
      return { Icon: Globe2, shortLabel: custom || decodeUrlPart(route.preview.sourceName) || fallback };
    default:
      // QDN explorer routes (services/service/name-services/name).
      return { Icon: Globe2, shortLabel: fallback };
  }
}
