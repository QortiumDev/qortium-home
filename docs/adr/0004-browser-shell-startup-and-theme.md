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
| No account | Open Dashboard with no selected account. | Node controls, public browsing, and account import/create. |
| Selected and locked | Restore the last selected account and show both labelled network presences without signing authority. | Node controls, public browsing, account selection, and unlock. |
| Selected and unlocked | Restore the last account and unlock only when the user previously opted into secure device storage. | Normal granted account capabilities. |

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
Light mode uses linen, warm gray, and restrained tan surfaces; dark mode uses
graphite and charcoal with a subtle chocolate undertone. Brown is not the main
surface color. A restrained clay accent supports actions by default. Qortal is
always identified with blue and Qortium with green; neither network identity
color follows the user accent. Health and synchronization use separate semantic
status colors. Network color is always accompanied by network text.

Home retains system/light/dark theme, accent, six text sizes, 50–200% page zoom,
and system/supported-language controls. Existing valid v1 values migrate into
the v2 settings model. New profiles use clay as the neutral default accent.
Legacy `classic`, `modern`, and `fun` values all map to the single standard v2
presentation; Home does not maintain three structural renderer styles.

Product copy uses literal page, section, state, and action names. Greetings,
metaphors, promotional language, and repeated explanations do not carry the
visual warmth. Longer copy is reserved for security, errors, unusual states,
and consequential actions.

Desktop and Android share tokens, component states, semantics, and responsive
acceptance. Mobile rearranges the same browser model for limited width; it is
not a deferred or reduced product.

## Consequences

- Dashboard can become simpler because it is a start page, not an application
  frame or operations wall.
- Apps are visually and behaviorally first-class browser tabs.
- Account selection, account unlock, and network connectivity remain separate
  concepts in contracts and production host services.
- Dashboard option selectors use compact dropdowns. Account and connection
  cards reserve stable rows so changing state replaces content in place rather
  than shifting surrounding modules.
- Secure unlock persistence requires platform-specific host work and a threat
  model before connection to real wallets.
- Existing v1 styling and the first green v2 fixture are not maintained as
  alternate themes.

## Fixture acceptance

- The first rendered browser tab is Dashboard and no QDN app tab is pre-opened.
- Desktop and phone layouts expose global browser chrome.
- Light and dark warm-neutral themes are selectable.
- Theme, accent, text size, page zoom, and language controls are available in
  the Settings tab and update synthetic fixture state.
- No-account, locked, and unlocked startup states are selectable.
- Qortal and Qortium modes can each switch among Disabled, Local, Public, and
  Custom without making a live request.
- Network identity colors remain fixed blue/green across every accent, and
  no-account, locked, unlocked, or node-mode changes preserve card geometry at
  each responsive layout.
- The fixture remains disconnected and fail-closed.
