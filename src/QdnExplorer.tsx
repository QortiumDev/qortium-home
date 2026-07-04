import { ChevronDown, ChevronUp, Eye, File, FileAudio, FileImage, FileText, FileVideo, Folder, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ModalDialog } from './components/ModalDialog';
import { t } from './i18n';
import { canPreviewDirectoryContent } from './platform';
import type { QdnDisplaySettings, QdnExplorerRoute, QdnResourceListItem, QdnRoute, QdnService } from './qdn';
import {
  PUBLIC_QDN_SERVICES,
  buildQdnPreviewRoute,
  buildQdnRenderUrl,
  buildQdnRouteFromListItem,
  formatByteSize,
  formatQdnStatus,
  getQdnItemIdentifier,
  getQdnViewerKind,
  isQdnRenderableService,
  isQdnService,
} from './qdn';

type QdnExplorerProps = {
  displaySettings: QdnDisplaySettings;
  nodeApiUrl: string;
  onNavigate: (route: QdnRoute, options?: { replace?: boolean }) => void;
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
  name: string;
  updated?: number;
};

type ServiceRow = {
  count: number;
  service: QdnService;
  updated?: number;
};

type ExplorerSortKey = 'count' | 'name' | 'size' | 'status' | 'updated';

type ExplorerSort = {
  direction: 'asc' | 'desc';
  key: ExplorerSortKey;
};

type ExplorerColumn = {
  key: ExplorerSortKey;
  label: string;
};

const DEFAULT_EXPLORER_SORT: ExplorerSort = {
  direction: 'desc',
  key: 'updated',
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

type PreviewDialogState = {
  error?: string;
  isWorking: boolean;
} | null;

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('explorer.loadFailed');
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
    throw new Error(t('explorer.unexpectedListResponse'));
  }

  return data.filter(isQdnResourceListItem);
}

async function loadAllResources() {
  const data = await window.qortiumHome.qdn.listResources({
    limit: 0,
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
    includeStatus: route.kind === 'name',
    includeMetadata: route.kind === 'name',
  });

  return readResources(data);
}

function getItemUpdated(resource: QdnResourceListItem) {
  return resource.updated ?? resource.created ?? 0;
}

function formatUpdated(timestamp: number | undefined) {
  if (!timestamp) {
    return '';
  }

  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function getNameRows(resources: QdnResourceListItem[]) {
  const rowsByName = new Map<string, NameRow>();

  for (const resource of resources) {
    const currentRow = rowsByName.get(resource.name);

    rowsByName.set(resource.name, {
      name: resource.name,
      count: (currentRow?.count ?? 0) + 1,
      updated: Math.max(currentRow?.updated ?? 0, getItemUpdated(resource)) || undefined,
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

    rowsByService.set(resource.service, {
      service: resource.service,
      count: (currentRow?.count ?? 0) + 1,
      updated: Math.max(currentRow?.updated ?? 0, getItemUpdated(resource)) || undefined,
    });
  }

  return PUBLIC_QDN_SERVICES.map((service) => rowsByService.get(service)).filter(
    (row): row is ServiceRow => row !== undefined,
  );
}

function compareSortValues(first: number | string, second: number | string) {
  if (typeof first === 'string' || typeof second === 'string') {
    return String(first).localeCompare(String(second), undefined, { sensitivity: 'base' });
  }

  return first - second;
}

function sortExplorerRows<Row>(
  rows: Row[],
  sort: ExplorerSort,
  getValue: (row: Row, key: ExplorerSortKey) => number | string,
) {
  const direction = sort.direction === 'asc' ? 1 : -1;

  return rows
    .slice()
    .sort((first, second) => direction * compareSortValues(getValue(first, sort.key), getValue(second, sort.key)));
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

  return t('explorer.serviceAndNameHeading', { service: route.service, name: route.name });
}

function formatExplorerStatus(status: QdnResourceListItem['status']) {
  return status?.status ? formatQdnStatus(status) : t('qdnStatus.published');
}

function ExplorerLoadingRows({ label }: { label: string }) {
  return (
    <div className="qdn-explorer__skeleton" aria-busy="true">
      <p className="sr-only">{label}</p>
      {[0, 1, 2].map((row) => (
        <div className="qdn-explorer__skeleton-row" key={row} aria-hidden="true">
          <span className="skeleton skeleton--circle" />
          <span className="skeleton" />
        </div>
      ))}
    </div>
  );
}

function ExplorerListHeader({
  columns,
  sort,
  onSort,
}: {
  columns: ExplorerColumn[];
  sort: ExplorerSort;
  onSort: (key: ExplorerSortKey) => void;
}) {
  return (
    <div className="qdn-explorer__head" role="presentation">
      <span aria-hidden="true" />
      {columns.map((column, columnIndex) => {
        const isActive = sort.key === column.key;
        const DirectionIcon = sort.direction === 'asc' ? ChevronUp : ChevronDown;

        return (
          <button
            className={`qdn-explorer__column${columnIndex > 0 ? ' qdn-explorer__column--meta' : ''}${
              isActive ? ' qdn-explorer__column--active' : ''
            }`}
            key={column.key}
            type="button"
            onClick={() => onSort(column.key)}
          >
            {column.label}
            {isActive ? <DirectionIcon aria-hidden="true" size={14} strokeWidth={2.2} /> : null}
          </button>
        );
      })}
    </div>
  );
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

function QdnPreviewDialog({
  errorMessage,
  isWorking,
  onDismiss,
  onPick,
}: {
  errorMessage?: string;
  isWorking: boolean;
  onDismiss: () => void;
  onPick: (kind: 'directory' | 'file') => void;
}) {
  return (
    <ModalDialog onDismiss={onDismiss}>
      <section aria-label={t('preview.dialogTitle')} aria-modal="true" className="preview-dialog" role="dialog">
        <h3 className="preview-dialog__title">{t('preview.dialogTitle')}</h3>
        <p className="preview-dialog__intro">{t('preview.dialogIntro')}</p>
        <p className="preview-dialog__supported">{t('preview.supported')}</p>
        {errorMessage ? (
          <p className="preview-dialog__error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="preview-dialog__actions">
          <button className="button button--secondary" type="button" disabled={isWorking} onClick={onDismiss}>
            {t('common.cancel')}
          </button>
          <button className="button" type="button" disabled={isWorking} onClick={() => onPick('file')}>
            <File aria-hidden="true" size={18} strokeWidth={2} />
            {t('preview.chooseFile')}
          </button>
          {canPreviewDirectoryContent() ? (
            <button className="button" type="button" disabled={isWorking} onClick={() => onPick('directory')}>
              <Folder aria-hidden="true" size={18} strokeWidth={2} />
              {t('preview.chooseFolder')}
            </button>
          ) : null}
        </div>
      </section>
    </ModalDialog>
  );
}

export function QdnExplorer({ displaySettings, nodeApiUrl, onNavigate, route }: QdnExplorerProps) {
  const [state, setState] = useState<QdnExplorerState>({
    phase: 'idle',
    resources: [],
  });
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [sort, setSort] = useState<ExplorerSort>(DEFAULT_EXPLORER_SORT);
  const nameRows = useMemo(() => getNameRows(state.resources), [state.resources]);
  const serviceRows = useMemo(() => getServiceRows(state.resources), [state.resources]);
  const sortedServiceRows = useMemo(
    () =>
      sortExplorerRows(serviceRows, sort, (row, key) =>
        key === 'count' ? row.count : key === 'updated' ? (row.updated ?? 0) : row.service,
      ),
    [serviceRows, sort],
  );
  const sortedNameRows = useMemo(
    () =>
      sortExplorerRows(nameRows, sort, (row, key) =>
        key === 'count' ? row.count : key === 'updated' ? (row.updated ?? 0) : row.name,
      ),
    [nameRows, sort],
  );
  const sortedResources = useMemo(() => {
    const defaultSorted = state.resources
      .slice()
      .sort((first, second) =>
        getQdnItemIdentifier(first).localeCompare(getQdnItemIdentifier(second), undefined, {
          sensitivity: 'base',
        }),
      );

    return sortExplorerRows(defaultSorted, sort, (resource, key) => {
      if (key === 'size') {
        return resource.size ?? 0;
      }

      if (key === 'updated') {
        return getItemUpdated(resource);
      }

      if (key === 'status') {
        return formatExplorerStatus(resource.status);
      }

      return getQdnItemIdentifier(resource);
    });
  }, [sort, state.resources]);
  const folderColumns: ExplorerColumn[] = [
    { key: 'name', label: t('common.name') },
    { key: 'count', label: t('explorer.columnCount') },
    { key: 'updated', label: t('explorer.columnUpdated') },
  ];
  const resourceColumns: ExplorerColumn[] = [
    { key: 'name', label: t('common.name') },
    { key: 'status', label: t('common.status') },
    { key: 'size', label: t('common.size') },
    { key: 'updated', label: t('explorer.columnUpdated') },
  ];

  async function handlePreviewPick(kind: 'directory' | 'file') {
    setPreviewDialog({ isWorking: true });

    try {
      const result = await window.qortiumHome.qdn.previewContent({ kind });

      if (result.canceled) {
        setPreviewDialog({ isWorking: false });
        return;
      }

      if (!isQdnService(result.service)) {
        throw new Error(t('preview.failed'));
      }

      setPreviewDialog(null);
      onNavigate(
        buildQdnPreviewRoute({
          renderUrl: result.renderUrl,
          service: result.service,
          sourceKind: result.sourceKind,
          sourceName: result.sourceName,
          sourcePath: result.sourcePath,
          sourceToken: result.sourceToken,
        }),
      );
    } catch (error) {
      setPreviewDialog({
        isWorking: false,
        error: formatError(error),
      });
    }
  }

  function toggleSort(key: ExplorerSortKey) {
    setSort((currentSort) => {
      if (currentSort.key === key) {
        return { key, direction: currentSort.direction === 'asc' ? 'desc' : 'asc' };
      }

      return { key, direction: key === 'name' || key === 'status' ? 'asc' : 'desc' };
    });
  }

  // Keep a stable handle to onNavigate so the load effect can auto-resolve without
  // re-running every render (onNavigate is recreated on each parent render).
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    setSort(DEFAULT_EXPLORER_SORT);
  }, [route]);

  useEffect(() => {
    let isDisposed = false;

    async function loadResources() {
      setState((currentState) => ({
        phase: 'loading',
        resources: currentState.resources,
      }));

      try {
        const resources = route.kind === 'services' ? await loadAllResources() : await loadRouteResources(route);

        if (!isDisposed) {
          // An identifier-less name link that resolves to exactly one resource opens
          // that resource directly instead of showing a one-row listing. We stay in
          // the loading phase and replace history so the unresolved route is not left
          // behind (avoids a Back-button loop back into this auto-resolve).
          if (route.kind === 'name' && resources.length === 1) {
            onNavigateRef.current(buildQdnRouteFromListItem(resources[0]), { replace: true });
            return;
          }

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
    <section className="qdn-explorer" aria-label={t('explorer.ariaLabel')}>
      <header className="qdn-explorer__header">
        <div className="qdn-explorer__heading">
          <h2>{getRouteHeading(route)}</h2>
          <p>{route.displayUrl}</p>
        </div>
        <div className="qdn-explorer__header-actions">
          <button
            className="button button--secondary qdn-explorer__preview"
            type="button"
            title={t('explorer.previewButton')}
            aria-label={t('explorer.previewButton')}
            onClick={() => setPreviewDialog({ isWorking: false })}
          >
            <Eye aria-hidden="true" size={18} strokeWidth={2} />
            <span className="button__label">{t('explorer.previewButton')}</span>
          </button>
          <button
            className="button button--secondary qdn-explorer__refresh"
            type="button"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            disabled={state.phase === 'loading'}
            onClick={() => setRetryToken((currentToken) => currentToken + 1)}
          >
            <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
            <span className="button__label">{t('common.refresh')}</span>
          </button>
        </div>
      </header>

      {previewDialog ? (
        <QdnPreviewDialog
          errorMessage={previewDialog.error}
          isWorking={previewDialog.isWorking}
          onDismiss={() => setPreviewDialog(null)}
          onPick={(kind) => void handlePreviewPick(kind)}
        />
      ) : null}

      {state.phase === 'error' ? (
        <p className="qdn-explorer__message qdn-explorer__message--error">{state.message}</p>
      ) : null}

      {route.kind === 'services' ? (
        <>
          {state.phase === 'loading' && serviceRows.length === 0 ? (
            <ExplorerLoadingRows label={t('explorer.loadingServices')} />
          ) : null}
          {state.phase !== 'loading' && serviceRows.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">{t('explorer.emptyServices')}</p>
          ) : null}
          {serviceRows.length > 0 ? (
            <div className="qdn-explorer__list qdn-explorer__list--folders" role="list">
              <ExplorerListHeader columns={folderColumns} sort={sort} onSort={toggleSort} />
              {sortedServiceRows.map((row) => (
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
                  </span>
                  <span className="qdn-explorer__row-meta">{row.count.toLocaleString()}</span>
                  <span className="qdn-explorer__row-meta">{formatUpdated(row.updated)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {route.kind === 'name-services' ? (
        <>
          {state.phase === 'loading' && serviceRows.length === 0 ? (
            <ExplorerLoadingRows label={t('explorer.loadingNameServices')} />
          ) : null}
          {state.phase !== 'loading' && serviceRows.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">{t('explorer.emptyNameServices')}</p>
          ) : null}
          {serviceRows.length > 0 ? (
            <div className="qdn-explorer__list qdn-explorer__list--folders" role="list">
              <ExplorerListHeader columns={folderColumns} sort={sort} onSort={toggleSort} />
              {sortedServiceRows.map((row) => (
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
                  </span>
                  <span className="qdn-explorer__row-meta">{row.count.toLocaleString()}</span>
                  <span className="qdn-explorer__row-meta">{formatUpdated(row.updated)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {route.kind === 'service' ? (
        <>
          {state.phase === 'loading' && state.resources.length === 0 ? (
            <ExplorerLoadingRows label={t('explorer.loadingNames')} />
          ) : null}
          {state.phase !== 'loading' && nameRows.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">{t('explorer.emptyService', { service: route.service })}</p>
          ) : null}
          {nameRows.length > 0 ? (
            <div className="qdn-explorer__list qdn-explorer__list--folders" role="list">
              <ExplorerListHeader columns={folderColumns} sort={sort} onSort={toggleSort} />
              {sortedNameRows.map((row) => (
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
                  </span>
                  <span className="qdn-explorer__row-meta">{row.count.toLocaleString()}</span>
                  <span className="qdn-explorer__row-meta">{formatUpdated(row.updated)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {route.kind === 'name' ? (
        <>
          {state.phase === 'loading' && state.resources.length === 0 ? (
            <ExplorerLoadingRows label={t('explorer.loadingResources')} />
          ) : null}
          {state.phase !== 'loading' && state.resources.length === 0 && state.phase !== 'error' ? (
            <p className="qdn-explorer__message">{t('explorer.emptyNameService', { service: route.service })}</p>
          ) : null}
          {state.resources.length > 0 ? (
            <div className="qdn-explorer__list qdn-explorer__list--resources" role="list">
              <ExplorerListHeader columns={resourceColumns} sort={sort} onSort={toggleSort} />
              {sortedResources.map((resource) => {
                const canOpenResource = isQdnRenderableService(resource.service);
                const viewerKind = getQdnViewerKind(resource.service);
                const isImageResource = viewerKind === 'image';
                const ResourceIcon =
                  viewerKind === 'audio'
                    ? FileAudio
                    : viewerKind === 'video'
                      ? FileVideo
                      : viewerKind === 'gif-repository'
                        ? FileImage
                        : FileText;
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
                        {resource.metadata?.title || resource.metadata?.description || t('explorer.publishedResource')}
                      </span>
                    </span>
                    <span className="qdn-explorer__row-meta">{formatExplorerStatus(resource.status)}</span>
                    <span className="qdn-explorer__row-meta">{formatByteSize(resource.size)}</span>
                    <span className="qdn-explorer__row-meta">{formatUpdated(getItemUpdated(resource) || undefined)}</span>
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
