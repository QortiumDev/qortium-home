import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseWidgetPlacements,
  putWidgetPlacement,
  serializeWidgetPlacements,
  WIDGET_PLACEMENT_MAX_BYTES,
  type WidgetPlacement,
  type WidgetPlacements,
} from './widget-placement.js'

// File I/O for the placement store. The staged-write pattern matches
// home-v2-shell-store.ts: write a .next file, then rename it into place, so a
// crash mid-write cannot leave a half-written store behind.

const PLACEMENT_FILE = 'widget-placements.json'

function storePath() {
  return path.join(app.getPath('userData'), PLACEMENT_FILE)
}

export function readWidgetPlacements(): WidgetPlacements {
  try {
    return parseWidgetPlacements(readFileSync(storePath(), 'utf8'))
  } catch {
    return {}
  }
}

export function writeWidgetPlacements(placements: WidgetPlacements) {
  const raw = serializeWidgetPlacements(placements)
  if (Buffer.byteLength(raw, 'utf8') > WIDGET_PLACEMENT_MAX_BYTES) return
  const target = storePath()
  const staging = `${target}.next`
  writeFileSync(staging, raw, { encoding: 'utf8', mode: 0o600 })
  renameSync(staging, target)
}

export function saveWidgetPlacement(key: string, placement: WidgetPlacement) {
  try {
    writeWidgetPlacements(putWidgetPlacement(readWidgetPlacements(), key, placement))
  } catch {
    // Where a window sat is not worth failing a drag over.
  }
}
