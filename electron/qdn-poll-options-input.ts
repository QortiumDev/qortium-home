type PollOption = { optionName: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getArrayOptionName(entry: unknown) {
  if (typeof entry === 'string') {
    return entry;
  }

  if (isRecord(entry)) {
    for (const key of ['optionName', 'name', 'value']) {
      if (typeof entry[key] === 'string') {
        return entry[key];
      }
    }
  }

  throw new Error('Each poll option must be a string or an object containing optionName.');
}

export function getPollOptionsInput(raw: unknown): PollOption[] {
  const names = Array.isArray(raw)
    ? raw.map(getArrayOptionName)
    : typeof raw === 'string'
      ? raw.split(',').map((part) => part.trim()).filter(Boolean)
      : [];

  if (names.length < 2 || names.length > 1000) {
    throw new Error('A poll requires 2 to 1000 options.');
  }

  const encoder = new TextEncoder();

  for (const name of names) {
    const length = encoder.encode(name).byteLength;

    if (length < 1 || length > 400) {
      throw new Error('Each poll option must be 1 to 400 UTF-8 bytes.');
    }
  }

  if (new Set(names).size !== names.length) {
    throw new Error('Poll options must be unique.');
  }

  return names.map((optionName) => ({ optionName }));
}
