import test from "node:test";
import assert from "node:assert/strict";
import { formFromJob, localDateKey, monthGrid, occurrenceFor, scheduleFromForm, weekDays } from "../view/calendar-model.js";

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

test("one-time schedules use their own ISO occurrence", () => {
  const result = occurrenceFor({ id: "once", schedule: "2026-08-25T14:00:00Z", next_fire: null });
  assert.equal(result.recurring, false);
  assert.equal(result.date.toISOString(), "2026-08-25T14:00:00.000Z");
});

test("recurring schedules display only authoritative next_fire", () => {
  const result = occurrenceFor({ id: "daily", schedule: "0 9 * * *", next_fire: "2026-08-26T13:00:00Z" });
  assert.equal(result.recurring, true);
  assert.equal(result.date.toISOString(), "2026-08-26T13:00:00.000Z");
});

test("friendly forms produce five-field Scheduler expressions", () => {
  assert.deepEqual(scheduleFromForm({ type: "daily", time: "09:30", timezone: "America/New_York" }), { schedule: "30 9 * * *", timezone: "America/New_York" });
  assert.equal(scheduleFromForm({ type: "weekdays", time: "17:05" }).schedule, "5 17 * * 1-5");
  assert.equal(scheduleFromForm({ type: "weekly", time: "08:00", weekday: "2" }).schedule, "0 8 * * 2");
});

test("incomplete one-time input fails instead of inventing a time", () => {
  assert.throws(() => scheduleFromForm({ type: "once", onceAt: "" }), /complete date and time/);
});

test("stored schedules round-trip into the friendly editor", () => {
  const daily = formFromJob({ schedule: "30 9 * * *", timezone: "America/Chicago" });
  assert.equal(daily.type, "daily");
  assert.equal(daily.time, "09:30");
  assert.equal(daily.timezone, "America/Chicago");
  assert.equal(localDateKey(new Date(2026, 7, 25, 23, 30)), "2026-08-25");
});
