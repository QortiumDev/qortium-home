// Pure, platform-agnostic QDN app-bridge action-name lists — the single source of
// truth for the `qdnRequest` action surface. Imported by BOTH the Electron
// main-process bridge (electron/qdn.ts) and the renderer/Android fallback bridge
// (src/platform.ts) so the action names are defined in exactly one place.
//
// This file MUST stay pure string-literal data: no Electron, Node, DOM, or
// Capacitor imports, no runtime logic. That is what lets the renderer import it
// (via Vite/Bundler) and the Electron main process import it (via NodeNext)
// without dragging platform-specific code into the wrong build graph. The
// platform-specific request/sign/approval handlers stay separate by design.

export const QDN_WRITE_ACTIONS = ['PUBLISH_MULTIPLE_QDN_RESOURCES', 'PUBLISH_QDN_RESOURCE', 'DELETE_QDN_RESOURCE'] as const;
export const QDN_GROUP_ACTIONS = [
  'ADD_GROUP_ADMIN',
  'APPROVE_GROUP_JOIN_REQUEST',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'CREATE_GROUP',
  'GROUP_APPROVAL',
  'GROUP_BAN',
  'GROUP_KICK',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'LEAVE_GROUP',
  'REMOVE_GROUP_ADMIN',
  'SET_GROUP',
  'UPDATE_GROUP',
] as const;
export const QDN_NAME_ACTIONS = [
  'BUY_NAME',
  'CANCEL_SELL_NAME',
  'REGISTER_NAME',
  'SELL_NAME',
  'UPDATE_NAME',
] as const;
// PAYMENT and SEND_COIN are aliases for the same coin-transfer transaction.
export const QDN_PAYMENT_ACTIONS = ['PAYMENT', 'SEND_COIN', 'TRANSFER_ASSET'] as const;
export const QDN_POLL_ACTIONS = ['CREATE_POLL', 'UPDATE_POLL', 'VOTE_ON_POLL'] as const;
export const QDN_TRUST_ACTIONS = ['RATE_ACCOUNT'] as const;
export const QDN_CHAT_ACTIONS = ['SEND_CHAT_MESSAGE'] as const;
export const QDN_PRIVATE_GROUP_CHAT_READ_ACTIONS = [
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
] as const;
export const QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS = [
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
] as const;
export const QDN_PRIVATE_DIRECT_CHAT_READ_ACTIONS = [
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
] as const;
export const QDN_APP_BRIDGE_ACTIONS = [
  'FETCH_NODE_API',
  'FETCH_QDN_RESOURCE',
  'FETCH_QORTAL_RESOURCE',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_GROUPS',
  'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
  'GET_ACCOUNT_NAMES',
  'GET_ACTIVE_CHATS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_BALANCE',
  'GET_GROUP',
  'GET_GROUP_BANS',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_KICKS',
  'GET_GROUP_MEMBERS',
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
  'GET_MINTING_STATUS',
  'GET_NAME_DATA',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_SELECTED_ACCOUNT',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_URL',
  'GET_QORTAL_RESOURCE_METADATA',
  'GET_QORTAL_RESOURCE_STATUS',
  'GET_QORTAL_RESOURCE_URL',
  'IS_USING_PUBLIC_NODE',
  'LIST_GROUPS',
  'LIST_QDN_RESOURCES',
  'OPEN_NEW_TAB',
  'OPEN_CURRENT_TAB',
  'OPEN_QDN_MEDIA_PLAYER',
  ...QDN_WRITE_ACTIONS,
  ...QDN_GROUP_ACTIONS,
  ...QDN_NAME_ACTIONS,
  ...QDN_PAYMENT_ACTIONS,
  ...QDN_POLL_ACTIONS,
  ...QDN_TRUST_ACTIONS,
  ...QDN_CHAT_ACTIONS,
  ...QDN_PRIVATE_DIRECT_CHAT_READ_ACTIONS,
  ...QDN_PRIVATE_GROUP_CHAT_READ_ACTIONS,
  ...QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS,
  'REMOVE_MINTING_ACCOUNT',
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_GROUPS',
  'SEARCH_QDN_RESOURCES',
  'SEARCH_QORTAL_RESOURCES',
  'START_MINTING',
  'UNLOCK_SELECTED_ACCOUNT',
  'WHICH_UI',
  'SHOW_ACTIONS',
] as const;
