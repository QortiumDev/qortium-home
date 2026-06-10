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

export const DASHBOARD_ROUTE: DashboardRoute = {
  kind: 'dashboard',
  displayUrl: 'home://dashboard',
};

export const SETTINGS_ROUTE: SettingsRoute = {
  kind: 'settings',
  displayUrl: 'home://settings',
};

export const CORE_API_DOCS_ROUTE: CoreApiDocsRoute = {
  kind: 'core-api-docs',
  displayUrl: 'core://',
};

export type AppRoute = CoreApiDocsRoute | DashboardRoute | NodeApiRoute | QdnRoute | SettingsRoute;

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
