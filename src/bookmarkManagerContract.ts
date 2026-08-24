// Renderer-facing type adapter for the pure bookmark-manager data contract.
// Home 2 shell files do not import from the Electron source tree directly.
export type {
  BookmarkManagerFolder,
  BookmarkManagerLink,
  BookmarkManagerSnapshot,
  BookmarkManagerTreeItem,
} from '../electron/bookmark-manager-contract'
