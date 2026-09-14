// Decides which local Core API key Home should use when the file-based
// resolution (running-process introspection, then the managed runtime's
// apikey.txt) leaves Home with no key, or with one the Core rejects. Core keeps
// apikey.txt in its apiKeyPath, which defaults to the process working
// directory, so a Core started from the install tree created its key there
// while Home read runtime/apikey.txt — "API error 4" until the user copied the
// file by hand (tester report, 2026-09-13). Pure so it can be tested; the
// caller supplies the node probe and does the file migration.

export type LocalApiKeyProbe = (apiKey: string) => Promise<boolean | null>;

export interface LocalApiKeyAdoption {
  readonly apiKey: string;
  /** True when a candidate other than `current` was accepted by the Core. */
  readonly adopted: boolean;
}

export async function selectAcceptedLocalApiKey(input: {
  readonly current: string;
  readonly candidates: readonly (string | null | undefined)[];
  readonly probe: LocalApiKeyProbe;
}): Promise<LocalApiKeyAdoption> {
  const keep = { apiKey: input.current, adopted: false };

  if (input.current) {
    // Only a definite rejection moves on; an unreachable Core is not evidence.
    if ((await input.probe(input.current)) !== false) {
      return keep;
    }
  }

  const seen = new Set<string>([input.current]);

  for (const candidate of input.candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);

    if ((await input.probe(candidate)) === true) {
      return { apiKey: candidate, adopted: true };
    }
  }

  return keep;
}
