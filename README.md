# calendar-plugin

A self-reliant human Calendar workspace for [protoAgent](https://github.com/protoLabsAI/protoAgent).

Status: **v0.3.0 release candidate**. Linux source and live S1-dev acceptance are complete; release and stable installation follow the repository and runtime gates.

## What v0.3 provides

- a native visible Calendar rail entry;
- local all-day and timed human events with title, location, notes, and recurrence;
- recurring birthdays and daily, weekly, monthly, or yearly events;
- read-only HTTPS iCalendar subscriptions for Google secret iCal URLs, Apple published calendars, and other `.ics` feeds;
- a Google Calendar overlay through the public `protoLabsAI/google-plugin` API when that plugin is installed and connected;
- protoAgent Scheduler next-occurrence overlays without replacing or duplicating Scheduler;
- month, week, day, and agenda views with visible day/hour boundaries;
- a single-day 24-hour timeline with a separate all-day lane for daily scheduling and agenda use;
- a third-party CalendarLabs directory link for finding optional public holiday, sports, religious, and other iCalendar feeds;
- responsive desktop/mobile presentation.

`New event` creates a human event in Calendar's own store. It does not open the Scheduler prompt form.

## Ownership boundary

Calendar owns a separate instance-scoped SQLite database for local events and imported iCalendar snapshots. It never adds tables to a protoAgent core database or reads another plugin's database.

- Calendar owns human events, subscribed calendar sources, visual recurrence projection, and its UI.
- protoAgent Scheduler owns agent schedule execution and remains read-only in Calendar.
- [`google-plugin`](https://github.com/protoLabsAI/google-plugin) owns Google OAuth and Google Calendar operations. Calendar composes its authenticated public HTTP API; it does not import or duplicate Google internals.
- iCalendar subscriptions are read-only and explicitly refreshed by the operator.

The bounded v0.3 iCalendar parser handles VEVENT start/end, all-day and timed events, text fields, and common DAILY/WEEKLY/MONTHLY/YEARLY RRULE projection. Recurrence exceptions (`EXDATE`, `RDATE`, overridden instances) and full RFC 5545 parity remain later work and are not claimed.

## Security

- Plugin data APIs are bearer-gated by protoAgent's normal API boundary.
- Feed URLs must be HTTPS (`webcal://` is upgraded) and resolve only to public IP addresses.
- Redirect targets are revalidated, fetches time out, and responses are capped at 2 MiB.
- Feed URLs are stored only in instance-local Calendar state and are not returned to the browser after creation; the UI receives only the hostname.

## Compatibility

Development target: protoAgent `v0.147.0` or later. Install from an exact Git commit into an isolated development instance; the author default remains disabled.

## Platform status

| Platform | Status | Evidence / follow-up |
|---|---|---|
| Linux | Tested | Host-free gates plus isolated S1-dev API, desktop/mobile UI, restart, persistence, and state-preservation acceptance at `32e3dbf` |
| Windows | Not tested | Native qualification after Dennis accepts S1-dev |
| macOS | Not tested | Qualification remains separate |

## Development

```bash
python -m pytest -q
ruff check .
ruff format --check .
node --check view/calendar.js
node --check view/calendar-model.js
node --test tests/test_calendar_model.mjs
```

## License

MIT
