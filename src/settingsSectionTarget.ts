export type SettingsSectionId = 'core' | 'display' | 'home' | 'node' | 'notifications' | 'qdnApps';

// Retain the former App Notifications Settings target for dashboard links and
// other callers while rendering the controls in the unified QDN Apps section.
export function resolveSettingsSectionTarget(sectionId: SettingsSectionId) {
  return sectionId === 'notifications' ? 'qdnApps' : sectionId;
}
