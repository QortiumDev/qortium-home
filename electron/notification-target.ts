type NotificationTargetQuery = {
  address?: string;
  group?: string;
};

function getTargetValue(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function getNotificationTargetQuery(data: Record<string, unknown> | undefined): NotificationTargetQuery {
  const address = getTargetValue(data?.sender);
  const group = getTargetValue(data?.groupId) ?? getTargetValue(data?.txGroupId);
  const isDirect = getTargetValue(data?.recipient) !== undefined;

  // Direct chat messages have a sender and use Core's no-group sentinel (0).
  // Group messages can also carry a sender, but the explicit group target must
  // win so Chat opens the group conversation instead of a direct thread.
  if (group && !isDirect) {
    return { group };
  }

  return {
    ...(address ? { address } : {}),
  };
}

// Preserve an app's configured link when the pushed event has no conversation
// target. When Core supplies one, use URLSearchParams so values remain safe in
// the QDN render URL and existing app query parameters stay intact.
export function appendNotificationTargetQuery(
  link: string,
  data: Record<string, unknown> | undefined,
  event?: string,
) {
  if (event !== 'CHAT_MESSAGE' || !/^qdn:\/\//i.test(link)) {
    return link;
  }

  const query = getNotificationTargetQuery(data);

  if (!query.address && !query.group) {
    return link;
  }

  const hashIndex = link.indexOf('#');
  const base = hashIndex === -1 ? link : link.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : link.slice(hashIndex);
  const queryIndex = base.indexOf('?');
  const path = queryIndex === -1 ? base : base.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? '' : base.slice(queryIndex + 1));

  if (query.address) params.set('address', query.address);
  if (query.group) params.set('group', query.group);

  return `${path}?${params.toString()}${hash}`;
}
