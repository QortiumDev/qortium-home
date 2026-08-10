import type {
  AppDescriptor,
  NetworkId,
  OperationContext,
} from './contracts'

export class HomeV2PolicyError extends Error {
  readonly code = 'NETWORK_CONTEXT_MISMATCH'

  constructor(
    readonly appId: string,
    readonly targetNetwork: NetworkId,
  ) {
    super(`App ${appId} is not allowed to target ${targetNetwork}`)
    this.name = 'HomeV2PolicyError'
  }
}

export function assertAppMayTargetNetwork(
  app: AppDescriptor,
  context: OperationContext,
): void {
  if (!app.targetNetworks.includes(context.targetNetwork)) {
    throw new HomeV2PolicyError(app.id, context.targetNetwork)
  }
}

export function executeWithNetworkPolicy<Result>(
  app: AppDescriptor,
  context: OperationContext,
  invokeAdapter: (context: OperationContext) => Result,
): Result {
  assertAppMayTargetNetwork(app, context)
  return invokeAdapter(context)
}
