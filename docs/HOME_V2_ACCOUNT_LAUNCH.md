# Explicit account launch

Home's account dropdown offers **Open this app in a new tab** for ordinary app
tabs. The picker starts with the source tab's account (or No account); an
unavailable source account requires an explicit new choice. Choosing an account
does not change the global default or rebind the source tab. Locked and derived
accounts can be selected, but opening does not unlock them.

The button always creates a fresh tab, including when choosing the same account.
Ordinary app opens still reuse matching existing tabs. Separate native tab IDs
retain existing per-tab session-permission isolation; durable app/account grants
follow their established policy. This is not separate cookie/localStorage
partitioning per account.

The launch boundary rechecks the current source tab ID and captured resource
location, and resolves the chosen account against the current catalogue. An
explicit No account becomes Home's no-account binding, never runtime null's
legacy Current/default behavior. No account-selection, unlocking or signing API
is involved. Source and target checks plus new-tab dispatch run synchronously.

Publish previews, internal/transient pages, active resource viewers and a shell
whose restoration is incomplete are ineligible. A new tab opens the captured
resource address, not copied DOM/form state, browser history or viewer content.
Normal session restore preserves separately identified duplicate app tabs.

Validation includes reducer dedup/duplicate/restore tests, account-target and
stale-source tests, production launch-callback tests, accessible inline UI
interactions, and an isolated packaged A/B/same-account/guest acceptance script.
Android shares the renderer launch path; a desktop smoke is not Android device
acceptance. No QDN manager app update or publication is required.
