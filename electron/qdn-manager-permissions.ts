/**
 * User-owned QDN app assignments and durable, app-scoped capabilities.
 *
 * An assignment is only a launch/routing preference. It never grants an app
 * access to Home data. Capabilities are granted separately to the stable QDN
 * resource identity that requested them.
 */
export const QDN_MANAGER_CAPABILITIES = ['bookmarks.manage', 'notifications.manage'] as const;
/**
 * Durable per-app, per-account permission to send chat on the user's behalf, granted by
 * choosing "always allow" on a send prompt and revocable in QDN Apps settings.
 * Deliberately covers chat sends only — publishing, unlocking, group admin and
 * private-group key rotation are never grantable this way.
 */
export const QDN_APP_SEND_CAPABILITIES = ['chat.send'] as const;
/**
 * Durable per-app permission for the read-only account family, granted by
 * choosing "always allow" on an account-read prompt and revocable in QDN Apps
 * settings.
 *
 * Deliberately ONE capability for the whole family. It is the durable twin of
 * the `account.read` session-grant family in home-v2-session-grants.ts, which
 * is itself protocol- and route-independent, so a single approval covers the
 * family on both Qortal and Qortium. The family members that still prompt
 * today are the private-group chat reads and the chat-attachment reads;
 * granting this covers all of them at once, and the prompt says so.
 *
 * Deliberately READS ONLY. Membership is exactly the frozen
 * HOME_V2_ACCOUNT_READ_ACTIONS list, so nothing that sends, signs, publishes,
 * unlocks the account, administers a group or rotates a private-group key can
 * be reached through it — those keep prompting, and the minting writes and
 * publishes stay single-request.
 */
export const QDN_APP_READ_CAPABILITIES = ['account.read'] as const;
/**
 * Durable per-app permission to encrypt with the account's key (ENCRYPT_DATA),
 * granted by choosing "always allow" on an encryption prompt and revocable in
 * QDN Apps settings.
 *
 * Its OWN capability, deliberately not a member of the read family above. An
 * "always allow" the user gave for READING their account must never widen into
 * use of the KEY — home-v2-session-grants.test.ts pins ENCRYPT_DATA out of the
 * account.read family for exactly this reason, and giving it a separate
 * capability is what keeps the two grants, and the two revocation cards,
 * distinct.
 *
 * Durable is safe here because encryption is not an oracle: it consumes the
 * private key but returns only ciphertext, no request shape makes it decrypt
 * or reveal a shared secret, and its output is inert until some other action
 * publishes or sends it — each of which prompts separately.
 */
export const QDN_APP_ENCRYPT_CAPABILITIES = ['account.encrypt'] as const;
/**
 * Durable per-app permission to DECRYPT with the account's key (DECRYPT_DATA).
 *
 * Separate from account.encrypt, and not merged with it, because they are not
 * the same power. Encryption returns ciphertext and is inert until some other
 * approved action moves it; decryption returns PLAINTEXT and is an oracle over
 * any ciphertext the app can get hold of. A user who allowed an app to encrypt
 * has not thereby allowed it to read.
 *
 * Durable is still right: what an app may decrypt is bounded to data addressed
 * to this account that the app already possesses, it cannot send or publish
 * what it reads without a separate approval, and the alternative — a click per
 * message — is what makes encrypted apps unusable. See
 * qdn-app-exfiltration-channel-2026-08-28.md on the limit that a hostile
 * SERVING NODE sees plaintext regardless, which is a node-trust question
 * rather than a grant-scope one.
 */
export const QDN_APP_DECRYPT_CAPABILITIES = ['account.decrypt'] as const;
/**
 * Capabilities stored per (app principal, selected account) rather than per
 * app alone.
 *
 * account.read is account-scoped because the prompt that grants it names one
 * account and describes that account's data. Keying it by app alone would let
 * a grant approved while account A was selected silently cover account B after
 * a switch - which is exactly why the SESSION grant for this family is dropped
 * on `account-changed` (see home-v2-session-grants.ts). The durable grant now
 * follows the same rule instead of outliving it.
 *
 * chat.send also names one account. Legacy app-wide chat-send approvals are
 * discarded on read and must be confirmed again for each account. Manager
 * capabilities remain app-scoped because they manage Home data, not an account.
 */
/**
 * Reading this account's DIRECT MESSAGES, durably.
 *
 * Separate from account.decrypt: direct chat uses a per-conversation key
 * derived from an X25519 shared secret, not the envelope family, and an app
 * allowed to decrypt data it already holds has not thereby been allowed to read
 * a mailbox.
 *
 * Usable on any node route since 2026-09-01 (the former local-Core-only rule
 * rested on a false premise: these reads fetch ciphertext and decrypt inside
 * Home, so a serving node never sees message plaintext). Note the direct-read
 * actions themselves are permissionless (2026-08-24), so this capability is
 * presently vestigial; it stays defined and listed so any held grant remains
 * visible and revocable.
 */
export const QDN_APP_DIRECT_CHAT_CAPABILITIES = ['account.directChat'] as const;
/**
 * Reading private-GROUP chat history, on the same terms as account.directChat.
 *
 * Separate from account.directChat on purpose. They are different bodies of
 * material: an app that a user is happy to let read their group chats has not
 * thereby been trusted with their one-to-one messages, and the reverse holds
 * too. Folding them into one capability would mean a grant for either silently
 * covering both, and neither prompt says that.
 *
 * Stored and honored on ANY node route (owner decision, 2026-09-01; the
 * former local-Core-only rule rested on the false premise that a serving
 * node sees plaintext -- group history is fetched as ciphertext and
 * decrypted inside Home). A public route still observes access metadata,
 * exactly as it did under the route-independent session grant; the durable
 * form extends the observation horizon, which the decision accepted.
 * Revocable in Settings > QDN Apps.
 */
export const QDN_APP_GROUP_CHAT_CAPABILITIES = ['account.groupChat'] as const;
export const QDN_ACCOUNT_SCOPED_CAPABILITIES = [
  'chat.send',
  'account.read',
  'account.encrypt',
  'account.decrypt',
  'account.directChat',
  'account.groupChat',
] as const;
export type QdnAccountScopedCapability = (typeof QDN_ACCOUNT_SCOPED_CAPABILITIES)[number];

export function isQdnAccountScopedCapability(
  value: string,
): value is QdnAccountScopedCapability {
  return (QDN_ACCOUNT_SCOPED_CAPABILITIES as readonly string[]).includes(value);
}
export const QDN_APP_ASSIGNMENT_CAPABILITIES = ['assignments.read'] as const;
export const QDN_APP_CAPABILITIES = [
  ...QDN_MANAGER_CAPABILITIES,
  ...QDN_APP_ASSIGNMENT_CAPABILITIES,
  ...QDN_APP_SEND_CAPABILITIES,
  ...QDN_APP_READ_CAPABILITIES,
  ...QDN_APP_ENCRYPT_CAPABILITIES,
  ...QDN_APP_DECRYPT_CAPABILITIES,
  ...QDN_APP_DIRECT_CHAT_CAPABILITIES,
  ...QDN_APP_GROUP_CHAT_CAPABILITIES,
] as const;

export type QdnManagerCapability = (typeof QDN_MANAGER_CAPABILITIES)[number];
export type QdnAppCapability = (typeof QDN_APP_CAPABILITIES)[number];

export const DEFAULT_BOOKMARKS_MANAGER_URL = 'qdn://APP/Bookmarks/Bookmarks';
export const DEFAULT_NOTIFICATIONS_MANAGER_URL = 'qdn://APP/Notify/Notify';
export const DEFAULT_EXPLORE_APP_URL = 'qdn://APP/Explore/Explore';
/**
 * Both segments are spelled out on purpose. The published resource is name
 * "Apps" with identifier "Apps"; a bare `qdn://APP/Apps` would normalize to the
 * identifier `default`, which is NOT published, so the app would fail to load.
 */
export const DEFAULT_APPS_APP_URL = 'qdn://APP/Apps/Apps';

export const QDN_DEFAULT_APP_ASSIGNMENTS = {
  bookmarks: { description: 'App used when Home opens bookmarks.', label: 'Bookmarks', url: DEFAULT_BOOKMARKS_MANAGER_URL },
  notifications: { description: 'App used to manage Home notifications.', label: 'Notifications', url: DEFAULT_NOTIFICATIONS_MANAGER_URL },
  explore: { description: 'App used when Home opens QDN Explore.', label: 'Explore', url: DEFAULT_EXPLORE_APP_URL },
  apps: { description: 'App used when Home opens the app directory.', label: 'Apps', url: DEFAULT_APPS_APP_URL },
} as const;

export type QdnAppAssignment = {
  description: string | null;
  label: string;
  // The full QDN URL is preserved, including a path, query, and fragment.
  url: string | null;
};

export type QdnAppAssignmentsStore = {
  // principal -> selected account id -> capability. Separate from
  // capabilityGrants so that binding a capability to an account is an additive
  // change: an existing v2 store with no accountCapabilityGrants simply holds
  // no account-scoped grants, and app-scoped capabilities keep their keying.
  accountCapabilityGrants: Record<
    string,
    Record<string, Partial<Record<QdnAccountScopedCapability, { grantedAt: string }>>>
  >;
  assignments: Record<string, QdnAppAssignment>;
  capabilityGrants: Record<string, Partial<Record<QdnAppCapability, { grantedAt: string }>>>;
  // Kept for the one-time import from the pre-assignments stores.
  legacyMigrated: boolean;
  revision: number;
  version: 2;
};

// Kept as a type alias while renderer/desktop migration call sites move to the
// generic name. It intentionally no longer has a fixed `roles` record.
export type QdnAppRolesStore = QdnAppAssignmentsStore;

const APP_KEY_MAX_LENGTH = 2_048;
const ROLE_ID_MAX_LENGTH = 120;
const ROLE_LABEL_MAX_LENGTH = 80;
const ROLE_DESCRIPTION_MAX_LENGTH = 280;
// R4-4: GAME joined APP and WEBSITE here for the same reason as
// QDN_PRINCIPAL_PATTERN below — all three are app-tab content now.
const QDN_TARGET_PATTERN = /^qdn:\/\/(APP|WEBSITE|GAME)\/([^/?#]+)(?:\/([^/?#]+))?((?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?)$/i;
const ROLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const MAX_ASSIGNMENTS = 100;
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is required.`);
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${field} is invalid.`);
  }
  return text;
}

export function sanitizeQdnAppAssignmentRole(value: unknown): string {
  const role = sanitizeText(value, ROLE_ID_MAX_LENGTH, 'Assignment role').toLowerCase();
  if (!ROLE_ID_PATTERN.test(role) || UNSAFE_RECORD_KEYS.has(role)) {
    throw new Error('Assignment role must be a stable lowercase identifier.');
  }
  return role;
}

export function sanitizeQdnAppAssignmentLabel(value: unknown, role: string): string {
  if (typeof value === 'undefined' || value === null || value === '') return role;
  return sanitizeText(value, ROLE_LABEL_MAX_LENGTH, 'Assignment label');
}

export function sanitizeQdnAppAssignmentDescription(value: unknown): string | null {
  if (typeof value === 'undefined' || value === null || value === '') return null;
  return sanitizeText(value, ROLE_DESCRIPTION_MAX_LENGTH, 'Assignment description');
}

/** Validates a complete APP/WEBSITE URL without discarding its app route. */
export function sanitizeQdnAppAssignmentUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Assignment URL is required.');
  const url = value.trim();
  const match = QDN_TARGET_PATTERN.exec(url);
  if (!url || url.length > APP_KEY_MAX_LENGTH || /[\u0000-\u001f\u007f\s]/.test(url) || !match) {
    throw new Error('Assignment URL must be a valid QDN APP or WEBSITE resource URL.');
  }
  return `qdn://${match[1].toUpperCase()}/${match[2]}${match[3] ? `/${match[3]}` : ''}${match[4]}`;
}

/** Stable app identity for capability grants; intentionally omits app routing. */
export function sanitizeQdnManagerAppKey(value: unknown): string {
  const target = sanitizeQdnAppAssignmentUrl(value);
  const match = QDN_TARGET_PATTERN.exec(target);
  if (!match) throw new Error('App key must be a valid QDN APP or WEBSITE resource URL.');
  return `qdn://${match[1].toUpperCase()}/${match[2]}${match[3] ? `/${match[3]}` : ''}`;
}

// Accepts both schemes. `qortal://` is a real runtime value for Qortal-routed
// apps: sanitizeQdnManagerAppKey rejects it outright, which made a durable
// grant throw during persistence and fail the action the user had just
// approved. The scheme is PRESERVED, so same-named resources on different
// chains can never borrow each other's grants.
// R4-4: GAME joined APP and WEBSITE. Home opens all three browser-archive
// services as app tabs, so all three can reach a capability prompt; a pattern
// narrower than the set made `sanitizeQdnCapabilityPrincipal` THROW when a
// GAME app's grant was persisted, failing the action the user had just
// approved (the same class of bug the qortal:// note above records).
const QDN_PRINCIPAL_PATTERN =
  /^(qdn|qortal):\/\/(APP|WEBSITE|GAME)\/([^/?#]+)(?:\/([^/?#]+))?(?:\/[^?#]*)?(\?[^#]*)?(?:#.*)?$/i;

/**
 * Resolves the identifier the runtime would actually serve.
 *
 * This is a deliberate mirror of resolveCandidateIdentifier in
 * qdn-resource-identity.ts (and its render-path-identity.ts / QdnRenderProxy
 * twins). It is pinned against the same shared fixture,
 * src/shared-fixtures/qdn-render-candidate-identifier-vectors.json, so a
 * grant principal can never disagree with the resource Core serves.
 *
 * Three details are load-bearing and easy to get wrong:
 * - the winning value is used UNTRIMMED. `?identifier=%20evil` names the
 *   identifier " evil", a DIFFERENT resource from "evil"; trimming here would
 *   collapse them onto one grant.
 * - the "default" sentinel is compared EXACTLY, not case-insensitively. Core
 *   reserves only the exact lowercase string (ArbitraryDataTransactionBuilder),
 *   so "DEFAULT" names a real, distinct resource. Folding case here let a
 *   grant approved for .../DEFAULT persist under the no-identifier base
 *   principal, handing the base resource an approval it never received.
 *   Where this is stricter than the render-path twin it is stricter in the
 *   fail-closed direction: at worst the user is asked again.
 * - the sentinel applies to WHICHEVER value wins, query or path. Applying it
 *   to only one of them made canonicalization non-idempotent, and the store
 *   re-canonicalizes stored keys on read, so a second pass silently moved a
 *   grant to a different principal than the one it was written under.
 */
export function resolveQdnCapabilityIdentifier(
  pathIdentifier: string | null,
  queryIdentifier: string | null,
): string | null {
  const candidate = queryIdentifier !== null && queryIdentifier.trim() !== ''
    ? queryIdentifier
    : pathIdentifier;
  if (candidate === null || candidate === 'default') return null;
  return candidate;
}

const CAPABILITY_IDENTIFIER_MAX_LENGTH = 128;

/**
 * Canonical principal a durable capability grant is keyed by.
 *
 * Unlike sanitizeQdnManagerAppKey this resolves the EFFECTIVE identifier the
 * way the runtime does, so `?identifier=` cannot be discarded. Keying on the
 * path alone collapsed `qdn://APP/Chat/default` and
 * `qdn://APP/Chat/default?identifier=evil` onto one principal, letting the
 * second resource silently inherit the first one's durable grant.
 *
 * Everything that does NOT change which resource is served is dropped: the
 * in-app route path, the hash, and every other query parameter. A grant
 * therefore follows an app across its own navigation, and only across that.
 *
 * Fails closed. Anything unparseable throws, which makes a capability CHECK
 * answer false (so the user is prompted) rather than accidentally match.
 */
export function sanitizeQdnCapabilityPrincipal(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Capability principal is required.');
  const url = value.trim();
  const match = QDN_PRINCIPAL_PATTERN.exec(url);
  if (
    !url ||
    url.length > APP_KEY_MAX_LENGTH ||
    // Literal whitespace is rejected in the RAW url. A percent-encoded
    // space is not: `?identifier=%20evil` decodes to the distinct
    // identifier " evil", which the runtime serves as its own resource.
    /[\u0000-\u001f\u007f\s]/.test(url) ||
    !match
  ) {
    throw new Error('Capability principal must be a valid QDN APP, WEBSITE, or GAME resource URL.');
  }
  const scheme = match[1].toLowerCase();
  const type = match[2].toUpperCase();
  const name = match[3];
  const query = match[5];
  const queryIdentifier = query
    ? new URLSearchParams(query.slice(1)).get('identifier')
    : null;
  const identifier = resolveQdnCapabilityIdentifier(match[4] ?? null, queryIdentifier);
  // The identifier is embedded verbatim in the returned principal, so anything
  // that would not survive re-parsing that principal is refused rather than
  // stored. Whitespace is the important case: `?identifier=%20evil` decodes to
  // " evil", which would produce a principal the raw-URL check then rejects,
  // making sanitize() non-idempotent and silently dropping the grant on
  // read-back. Refusing here is fail-closed - the caller falls back to a
  // session grant and the user is asked again next session.
  if (identifier !== null && (
    !identifier ||
    identifier.length > CAPABILITY_IDENTIFIER_MAX_LENGTH ||
    /[\u0000-\u001f\u007f\s]/.test(identifier) ||
    /[/?#]/.test(identifier)
  )) {
    throw new Error('Capability principal identifier is invalid.');
  }
  return `${scheme}://${type}/${name}${identifier !== null ? `/${identifier}` : ''}`;
}

const GRANT_ACCOUNT_ID_MAX_LENGTH = 240;

/**
 * The selected-account identity a durable account-scoped grant is bound to.
 * Bounded and control-character free so it is safe as a persisted record key.
 */
export function sanitizeQdnGrantAccountId(value: unknown): string {
  const accountId = sanitizeText(value, GRANT_ACCOUNT_ID_MAX_LENGTH, 'Grant account');
  if (UNSAFE_RECORD_KEYS.has(accountId)) throw new Error('Grant account is invalid.');
  return accountId;
}

export function isQdnAppCapability(value: unknown): value is QdnAppCapability {
  return typeof value === 'string' && (QDN_APP_CAPABILITIES as readonly string[]).includes(value);
}

export function isQdnManagerCapability(value: unknown): value is QdnManagerCapability {
  return typeof value === 'string' && (QDN_MANAGER_CAPABILITIES as readonly string[]).includes(value);
}

function defaultAssignments(): Record<string, QdnAppAssignment> {
  return Object.fromEntries(Object.entries(QDN_DEFAULT_APP_ASSIGNMENTS).map(([role, assignment]) => [role, {
    description: assignment.description,
    label: assignment.label,
    url: assignment.url,
  }]));
}

export function createDefaultQdnAppRolesStore(): QdnAppAssignmentsStore {
  return {
    accountCapabilityGrants: {},
    assignments: defaultAssignments(),
    capabilityGrants: {},
    legacyMigrated: true,
    revision: 0,
    version: 2,
  };
}

function sanitizeGrantedAt(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function sanitizeAssignment(role: string, value: unknown, fallback?: QdnAppAssignment): QdnAppAssignment | null {
  if (!isRecord(value)) return fallback ?? null;
  const label = sanitizeQdnAppAssignmentLabel(value.label, role);
  const description = sanitizeQdnAppAssignmentDescription(value.description);
  if (value.url === null) return { description, label, url: null };
  try {
    return { description, label, url: sanitizeQdnAppAssignmentUrl(value.url) };
  } catch {
    return fallback ?? null;
  }
}

function sanitizeCapabilityGrants(value: unknown) {
  const grants: QdnAppAssignmentsStore['capabilityGrants'] = {};
  if (!isRecord(value)) return grants;
  for (const [rawAppKey, rawCapabilities] of Object.entries(value)) {
    let appKey: string;
    try { appKey = sanitizeQdnManagerAppKey(rawAppKey); } catch { continue; }
    if (!isRecord(rawCapabilities)) continue;
    const safeCapabilities: Partial<Record<QdnAppCapability, { grantedAt: string }>> = {};
    for (const capability of QDN_APP_CAPABILITIES) {
      // An old app-wide send approval cannot identify the account the user
      // intended. Never expand it into grants for current or future accounts.
      if (capability === 'chat.send') continue;
      const rawGrant = rawCapabilities[capability];
      const grantedAt = isRecord(rawGrant) ? sanitizeGrantedAt(rawGrant.grantedAt) : null;
      if (grantedAt) safeCapabilities[capability] = { grantedAt };
    }
    if (Object.keys(safeCapabilities).length) grants[appKey] = safeCapabilities;
  }
  return grants;
}

function sanitizeAccountCapabilityGrants(value: unknown) {
  const grants: QdnAppAssignmentsStore['accountCapabilityGrants'] = {};
  if (!isRecord(value)) return grants;
  for (const [rawPrincipal, rawAccounts] of Object.entries(value)) {
    let principal: string;
    // Re-canonicalize on read: a stored key that no longer canonicalizes is
    // dropped rather than trusted, so a principal written by an older or
    // tampered-with store cannot widen a grant.
    try { principal = sanitizeQdnCapabilityPrincipal(rawPrincipal); } catch { continue; }
    if (!isRecord(rawAccounts)) continue;
    const safeAccounts: Record<string, Partial<Record<QdnAccountScopedCapability, { grantedAt: string }>>> = {};
    for (const [rawAccountId, rawCapabilities] of Object.entries(rawAccounts)) {
      let accountId: string;
      try { accountId = sanitizeQdnGrantAccountId(rawAccountId); } catch { continue; }
      if (!isRecord(rawCapabilities)) continue;
      const safeCapabilities: Partial<Record<QdnAccountScopedCapability, { grantedAt: string }>> = {};
      for (const capability of QDN_ACCOUNT_SCOPED_CAPABILITIES) {
        const rawGrant = rawCapabilities[capability];
        const grantedAt = isRecord(rawGrant) ? sanitizeGrantedAt(rawGrant.grantedAt) : null;
        if (grantedAt) safeCapabilities[capability] = { grantedAt };
      }
      if (Object.keys(safeCapabilities).length) safeAccounts[accountId] = safeCapabilities;
    }
    if (Object.keys(safeAccounts).length) grants[principal] = safeAccounts;
  }
  return grants;
}

function migrateVersionOneStore(value: Record<string, unknown>): QdnAppAssignmentsStore {
  const store = createDefaultQdnAppRolesStore();
  store.legacyMigrated = value.legacyMigrated !== false;
  if (!isRecord(value.roles)) return store;
  const legacyRoles: Array<[string, QdnManagerCapability, string]> = [
    ['bookmarksManager', 'bookmarks.manage', 'bookmarks'],
    ['notificationsManager', 'notifications.manage', 'notifications'],
  ];
  for (const [legacyRole, capability, role] of legacyRoles) {
    const rawRole = value.roles[legacyRole];
    if (!isRecord(rawRole)) continue;
    if (rawRole.url === null) {
      const existing = store.assignments[role];
      store.assignments[role] = { ...existing, url: null };
      continue;
    }
    let url: string;
    try { url = sanitizeQdnAppAssignmentUrl(rawRole.url); } catch { continue; }
    const existing = store.assignments[role];
    store.assignments[role] = { ...existing, url };
    // v1 tied a grant to being the current role holder. That guarantee no
    // longer exists in v2, so do not silently widen an old appointment into a
    // durable independent capability. The app can ask the user again.
    void capability;
  }
  return store;
}

/** Reads untrusted persisted data, including the old fixed-manager v1 store. */
export function sanitizeQdnAppRolesStore(value: unknown): QdnAppAssignmentsStore {
  if (!isRecord(value)) return createDefaultQdnAppRolesStore();
  if (value.version === 1) return migrateVersionOneStore(value);
  if (value.version !== 2 || !isRecord(value.assignments)) return createDefaultQdnAppRolesStore();

  const store = createDefaultQdnAppRolesStore();
  store.legacyMigrated = value.legacyMigrated !== false;
  store.revision = Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 ? value.revision as number : 0;
  for (const [rawRole, rawAssignment] of Object.entries(value.assignments).slice(0, MAX_ASSIGNMENTS)) {
    let role: string;
    try { role = sanitizeQdnAppAssignmentRole(rawRole); } catch { continue; }
    const assignment = sanitizeAssignment(role, rawAssignment, store.assignments[role]);
    if (assignment) store.assignments[role] = assignment;
  }
  store.capabilityGrants = sanitizeCapabilityGrants(value.capabilityGrants);
  store.accountCapabilityGrants = sanitizeAccountCapabilityGrants(value.accountCapabilityGrants);
  return store;
}

export function getQdnAppAssignment(store: QdnAppAssignmentsStore, role: string): QdnAppAssignment | null {
  try { return store.assignments[sanitizeQdnAppAssignmentRole(role)] ?? null; } catch { return null; }
}

export function setQdnAppAssignment(
  store: QdnAppAssignmentsStore,
  input: { description?: unknown; label?: unknown; role: unknown; url: unknown },
) {
  const role = sanitizeQdnAppAssignmentRole(input.role);
  const current = store.assignments[role];
  if (!current && Object.keys(store.assignments).length >= MAX_ASSIGNMENTS) {
    throw new Error(`Home supports at most ${MAX_ASSIGNMENTS} app assignments.`);
  }
  const next: QdnAppAssignment = {
    description: sanitizeQdnAppAssignmentDescription(input.description ?? current?.description),
    label: sanitizeQdnAppAssignmentLabel(input.label ?? current?.label, role),
    url: sanitizeQdnAppAssignmentUrl(input.url),
  };
  if (JSON.stringify(current) === JSON.stringify(next)) return store;
  return {
    ...store,
    assignments: { ...store.assignments, [role]: next },
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

export function clearQdnAppAssignment(store: QdnAppAssignmentsStore, roleValue: unknown) {
  const role = sanitizeQdnAppAssignmentRole(roleValue);
  const current = store.assignments[role];
  if (!current || current.url === null) return store;
  return {
    ...store,
    assignments: { ...store.assignments, [role]: { ...current, url: null } },
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

export function storeHoldsQdnAppCapability(store: QdnAppAssignmentsStore, appKeyValue: unknown, capability: QdnAppCapability) {
  if (capability === 'chat.send') return false;
  let appKey: string;
  try { appKey = sanitizeQdnManagerAppKey(appKeyValue); } catch { return false; }
  return !!store.capabilityGrants[appKey]?.[capability];
}

export function storeHoldsQdnManagerPermission(store: QdnAppAssignmentsStore, appKey: string, capability: QdnManagerCapability) {
  return storeHoldsQdnAppCapability(store, appKey, capability);
}

export function grantQdnAppCapability(store: QdnAppAssignmentsStore, appKeyValue: unknown, capability: QdnAppCapability) {
  if (capability === 'chat.send') throw new Error('Chat-send approval requires an account.');
  const appKey = sanitizeQdnManagerAppKey(appKeyValue);
  if (storeHoldsQdnAppCapability(store, appKey, capability)) return store;
  return {
    ...store,
    capabilityGrants: {
      ...store.capabilityGrants,
      [appKey]: { ...(store.capabilityGrants[appKey] ?? {}), [capability]: { grantedAt: new Date().toISOString() } },
    },
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

/**
 * Account-scoped durable capabilities.
 *
 * Every one of these resolves the app principal through
 * sanitizeQdnCapabilityPrincipal (so `?identifier=` cannot be collapsed away,
 * and `qortal://` is accepted) and binds the grant to one selected account.
 * A check therefore misses when EITHER the effective resource identifier or
 * the selected account differs from the one the user approved.
 */
export function storeHoldsQdnAccountCapability(
  store: QdnAppAssignmentsStore,
  principalValue: unknown,
  accountIdValue: unknown,
  capability: QdnAccountScopedCapability,
) {
  let principal: string;
  let accountId: string;
  try {
    principal = sanitizeQdnCapabilityPrincipal(principalValue);
    accountId = sanitizeQdnGrantAccountId(accountIdValue);
  } catch { return false; }
  return !!store.accountCapabilityGrants[principal]?.[accountId]?.[capability];
}

export function grantQdnAccountCapability(
  store: QdnAppAssignmentsStore,
  principalValue: unknown,
  accountIdValue: unknown,
  capability: QdnAccountScopedCapability,
) {
  const principal = sanitizeQdnCapabilityPrincipal(principalValue);
  const accountId = sanitizeQdnGrantAccountId(accountIdValue);
  if (storeHoldsQdnAccountCapability(store, principal, accountId, capability)) return store;
  const accounts = store.accountCapabilityGrants[principal] ?? {};
  return {
    ...store,
    accountCapabilityGrants: {
      ...store.accountCapabilityGrants,
      [principal]: {
        ...accounts,
        [accountId]: {
          ...(accounts[accountId] ?? {}),
          [capability]: { grantedAt: new Date().toISOString() },
        },
      },
    },
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

export function revokeQdnAccountCapability(
  store: QdnAppAssignmentsStore,
  principalValue: unknown,
  accountIdValue: unknown,
  capability: QdnAccountScopedCapability,
) {
  const principal = sanitizeQdnCapabilityPrincipal(principalValue);
  const accountId = sanitizeQdnGrantAccountId(accountIdValue);
  if (!storeHoldsQdnAccountCapability(store, principal, accountId, capability)) return store;
  const nextCapabilities = { ...store.accountCapabilityGrants[principal]?.[accountId] };
  delete nextCapabilities[capability];
  const nextAccounts = { ...store.accountCapabilityGrants[principal] };
  if (Object.keys(nextCapabilities).length) nextAccounts[accountId] = nextCapabilities;
  else delete nextAccounts[accountId];
  const accountCapabilityGrants = { ...store.accountCapabilityGrants };
  if (Object.keys(nextAccounts).length) accountCapabilityGrants[principal] = nextAccounts;
  else delete accountCapabilityGrants[principal];
  return {
    ...store,
    accountCapabilityGrants,
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

/** Every (app, account) pair holding one account-scoped capability. */
export function listQdnAccountCapabilityGrants(
  store: QdnAppAssignmentsStore,
  capability: QdnAccountScopedCapability,
): readonly { accountId: string; appKey: string; grantedAt: string }[] {
  return Object.entries(store.accountCapabilityGrants)
    .flatMap(([appKey, accounts]) => Object.entries(accounts).flatMap(([accountId, capabilities]) => {
      const grant = capabilities[capability];
      return grant ? [{ accountId, appKey, grantedAt: grant.grantedAt }] : [];
    }))
    .sort((left, right) => left.appKey.localeCompare(right.appKey) ||
      left.accountId.localeCompare(right.accountId));
}

export function revokeQdnAppCapability(store: QdnAppAssignmentsStore, appKeyValue: unknown, capability: QdnAppCapability) {
  const appKey = sanitizeQdnManagerAppKey(appKeyValue);
  if (!storeHoldsQdnAppCapability(store, appKey, capability)) return store;
  const nextCapabilities = { ...store.capabilityGrants[appKey] };
  delete nextCapabilities[capability];
  const capabilityGrants = { ...store.capabilityGrants };
  if (Object.keys(nextCapabilities).length) capabilityGrants[appKey] = nextCapabilities;
  else delete capabilityGrants[appKey];
  return {
    ...store,
    capabilityGrants,
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

// Legacy stores predate the generic v2 schema. Preserve the chosen bookmarks
// target, but intentionally do not carry over manager grants: v1 grants were
// appointments tied to one role, whereas v2 capabilities are independent.
export function migrateLegacyQdnAppStores(legacyPermissions: unknown, legacyPreferredApps: unknown): QdnAppAssignmentsStore {
  let next = createDefaultQdnAppRolesStore();
  const preferred = isRecord(legacyPreferredApps) ? legacyPreferredApps.bookmarksManager : undefined;
  if (typeof preferred === 'string') {
    try { next = setQdnAppAssignment(next, { role: 'bookmarks', url: preferred }); } catch { /* default */ }
  }
  void legacyPermissions;
  return next;
}

// The former renderer-side preferred-bookmarks migration remains a harmless
// compatibility seam; it now changes only the bookmarks assignment.
export function applyLegacyPreferredBookmarksUrl(store: QdnAppAssignmentsStore, legacyPreferredApps: unknown) {
  if (store.legacyMigrated || !isRecord(legacyPreferredApps)) return store;
  try { return setQdnAppAssignment(store, { role: 'bookmarks', url: legacyPreferredApps.bookmarksManager }); }
  catch { return store; }
}

export function isTrustedQdnAppRolesSender(input: {
  senderId: number;
  isQdnView: boolean;
  shellWindowWebContentsIds: readonly number[];
}): boolean {
  return !input.isQdnView && input.shellWindowWebContentsIds.includes(input.senderId);
}
