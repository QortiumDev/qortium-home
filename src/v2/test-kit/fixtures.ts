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
  tab: fixtureBrand<TabId>('fixture:tab:primary'),
} as const

const apps: readonly AppDescriptor[] = [
  {
    id: fixtureIds.chatApp,
    title: 'Chat',
    description: 'Conversations across Qortal and Qortium.',
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
    description: 'Network-labelled balances and activity.',
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
]

export const homeV2Fixture: HomeV2Snapshot = deepFreeze({
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
      state: 'syncing',
      statusText: 'Syncing 96%',
      isTrusted: true,
    },
    qortium: {
      ref: fixtureIds.qortiumNode,
      network: 'qortium',
      label: 'Qortium local node',
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
    tabId: fixtureIds.tab,
  }
}

export function fixtureApp(appId: AppId): AppDescriptor {
  const app = apps.find((candidate) => candidate.id === appId)
  if (!app) {
    throw new Error(`Unknown fixture app: ${appId}`)
  }
  return app
}
