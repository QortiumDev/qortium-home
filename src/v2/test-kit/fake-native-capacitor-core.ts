export const Capacitor = {
  getPlatform: () => 'android',
  isNativePlatform: () => true,
}

export function registerPlugin<T>(name: string): T {
  return new Proxy({}, {
    get: (_target, method) => (...args: unknown[]) => {
      const plugins = (globalThis as unknown as { __nativeTestPlugins?: Record<string, Record<string, (...args: unknown[]) => unknown>> }).__nativeTestPlugins
      const callback = plugins?.[name]?.[String(method)]
      if (!callback) throw new Error(`Unconfigured native test plugin: ${name}.${String(method)}`)
      return callback(...args)
    },
  }) as T
}
