/** Display observations only. The caller must first verify the current wallet owner. */
export type WalletScanHistory = { identity: string; samples: { at: number; blocks: number; total: number }[] };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
export function projectWalletScanHistory(value: unknown, identity: string | null, blocks: number | null, total: number | null, observedAt: number | null): WalletScanHistory | undefined {
  if (value == null) return undefined;
  if (!record(value) || identity === null || value.identity !== identity || !Array.isArray(value.samples) || value.samples.length === 0 || value.samples.length > 128)
    throw Error('Invalid wallet scan history');
  let previous: WalletScanHistory['samples'][number] | undefined;
  const samples = value.samples.map((v) => {
    if (!record(v) || !integer(v.at, 8640000000000000) || !integer(v.blocks, 500000000) || !integer(v.total, 500000000) || v.total === 0 || v.blocks > v.total ||
      (previous && (v.at <= previous.at || v.at - previous.at > 900000 || v.blocks < previous.blocks || v.total < previous.total))) throw Error('Invalid wallet scan history sample');
    const sample = { at: v.at, blocks: v.blocks, total: v.total };
    previous = sample;
    return sample;
  });
  const last = samples[samples.length - 1];
  if (last.at - samples[0].at > 1800000 || (observedAt !== null && last.at > observedAt) || (blocks !== null && last.blocks > blocks) || (total !== null && last.total > total)) throw Error('Invalid wallet scan history range');
  return { identity, samples };
}
