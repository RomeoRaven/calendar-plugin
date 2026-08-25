# calendar-plugin

A self-reliant Calendar workspace for [protoAgent](https://github.com/protoLabsAI/protoAgent).

Status: **v0.1 development candidate**. It is not released or approved for stable use.

## What v0.1 provides

- a native visible Calendar rail entry;
- month, week, and agenda views;
- one-time Scheduler jobs at their scheduled date and time;
- each recurring job at Scheduler's authoritative next occurrence;
- friendly one-time, daily, weekday, weekly, and custom-cron creation;
- in-place editing and deletion through protoAgent's authenticated public Scheduler API;
- responsive desktop/mobile presentation and live refresh after `scheduler.fired`.

## Ownership boundary

Calendar is a presentation and control workspace. protoAgent Scheduler remains authoritative for execution, recurrence evaluation, persistence, firing, missed-run recovery, and cancellation. Calendar has no database, does not read Scheduler state directly, and does not import private core modules.

The upstream [`google-plugin`](https://github.com/protoLabsAI/google-plugin) separately owns Google OAuth and Google Calendar operations. Calendar does not import or duplicate it.

## Compatibility

Development target: protoAgent `v0.147.0` or later. Install from an exact Git commit into an isolated development instance; the author default remains disabled.

## Platform status

| Platform | Status | Evidence / follow-up |
|---|---|---|
| Linux | In qualification | Host-free source gates and isolated S1-dev acceptance required |
| Windows | Not tested | Native qualification after Dennis accepts S1-dev |
| macOS | Not tested | Qualification remains separate |

## Development

```bash
python -m pytest -q
ruff check .
ruff format --check tests/
node --test tests/test_calendar_model.mjs
```

## License

MIT
