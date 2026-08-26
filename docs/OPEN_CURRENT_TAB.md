# Add `OPEN_CURRENT_TAB` bridge action

> **Status: implemented, but not by the plan below.** This file is the original
> Home 1.x design note, and every file path in it (`electron/qdn.ts`,
> `electron/qdn-app-actions.ts`, `src/App.tsx`, `src/platform.ts`) belongs to
> the 1.x bridge. Home 2 ships `OPEN_CURRENT_TAB` through its own bridge:
> `electron/home-v2-app-actions.ts` (catalogue and the shared
> `normalizeHomeV2OpenAddress` validator), `electron/home-v2-app-bridge.ts`
> (desktop handler, bound to `context.tabId`), `src/home-v2-live/node-client.ts`
> (portable host), and the `replace-tab-app` reducer in `src/v2/product-model.ts`.
> Several contract points also differ on purpose:
>
> - Home 2 accepts `qdn://`, `qortal://` and `home://` rather than 1.x's
>   `core://` set.
> - It has no per-tab history model of its own — Back is the app view's own
>   navigation history, so the "push to history" design below does not apply.
> - **An explicit resource identifier is required.** The examples below pass
>   `qdn://APP/{publisherName}/Apps`, which is fine; a bare `qdn://APP/Name` is
>   rejected, because it can match several published resources and a bridge
>   call has no user to ask which one was meant. `OPEN_NEW_TAB` keeps the
>   chooser.
> - The replacement is a compare-and-swap against the requesting app's own
>   resource location, and it rebuilds the tab's app view instead of reusing
>   it, so the incoming app never inherits the previous app's browser storage.
>
> See [Bridge action notes](BRIDGE_ACTIONS.md) for the current contract; keep
> this file as the motivation record.

## Goal

Add a `OPEN_CURRENT_TAB` QDN bridge action that lets a Q-App navigate the
tab it is running in to a different QDN address, rather than always opening a
new tab. The new tab stays in the existing tab (pushing to its history so the
user can hit Back), and the tab becomes/stays active.

Contrast with `OPEN_NEW_TAB`, which always creates a brand-new tab.

## Motivation / use case

Browsium (`qortium-browser`) is a QDN app-discovery app. When a user clicks
"Open" on an app card, the natural UX is to load that app in-place (same tab)
rather than stacking an ever-growing tab bar. Without `OPEN_CURRENT_TAB`,
Browsium can only call `OPEN_NEW_TAB`.

General use cases:
- App browsers / launchers that want to "go to" an app
- Wizard-style flows that hand off between apps
- "Return to X" back-button patterns across apps

## Q-App usage (after this PR)

```ts
// Navigate the current tab to the Apps explorer
await qdnRequest({
  action: 'OPEN_CURRENT_TAB',
  address: 'qdn://APP/{publisherName}/Apps',
});

// Navigate to any resource (push to history, user can hit Back)
await qdnRequest({
  action: 'OPEN_CURRENT_TAB',
  address: `qdn://APP/${name}/${identifier}`,
});
```

Accepts the same URL formats as `OPEN_NEW_TAB`: `qdn://`, `home://`, `core://`.
Same 2 048-character length cap.

---

## Files to change (desktop IPC path — see the platform note at the end for Android)

### 1. `electron/qdn-app-actions.ts`

Add `'OPEN_CURRENT_TAB'` to `QDN_APP_BRIDGE_ACTIONS`.

```diff
 export const QDN_APP_BRIDGE_ACTIONS = [
   ...
   'OPEN_NEW_TAB',
   'OPEN_QDN_MEDIA_PLAYER',
+  'OPEN_CURRENT_TAB',
   ...
 ] as const;
```

The exact location is the block starting at line 52. Insert after `'OPEN_NEW_TAB'`
(line 85 in the current file) or anywhere in the array — order is not significant.

---

### 2. `electron/qdn.ts`

Add a new `case` immediately after the `'OPEN_NEW_TAB'` case (~line 5103).

The existing `'OPEN_NEW_TAB'` block ends at line 5103:
```ts
      hostWindow.webContents.send('qdn-app:open-new-tab', {
        address,
        sourceTabId: context.tabId,
      });

      return true;
    }

    case 'OPEN_QDN_MEDIA_PLAYER': {   // ← insert before this line
```

Insert this block between `OPEN_NEW_TAB` and `OPEN_QDN_MEDIA_PLAYER`:

```ts
    case 'OPEN_CURRENT_TAB': {
      const address =
        getString(getRequestValue(request, 'address')) || getString(getRequestValue(request, 'qdnUrl'));

      if (!address) {
        throw new Error('Address is required.');
      }

      if (!/^(qdn|home|core):\/\//i.test(address)) {
        throw new Error('OPEN_CURRENT_TAB only accepts qdn://, home://, and core:// addresses.');
      }

      if (address.length > QDN_OPEN_NEW_TAB_URL_MAX_LENGTH) {
        throw new Error('Address is too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN navigate current tab request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-current-tab', {
        address,
        sourceTabId: context.tabId,
      });

      return true;
    }
```

Everything (validation, constant reuse, IPC send) is identical to `OPEN_NEW_TAB`
— only the IPC channel name and the error message text differ.

---

### 3. `electron/preload.cts`

Add `onOpenCurrentTab` to the `qdnEvents` object, immediately after the
closing brace of `onOpenMediaPlayer` (~line 244), before the closing `},` of
`qdnEvents`:

```diff
       return () => {
         ipcRenderer.removeListener('qdn-app:open-media-player', listener);
       };
     },
+    onOpenCurrentTab: (callback: (event: { address: string; sourceTabId: string | null }) => void) => {
+      const listener = (
+        _event: Electron.IpcRendererEvent,
+        payload: { address: string; sourceTabId: string | null },
+      ) => {
+        callback(payload);
+      };
+
+      ipcRenderer.on('qdn-app:open-current-tab', listener);
+
+      return () => {
+        ipcRenderer.removeListener('qdn-app:open-current-tab', listener);
+      };
+    },
   },
 });
```

The pattern is an exact copy of `onOpenNewTab` with a different IPC channel name.

---

### 4. `src/vite-env.d.ts`

Add `onOpenCurrentTab` to the `qdnEvents` type (~line 699).

Current block:
```ts
    qdnEvents?: {
      onOpenNewTab: (
        callback: (event: { address: string; sourceTabId: string | null }) => void,
      ) => () => void;
      onOpenMediaPlayer: (
        callback: (event: QortiumQdnMediaPlayerRequest) => void,
      ) => () => void;
    };
```

After:
```ts
    qdnEvents?: {
      onOpenNewTab: (
        callback: (event: { address: string; sourceTabId: string | null }) => void,
      ) => () => void;
      onOpenMediaPlayer: (
        callback: (event: QortiumQdnMediaPlayerRequest) => void,
      ) => () => void;
      onOpenCurrentTab: (
        callback: (event: { address: string; sourceTabId: string | null }) => void,
      ) => () => void;
    };
```

---

### 5. `src/App.tsx`

Two additions.

#### 5a. Add a ref for the new function (~line 682, next to `openAppLinkInNewTabRef`)

```diff
   const openAppLinkInNewTabRef = useRef<
     ((address: string, sourceTabId: string | null) => void) | null
   >(null);
+  const openInCurrentTabRef = useRef<
+    ((address: string, sourceTabId: string | null) => void) | null
+  >(null);
   const openQdnMediaPlayerRef = useRef<...>
```

#### 5b. Add the `openInCurrentTab` function (~line 1306, after `openAppLinkInNewTab`)

```ts
  function openInCurrentTab(address: string, sourceTabId: string | null) {
    const parsed = parseAppAddress(address);

    if (!parsed.success) {
      console.warn('Ignoring QDN app request to navigate current tab to an unsupported address.', address);
      return;
    }

    setTabState((currentTabState) => {
      const targetTab = currentTabState.tabs.find((tab) => tab.id === sourceTabId);

      if (!targetTab) {
        console.warn('Could not find source tab for OPEN_CURRENT_TAB request.', sourceTabId);
        return currentTabState;
      }

      const currentEntry = targetTab.history.entries[targetTab.history.index] ?? null;
      const newHistory =
        currentEntry?.displayUrl === parsed.route.displayUrl
          ? targetTab.history
          : {
              entries: [...targetTab.history.entries.slice(0, targetTab.history.index + 1), parsed.route],
              index: targetTab.history.index + 1,
            };

      return {
        ...currentTabState,
        activeTabId: targetTab.id,
        tabs: currentTabState.tabs.map((tab) =>
          tab.id === targetTab.id ? { ...tab, history: newHistory } : tab,
        ),
      };
    });
  }
```

Key behaviour notes:
- Uses `setTabState` functional update (same as `openAppLinkInNewTab`) to avoid
  stale closure on `tabState`.
- **Pushes to history** (does not replace), so the user can navigate Back to
  return to the originating app. This mirrors how `navigateToRoute` works.
- Deduplicates: if the target URL is already the current entry, history is
  unchanged (same guard as `navigateToRoute`).
- Sets `activeTabId` to the source tab so it comes to the front even if the
  user had clicked away.

#### 5c. Wire up the ref and subscribe to the IPC event

Right after the `openAppLinkInNewTabRef` assignment and the `onOpenNewTab`
`useEffect` block (~line 1692–1694):

```diff
   // existing ref assignment pattern — find by searching "openAppLinkInNewTabRef.current ="
   openAppLinkInNewTabRef.current = openAppLinkInNewTab;
+  openInCurrentTabRef.current = openInCurrentTab;
```

And right after the `onOpenNewTab` `useEffect` (~line 1694):

```ts
  useEffect(() => {
    const qdnEvents = window.qortiumHome.qdnEvents;

    if (!qdnEvents?.onOpenCurrentTab) {
      return undefined;
    }

    return qdnEvents.onOpenCurrentTab((event) => {
      openInCurrentTabRef.current?.(event.address, event.sourceTabId);
    });
  }, []);
```

---

## How refs are assigned — context for the implementer

Search `App.tsx` for `openAppLinkInNewTabRef.current =` to find the exact line
where the existing ref is updated each render. Add `openInCurrentTabRef.current = openInCurrentTab`
on the next line.

The ref pattern is used here (instead of putting the function directly in the
`useEffect`) because `openInCurrentTab` closes over `setTabState` which is
stable, but the effect must not re-subscribe every render — the ref breaks that
coupling cleanly.

---

## Summary of changes

| File | Change |
|---|---|
| `electron/qdn-app-actions.ts` | Add `'OPEN_CURRENT_TAB'` to the actions array |
| `electron/qdn.ts` | Add `case 'OPEN_CURRENT_TAB':` handler (IPC channel `qdn-app:open-current-tab`) |
| `electron/preload.cts` | Add `onOpenCurrentTab` IPC-to-callback binding |
| `src/vite-env.d.ts` | Add `onOpenCurrentTab` to `qdnEvents` type |
| `src/App.tsx` | Add ref + function + `useEffect` subscriber, and pass `onOpenInCurrentTab` to `QdnViewer` |
| `src/platform.ts` | Add `onOpenInCurrentTab` to `QdnAppRequestContext` and a `case 'OPEN_CURRENT_TAB':` handler (Android path) |
| `src/QdnViewer.tsx` | Thread `onOpenInCurrentTab` through to the iframe bridge context |

No new constants, no new packages, no behaviour changes to existing actions.

> **Platform note:** The Electron desktop path routes `OPEN_CURRENT_TAB` over IPC
> (`electron/*` + `src/App.tsx`), while Android handles the same action directly in
> the shared renderer via `src/platform.ts` and `src/QdnViewer.tsx`. Both ultimately
> call the same `openInCurrentTab` logic in `App.tsx`.
