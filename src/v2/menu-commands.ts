export type HomeV2TextSizeCommand =
  | 'text-size-decrease'
  | 'text-size-increase'
  | 'text-size-reset'

export type HomeV2MenuCommand =
  | HomeV2TextSizeCommand
  | 'close-tab'
  | 'focus-address-bar'
  | 'go-back'
  | 'go-forward'
  | 'new-tab'
  | 'reload-tab'
  | 'reopen-closed-tab'

const HOME_V2_MENU_COMMANDS: ReadonlySet<HomeV2MenuCommand> = new Set([
  'close-tab',
  'focus-address-bar',
  'go-back',
  'go-forward',
  'new-tab',
  'reload-tab',
  'reopen-closed-tab',
  'text-size-decrease',
  'text-size-increase',
  'text-size-reset',
])

export function parseHomeV2MenuCommand(
  value: unknown,
): HomeV2MenuCommand | null {
  return typeof value === 'string' &&
    HOME_V2_MENU_COMMANDS.has(value as HomeV2MenuCommand)
    ? (value as HomeV2MenuCommand)
    : null
}

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
    homeV2MenuCommands?: {
      onCommand: (
        listener: (command: HomeV2MenuCommand) => void,
      ) => () => void
    }
  }
}

export function subscribeHomeV2MenuCommands(
  listener: (command: HomeV2MenuCommand) => void,
) {
  return window.homeV2MenuCommands?.onCommand(listener)
}
