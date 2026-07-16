const USER_MESSAGE_PREFIX = 'QORTIUM_I18N:';

export function userMessage(key: string, params: Record<string, string | number> = {}) {
  return `${USER_MESSAGE_PREFIX}${key}:${encodeURIComponent(JSON.stringify(params))}`;
}
