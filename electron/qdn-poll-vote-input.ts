export type PollVoteOptionInput = {
  optionIndex?: number;
  optionIndexes?: number[];
};

type GetInteger = (value: unknown) => number | undefined;

export function getOptionalPollVoteOptionIndexes(
  value: unknown,
  getInteger: GetInteger,
): number[] | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('Option indexes must be an array.');
  }

  const optionIndexes = value.map((entry) => {
    const optionIndex = getInteger(entry);

    if (typeof optionIndex !== 'number') {
      throw new Error('Option indexes must contain safe integers.');
    }

    if (optionIndex < 0) {
      throw new Error('Option indexes must be at least 0.');
    }

    return optionIndex;
  });

  if (optionIndexes.length > 1) {
    if (optionIndexes.includes(0)) {
      throw new Error('Option index 0 (remove vote) cannot be combined with other option indexes.');
    }

    if (new Set(optionIndexes).size !== optionIndexes.length) {
      throw new Error('Option indexes must not contain duplicates.');
    }
  }

  return optionIndexes;
}

export function resolvePollVoteOptionInput(
  optionIndex: number | undefined,
  optionIndexes: number[] | undefined,
): PollVoteOptionInput {
  if (typeof optionIndexes === 'undefined') {
    if (typeof optionIndex !== 'number') {
      throw new Error('Option index is required.');
    }

    return { optionIndex };
  }

  if (typeof optionIndex === 'number') {
    const isConsistent =
      (optionIndex === 0 && (optionIndexes.length === 0 || (optionIndexes.length === 1 && optionIndexes[0] === 0))) ||
      (optionIndexes.length === 1 && optionIndexes[0] === optionIndex);

    if (!isConsistent) {
      throw new Error('optionIndex conflicts with optionIndexes.');
    }
  }

  return { optionIndexes };
}

export function getPollVoteApprovalName(pollId: number, optionInput: PollVoteOptionInput) {
  if (typeof optionInput.optionIndexes === 'undefined') {
    return `Poll #${pollId} · option ${optionInput.optionIndex}`;
  }

  if (
    optionInput.optionIndexes.length === 0 ||
    (optionInput.optionIndexes.length === 1 && optionInput.optionIndexes[0] === 0)
  ) {
    return `Poll #${pollId} · remove vote`;
  }

  return `Poll #${pollId} · options ${[...optionInput.optionIndexes].sort((a, b) => a - b).join(', ')}`;
}
