import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mergeHomeV2ShellGlobalState } from './home-v2-window-startup.js'

const SHELL_STATE_FILE = 'home-v2-shell-state.json'
const SHELL_STATE_MAX_BYTES = 128 * 1024

function statePath() {
  return path.join(app.getPath('userData'), SHELL_STATE_FILE)
}

export function readHomeV2ShellState(): unknown {
  try {
    const raw = readFileSync(statePath(), 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > SHELL_STATE_MAX_BYTES) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function writeHomeV2ShellState(value: unknown) {
  const raw = JSON.stringify(value)
  if (Buffer.byteLength(raw, 'utf8') > SHELL_STATE_MAX_BYTES) {
    throw new Error('Home v2 shell state exceeded the 128 KiB limit.')
  }
  const target = statePath()
  const staging = `${target}.next`
  writeFileSync(staging, raw, { encoding: 'utf8', mode: 0o600 })
  renameSync(staging, target)
}

/**
 * Writes everything except `product`, keeping the tab state already on disk.
 *
 * A detached window has its own tab strip that is deliberately session-only,
 * but it must still be able to persist global settings. Writing its whole
 * record would destroy the primary window's tabs. The merge happens here, in
 * the main process, so two windows saving at once cannot interleave a read
 * and a write.
 */
export function writeHomeV2ShellGlobalState(value: unknown) {
  writeHomeV2ShellState(mergeHomeV2ShellGlobalState(readHomeV2ShellState(), value))
}
