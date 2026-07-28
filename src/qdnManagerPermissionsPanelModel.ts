import {
  QDN_DEFAULT_APP_ASSIGNMENTS,
  sanitizeQdnAppAssignmentRole,
  sanitizeQdnAppAssignmentUrl,
  type QdnAppAssignmentsStore,
} from '../electron/qdn-manager-permissions';

export type QdnAppAssignmentRow = {
  description: string | null;
  defaultUrl: string | null;
  label: string;
  role: string;
  url: string | null;
};

/** Lists Home defaults first, then user/app-created roles in stable order. */
export function getQdnAppAssignmentRows(store: QdnAppAssignmentsStore | null): QdnAppAssignmentRow[] {
  if (!store) return [];
  return Object.entries(store.assignments)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, assignment]) => ({
      ...assignment,
      defaultUrl: QDN_DEFAULT_APP_ASSIGNMENTS[role as keyof typeof QDN_DEFAULT_APP_ASSIGNMENTS]?.url ?? null,
      role,
    }));
}

export function getQdnAppAssignmentSaveState(value: string, currentUrl: string | null) {
  const trimmed = value.trim();
  if (!trimmed) return { changed: false, normalized: null, valid: false };
  try {
    const normalized = sanitizeQdnAppAssignmentUrl(trimmed);
    return { changed: normalized !== currentUrl, normalized, valid: true };
  } catch {
    return { changed: true, normalized: null, valid: false };
  }
}

export function getQdnAppAssignmentRoleSaveState(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { normalized: null, valid: false };
  try { return { normalized: sanitizeQdnAppAssignmentRole(trimmed), valid: true }; }
  catch { return { normalized: null, valid: false }; }
}
