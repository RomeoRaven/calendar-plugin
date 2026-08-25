---
name: calendar
description: Use Calendar for human events, calendar feeds, and schedule overlays.
summary: Manage human events and view external calendars with Scheduler context.
---

# Calendar

Use the native Calendar rail for real-world events and external calendars.

- **My calendar** owns editable all-day or timed events, including yearly birthdays and daily, weekly, monthly, or yearly recurrence.
- **iCalendar feeds** pull read-only events from operator-provided HTTPS or `webcal://` calendar URLs. Google secret iCal addresses, Apple published calendars, and standards-compatible `.ics` feeds use this route.
- **Google Calendar** appears through the Google Workspace plugin's public API when that plugin is installed and connected.
- **Scheduler** contributes each agent job's authoritative next occurrence as a read-only overlay; edit the underlying job in Scheduler.
- Use the `calendar_event_create`, `calendar_event_list`, and `calendar_status` tools when an agent needs to create or inspect human events.

Treat subscribed and Google events as read-only. The v0.2 parser covers common event fields and recurrence, not complete RFC 5545 exception/attendee semantics.
