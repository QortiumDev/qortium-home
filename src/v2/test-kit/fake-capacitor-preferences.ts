let storedValue: string | null = null
let unavailable = false
let writeUnavailable = false

export const Preferences = {
  async get() {
    if (unavailable) throw new Error('Preferences unavailable')
    return { value: storedValue }
  },
  async set(input: { value: string }) {
    if (unavailable || writeUnavailable) throw new Error('Preferences unavailable')
    storedValue = input.value
  },
  async remove() {
    if (unavailable || writeUnavailable) throw new Error('Preferences unavailable')
    storedValue = null
  },
}

export function readFakePreference() {
  return storedValue
}

export function setFakePreference(value: string | null) {
  storedValue = value
}

export function setFakePreferencesUnavailable(value: boolean) {
  unavailable = value
}

export function setFakePreferencesWriteUnavailable(value: boolean) {
  writeUnavailable = value
}
