// Pure validation and derivation for the Home 2 node-settings bridge actions.
//
// Everything the UPDATE_NODE_SETTINGS / RESTART_NODE family shows a user or
// sends a node is computed here, with no network or Electron access — so the
// rules can be tested directly and the bridge handler (desktop) and node
// client (Android) stay thin transports around them, exactly like
// home-v2-minting.ts.
//
// Two invariants this module exists to hold:
//  1. A settings patch is validated BEFORE any prompt is raised: a malformed
//     request, an oversized batch, or a key the node does not declare
//     writable can never reach the approval dialog, let alone the node.
//  2. Nothing from Core's settings-update response passes through verbatim.
//     The result is rebuilt field by field from a fixed allowlist, so values
//     like the node's settings file path never reach an app.

import { homeV2PromptText } from './home-v2-prompt-text.js'

export const HOME_V2_NODE_SETTINGS_WRITE_ACTIONS = Object.freeze([
  'RESTART_NODE',
  'UPDATE_NODE_SETTINGS',
] as const)

export type HomeV2NodeSettingsWriteAction =
  (typeof HOME_V2_NODE_SETTINGS_WRITE_ACTIONS)[number]

const WRITE_ACTIONS = new Set<string>(HOME_V2_NODE_SETTINGS_WRITE_ACTIONS)

// The 1.x caps, kept exactly: at most 64 settings per request, key names at
// most 120 characters, and every displayed value at most 1,000 escaped
// characters — a batch too large to show in full is refused rather than
// approved unseen.
const MAX_PATCH_ENTRIES = 64
const MAX_SETTING_KEY_LENGTH = 120
const MAX_SETTING_VALUE_DISPLAY = 1_000

// Response-sanitization ceilings: one hostile or broken node must not make
// Home build an unbounded result object out of a bounded response body.
const MAX_RESULT_KEYS = 256
const MAX_RESULT_KEY_LENGTH = 200

// The fixed Impact row a RESTART_NODE prompt carries. Home's own copy — the
// shell pins it byte-for-byte, so an app cannot substitute its own wording.
export const HOME_V2_RESTART_NODE_IMPACT = 'Restart the selected Core node'

export function isHomeV2NodeSettingsWriteAction(
  action: string,
): action is HomeV2NodeSettingsWriteAction {
  return WRITE_ACTIONS.has(action)
}

export function homeV2NodeSettingsOperationLabel(action: string): string {
  return action === 'RESTART_NODE' ? 'Restart the node' : 'Update node settings'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The validated settings patch, in the shape 1.x accepted: `patch`, then
 * `settings`, then a record `payload`. Only the ENTRY rules live here — which
 * keys are writable is the node's declaration, checked separately against
 * the metadata it serves (homeV2WritableSettingKeys).
 */
export function normalizeHomeV2NodeSettingsPatch(
  requestValue: Record<string, unknown>,
): Record<string, unknown> {
  const candidate = requestValue.patch ?? requestValue.settings ??
    (isRecord(requestValue.payload) ? requestValue.payload : undefined)
  if (!isRecord(candidate)) {
    throw new Error('Node settings update requests must include a settings patch object.')
  }
  const entries = Object.entries(candidate)
  if (entries.length === 0) {
    throw new Error('Node settings update requests must include at least one setting.')
  }
  if (entries.length > MAX_PATCH_ENTRIES) {
    throw new Error(`Node settings update requests may include at most ${MAX_PATCH_ENTRIES} settings.`)
  }
  for (const [key] of entries) {
    if (!key || key.length > MAX_SETTING_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(key)) {
      throw new Error(`Node setting names may contain at most ${MAX_SETTING_KEY_LENGTH} characters.`)
    }
  }
  return Object.fromEntries(entries)
}

/**
 * The keys the node itself declares writable, from its
 * `/admin/settings/metadata` answer. Current Cores serve `writable` as an
 * object map (key → { type, restartRequired }); the array-of-entries form is
 * accepted too, as 1.x did, for older builds. Anything else answers an empty
 * set, which refuses every patch key — fail closed, never open.
 */
export function homeV2WritableSettingKeys(metadata: unknown): ReadonlySet<string> {
  const keys = new Set<string>()
  if (!isRecord(metadata)) return keys
  const writable = metadata.writable
  if (isRecord(writable)) {
    for (const key of Object.keys(writable)) keys.add(key)
    return keys
  }
  if (Array.isArray(writable)) {
    for (const entry of writable) {
      if (isRecord(entry) && typeof entry.key === 'string' && entry.key) keys.add(entry.key)
      else if (typeof entry === 'string' && entry) keys.add(entry)
    }
  }
  return keys
}

function approvalValue(value: unknown, label: string): string {
  // Strings render QUOTED, so Home's own annotations below — '(not present)',
  // '(empty)' — cannot be forged by an app sending them as literal values
  // (the escaper also escapes the quote character itself).
  if (typeof value === 'string') {
    if (value === '') return '(empty)'
    return `"${homeV2PromptText(value, label, MAX_SETTING_VALUE_DISPLAY)}"`
  }
  const serialized = JSON.stringify(value) ?? 'null'
  return homeV2PromptText(serialized, label, MAX_SETTING_VALUE_DISPLAY)
}

/**
 * The per-key current-vs-proposed rows an UPDATE_NODE_SETTINGS prompt renders,
 * derived from the node's real current settings and the validated patch. The
 * substance of the prompt: the user answers about named settings and named
 * values, never about a category. Every patch key must already have passed
 * the writable check — rows are display only.
 */
export function buildHomeV2NodeSettingsApprovalRows(
  currentSettings: unknown,
  patch: Record<string, unknown>,
): readonly { readonly label: string; readonly value: string }[] {
  if (!isRecord(currentSettings)) {
    throw new Error('The current node settings response is not an object.')
  }
  const rows: { label: string; value: string }[] = []
  for (const [key, value] of Object.entries(patch)) {
    const currentLabel = `${key} (current)`
    const proposedLabel = `${key} (proposed)`
    rows.push({
      label: currentLabel,
      value: key in currentSettings
        ? approvalValue(currentSettings[key], currentLabel)
        : '(not present)',
    })
    rows.push({ label: proposedLabel, value: approvalValue(value, proposedLabel) })
  }
  return rows
}

function sanitizedKeyList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const keys: string[] = []
  for (const entry of value) {
    if (keys.length >= MAX_RESULT_KEYS) break
    if (typeof entry === 'string' && entry && entry.length <= MAX_RESULT_KEY_LENGTH &&
      !/[\u0000-\u001f\u007f]/.test(entry)) {
      keys.push(entry)
    }
  }
  return Object.freeze(keys)
}

export interface HomeV2NodeSettingsUpdateResult {
  readonly applied: readonly string[]
  readonly removed: readonly string[]
  readonly restartRequired: readonly string[]
  readonly saved: boolean
  readonly updated: readonly string[]
}

/**
 * Core's SettingsUpdateResult, rebuilt from a fixed allowlist. `settingsPath`
 * — the node's settings file location on disk — is deliberately dropped: an
 * app asked to change a setting, not to learn the node's filesystem layout.
 */
export function createHomeV2NodeSettingsUpdateResult(
  raw: unknown,
): HomeV2NodeSettingsUpdateResult {
  const record = isRecord(raw) ? raw : {}
  return Object.freeze({
    applied: sanitizedKeyList(record.applied),
    removed: sanitizedKeyList(record.removed),
    restartRequired: sanitizedKeyList(record.restartRequired),
    saved: record.saved === true,
    updated: sanitizedKeyList(record.updated),
  })
}
