import { defaultHomeV2Appearance } from '../appearance'
import type {
  AppDescriptor,
  AppId,
  HomeV2Snapshot,
  IdentityId,
  NetworkAddress,
  NetworkId,
  NodeProfileRef,
  OperationContext,
  TabId,
  WalletRef,
} from '../contracts'
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
  qortalChatTab: fixtureBrand<TabId>('fixture:tab:chat:qortal'),
  qortiumChatTab: fixtureBrand<TabId>('fixture:tab:chat:qortium'),
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
    qdnIdentity: {
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
    qdnIdentity: {
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
    qdnIdentity: {
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
    qdnIdentity: {
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
    qdnIdentity: {
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
      mode: 'local',
      state: 'syncing',
      statusText: 'Syncing 96%',
      isTrusted: true,
    },
    qortium: {
      ref: fixtureIds.qortiumNode,
      network: 'qortium',
      label: 'Qortium local node',
      mode: 'local',
      state: 'online',
      statusText: 'Online',
      isTrusted: true,
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
    context: fixtureOperationContext(
      chat.id,
      'qortal',
      fixtureIds.qortalChatTab,
    ),
    tabId: fixtureIds.qortalChatTab,
  })
  state = reduceProductState(state, {
    type: 'open-app',
    app: chat,
    context: fixtureOperationContext(
      chat.id,
      'qortium',
      fixtureIds.qortiumChatTab,
    ),
    tabId: fixtureIds.qortiumChatTab,
  })
  state = reduceProductState(state, {
    type: 'open-app',
    app: qortalApp,
    context: fixtureOperationContext(
      qortalApp.id,
      'qortal',
      fixtureIds.qortalCompatTab,
    ),
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
    fixtureIds.qortiumChatTab,
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
