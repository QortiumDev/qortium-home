// Browser-safe Home 2 contract facade. The implementation is runtime-free and
// shared with Electron; keeping this facade outside src/v2 preserves the
// renderer shell's explicit host-boundary import rule.
export { getHomeV2AppNetwork } from '../../electron/home-v2-app-actions'
export {
  getHomeV2AppRouteDescriptor,
  getHomeV2BridgeStateDetails,
  homeV2BridgeErrorPayload,
  normalizeHomeV2BridgeError,
} from '../../electron/home-v2-app-runtime'
