import type {
  AppDescriptor,
  NetworkId,
  OperationContext,
} from './contracts'
import {
  createPermissionPrompt,
  type PermissionPrompt,
  type PermissionRequestId,
} from './bridge-permissions'
import { assertAppMayTargetNetwork } from './policy'

export interface MockQdnPublishRequest {
  readonly protocol: 'qdnRequest'
  readonly action: 'PUBLISH_QDN_RESOURCE'
  readonly service: 'APP'
  readonly name: string
  readonly identifier: string | null
  readonly data64: string
}

export interface MockQortalAccountRequest {
  readonly protocol: 'qortalRequest'
  readonly action: 'GET_USER_ACCOUNT'
}

export class BridgeContractError extends Error {
  constructor(
    readonly code:
      | 'APP_CONTEXT_MISMATCH'
      | 'INVALID_FIXTURE_REQUEST'
      | 'PROTOCOL_CONTEXT_MISMATCH',
    message: string,
  ) {
    super(message)
    this.name = 'BridgeContractError'
  }
}

function getAppIdentityKey(app: AppDescriptor): string {
  const { service, name, identifier } = app.qdnIdentity
  return [app.sourceNetwork, service, name, identifier ?? ''].join(':')
}

function assertBridgeContext(
  app: AppDescriptor,
  context: OperationContext,
  requiredNetwork: NetworkId,
): void {
  if (app.id !== context.appId) {
    throw new BridgeContractError(
      'APP_CONTEXT_MISMATCH',
      'The requesting app does not match the immutable operation context.',
    )
  }
  assertAppMayTargetNetwork(app, context)
  if (context.targetNetwork !== requiredNetwork) {
    throw new BridgeContractError(
      'PROTOCOL_CONTEXT_MISMATCH',
      `This request requires an explicit ${requiredNetwork} context.`,
    )
  }
}

export function prepareMockQdnPermission(
  id: PermissionRequestId,
  request: MockQdnPublishRequest,
  app: AppDescriptor,
  context: OperationContext,
): PermissionPrompt {
  assertBridgeContext(app, context, 'qortium')
  const allowedKeys = new Set([
    'protocol',
    'action',
    'service',
    'name',
    'identifier',
    'data64',
  ])
  if (
    Object.keys(request).some((key) => !allowedKeys.has(key)) ||
    request.name.length === 0 ||
    request.data64.length === 0
  ) {
    throw new BridgeContractError(
      'INVALID_FIXTURE_REQUEST',
      'The synthetic QDN publish request is invalid.',
    )
  }

  return createPermissionPrompt({
    id,
    protocol: request.protocol,
    action: request.action,
    capability: 'qdn.publish',
    appId: app.id,
    appIdentityKey: getAppIdentityKey(app),
    appTitle: app.title,
    context,
    title: `Allow ${app.title} to publish on Qortium?`,
    summary: 'The app is requesting one QDN publish operation.',
    details: [
      { label: 'Service', value: request.service },
      { label: 'Name', value: request.name },
      { label: 'Identifier', value: request.identifier ?? 'Default' },
      {
        label: 'Fixture payload',
        value: `${request.data64.length} base64 characters`,
      },
    ],
    allowedScopes: ['single-request'],
  })
}

export function prepareMockQortalPermission(
  id: PermissionRequestId,
  request: MockQortalAccountRequest,
  app: AppDescriptor,
  context: OperationContext,
): PermissionPrompt {
  assertBridgeContext(app, context, 'qortal')
  if (
    Object.keys(request).some(
      (key) => key !== 'protocol' && key !== 'action',
    )
  ) {
    throw new BridgeContractError(
      'INVALID_FIXTURE_REQUEST',
      'GET_USER_ACCOUNT does not accept fixture payload fields.',
    )
  }

  return createPermissionPrompt({
    id,
    protocol: request.protocol,
    action: request.action,
    capability: 'qortal.account.read',
    appId: app.id,
    appIdentityKey: getAppIdentityKey(app),
    appTitle: app.title,
    context,
    title: `Share your Qortal account with ${app.title}?`,
    summary:
      'This shares the selected Qortal address and public key with this app only.',
    details: [
      { label: 'Shared data', value: 'Qortal address and public key' },
      { label: 'Extra permissions', value: 'None' },
    ],
    allowedScopes: ['single-request', 'session', 'always'],
  })
}
