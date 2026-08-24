# calendar-plugin

Design stub for a self-reliant calendar workspace plugin for [protoAgent](https://github.com/protoLabsAI/protoAgent).

Status: **design review only**. The repository contains an importable Plugin DevKit scaffold and the proposed implementation plan; it does not yet provide the planned calendar workspace.

## Why it exists

The proposed plugin presents Scheduler jobs in month, week, and agenda views while leaving execution, recurrence ownership, persistence, cancellation, and missed-run recovery in protoAgent Scheduler. It is intended to use public Scheduler APIs and the documented plugin view/design-system contracts without changing core.

If Google Calendar access alone satisfies the need, the existing upstream `google-plugin` should be used instead.

## Review the proposal

Read [`docs/PLAN.md`](docs/PLAN.md). Feedback is welcome through [GitHub Issues](https://github.com/RomeoRaven/calendar-plugin/issues).

## Current stub

The scaffold follows the upstream protoAgent Plugin DevKit contract and contributes only:

- a placeholder console view;
- `calendar_status`, which reports that implementation is pending;
- host-free scaffold tests and CI.

## Compatibility

Design target: protoAgent `v0.147.0` or later. No release or production compatibility claim is made yet.

## Platform status

| Platform | Status | Evidence / follow-up |
|---|---|---|
| Linux | Tested | Host-free scaffold tests only |
| Windows | Not tested | Native qualification after implementation |
| macOS | Not tested | Qualification after implementation |

## License

MIT
