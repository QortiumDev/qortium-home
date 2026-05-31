import type { QdnRoute } from './qdn';
import { parseQdnUrl } from './qdn';

export type NodeApiRoute = {
  displayUrl: string;
  kind: 'node-api';
  path: string;
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

export type AppRoute = DashboardRoute | NodeApiRoute | QdnRoute | SettingsRoute;

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
      message: 'Core addresses must start with core://.',
    };
  }

  const pathInput = input.replace(/^core:\/\//i, '').replace(/#.*$/, '').replace(/^\/+/, '');

  if (!pathInput || pathInput.startsWith('?')) {
    return {
      success: false,
      message: 'Enter a Core API path after core://.',
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
      message: 'Home addresses must start with home://.',
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
    message: 'Only home://dashboard and home://settings can be loaded right now.',
  };
}

function parseQdnAddress(input: string): RouteParseResult | undefined {
  if (!/^qdn:/i.test(input)) {
    return undefined;
  }

  if (!/^qdn:\/\//i.test(input)) {
    return {
      success: false,
      message: 'QDN addresses must start with qdn://.',
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
    message: 'Enter a qdn://, core://, or home:// address.',
  };
}
