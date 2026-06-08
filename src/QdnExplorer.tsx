import { FileAudio, FileText, FileVideo, Folder, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DisplaySettings } from './displaySettings';
import type { QdnDisplaySettings, QdnExplorerRoute, QdnResourceListItem, QdnRoute, QdnService } from './qdn';
import {
  PUBLIC_QDN_SERVICES,
  buildQdnRenderUrl,
  buildQdnRouteFromListItem,
  formatQdnStatus,
  getQdnItemIdentifier,
  getQdnViewerKind,
  isQdnRenderableService,
  isQdnService,
} from './qdn';

type QdnExplorerProps = {
  displaySettings: DisplaySettings;
  nodeApiUrl: string;
  onNavigate: (route: QdnRoute) => void;
  route: QdnExplorerRoute;
};

type QdnExplorerState =
  | {
      phase: 'idle';
      resources: QdnResourceListItem[];
    }
  | {
      phase: 'loading';
      resources: QdnResourceListItem[];
    }
  | {
      message: string;
      phase: 'error';
      resources: QdnResourceListItem[];
    };

type NameRow = {
  count: number;
  created?: number;
  name: string;
  status?: QdnResourceListItem['status'];
};

type ServiceRow = {
  count: number;
  created?: number;
  service: QdnService;
  status?: QdnResourceListItem['status'];
};

type QdnImagePreviewState =
  | {
      phase: 'loading';
    }
  | {
      phase: 'ready';
      url: string;
    }
  | {
      phase: 'error';
    };

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unable to load QDN resources.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function isQdnResourceListItem(value: unknown): value is QdnResourceListItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<QdnResourceListItem>;

  return (
    typeof item.name === 'string' &&
    typeof item.service === 'string' &&
    isQdnService(item.service) &&
    (item.identifier === undefined || typeof item.identifier === 'string')
  );
}

function readResources(data: unknown) {
  if (!Array.isArray(data)) {
    throw new Error('QDN resource list response did not match the expected shape.');
  }

  return data.filter(isQdnResourceListItem);
}

async function loadServiceAvailabilityResources(service: QdnService) {
  const data = await window.qortiumHome.qdn.listResources({
    service,
    limit: 1,
    includeStatus: false,
    includeMetadata: false,
  });

  return readResources(data);
}

async function loadRouteResources(route: Extract<QdnExplorerRoute, { kind: 'service' | 'name' | 'name-services' }>) {
  const data = await window.qortiumHome.qdn.listResources({
    service: route.kind === 'name-services' ? undefined : route.service,
    name: route.kind === 'service' ? undefined : route.name,
    exactMatchNames: route.kind !== 'service',
    limit: 0,
    includeStatus: true,
    includeMetadata: true,
  });

  return readResources(data);
}

function formatDate(timestamp: number | undefined) {
  if (!timestamp) {
    return '';
  }

  return new Date(timestamp).toLocaleString();
}

function getNameRows(resources: QdnResourceListItem[]) {
  const rowsByName = new Map<string, NameRow>();

  for (const resource of resources) {
    const currentRow = rowsByName.get(resource.name);
    const currentCreated = currentRow?.created ?? 0;
    const nextCreated = resource.created ?? 0;

    rowsByName.set(resource.name, {
      name: resource.name,
      count: (currentRow?.count ?? 0) + 1,
      created: Math.max(currentCreated, nextCreated) || undefined,
      status: nextCreated >= currentCreated ? resource.status : currentRow?.status,
    });
  }

  return [...rowsByName.values()].sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }),
  );
}

function getServiceRows(resources: QdnResourceListItem[]) {
  const rowsByService = new Map<QdnService, ServiceRow>();

  for (const resource of resources) {
    const currentRow = rowsByService.get(resource.service);
    const currentCreated = currentRow?.created ?? 0;
    const nextCreated = resource.created ?? 0;

    rowsByService.set(resource.service, {
      service: resource.service,
      count: (currentRow?.count ?? 0) + 1,
      created: Math.max(currentCreated, nextCreated) || undefined,
      status: nextCreated >= currentCreated ? resource.status : currentRow?.status,
    });
  }

  return PUBLIC_QDN_SERVICES.map((service) => rowsByService.get(service)).filter(
    (row): row is ServiceRow => row !== undefined,
  );
}

function getRouteHeading(route: QdnExplorerRoute) {
  if (route.kind === 'services') {
    return 'QDN';
  }

  if (route.kind === 'service') {
    return route.service;
  }

  if (route.kind === 'name-services') {
    return route.name;
  }

  return `${route.service} / ${route.name}`;
}

function formatExplorerStatus(status: QdnResourceListItem['status']) {
  return status?.status ? formatQdnStatus(status) : 'Published';
}

function formatResourceMeta(resource: QdnResourceListItem) {
  return [
    formatExplorerStatus(resource.status),
    resource.size ? `${resource.size.toLocaleString()} bytes` : '',
    resource.created ? formatDate(resource.created) : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function QdnImageResourcePreview({
  displaySettings,
  nodeApiUrl,
  resource,
}: {
  displaySettings: QdnDisplaySettings;
  nodeApiUrl: string;
  resource: QdnResourceListItem;
}) {
  const [state, setState] = useState<QdnImagePreviewState>({
    phase: 'loading',
  });
  const identifier = resource.identifier || undefined;
  const fallbackIcon = (
    <span className="qdn-explorer__row-preview qdn-explorer__row-preview--fallback">
      <FileText aria-hidden="true" size={22} strokeWidth={2} />
    </span>
  );

  useEffect(() => {
    const route = buildQdnRouteFromListItem(resource);
    let isDisposed = false;

    async function loadPreview() {
      if (route.kind !== 'resource') {
        return;
      }

      setState({
        phase: 'loading',
      });

      try {
        await window.qortiumHome.qdn.authorizeResource({
          service: route.resource.service,
          name: route.resource.name,
          identifier: route.resource.identifier,
        });

        if (!isDisposed) {
          setState({
            phase: 'ready',
            url: buildQdnRenderUrl(route.resource, nodeApiUrl, displaySettings),
          });
        }
      } catch {
        if (!isDisposed) {
          setState({
            phase: 'error',
          });
        }
      }
    }

    void loadPreview();

    return () => {
      isDisposed = true;
    };
  }, [displaySettings, identifier, nodeApiUrl, resource.name, resource.service]);

  if (state.phase !== 'ready') {
    return fallbackIcon;
  }

  return (
    <span className="qdn-explorer__row-preview">
      <img
        alt=""
        className="qdn-explorer__row-preview-image"
        loading="lazy"
        src={state.url}
        onError={() =>
          setState({
            phase: 'error',
          })
        }
      />
    </span>
  );
}

export function QdnExplorer({ displaySettings, nodeApiUrl, onNavigate, route }: QdnExplorerProps) {
  const [state, setState] = useState<QdnExplorerState>({
    phase: 'idle',
    resources: [],
  });
  const [retryToken, setRetryToken] = useState(0);
  const nameRows = useMemo(() => getNameRows(state.resources), [state.resources]);
  const serviceRows = useMemo(() => getServiceRows(state.resources), [state.resources]);

  useEffect(() => {
    let isDisposed = false;

    async function loadResources() {
      setState((currentState) => ({
        phase: 'loading',
        resources: currentState.resources,
      }));

      try {
        const resources =
          route.kind === 'services'
            ? (await Promise.all(PUBLIC_QDN_SERVICES.map(loadServiceAvailabilityResources))).flat()
            : await loadRouteResources(route);

        if (!isDisposed) {
          setState({
            phase: 'idle',
            resources,
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (!isDisposed) {
          setState((currentState) => ({
            phase: 'error',
            resources: currentState.resources,
            message: formatError(error),
          }));
        }
      }
    }

    void loadResources();

    return () => {
      isDisposed = true;
    };
  }, [route, retryToken]);

  return (
    <section className="qdn-explorer" aria-label="QDN explorer">
      <header className="qdn-explorer__header">
        <div className="qdn-explorer__heading">
          <h2>{getRouteHeading(route)}</h2>
          <p>{route.displayUrl}</p>
        </div>
        <button
          className="button button--secondary qdn-explorer__refresh"
          type="button"
          disabled={state.phase === 'loading'}
          onClick={() => setRetryToken((currentToken) => currentToken + 1)}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          Refresh
        </button>
      </header>

      {state.phase === 'error' ? (
        <p className="qdn-explorer__message qdn-explorer__message--error">{state.message}</p>
      ) : null}

      {route.kind === 'services' ? (
        <>
          {state.phase === 'loading' && serviceRows.length === 0 ? (
            <p className="qdn-explorer__message">Loading published services</p>
          ) : null}
          {state.phase !== 'loading' && serviceRows.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">No public QDN resources found.</p>
          ) : null}
          {serviceRows.length > 0 ? (
            <div className="qdn-explorer__list" role="list">
              {serviceRows.map((row) => (
                <button
                  className="qdn-explorer__row"
                  key={row.service}
                  type="button"
                  role="listitem"
                  onClick={() =>
                    onNavigate({
                      kind: 'service',
                      service: row.service,
                      displayUrl: `qdn://${row.service}`,
                    })
                  }
                >
                  <Folder aria-hidden="true" className="qdn-explorer__row-icon" size={22} strokeWidth={2} />
                  <span className="qdn-explorer__row-main">
                    <span className="qdn-explorer__row-title">{row.service}</span>
                    <span className="qdn-explorer__row-subtitle">Browse published {row.service} names</span>
                  </span>
                  <span className="qdn-explorer__row-meta">Service</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {route.kind === 'name-services' ? (
        <>
          {state.phase === 'loading' && serviceRows.length === 0 ? (
            <p className="qdn-explorer__message">Loading published services for this name</p>
          ) : null}
          {state.phase !== 'loading' && serviceRows.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">No public QDN resources found for this name.</p>
          ) : null}
          {serviceRows.length > 0 ? (
            <div className="qdn-explorer__list" role="list">
              {serviceRows.map((row) => (
                <button
                  className="qdn-explorer__row"
                  key={row.service}
                  type="button"
                  role="listitem"
                  onClick={() =>
                    onNavigate({
                      kind: 'name',
                      service: row.service,
                      name: route.name,
                      displayUrl: `qdn://${row.service}/${encodeURIComponent(route.name)}`,
                    })
                  }
                >
                  <Folder aria-hidden="true" className="qdn-explorer__row-icon" size={22} strokeWidth={2} />
                  <span className="qdn-explorer__row-main">
                    <span className="qdn-explorer__row-title">{row.service}</span>
                    <span className="qdn-explorer__row-subtitle">
                      {row.count.toLocaleString()} {row.count === 1 ? 'resource' : 'resources'} published by{' '}
                      {route.name}
                    </span>
                  </span>
                  <span className="qdn-explorer__row-meta">{formatExplorerStatus(row.status)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {route.kind === 'service' ? (
        <>
          {state.phase === 'loading' && state.resources.length === 0 ? (
            <p className="qdn-explorer__message">Loading published names</p>
          ) : null}
          {state.phase !== 'loading' && nameRows.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">No published {route.service} resources found.</p>
          ) : null}
          {nameRows.length > 0 ? (
            <div className="qdn-explorer__list" role="list">
              {nameRows.map((row) => (
                <button
                  className="qdn-explorer__row"
                  key={row.name}
                  type="button"
                  role="listitem"
                  onClick={() =>
                    onNavigate({
                      kind: 'name',
                      service: route.service,
                      name: row.name,
                      displayUrl: `qdn://${route.service}/${encodeURIComponent(row.name)}`,
                    })
                  }
                >
                  <Folder aria-hidden="true" className="qdn-explorer__row-icon" size={22} strokeWidth={2} />
                  <span className="qdn-explorer__row-main">
                    <span className="qdn-explorer__row-title">{row.name}</span>
                    <span className="qdn-explorer__row-subtitle">
                      {row.count.toLocaleString()} {row.count === 1 ? 'resource' : 'resources'}
                    </span>
                  </span>
                  <span className="qdn-explorer__row-meta">{formatExplorerStatus(row.status)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {route.kind === 'name' ? (
        <>
          {state.phase === 'loading' && state.resources.length === 0 ? (
            <p className="qdn-explorer__message">Loading published resources</p>
          ) : null}
          {state.phase !== 'loading' && state.resources.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">No published {route.service} resources found for this name.</p>
          ) : null}
          {state.resources.length > 0 ? (
            <div className="qdn-explorer__list" role="list">
              {state.resources
                .slice()
                .sort((first, second) =>
                  getQdnItemIdentifier(first).localeCompare(getQdnItemIdentifier(second), undefined, {
                    sensitivity: 'base',
                  }),
                )
                .map((resource) => {
                  const canOpenResource = isQdnRenderableService(resource.service);
                  const viewerKind = getQdnViewerKind(resource.service);
                  const isImageResource = viewerKind === 'image';
                  const ResourceIcon =
                    viewerKind === 'audio' ? FileAudio : viewerKind === 'video' ? FileVideo : FileText;
                  const rowContent = (
                    <>
                      {isImageResource ? (
                        <QdnImageResourcePreview
                          displaySettings={displaySettings}
                          nodeApiUrl={nodeApiUrl}
                          resource={resource}
                        />
                      ) : (
                        <ResourceIcon aria-hidden="true" className="qdn-explorer__row-icon" size={22} strokeWidth={2} />
                      )}
                      <span className="qdn-explorer__row-main">
                        <span className="qdn-explorer__row-title">{getQdnItemIdentifier(resource)}</span>
                        <span className="qdn-explorer__row-subtitle">
                          {resource.metadata?.title || resource.metadata?.description || 'Published QDN resource'}
                        </span>
                      </span>
                      <span className="qdn-explorer__row-meta">{formatResourceMeta(resource)}</span>
                    </>
                  );

                  if (!canOpenResource) {
                    return (
                      <div
                        className={`qdn-explorer__row qdn-explorer__row--static${
                          isImageResource ? ' qdn-explorer__row--preview' : ''
                        }`}
                        key={`${resource.service}:${resource.name}:${getQdnItemIdentifier(resource)}`}
                        role="listitem"
                      >
                        {rowContent}
                      </div>
                    );
                  }

                  return (
                    <button
                      className={`qdn-explorer__row${isImageResource ? ' qdn-explorer__row--preview' : ''}`}
                      key={`${resource.service}:${resource.name}:${getQdnItemIdentifier(resource)}`}
                      type="button"
                      role="listitem"
                      onClick={() => onNavigate(buildQdnRouteFromListItem(resource))}
                    >
                      {rowContent}
                    </button>
                  );
                })}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
