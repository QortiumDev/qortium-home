import type { TabId } from '../contracts'
import type {
  InternalPageId,
  ProductState,
  ShellDestination,
} from '../product-model'
import { t, type TranslationKey } from '../../i18n'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { HomeMark } from './ProductMarks'
import { HomeV2AppIcon } from './HomeV2AppIcon'
import type { VisibleAppIconLoader } from '../contracts'

export interface TabStripProps {
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: TabId) => void
  readonly onCloseTab?: (tabId: TabId) => void
  readonly onCloseInternal?: (page: InternalPageId) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
  readonly onNewTab?: () => void
  readonly newTabDisabled?: boolean
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
}

const internalTabLabelKeys: Readonly<
  Record<Exclude<ShellDestination, 'tab'>, TranslationKey>
> = {
  activity: 'home2.activity',
  apps: 'home2.apps',
  'core-docs': 'coreApi.title',
  dashboard: 'common.dashboard',
  newtab: 'home2.tabs.newTab',
  releases: 'releaseNotes.open',
  settings: 'common.settings',
  welcome: 'welcome.title',
}

export function TabStrip({
  productState,
  onActivateTab,
  onCloseTab,
  onCloseInternal,
  onNavigate,
  onNewTab,
  newTabDisabled,
  loadVisibleAppIcon,
}: TabStripProps) {
  return (
    <div className="home-v2-tabs" role="tablist" aria-label={t('tabs.listLabel')}>
      {productState.internalPages.map((page) => {
        const isActive = productState.destination === page
        const label = t(internalTabLabelKeys[page])
        return (
          <div
            className={`home-v2-tab home-v2-tab--dashboard${
              isActive ? ' is-active' : ''
            }`}
            key={`internal:${page}`}
            data-internal-page={page}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? 'is-active' : ''}
              onClick={() => onNavigate?.(page)}
            >
              <HomeMark className="home-v2-tab__favicon" />
              {label}
            </button>
            <button
              type="button"
              className="home-v2-tab__close"
              aria-label={t('tabs.closeNamed', { label })}
              onClick={() => onCloseInternal?.(page)}
            >
              ×
            </button>
          </div>
        )
      })}
      {productState.tabs.map((tab) => {
        const isActive = productState.activeTabId === tab.id
        return (
          <div
            className={`home-v2-tab${isActive ? ' is-active' : ''}`}
            key={tab.id}
            data-tab-id={tab.id}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? 'is-active' : ''}
              onClick={() => onActivateTab?.(tab.id)}
            >
              <HomeV2AppIcon
                displayUrl={tab.context.resourceLocation}
                loader={loadVisibleAppIcon}
                size={18}
                variant="tab"
              />
              <span>{tab.title}</span>
              <NetworkBadge network={tab.context.sourceNetwork} />
            </button>
            <button
              type="button"
              className="home-v2-tab__close"
              aria-label={t('home2.tabs.closeFrom', {
                label: tab.title,
                network: networkLabels[tab.context.sourceNetwork],
              })}
              onClick={() => onCloseTab?.(tab.id)}
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="home-v2-new-tab"
        aria-label={t('home2.tabs.newTab')}
        title={t('home2.tabs.newTab')}
        disabled={newTabDisabled}
        onClick={onNewTab}
      >
        +
      </button>
    </div>
  )
}
