import { defaultHomeV2Appearance } from '../appearance'
import type {
  AppDescriptor,
  AppId,
  AppTabContext,
  HomeV2Snapshot,
  IdentityId,
  NetworkAddress,
  NetworkId,
  NodeProfileRef,
  OperationContext,
  TabId,
  WalletRef,
} from '../contracts'
import { buildAppResourceLocation } from '../resource-location'
import {
  createPermissionState,
  queuePermissionPrompt,
  type PermissionRequestId,
} from '../bridge-permissions'
import {
  prepareMockQdnPermission,
  prepareMockQortalPermission,
  type MockQdnPublishRequest,
  type MockQortalAccountRequest,
} from '../mock-bridge-adapters'
import {
  createProductState,
  reduceProductState,
  type ProductState,
} from '../product-model'

function fixtureBrand<Type extends string>(value: string): Type {
  return value as Type
}

function fixtureAddress<Network extends NetworkId>(
  network: Network,
  label: string,
): NetworkAddress<Network> {
  return fixtureBrand<NetworkAddress<Network>>(`demo:${network}:${label}`)
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}

export const fixtureIds = {
  identity: fixtureBrand<IdentityId>('fixture:identity:alice'),
  wallet: fixtureBrand<WalletRef>('fixture:wallet:alice'),
  qortalNode: fixtureBrand<NodeProfileRef>('fixture:node:qortal'),
  qortiumNode: fixtureBrand<NodeProfileRef>('fixture:node:qortium'),
  chatApp: fixtureBrand<AppId>('fixture:app:chat'),
  walletsApp: fixtureBrand<AppId>('fixture:app:wallets'),
  trustApp: fixtureBrand<AppId>('fixture:app:trust'),
  qortiumOnlyApp: fixtureBrand<AppId>('fixture:app:qortium-only'),
  qortalCompatApp: fixtureBrand<AppId>('fixture:app:qortal-compat'),
  tab: fixtureBrand<TabId>('fixture:tab:primary'),
  chatTab: fixtureBrand<TabId>('fixture:tab:chat'),
  qortalCompatTab: fixtureBrand<TabId>('fixture:tab:qortal-compat'),
  qdnPermissionRequest: fixtureBrand<PermissionRequestId>(
    'fixture:permission:qdn-publish',
  ),
  qortalPermissionRequest: fixtureBrand<PermissionRequestId>(
    'fixture:permission:qortal-account',
  ),
} as const

const apps: readonly AppDescriptor[] = [
  {
    id: fixtureIds.chatApp,
    title: 'Chat',
    description: 'Chat across Qortal and Qortium.',
    category: 'communication',
    sourceNetwork: 'qortium',
    resourceIdentity: {
      service: 'APP',
      name: 'fixture-chat',
      identifier: null,
    },
    targetNetworks: ['qortal', 'qortium'],
    placement: 'pinned',
  },
  {
    id: fixtureIds.walletsApp,
    title: 'Wallets',
    description: 'Balances and activity by network.',
    category: 'finance',
    sourceNetwork: 'qortium',
    resourceIdentity: {
      service: 'APP',
      name: 'fixture-wallets',
      identifier: null,
    },
    targetNetworks: ['qortal', 'qortium'],
    placement: 'pinned',
  },
  {
    id: fixtureIds.trustApp,
    title: 'Trust',
    description: 'Look up reputation without losing account context.',
    category: 'community',
    sourceNetwork: 'qortium',
    resourceIdentity: {
      service: 'APP',
      name: 'fixture-trust',
      identifier: null,
    },
    targetNetworks: ['qortal', 'qortium'],
    placement: 'recommended',
  },
  {
    id: fixtureIds.qortiumOnlyApp,
    title: 'Qortium Lab',
    description: 'A fixture used to prove wrong-network rejection.',
    category: 'utility',
    sourceNetwork: 'qortium',
    resourceIdentity: {
      service: 'APP',
      name: 'fixture-qortium-lab',
      identifier: null,
    },
    targetNetworks: ['qortium'],
    placement: 'recommended',
  },
  {
    id: fixtureIds.qortalCompatApp,
    title: 'Qortal App',
    description: 'A fixture for exact qortalRequest compatibility.',
    category: 'utility',
    sourceNetwork: 'qortal',
    resourceIdentity: {
      service: 'APP',
      name: 'fixture-qortal-app',
      identifier: null,
    },
    targetNetworks: ['qortal'],
    placement: 'recommended',
  },
]

export const homeV2Fixture: HomeV2Snapshot = deepFreeze({
  account: {
    state: 'unlocked',
    selectedIdentityId: fixtureIds.identity,
    rememberUnlock: true,
    lockOnExit: true,
    manuallyLocked: false,
    secureStorageAvailable: true,
  },
  appearance: defaultHomeV2Appearance,
  identity: {
    id: fixtureIds.identity,
    displayLabel: 'Alice',
    // The fixture's label IS a registered name (both presences resolve one).
    displayLabelIsRegisteredName: true,
    selectedWallet: fixtureIds.wallet,
    presences: {
      qortal: {
        network: 'qortal',
        state: 'present',
        address: fixtureAddress('qortal', 'alice'),
        names: ['AliceQ'],
        primaryName: 'AliceQ',
        avatar: {
          kind: 'initials',
          value: 'AQ',
          network: 'qortal',
        },
        detail: null,
      },
      qortium: {
        network: 'qortium',
        state: 'present',
        address: fixtureAddress('qortium', 'alice'),
        names: ['Alice'],
        primaryName: 'Alice',
        avatar: {
          kind: 'initials',
          value: 'A',
          network: 'qortium',
        },
        detail: null,
      },
    },
  },
  nodes: {
    qortal: {
      ref: fixtureIds.qortalNode,
      network: 'qortal',
      label: 'Qortal local node',
      lastEnabledMode: 'local',
      mode: 'local',
      state: 'syncing',
      statusText: 'Syncing 96%',
      isTrusted: true,
      customAuthenticated: false,
      customConfigured: true,
      customUrl: 'https://qortal-node.example',
      localCoreState: 'running',
      localCoreStatusText: 'Local Core running',
      nodeApiUrl: 'http://127.0.0.1:12391',
      height: 2_100_000,
      peerCount: 18,
      dataPeerCount: 21,
      i2pPeerCount: 5,
      i2pDataPeerCount: 6,
      syncPercent: 96,
      syncPhase: 'SYNCING',
      lastCheckedAt: 1_775_000_000_000,
      error: null,
      capabilities: { admin: false, read: true, write: false },
    },
    qortium: {
      ref: fixtureIds.qortiumNode,
      network: 'qortium',
      label: 'Qortium local node',
      lastEnabledMode: 'local',
      mode: 'local',
      state: 'online',
      statusText: 'Online',
      isTrusted: true,
      customAuthenticated: false,
      customConfigured: true,
      customUrl: 'https://qortium-node.example',
      localCoreState: 'installed',
      localCoreStatusText: 'Local Core installed · stopped',
      nodeApiUrl: 'http://127.0.0.1:24891',
      height: 125_000,
      peerCount: 12,
      dataPeerCount: 9,
      i2pPeerCount: null,
      i2pDataPeerCount: null,
      syncPercent: 100,
      syncPhase: 'SYNCED',
      lastCheckedAt: 1_775_000_000_000,
      error: null,
      capabilities: { admin: true, read: true, write: true },
    },
  },
  apps,
  recentItems: [
    {
      id: 'fixture:recent:community',
      appId: fixtureIds.chatApp,
      label: 'Qortium community',
      context: 'Chat',
      targetNetwork: 'qortium',
    },
    {
      id: 'fixture:recent:qortal',
      appId: fixtureIds.trustApp,
      label: 'AliceQ',
      context: 'Trust profile',
      targetNetwork: 'qortal',
    },
  ],
  reticulum: {
    state: 'disabled',
    enabled: false,
    statusText: 'Optional and off',
  },
})

export function fixtureOperationContext(
  appId: AppId,
  targetNetwork: NetworkId,
  tabId: TabId = fixtureIds.tab,
): OperationContext {
  return {
    identityId: fixtureIds.identity,
    walletRef: fixtureIds.wallet,
    targetNetwork,
    nodeProfileRef:
      targetNetwork === 'qortal'
        ? fixtureIds.qortalNode
        : fixtureIds.qortiumNode,
    appId,
    tabId,
  }
}

export function fixtureTabContext(
  app: AppDescriptor,
  tabId: TabId = fixtureIds.tab,
): AppTabContext {
  return {
    identityId: fixtureIds.identity,
    walletRef: fixtureIds.wallet,
    appId: app.id,
    tabId,
    sourceNetwork: app.sourceNetwork,
    previewUrl: null,
    resourceLocation: buildAppResourceLocation(
      app.sourceNetwork,
      app.resourceIdentity,
    ),
  }
}

export function fixtureApp(appId: AppId): AppDescriptor {
  const app = apps.find((candidate) => candidate.id === appId)
  if (!app) {
    throw new Error(`Unknown fixture app: ${appId}`)
  }
  return app
}

function createFixtureProductState(): ProductState {
  let state = createProductState()
  const chat = fixtureApp(fixtureIds.chatApp)
  const qortalApp = fixtureApp(fixtureIds.qortalCompatApp)
  state = reduceProductState(state, {
    type: 'open-app',
    app: chat,
    context: fixtureTabContext(chat, fixtureIds.chatTab),
    tabId: fixtureIds.chatTab,
  })
  state = reduceProductState(state, {
    type: 'open-app',
    app: qortalApp,
    context: fixtureTabContext(qortalApp, fixtureIds.qortalCompatTab),
    tabId: fixtureIds.qortalCompatTab,
  })
  return reduceProductState(state, {
    type: 'navigate',
    destination: 'dashboard',
  })
}

export const homeV2ProductFixture = createFixtureProductState()

export const mockQdnPublishRequest: MockQdnPublishRequest = deepFreeze({
  protocol: 'qdnRequest',
  action: 'PUBLISH_QDN_RESOURCE',
  service: 'APP',
  name: 'fixture-chat',
  identifier: 'fixture-preview',
  data64: 'RklYVFVSRQ==',
})

export const mockQortalAccountRequest: MockQortalAccountRequest = deepFreeze({
  protocol: 'qortalRequest',
  action: 'GET_USER_ACCOUNT',
})

export const qdnPermissionPromptFixture = prepareMockQdnPermission(
  fixtureIds.qdnPermissionRequest,
  mockQdnPublishRequest,
  fixtureApp(fixtureIds.chatApp),
  fixtureOperationContext(
    fixtureIds.chatApp,
    'qortium',
    fixtureIds.chatTab,
  ),
)

export const qortalPermissionPromptFixture = prepareMockQortalPermission(
  fixtureIds.qortalPermissionRequest,
  mockQortalAccountRequest,
  fixtureApp(fixtureIds.qortalCompatApp),
  fixtureOperationContext(
    fixtureIds.qortalCompatApp,
    'qortal',
    fixtureIds.qortalCompatTab,
  ),
)

export const qdnPermissionStateFixture = queuePermissionPrompt(
  createPermissionState(),
  qdnPermissionPromptFixture,
)

export const qortalPermissionStateFixture = queuePermissionPrompt(
  createPermissionState(),
  qortalPermissionPromptFixture,
)
