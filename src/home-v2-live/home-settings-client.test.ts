import assert from 'node:assert/strict'
import {
  createHomeV2HomeSettingsResponder,
  splitHomeV2HomeSettingsPatch,
  type HomeV2HomeSettingsResponderDependencies,
} from './home-settings-client'
import type { HomeV2AppearanceSettings } from '../v2/appearance'
import type { HomeV2NotificationPolicyState } from './notification-policy-client'

const BASE_APPEARANCE: HomeV2AppearanceSettings = {
  accent: 'clay',
  appZoom: 100,
  language: 'system',
  resolvedLanguage: 'en',
  resolvedTheme: 'dark',
  textSize: 'medium',
  theme: 'system',
  ui: 'classic',
}

function policy(
  overrides: Partial<HomeV2NotificationPolicyState> = {},
): HomeV2NotificationPolicyState {
  return {
    enabled: true,
    generation: 4,
    schema: 'qortium-home-v2-notification-policy',
    status: 'available',
    version: 1,
    ...overrides,
  } as HomeV2NotificationPolicyState
}

type Harness = {
  readonly dependencies: HomeV2HomeSettingsResponderDependencies
  readonly appearanceWrites: Partial<HomeV2AppearanceSettings>[]
  readonly policyWrites: { enabled: boolean; expectedGeneration: number }[]
  refreshes: number
}

function harness(options: {
  appearance?: HomeV2AppearanceSettings
  policy?: HomeV2NotificationPolicyState | null
  refreshedPolicy?: HomeV2NotificationPolicyState
  setPolicy?: (
    request: { enabled: boolean; expectedGeneration: number },
    attempt: number,
  ) => Promise<HomeV2NotificationPolicyState>
} = {}): Harness {
  let appearance = options.appearance ?? BASE_APPEARANCE
  const appearanceWrites: Partial<HomeV2AppearanceSettings>[] = []
  const policyWrites: { enabled: boolean; expectedGeneration: number }[] = []
  const state: Harness = {
    appearanceWrites,
    dependencies: {
      applyAppearance: (patch) => {
        appearanceWrites.push(patch)
        appearance = { ...appearance, ...patch }
      },
      getAppearance: () => appearance,
      getNotificationPolicy: () =>
        options.policy === undefined ? policy() : options.policy,
      refreshNotificationPolicy: async () => {
        state.refreshes += 1
        return options.refreshedPolicy ?? policy()
      },
      resolveSystemLanguage: () => 'fr',
      resolveSystemTheme: () => 'light',
      setNotificationPolicy: async (request) => {
        policyWrites.push(request)
        if (options.setPolicy) return options.setPolicy(request, policyWrites.length)
        return policy({ enabled: request.enabled, generation: request.expectedGeneration + 1 })
      },
    },
    policyWrites,
    refreshes: 0,
  }
  return state
}

function stale() {
  return Object.assign(new Error('Notification settings changed; refresh and try again.'), {
    code: 'HOME_DATA_STALE',
  })
}

async function main() {
  // -------------------------------------------------------------------------
  // Composition: two stores, one seven-key answer.
  // -------------------------------------------------------------------------

  {
    const test = harness()
    const read = await createHomeV2HomeSettingsResponder(test.dependencies).read()
    assert.deepEqual(read, {
      accent: 'clay',
      appNotifications: true,
      appZoom: 100,
      language: 'system',
      textSize: 'medium',
      theme: 'system',
      ui: 'classic',
    })
    // The appearance PREFERENCE is reported, not what it resolved to: 'system'
    // is what the user chose, and it is what an app must send back to keep it.
    assert.equal(read.theme, 'system')
    assert.equal(read.language, 'system')
    // resolvedTheme and resolvedLanguage are appearance fields too, and they
    // must never reach an app through this surface — the reply is exactly seven
    // keys, built from the schema rather than by spreading the appearance.
    assert.equal(Object.keys(read).length, 7)
    assert.equal('resolvedTheme' in read, false)
    assert.equal('resolvedLanguage' in read, false)
  }

  {
    // Home 2's default accent is clay, which 1.x's schema does not list. A read
    // must tolerate it or the bridge is broken on every fresh profile.
    const test = harness({ appearance: { ...BASE_APPEARANCE, accent: 'clay' } })
    assert.equal(
      (await createHomeV2HomeSettingsResponder(test.dependencies).read()).accent,
      'clay',
    )
  }

  {
    // The notification half comes from the policy, not from appearance.
    const test = harness({ policy: policy({ enabled: false }) })
    assert.equal(
      (await createHomeV2HomeSettingsResponder(test.dependencies).read()).appNotifications,
      false,
    )
  }

  for (const status of ['corrupt', 'unavailable'] as const) {
    // A degraded policy reads as OFF. That is the truthful answer — in either
    // state no notification will be shown — and it is the safe direction to be
    // wrong in.
    const test = harness({ policy: policy({ enabled: false, generation: null, status }) })
    assert.equal(
      (await createHomeV2HomeSettingsResponder(test.dependencies).read()).appNotifications,
      false,
      `a ${status} policy must read as notifications off`,
    )
  }

  {
    // Before the first policy read the responder fetches one rather than
    // reporting a placeholder.
    const test = harness({ policy: null })
    const read = await createHomeV2HomeSettingsResponder(test.dependencies).read()
    assert.equal(test.refreshes, 1)
    assert.equal(read.appNotifications, true)
  }

  // -------------------------------------------------------------------------
  // The write split.
  // -------------------------------------------------------------------------

  // The pure split, pinned on its own: six appearance keys and one policy key.
  assert.deepEqual(splitHomeV2HomeSettingsPatch({ theme: 'dark', appNotifications: false }), {
    appearance: { theme: 'dark' },
    appNotifications: false,
  })
  assert.deepEqual(splitHomeV2HomeSettingsPatch({ appZoom: 125 }), {
    appearance: { appZoom: 125 },
    appNotifications: null,
  })
  assert.deepEqual(
    splitHomeV2HomeSettingsPatch({
      accent: 'teal', appZoom: 125, language: 'de', textSize: 'large', theme: 'light', ui: 'modern',
    }).appearance,
    { accent: 'teal', appZoom: 125, language: 'de', textSize: 'large', theme: 'light', ui: 'modern' },
  )
  // A patch that only touches appNotifications produces no appearance write at
  // all — not an empty one.
  assert.deepEqual(splitHomeV2HomeSettingsPatch({ appNotifications: true }).appearance, {})

  {
    // Appearance-only: the trusted policy IPC is never touched.
    const test = harness()
    const applied = await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ accent: 'teal', textSize: 'large' })
    assert.deepEqual(test.appearanceWrites, [{ accent: 'teal', textSize: 'large' }])
    assert.deepEqual(test.policyWrites, [])
    // The reply reflects the change the app just made.
    assert.equal(applied.accent, 'teal')
    assert.equal(applied.textSize, 'large')
  }

  {
    // Notification-only: no appearance write.
    const test = harness()
    const applied = await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ appNotifications: false })
    assert.deepEqual(test.appearanceWrites, [])
    assert.deepEqual(test.policyWrites, [{ enabled: false, expectedGeneration: 4 }])
    assert.equal(applied.appNotifications, false)
  }

  {
    // Both halves, one patch.
    const test = harness()
    const applied = await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ appNotifications: false, ui: 'modern' })
    assert.deepEqual(test.appearanceWrites, [{ ui: 'modern' }])
    assert.deepEqual(test.policyWrites, [{ enabled: false, expectedGeneration: 4 }])
    assert.equal(applied.ui, 'modern')
    assert.equal(applied.appNotifications, false)
  }

  {
    // Home derives the resolved values; an app names a PREFERENCE only.
    const test = harness()
    await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ language: 'system', theme: 'system' })
    assert.deepEqual(test.appearanceWrites, [{
      language: 'system',
      resolvedLanguage: 'fr',
      resolvedTheme: 'light',
      theme: 'system',
    }])
  }

  {
    // A concrete preference resolves to itself, never to the system value.
    const test = harness()
    await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ language: 'de', theme: 'dark' })
    assert.deepEqual(test.appearanceWrites, [{
      language: 'de',
      resolvedLanguage: 'de',
      resolvedTheme: 'dark',
      theme: 'dark',
    }])
  }

  {
    // Defence in depth: appZoom is already bounded by the shared contract, so
    // clamping here is a no-op for anything that came through it.
    const test = harness()
    await createHomeV2HomeSettingsResponder(test.dependencies).apply({ appZoom: 125 })
    assert.deepEqual(test.appearanceWrites, [{ appZoom: 125 }])
  }

  // -------------------------------------------------------------------------
  // The compare-and-set conflict path.
  // -------------------------------------------------------------------------

  {
    // The user toggled notifications in Settings between approval and apply.
    // That is a race, not a refusal: re-read and retry against the generation
    // that is now current.
    const test = harness({
      refreshedPolicy: policy({ generation: 9 }),
      setPolicy: async (request, attempt) => {
        if (attempt === 1) throw stale()
        return policy({ enabled: request.enabled, generation: request.expectedGeneration + 1 })
      },
    })
    const applied = await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ appNotifications: false })
    assert.equal(test.refreshes, 1, 'a conflict must trigger exactly one re-read')
    assert.deepEqual(test.policyWrites, [
      { enabled: false, expectedGeneration: 4 },
      // The retry uses the REFRESHED generation, not the stale one.
      { enabled: false, expectedGeneration: 9 },
    ])
    assert.equal(applied.appNotifications, false)
  }

  {
    // A second conflict is surfaced rather than looped on. Two losses in a row
    // means something else is writing continuously, and retrying forever would
    // let an app's write win a fight against the user's own hand.
    const test = harness({
      refreshedPolicy: policy({ generation: 9 }),
      setPolicy: async () => { throw stale() },
    })
    await assert.rejects(
      () => createHomeV2HomeSettingsResponder(test.dependencies).apply({ appNotifications: false }),
      (error: unknown) => (error as { code?: string }).code === 'HOME_DATA_STALE',
    )
    assert.equal(test.policyWrites.length, 2)
    assert.equal(test.refreshes, 1)
  }

  {
    // A non-conflict failure is NOT retried: only HOME_DATA_STALE means "try
    // again against a newer generation".
    const test = harness({ setPolicy: async () => { throw new Error('disk is on fire') } })
    await assert.rejects(
      () => createHomeV2HomeSettingsResponder(test.dependencies).apply({ appNotifications: false }),
      /disk is on fire/,
    )
    assert.equal(test.policyWrites.length, 1)
    assert.equal(test.refreshes, 0)
  }

  for (const status of ['corrupt', 'unavailable'] as const) {
    // Writing the notification half against a degraded policy fails closed with
    // a code the app can distinguish — and, critically, the APPEARANCE half is
    // left untouched, because the fallible write runs first. A half-applied
    // patch reported as a failure is the worst of both outcomes.
    const test = harness({ policy: policy({ enabled: false, generation: null, status }) })
    await assert.rejects(
      () => createHomeV2HomeSettingsResponder(test.dependencies)
        .apply({ appNotifications: true, theme: 'light' }),
      (error: unknown) => (error as { code?: string }).code === (
        status === 'corrupt'
          ? 'HOME_NOTIFICATION_POLICY_CORRUPT'
          : 'HOME_NOTIFICATION_POLICY_UNAVAILABLE'
      ),
    )
    assert.deepEqual(test.appearanceWrites, [], `a ${status} policy must not half-apply the patch`)
    assert.deepEqual(test.policyWrites, [])
  }

  {
    // A degraded policy does NOT block an appearance-only write: the two stores
    // fail independently.
    const test = harness({ policy: policy({ enabled: false, generation: null, status: 'corrupt' }) })
    const applied = await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ theme: 'light' })
    assert.deepEqual(test.appearanceWrites, [{ resolvedTheme: 'light', theme: 'light' }])
    assert.equal(applied.theme, 'light')
    assert.equal(applied.appNotifications, false)
  }

  // -------------------------------------------------------------------------
  // The reply never leaks, whatever was written.
  // -------------------------------------------------------------------------

  {
    const test = harness()
    const applied = await createHomeV2HomeSettingsResponder(test.dependencies)
      .apply({ language: 'system', theme: 'system' })
    assert.equal(Object.keys(applied).length, 7)
    assert.equal('resolvedTheme' in applied, false)
    assert.equal('resolvedLanguage' in applied, false)
  }

  console.log('Home v2 Home settings renderer round-trip tests passed.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
