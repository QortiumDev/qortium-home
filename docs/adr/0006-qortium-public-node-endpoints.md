# ADR 0006: Qortium public node endpoints

Date: 2026-08-08

Status: accepted for Home v2

## Context

Home v2 needs publicly trusted HTTPS endpoints for the two independently
operated Qortium public nodes. A shared hostname with multiple address records
would leave failure handling to DNS and client resolver behavior, while Home
already has a reviewed public-candidate selection boundary.

The user-facing connection model should remain one simple Qortium Public mode,
but the Dashboard should identify the node that Home is actually using.

## Decision

- Keep the public nodes on separate stable hostnames:
  - `https://node1.qortium.app` for Regxa at `146.103.42.59`.
  - `https://node2.qortium.app` for Netcup at `185.207.104.78`.
- Do not add a shared `node.qortium.app` endpoint to Home's candidate list.
- Probe both candidates over HTTPS using the real status and public-read
  requests. Do not use ICMP ping as the selection signal.
- Apply the eligibility requirements from ADR 0005 before comparing candidates:
  positive height, fully synchronized state, no active synchronization, and a
  successful public-read probe.
- Keep the current healthy selection sticky. On initial selection or after a
  failure, prefer the eligible candidate with the lower observed HTTPS request
  latency; a tie may be resolved arbitrarily.
- Fail over only inside Qortium Public mode. Never silently change Local,
  Custom, or Disabled mode to Public.
- Show the connected hostname and current status in the Dashboard rather than
  hiding which public node was selected.
- Provision and renew a publicly trusted certificate independently for each
  hostname.
- Preserve the Core's public API restrictions when placing a TLS terminator or
  reverse proxy in front of it. A proxy must not cause external requests to be
  treated as trusted loopback traffic.

## Consequences

Each VPS has an independent DNS and certificate lifecycle. Home, rather than
DNS round-robin behavior, owns health-aware selection and failover. Users see a
single Qortium Public mode while still being able to identify the active node.

The DNS records, VPS TLS configuration, trusted-proxy boundary, and Home
endpoint changes remain separate implementation and deployment steps.
