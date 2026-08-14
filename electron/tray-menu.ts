// The tray menu's shape, with no Electron in sight so it can be tested
// headlessly. electron/tray.ts turns these nodes into real MenuItems.
//
// The spec treats this inventory as a correctness requirement rather than
// polish: a widget whose app fails to load is an invisible window, and without
// a list that names it and offers to close it the only way out is quitting
// Home.

export const TRAY_LABEL_MAX_LENGTH = 48
export const TRAY_OPACITY_STEPS: readonly number[] = [1, 0.9, 0.75, 0.5]

export type TrayWidgetSummary = {
  readonly widgetId: string
  readonly appName: string
  readonly opacity: number
}

export type TrayMenuNode =
  | { readonly kind: 'separator' }
  | { readonly kind: 'command'; readonly commandId: string; readonly label: string; readonly enabled: boolean }
  | {
      readonly kind: 'radio'
      readonly commandId: string
      readonly label: string
      readonly checked: boolean
    }
  | { readonly kind: 'submenu'; readonly label: string; readonly items: readonly TrayMenuNode[] }

export const TRAY_COMMAND_OPEN_HOME = 'open-home'
export const TRAY_COMMAND_QUIT = 'quit'
export const TRAY_COMMAND_CLOSE_ALL_WIDGETS = 'close-all-widgets'

export function trayCloseWidgetCommand(widgetId: string) {
  return `close-widget:${widgetId}`
}

export function trayOpacityCommand(widgetId: string, opacity: number) {
  return `widget-opacity:${widgetId}:${opacity}`
}

// An app name is published content, so it is untrusted display text. Truncate
// it and strip control characters rather than letting it reshape the menu.
export function trayWidgetLabel(appName: unknown): string {
  const raw = typeof appName === 'string' ? appName : ''
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!cleaned) return 'Unnamed widget'
  if (cleaned.length <= TRAY_LABEL_MAX_LENGTH) return cleaned
  return `${cleaned.slice(0, TRAY_LABEL_MAX_LENGTH - 1)}…`
}

function opacityLabel(opacity: number) {
  return `${Math.round(opacity * 100)}%`
}

function widgetNode(widget: TrayWidgetSummary): TrayMenuNode {
  return {
    kind: 'submenu',
    label: trayWidgetLabel(widget.appName),
    items: [
      {
        kind: 'submenu',
        label: 'Opacity',
        items: TRAY_OPACITY_STEPS.map((step) => ({
          kind: 'radio' as const,
          commandId: trayOpacityCommand(widget.widgetId, step),
          label: opacityLabel(step),
          // Float comparison is safe here because both sides come from
          // TRAY_OPACITY_STEPS: the tray is the only thing that sets opacity.
          checked: Math.abs(widget.opacity - step) < 0.001,
        })),
      },
      {
        kind: 'command',
        commandId: trayCloseWidgetCommand(widget.widgetId),
        label: 'Close',
        enabled: true,
      },
    ],
  }
}

export function buildTrayMenu(widgets: readonly TrayWidgetSummary[]): readonly TrayMenuNode[] {
  const nodes: TrayMenuNode[] = [
    { kind: 'command', commandId: TRAY_COMMAND_OPEN_HOME, label: 'Open Qortium Home', enabled: true },
    { kind: 'separator' },
  ]

  if (widgets.length === 0) {
    // Disabled rather than absent: an empty inventory is information, and a
    // menu that changes shape entirely is harder to read at a glance.
    nodes.push({ kind: 'command', commandId: 'no-widgets', label: 'No widgets open', enabled: false })
  } else {
    for (const widget of widgets) nodes.push(widgetNode(widget))
    nodes.push({
      kind: 'command',
      commandId: TRAY_COMMAND_CLOSE_ALL_WIDGETS,
      label: widgets.length === 1 ? 'Close widget' : `Close all ${widgets.length} widgets`,
      enabled: true,
    })
  }

  nodes.push({ kind: 'separator' })
  nodes.push({ kind: 'command', commandId: TRAY_COMMAND_QUIT, label: 'Quit Qortium Home', enabled: true })
  return nodes
}

export function trayTooltip(widgets: readonly TrayWidgetSummary[]): string {
  if (widgets.length === 0) return 'Qortium Home'
  if (widgets.length === 1) return 'Qortium Home - 1 widget'
  return `Qortium Home - ${widgets.length} widgets`
}
