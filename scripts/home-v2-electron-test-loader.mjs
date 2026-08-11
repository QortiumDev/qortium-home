export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(`
        export const app = globalThis.__homeV2ElectronTest.app;
        export const safeStorage = globalThis.__homeV2ElectronTest.safeStorage;
      `)}`,
    }
  }
  return nextResolve(specifier, context)
}
