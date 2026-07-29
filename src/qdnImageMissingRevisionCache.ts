export class QdnImageMissingRevisionCache {
  private readonly entries = new Map<string, string>();

  constructor(private readonly maxEntries: number) {}

  has(cacheKey: string, revision: string): boolean {
    return Boolean(revision) && this.entries.get(cacheKey) === revision;
  }

  remember(cacheKey: string, revision: string): void {
    if (!revision || this.maxEntries <= 0) {
      return;
    }

    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, revision);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;

      if (!oldestKey) {
        break;
      }

      this.entries.delete(oldestKey);
    }
  }

  forget(cacheKey: string): void {
    this.entries.delete(cacheKey);
  }
}
