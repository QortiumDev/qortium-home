export type HomeV2TextSizeCommand =
  | 'text-size-decrease'
  | 'text-size-increase'
  | 'text-size-reset'

export function parseHomeV2TextSizeCommand(
  value: unknown,
): HomeV2TextSizeCommand | null {
  return value === 'text-size-decrease' ||
    value === 'text-size-increase' ||
    value === 'text-size-reset'
    ? value
    : null
}

declare global {
  interface Window {
    homeV2TextSizeShortcuts?: {
      onCommand: (
        listener: (command: HomeV2TextSizeCommand) => void,
      ) => () => void
    }
  }
}

export function subscribeHomeV2TextSizeCommands(
  listener: (command: HomeV2TextSizeCommand) => void,
) {
  return window.homeV2TextSizeShortcuts?.onCommand(listener)
}
