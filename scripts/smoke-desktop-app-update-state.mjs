#!/usr/bin/env node

// Home 2 owns the shipped desktop renderer. Keep the historical command as a
// compatibility alias, but run the packaged Home 2 Runtime-settings smoke that
// now asserts the sender-gated updater bridge and real update surface.
await import('./smoke-desktop-home-v2-settings.mjs')
