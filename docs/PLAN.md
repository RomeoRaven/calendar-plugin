# Calendar plugin — external, self-reliant design

Status: Updated design boundary; implementation not yet authorized
Date: 2026-08-23
Target host reviewed: upstream protoAgent `v0.147.0`
Placement: external plugin (`new with reuse`)

## Decision

Build Calendar only when the desired outcome is a unified month/week/agenda workspace. Do not change protoAgent core and do not duplicate Scheduler's execution engine.

If the need is only Google Calendar access, use the existing upstream `google-plugin` first. It already provides Calendar read, search, free/busy, upcoming events, and own-calendar event creation. A new Calendar plugin is justified only for a richer calendar workspace or multi-source aggregation.

## Existing platform capability to use

### Core Scheduler

The public operator API already provides:

- `GET /api/scheduler/jobs`;
- `POST /api/scheduler/jobs`;
- `PUT /api/scheduler/jobs/{job_id}`;
- `DELETE /api/scheduler/jobs/{job_id}`.

A Scheduler job carries its schedule expression, timezone, authoritative `next_fire`, `last_fire`, enabled state, prompt, and identity. Scheduler remains responsible for persistence, recurrence evaluation, firing, missed-run recovery, and cancellation.

The plugin view calls these endpoints through the documented plugin-view handshake and `plugin-kit.js` `apiFetch()`. It never imports `scheduler.*`, reads Scheduler's SQLite database, or reimplements job execution.

### Existing Scheduler calendar work

Upstream Scheduler has a small inline `MonthCalendar` and tested date helpers for one-time schedule creation. They are private console source, not a public plugin component, so an external plugin cannot import them safely.

We can still reuse that work without coupling to core:

- preserve its Monday-first 6×7 month-grid behavior;
- preserve previous/next month navigation, today state, selected-day state, and accessible labels;
- adapt the pure date-grid/date-time algorithms into plugin-owned code with repository-license attribution;
- carry forward the tested rule that incomplete time input never silently becomes 09:00;
- reuse the same local-date, 12/24-hour conversion, timezone, validation, and DST test cases;
- use the host's `/_ds/plugin-kit.css` and `plugin-kit.js` instead of copying core CSS or React components.

This is an owned, distributable implementation of proven behavior—not a private import or core patch.

### Existing external Calendar integration

The upstream `google-plugin` already owns Google OAuth and Google Calendar operations. The Calendar plugin must not import it. A later Google source may compose only through a documented HTTP/event contract. If no stable contract exists, Google aggregation remains optional and deferred rather than forcing a core or cross-plugin dependency.

## Plugin-owned capability

The plugin owns:

- month, week, and agenda presentation;
- date navigation, filtering, source colors, and event detail UI;
- a normalized internal event envelope;
- source adapters that consume documented APIs;
- display-only expansion of recurring Scheduler jobs over a bounded visible range;
- plugin-owned tests, assets, settings, routes, and optional cache.

Scheduler is the first provider. One-time jobs render directly. For recurring jobs, the plugin may use a pinned, declared recurrence dependency to calculate a bounded display projection from the returned cron expression and timezone. Scheduler's `next_fire` remains authoritative; the plugin never fires or reschedules a job itself. Recurrence parity and DST tests are mandatory before recurring projections are called accurate.

## Self-reliant plugin shape

```text
calendar-plugin/
  protoagent.plugin.yaml
  __init__.py
  view/
    calendar.html
    calendar.js
    calendar.css
    date-grid.js
    recurrence.js
  tests/
  README.md
```

Manifest intent:

- standalone external repository;
- disabled by default;
- rail view at `/plugins/calendar/view`;
- plugin-owned API routes only when needed under `/api/plugins/calendar/*`;
- declared dependencies and compatibility floor;
- exact GitHub topic `protoagent-plugin` when public-ready.

The iframe page is public chrome; data remains bearer-gated. All URLs are same-origin and fleet-slug-aware through `plugin-kit`. Runtime state never lives in the installed plugin directory.

## Refresh and event behavior

- Subscribe to `scheduler.fired` and refresh Scheduler jobs after a fire.
- Refresh when the view opens and on a bounded interval because current core does not publish create/update/delete Scheduler events.
- Treat fetch failures as errors, never as an empty calendar.
- Keep plugin state scoped by active agent/fleet slug.

## Deliberate limits

- No core occurrence-window API.
- No core provider registry or normalized event schema.
- No imports from private core Scheduler or console modules.
- No direct imports from `google-plugin` or other plugins.
- No duplicate schedule executor, job database, polling engine, or missed-fire logic.
- No dependency on fork-only Surface Focus; the plugin must work on stock upstream.
- Tasks do not appear on dates unless the Calendar plugin has its own explicit task adapter and temporal meaning.

## Definition of Done

1. Re-check current upstream/core and public plugins immediately before implementation.
2. Scaffold from the current upstream plugin DevKit with a standalone host-free test suite.
3. Install on unmodified upstream-compatible protoAgent by git URL.
4. Render Scheduler one-time and recurring projections in a timezone-aware bounded range.
5. Create/edit/delete Scheduler jobs only through the public core API.
6. Prove recurrence/DST parity against authoritative Scheduler `next_fire` cases.
7. Prove theme switching, auth handshake, fleet-proxy routing, keyboard/mobile behavior, refresh, error states, restart, disable/uninstall, and no core file changes.
8. Qualify on isolated S1 development; hold native Windows proof for PLA/PC1.
