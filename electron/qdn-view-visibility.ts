/** Electron 32 has setVisible but no getVisible. The fallback is maintained
 * only by Home's trusted show/hide handlers, never by the app renderer. */
export function isQdnNativeViewVisible(view: object, requestedVisible: boolean): boolean {
  const getter = (view as { getVisible?: () => boolean }).getVisible;
  return typeof getter === 'function' ? getter.call(view) === true : requestedVisible;
}
