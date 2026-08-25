# Calendar plugin — v0.2 S1-dev contract

Status: Implementation and qualification isolated to S1-dev
Date: 2026-08-25
Target host: accepted RR protoAgent `0.147.0`
Placement: external plugin (`new with reuse`)
Tracker: `kanban-c34414e75158`

## Corrected product decision

Calendar is a human event calendar, not a second Scheduler interface. `New event` writes an all-day or timed event to Calendar's own instance-scoped store. Calendar then composes four source types in one workspace:

1. editable local human events;
2. read-only HTTPS iCalendar subscriptions;
3. Google Calendar through `google-plugin`'s public authenticated API when installed and connected;
4. read-only Scheduler next-occurrence overlays.

Scheduler remains useful context, but it is not Calendar's event model and Calendar does not edit schedules.

## Architecture

- `calendar/calendar.db` under the active documented protoAgent instance root owns local events, source metadata, and imported iCalendar snapshots.
- Calendar does not modify core databases, read another plugin's files, import private protoAgent modules, or edit core.
- Browser data access uses authenticated same-origin routes under `/api/plugins/calendar`.
- Google composition uses only `/api/plugins/google/status` and `/api/plugins/google/upcoming`; the Google plugin continues to own OAuth and provider calls.
- iCalendar imports validate every HTTPS destination/redirect against public addresses, cap reads at 2 MiB, and persist refresh errors visibly.
- Feed URLs are never returned by source-list APIs; only their hostname is exposed.

## v0.2 scope

- Month, week, and agenda views with subtle explicit day borders.
- Local event create/edit/delete with optimistic versions.
- All-day/timed semantics, location, notes, and common daily/weekly/monthly/yearly recurrence.
- Birthday support through yearly all-day events.
- iCalendar URL add, manual refresh, and remove.
- Google Calendar upcoming-event overlay through the existing owner plugin when available.
- Scheduler next occurrence as a visually distinct read-only overlay.
- Source identity/color and read-only event details.
- Desktop and pushed-mobile operation.

## Explicit limits

- Imported and Google events are read-only in Calendar.
- iCalendar refresh is manual in this tranche; automatic background refresh is not claimed.
- The bounded parser does not claim full RFC 5545 parity. `EXDATE`, `RDATE`, detached recurring overrides, VALARM, attendee workflows, CalDAV writes, and conflict reconciliation are later work.
- The current Google owner API returns its bounded upcoming window; Calendar does not bypass or expand that contract.
- Windows, publication, release, and stable promotion remain separately gated.

## Acceptance

1. Host-free Python and JavaScript tests, Ruff, formatting, syntax, manifest, and diff checks pass.
2. Exact candidate is installed only in the S1 development instance with coherent rollback evidence.
3. Authenticated live UI proves local timed and birthday event create/edit/delete, source management, real HTTPS iCalendar import/refresh/remove, Scheduler coexistence, month/week/agenda, visible borders, desktop/mobile use, and restart persistence.
4. Data and source APIs reject anonymous access; Calendar SQLite and existing S1 databases pass integrity checks.
5. Google source state is correctly detected through the public API. If `google-plugin` is absent on S1-dev, that provider is visibly reported unavailable rather than falsely claimed live.
6. S1-stable source, selector, config, lock, databases, service state, and routes remain unchanged.
7. Stop for Dennis's hands-on S1-dev review. Publication, merge, PC1 work, release, and stable promotion remain separately gated.
