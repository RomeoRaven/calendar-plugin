import test from "node:test";
import assert from "node:assert/strict";
import { calendarOccurrences, eventFormPayload, formFromEvent, localDateKey, monthGrid, parseRRule, weekDays } from "../view/calendar-model.js";

test("month grid is Monday-first and always 42 cells", () => {
  const cells = monthGrid(new Date(2026, 6, 1));
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, "2026-06-29");
  assert.equal(cells[41].key, "2026-08-09");
});

test("week begins Monday without UTC date drift", () => {
  const days = weekDays(new Date(2026, 7, 25, 12));
  assert.deepEqual(days.map((d) => d.key), ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]);
});

test("human events and Scheduler occurrences coexist", () => {
  const events = [{ id: "dentist", title: "Dentist", starts_at: "2026-08-26T14:00:00Z", ends_at: "2026-08-26T15:00:00Z", all_day: false, rrule: "", source_name: "My calendar" }];
  const jobs = [{ id: "daily", prompt: "Daily agent work", schedule: "0 9 * * *", next_fire: "2026-08-27T13:00:00Z" }];
  const rows = calendarOccurrences(events, jobs, new Date("2026-08-25T00:00:00Z"), new Date("2026-08-29T00:00:00Z"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event.title, "Dentist");
  assert.equal(rows[1].event.source_kind, "scheduler");
});

test("yearly birthdays expand into the visible year", () => {
  const event = { id: "birthday", title: "Birthday", starts_at: "1980-09-12", ends_at: "1980-09-13", all_day: true, rrule: "FREQ=YEARLY" };
  const rows = calendarOccurrences([event], [], new Date(2026, 8, 1), new Date(2026, 9, 1));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "2026-09-12");
  assert.equal(rows[0].recurring, true);
});

test("weekly and monthly recurrences expand over a bounded range", () => {
  const weekly = { id: "w", title: "Class", starts_at: "2026-08-03T09:00:00", ends_at: "2026-08-03T10:00:00", all_day: false, rrule: "FREQ=WEEKLY;BYDAY=MO,WE" };
  const monthly = { id: "m", title: "Rent", starts_at: "2026-01-01", ends_at: "2026-01-02", all_day: true, rrule: "FREQ=MONTHLY;BYMONTHDAY=1" };
  const rows = calendarOccurrences([weekly, monthly], [], new Date(2026, 7, 1), new Date(2026, 8, 1));
  assert.equal(rows.filter((row) => row.event.id === "w").length, 9);
  assert.equal(rows.filter((row) => row.event.id === "m").length, 1);
});

test("event form creates human all-day and timed payloads", () => {
  const allDay = eventFormPayload({ title: "Birthday", allDay: true, startDate: "2026-09-12", endDate: "2026-09-13", repeat: "yearly", location: "", notes: "" });
  assert.equal(allDay.rrule, "FREQ=YEARLY");
  assert.equal(allDay.starts_at, "2026-09-12");
  const timed = eventFormPayload({ title: "Doctor", allDay: false, startDateTime: "2026-08-25T10:00", endDateTime: "2026-08-25T11:00", repeat: "none", location: "Clinic", notes: "" });
  assert.match(timed.starts_at, /^2026-08-25T/);
  assert.equal(timed.location, "Clinic");
});

test("incomplete or reversed event windows fail", () => {
  assert.throws(() => eventFormPayload({ title: "No", allDay: false, startDateTime: "", endDateTime: "", location: "", notes: "" }), /complete/);
  assert.throws(() => eventFormPayload({ title: "No", allDay: true, startDate: "2026-09-13", endDate: "2026-09-12", location: "", notes: "" }), /after start/);
});

test("event editor round-trips yearly local events", () => {
  const form = formFromEvent({ title: "Birthday", starts_at: "1980-09-12", ends_at: "1980-09-13", all_day: true, rrule: "FREQ=YEARLY", location: "Home", notes: "Cake" });
  assert.equal(form.repeat, "yearly");
  assert.equal(form.startDate, "1980-09-12");
  assert.equal(localDateKey(new Date(2026, 7, 25, 23, 30)), "2026-08-25");
  assert.equal(parseRRule("FREQ=WEEKLY;BYDAY=MO,WE").BYDAY, "MO,WE");
});
