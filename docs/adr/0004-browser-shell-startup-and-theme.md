# ADR 0004: Browser Shell, Startup State, and Warm Neutral Theme

- Status: Accepted
- Date: 2026-08-08
- Applies to: Qortium Home 2.0 renderer and fixture

## Context

The first Home 2.0 fixture retained too much dashboard-style application
framing. It placed primary navigation beside a content canvas and visually
suggested that Chat and other apps lived inside Dashboard. That conflicts with
the intended QDN-app model and with the familiar browser behavior users already
understand from Home 1.x.

The existing green treatment also inherited a visual direction that is no
longer wanted. Startup must remain useful with no account or a locked account,
and Qortal and Qortium connectivity must not depend on unlocking a wallet.

## Decision

### Browser anatomy

Home uses one global browser shell. The tab strip and browser toolbar stay
outside page content. Dashboard is the initial internal tab; Apps, Activity,
and Settings are internal browser destinations; QDN apps open as peer tabs in
the same strip. No Chat, Wallets, or other full app gets a nested tab system
inside Dashboard.

The stable chrome contains:

- top-level tabs and a new-tab affordance;
- back, forward, reload, and Dashboard controls;
- one address/search surface;
- compact, labelled Qortal and Qortium connection summaries; and
- the selected account and lock state.

The fixture models the anatomy now. Per-tab history, address/search behavior,
and production new-tab semantics are Phase 2 work and must be implemented in
the shared product model rather than improvised in components.

### Startup states

Dashboard is never replaced by a login wall. It renders three explicit states:

| State | Startup behavior | Available behavior |
| --- | --- | --- |
| No account | Open Dashboard with no selected identity. | Node controls, public browsing, and account import/create. |
| Selected and locked | Restore the last selected identity and show both labelled network presences without signing authority. | Node controls, public browsing, account switch, and unlock. |
| Selected and unlocked | Restore the last identity and unlock only when the user previously opted into secure device storage. | Normal granted account capabilities. |

Manual lock is immediate, clears pending requests and affected grants, and
persists as locked. `Lock on exit` is an account/device preference enabled by
default. When enabled, Home does not restore an unlocked session after exit.

“Remember unlock” never means storing a plaintext password in renderer state,
preferences, logs, or a general application database. The production design
must wrap the minimum unlock secret with operating-system secure storage on
desktop and Android Keystore-backed storage on mobile. If suitable secure
storage is unavailable, Home disables the option and explains why. Recovery
credentials and wallet seeds remain outside this convenience mechanism.

### Connection modes and words

Qortal and Qortium each expose an independent mode:

- **Disabled**: Home makes no connection to that network.
- **Local**: use or manage the local node for that network.
- **Public**: use a configured public node without calling the mode Previewnet.
- **Custom**: use an explicitly configured node profile.

Connection state is account-independent. Status communicates mode, node label,
sync/health state, and actionable details. Color is supplementary, never the
only status signal.

### Visual system

The foundation palette is warm and neutral rather than green- or blue-led.
Light mode uses tan, parchment, and walnut surfaces; dark mode uses chocolate
gray and warm charcoal surfaces. A restrained clay/copper accent supports
actions. Qortal and Qortium may use muted plum and umber labels respectively,
always accompanied by network text.

Desktop and Android share tokens, component states, semantics, and responsive
acceptance. Mobile rearranges the same browser model for limited width; it is
not a deferred or reduced product.

## Consequences

- Dashboard can become simpler because it is a start page, not an application
  frame or operations wall.
- Apps are visually and behaviorally first-class browser tabs.
- Account selection, account unlock, and network connectivity remain separate
  concepts in contracts and production host services.
- Secure unlock persistence requires platform-specific host work and a threat
  model before connection to real wallets.
- Existing v1 styling and the first green v2 fixture are not maintained as
  alternate themes.

## Fixture acceptance

- The first rendered browser tab is Dashboard and no QDN app tab is pre-opened.
- Desktop and phone layouts expose global browser chrome.
- Light and dark warm-neutral themes are selectable.
- No-account, locked, and unlocked startup states are selectable.
- Qortal and Qortium modes can each switch among Disabled, Local, Public, and
  Custom without making a live request.
- The fixture remains disconnected and fail-closed.
