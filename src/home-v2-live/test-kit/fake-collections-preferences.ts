const values = new Map<string, string>()
let failingWriteKey: string | null = null

export const Preferences = {
  async get(input: { key: string }) {
    return { value: values.get(input.key) ?? null }
  },
  async remove(input: { key: string }) {
    values.delete(input.key)
  },
  async set(input: { key: string; value: string }) {
    if (input.key === failingWriteKey) {
      failingWriteKey = null
      throw new Error(`Preferences write failed for ${input.key}`)
    }
    values.set(input.key, input.value)
  },
}

export function clearFakeCollectionPreferences() {
  values.clear()
  failingWriteKey = null
}

export function readFakeCollectionPreference(key: string) {
  return values.get(key) ?? null
}

export function setFakeCollectionPreference(key: string, value: string) {
  values.set(key, value)
}

export function failNextFakeCollectionWrite(key: string) {
  failingWriteKey = key
}
