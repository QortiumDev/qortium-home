import { t } from './i18n';
import type { QdnRoute } from './qdn';
import { parseQdnUrl } from './qdn';

export type NodeApiRoute = {
  displayUrl: string;
  kind: 'node-api';
  path: string;
};

export type CoreApiDocsRoute = {
  displayUrl: 'core://';
  kind: 'core-api-docs';
};

export type SettingsRoute = {
  displayUrl: 'home://settings';
  kind: 'settings';
};

export type DashboardRoute = {
  displayUrl: 'home://dashboard';
  kind: 'dashboard';
};

export type WelcomeRoute = {
  displayUrl: 'home://welcome';
  kind: 'welcome';
};

export type BookmarksRoute = {
  displayUrl: 'home://bookmarks';
  kind: 'bookmarks';
};

export type ReleaseNotesRoute = {
  displayUrl: string;
  kind: 'release-notes';
  product: 'core' | 'home';
  tagName: string;
};

export const DASHBOARD_ROUTE: DashboardRoute = {
  kind: 'dashboard',
  displayUrl: 'home://dashboard',
};

export const WELCOME_ROUTE: WelcomeRoute = {
  kind: 'welcome',
  displayUrl: 'home://welcome',
};

export const BOOKMARKS_ROUTE: BookmarksRoute = {
  kind: 'bookmarks',
  displayUrl: 'home://bookmarks',
};

export const SETTINGS_ROUTE: SettingsRoute = {
  kind: 'settings',
  displayUrl: 'home://settings',
};

export const CORE_API_DOCS_ROUTE: CoreApiDocsRoute = {
  kind: 'core-api-docs',
  displayUrl: 'core://',
};

export type AppRoute =
  | BookmarksRoute
  | CoreApiDocsRoute
  | DashboardRoute
  | NodeApiRoute
  | QdnRoute
  | ReleaseNotesRoute
  | SettingsRoute
  | WelcomeRoute;

type RouteParseResult =
  | {
      route: AppRoute;
      success: true;
    }
  | {
      message: string;
      success: false;
    };

function buildCoreDisplayUrl(path: string) {
  return `core://${path.replace(/^\/+/, '')}`;
}

function buildNodeApiRoute(path: string): NodeApiRoute {
  return {
    kind: 'node-api',
    path,
    displayUrl: buildCoreDisplayUrl(path),
  };
}

export function buildReleaseNotesRoute(product: ReleaseNotesRoute['product'], tagName: string): ReleaseNotesRoute {
  const normalizedTag = tagName.trim();

  return {
    kind: 'release-notes',
    product,
    tagName: normalizedTag,
    displayUrl: `home://releases/${product}/${encodeURIComponent(normalizedTag)}`,
  };
}

function parseCoreAddress(input: string): RouteParseResult | undefined {
  if (!/^core:/i.test(input)) {
    return undefined;
  }

  if (!/^core:\/\//i.test(input)) {
    return {
      success: false,
      message: t('address.error.coreScheme'),
    };
  }

  const pathInput = input.replace(/^core:\/\//i, '').replace(/#.*$/, '').replace(/^\/+/, '');

  if (!pathInput) {
    return {
      success: true,
      route: CORE_API_DOCS_ROUTE,
    };
  }

  if (pathInput.startsWith('?')) {
    return {
      success: false,
      message: t('address.error.corePathMissing'),
    };
  }

  return {
    success: true,
    route: buildNodeApiRoute(`/${pathInput}`),
  };
}

function parseHomeAddress(input: string): RouteParseResult | undefined {
  if (!/^home:/i.test(input)) {
    return undefined;
  }

  if (!/^home:\/\//i.test(input)) {
    return {
      success: false,
      message: t('address.error.homeScheme'),
    };
  }

  const pathname = input.replace(/^home:\/\//i, '').replace(/^\/+/, '').replace(/\/+$/, '');

  const normalizedPathname = pathname.toLowerCase();

  if (!normalizedPathname || normalizedPathname === 'dashboard') {
    return {
      success: true,
      route: DASHBOARD_ROUTE,
    };
  }

  if (normalizedPathname === 'settings') {
    return {
      success: true,
      route: SETTINGS_ROUTE,
    };
  }

  if (normalizedPathname === 'welcome') {
    return {
      success: true,
      route: WELCOME_ROUTE,
    };
  }

  if (normalizedPathname === 'bookmarks') {
    return {
      success: true,
      route: BOOKMARKS_ROUTE,
    };
  }


  const parts = pathname.split('/').filter(Boolean);

  if (parts[0]?.toLowerCase() === 'releases') {
    const product = parts[1]?.toLowerCase();
    const rawTag = parts.slice(2).join('/');
    let tagName = '';

    try {
      tagName = rawTag ? decodeURIComponent(rawTag) : '';
    } catch {
      tagName = rawTag;
    }

    if ((product === 'home' || product === 'core') && tagName) {
      return {
        success: true,
        route: buildReleaseNotesRoute(product, tagName),
      };
    }
  }

  return {
    success: false,
    message: t('address.error.homePathUnsupported'),
  };
}

function parseQdnAddress(input: string): RouteParseResult | undefined {
  if (!/^qdn:/i.test(input)) {
    return undefined;
  }

  if (!/^qdn:\/\//i.test(input)) {
    return {
      success: false,
      message: t('address.error.qdnScheme'),
    };
  }

  return parseQdnUrl(input);
}

export function parseAppAddress(value: string): RouteParseResult {
  const input = value.trim();

  const qdnRoute = parseQdnAddress(input);

  if (qdnRoute) {
    return qdnRoute;
  }

  const homeRoute = parseHomeAddress(input);

  if (homeRoute) {
    return homeRoute;
  }

  const coreRoute = parseCoreAddress(input);

  if (coreRoute) {
    return coreRoute;
  }

  return {
    success: false,
    message: t('address.error.unknownScheme'),
  };
}
