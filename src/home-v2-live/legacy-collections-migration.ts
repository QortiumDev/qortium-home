import {
  HOME_V2_LEGACY_COLLECTION_KEYS,
  parseHomeV2LegacyCollectionsRaw,
  type HomeV2LegacyCollectionRawValues,
} from './legacy-collections-contract'

async function readLegacyCollections() {
  const raw = Object.fromEntries(
    HOME_V2_LEGACY_COLLECTION_KEYS.map((key) => [key, window.localStorage.getItem(key)]),
  ) as HomeV2LegacyCollectionRawValues
  return parseHomeV2LegacyCollectionsRaw(raw)
}

declare global {
  interface Window {
    __QORTIUM_HOME_LEGACY_COLLECTIONS__?: ReturnType<typeof readLegacyCollections>
  }
}

window.__QORTIUM_HOME_LEGACY_COLLECTIONS__ = readLegacyCollections()
