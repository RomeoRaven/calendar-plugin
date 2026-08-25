# Calendar plugin — v0.1 development contract

Status: Implementation in isolated S1-dev qualification
Date: 2026-08-25
Target host: accepted RR protoAgent `0.147.0`
Placement: external plugin (`new with reuse`)
Tracker: `kanban-c34414e75158`

## Decision

Calendar is a self-reliant visual workspace over protoAgent Scheduler. It does not change core, duplicate Scheduler's engine, import private host code, or depend on another plugin.

The upstream `google-plugin` owns Google Calendar access. Calendar v0.1 is instead the local Scheduler workspace.

## v0.1 scope

- Native visible Calendar rail and sandboxed plugin view.
- Month, week, and agenda presentation.
- One-time jobs at their scheduled ISO time.
- Recurring jobs represented honestly by Scheduler's authoritative `next_fire` only.
- Friendly one-time/daily/weekdays/weekly inputs plus custom five-field cron.
- Create, edit, and delete only through `/api/scheduler/jobs`.
- Refresh on open, after mutation, and after `scheduler.fired`.
- No database, cache, provider registry, Google aggregation, full recurrence projection, core edit, or private import.

Full occurrence expansion is deferred until a separate tranche proves cron/timezone/DST parity. Showing only `next_fire` makes v0.1 useful without inventing recurrence truth.

## Security and architecture

- The iframe page and declared assets are public chrome.
- Scheduler data calls use `plugin-kit.js` `apiFetch()` and remain bearer-gated.
- URLs are same-origin and fleet-slug-aware.
- Fetch failures render an error state and never masquerade as an empty calendar.
- Scheduler remains authoritative for persistence, recurrence, firing, recovery, and cancellation.

## Acceptance

1. Host-free Python and JavaScript tests, Ruff, formatting, syntax, manifest, and diff checks pass.
2. Exact candidate installs by immutable Git revision on S1-dev only and remains disabled until explicit activation there.
3. Native rail, month/week/agenda, create/edit/delete, auth handshake, theme, desktop/mobile, error state, restart persistence, disable/uninstall rollback, and direct/routed health pass on S1-dev.
4. S1-stable source, selector, config, lock, databases, service state, and routes remain unchanged.
5. Stop for Dennis's hands-on S1-dev review. Release, merge, PC1 work, and stable promotion remain separately gated.
