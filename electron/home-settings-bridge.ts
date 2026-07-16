// Pure, shared schema for the deliberately small Home display-settings bridge.
// Keep this independent of Electron/DOM/Capacitor so it is safe in both bridge
// implementations and in focused unit tests.

export type HomeSettingKey = 'theme' | 'accent' | 'language' | 'textSize' | 'appZoom' | 'ui' | 'appNotifications';

export type HomeSettings = {
  theme: 'system' | 'light' | 'dark';
  accent: 'green' | 'blue' | 'orange' | 'purple' | 'red' | 'teal' | 'cyan' | 'pink' | 'yellow';
  language: 'system' | 'ar' | 'de' | 'el' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'he' | 'hi' | 'hu' | 'it' | 'ja' | 'ko' | 'nb' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sv' | 'zh-CN' | 'zh-TW';
  textSize: 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large' | 'huge';
  appZoom: number;
  ui: 'classic' | 'modern' | 'fun';
  appNotifications: boolean;
};

type HomeSettingType = 'boolean' | 'number' | 'string';

type HomeSettingDefinition<K extends HomeSettingKey = HomeSettingKey> = {
  key: K;
  label: string;
  type: HomeSettingType;
  allowedValues?: readonly HomeSettings[K][];
  min?: number;
  max?: number;
  default: HomeSettings[K];
  validate: (value: unknown) => value is HomeSettings[K];
};

// This is the complete and only QDN-writable Home settings table. Do not add
// non-display settings here: it backs metadata, validation, and approval UI.
export const HOME_SETTINGS_SCHEMA: readonly HomeSettingDefinition[] = [
  {
    key: 'theme', label: 'Theme', type: 'string', allowedValues: ['system', 'light', 'dark'], default: 'system',
    validate: (value): value is HomeSettings['theme'] => typeof value === 'string',
  },
  {
    key: 'accent', label: 'Accent color', type: 'string', allowedValues: ['green', 'blue', 'orange', 'purple', 'red', 'teal', 'cyan', 'pink', 'yellow'], default: 'green',
    validate: (value): value is HomeSettings['accent'] => typeof value === 'string',
  },
  {
    key: 'language', label: 'Language', type: 'string', allowedValues: ['system', 'ar', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hi', 'hu', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'zh-CN', 'zh-TW'], default: 'system',
    validate: (value): value is HomeSettings['language'] => typeof value === 'string',
  },
  {
    key: 'textSize', label: 'Text size', type: 'string', allowedValues: ['extra-small', 'small', 'medium', 'large', 'extra-large', 'huge'], default: 'medium',
    validate: (value): value is HomeSettings['textSize'] => typeof value === 'string',
  },
  {
    key: 'appZoom', label: 'App zoom', type: 'number', min: 50, max: 200, default: 100,
    validate: (value): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value),
  },
  {
    key: 'ui', label: 'Interface style', type: 'string', allowedValues: ['classic', 'modern', 'fun'], default: 'classic',
    validate: (value): value is HomeSettings['ui'] => typeof value === 'string',
  },
  {
    key: 'appNotifications', label: 'App notifications', type: 'boolean', default: true,
    validate: (value): value is boolean => typeof value === 'boolean',
  },
];

export type HomeSettingsMetadata = Array<{
  key: HomeSettingKey;
  type: HomeSettingType;
  allowedValues?: readonly string[];
  min?: number;
  max?: number;
  default: string | number | boolean;
}>;

export function getHomeSettingsMetadata(): HomeSettingsMetadata {
  return HOME_SETTINGS_SCHEMA.map(({ key, type, allowedValues, min, max, default: defaultValue }) => {
    const metadata: HomeSettingsMetadata[number] = { key, type, default: defaultValue };
    if (allowedValues) metadata.allowedValues = (allowedValues as readonly unknown[]).filter(
      (value) => typeof value === 'string',
    ) as string[];
    if (typeof min === 'number') metadata.min = min;
    if (typeof max === 'number') metadata.max = max;
    return metadata;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function getWritableHomeSettings(settings: HomeSettings): HomeSettings {
  return Object.fromEntries(HOME_SETTINGS_SCHEMA.map(({ key }) => [key, settings[key]])) as HomeSettings;
}

export function validateHomeSettingsPatch(value: unknown): Partial<HomeSettings> {
  if (!isRecord(value)) {
    throw new Error('Home settings update requests must include a settings patch object.');
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error('Home settings update requests must include at least one setting.');
  }

  const definitions = new Map(HOME_SETTINGS_SCHEMA.map((definition) => [definition.key, definition]));
  const patch: Partial<HomeSettings> = {};

  for (const [key, settingValue] of entries) {
    const definition = definitions.get(key as HomeSettingKey);
    if (!definition) {
      throw new Error(`Home setting ${key} is not writable.`);
    }
    const isAllowedValue = !definition.allowedValues || (definition.allowedValues as readonly unknown[]).includes(settingValue);
    const isInRange = typeof settingValue !== 'number' || (
      (typeof definition.min !== 'number' || settingValue >= definition.min) &&
      (typeof definition.max !== 'number' || settingValue <= definition.max)
    );
    if (!definition.validate(settingValue) || !isAllowedValue || !isInRange) {
      const range = typeof definition.min === 'number' ? ` between ${definition.min} and ${definition.max}` : '';
      throw new Error(`Home setting ${key} must be a valid ${definition.type}${range}.`);
    }
    Object.assign(patch, { [key]: settingValue });
  }

  return patch;
}

export function validateHomeSettings(value: unknown): HomeSettings {
  const settings = validateHomeSettingsPatch(value);
  for (const { key } of HOME_SETTINGS_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) {
      throw new Error(`Home settings response is missing ${key}.`);
    }
  }
  return settings as HomeSettings;
}

function formatHomeSettingValue(value: unknown) {
  return typeof value === 'string' ? value : String(value);
}

export function getHomeSettingsApprovalDetails(current: HomeSettings, patch: Partial<HomeSettings>) {
  return HOME_SETTINGS_SCHEMA.flatMap(({ key, label }) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return [];
    return [
      { label: `${label} (current)`, value: formatHomeSettingValue(current[key]) },
      { label: `${label} (proposed)`, value: formatHomeSettingValue(patch[key]) },
    ];
  });
}
