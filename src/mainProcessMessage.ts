import { t, type TranslationKey } from './i18n';

const USER_MESSAGE_PATTERN = /QORTIUM_I18N:([\w.-]+):([^\s]*)/;

export function translateMainProcessMessage(message: string) {
  const match = USER_MESSAGE_PATTERN.exec(message);

  if (!match) {
    return message;
  }

  try {
    const params = JSON.parse(decodeURIComponent(match[2])) as Record<string, string | number>;

    return t(match[1] as TranslationKey, params);
  } catch {
    return t(match[1] as TranslationKey);
  }
}
