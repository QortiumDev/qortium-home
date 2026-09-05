// Renderer-facing type adapter for the pure bookmark-manager data contract.
// Home 2 shell files do not import from the Electron source tree directly.
export { SAVED_GUEST_ACCOUNT_ID } from '../electron/bookmark-manager-contract'
export type {
  BookmarkManagerFolder,
  BookmarkManagerLink,
  BookmarkManagerMutation,
  BookmarkManagerSnapshot,
  BookmarkManagerTreeItem,
} from '../electron/bookmark-manager-contract'
