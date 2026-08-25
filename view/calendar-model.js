const pad = (value) => String(value).padStart(2, "0");
const DAY = 86400000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseCalendarDate(value, allDay = false) {
  if (!value) return new Date(NaN);
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export function monthGrid(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { date, key: localDateKey(date), inMonth: date.getMonth() === anchor.getMonth() };
  });
}

export function weekDays(anchor) {
  const lead = (anchor.getDay() + 6) % 7;
  const monday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - lead);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    return { date, key: localDateKey(date) };
  });
}

export function parseRRule(raw) {
  const values = {};
  String(raw || "").split(";").forEach((part) => {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) values[key.toUpperCase()] = rest.join("=").toUpperCase();
  });
  return values;
}

function eventMatchesDay(base, candidate, rule) {
  const interval = Math.max(1, Number(rule.INTERVAL || 1));
  const dayDiff = Math.round((new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate()) - new Date(base.getFullYear(), base.getMonth(), base.getDate())) / DAY);
  if (dayDiff < 0) return false;
  if (rule.UNTIL) {
    const untilRaw = rule.UNTIL.replace(/^(\d{4})(\d{2})(\d{2}).*$/, "$1-$2-$3");
    const until = parseCalendarDate(untilRaw, true);
    if (!Number.isNaN(until.getTime()) && candidate > new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59)) return false;
  }
  if (rule.FREQ === "DAILY") return dayDiff % interval === 0;
  if (rule.FREQ === "WEEKLY") {
    const week = Math.floor(dayDiff / 7);
    const allowed = (rule.BYDAY || WEEKDAYS[base.getDay()]).split(",").map((value) => value.slice(-2));
    return week % interval === 0 && allowed.includes(WEEKDAYS[candidate.getDay()]);
  }
  if (rule.FREQ === "MONTHLY") {
    const months = (candidate.getFullYear() - base.getFullYear()) * 12 + candidate.getMonth() - base.getMonth();
    const days = (rule.BYMONTHDAY || String(base.getDate())).split(",").map(Number);
    return months >= 0 && months % interval === 0 && days.includes(candidate.getDate());
  }
  if (rule.FREQ === "YEARLY") {
    const years = candidate.getFullYear() - base.getFullYear();
    const months = (rule.BYMONTH || String(base.getMonth() + 1)).split(",").map(Number);
    const days = (rule.BYMONTHDAY || String(base.getDate())).split(",").map(Number);
    return years >= 0 && years % interval === 0 && months.includes(candidate.getMonth() + 1) && days.includes(candidate.getDate());
  }
  return localDateKey(base) === localDateKey(candidate);
}

function expandEvent(event, rangeStart, rangeEnd) {
  const base = parseCalendarDate(event.starts_at, event.all_day);
  const end = parseCalendarDate(event.ends_at, event.all_day);
  if (Number.isNaN(base.getTime()) || Number.isNaN(end.getTime())) return [];
  const duration = Math.max(0, end - base);
  const rule = parseRRule(event.rrule);
  if (!rule.FREQ) {
    if (base >= rangeEnd || end < rangeStart) return [];
    return [{ event, date: base, end, key: localDateKey(base), recurring: false, kind: "event" }];
  }
  const output = [];
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const stop = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  for (; cursor < stop && output.length < 500; cursor.setDate(cursor.getDate() + 1)) {
    if (!eventMatchesDay(base, cursor, rule)) continue;
    const date = event.all_day ? new Date(cursor) : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), base.getHours(), base.getMinutes(), base.getSeconds());
    output.push({ event, date, end: new Date(date.getTime() + duration), key: localDateKey(date), recurring: true, kind: "event" });
  }
  return output;
}

export function schedulerOccurrence(job) {
  const recurring = !/^\d{4}-\d{2}-\d{2}T/.test((job.schedule || "").trim());
  const when = recurring ? job.next_fire : job.schedule;
  const date = new Date(when || "");
  if (Number.isNaN(date.getTime())) return null;
  return {
    event: {
      id: `scheduler:${job.id}`,
      title: job.prompt,
      starts_at: when,
      ends_at: when,
      all_day: false,
      readonly: true,
      source_kind: "scheduler",
      source_name: "Scheduler",
      source_color: "#0891b2",
      scheduler_job: job,
    },
    date,
    end: date,
    key: localDateKey(date),
    recurring,
    kind: "scheduler",
  };
}

export function calendarOccurrences(events, jobs, rangeStart, rangeEnd) {
  const expanded = events.flatMap((event) => expandEvent(event, rangeStart, rangeEnd));
  const scheduler = jobs.map(schedulerOccurrence).filter(Boolean).filter((item) => item.date >= rangeStart && item.date < rangeEnd);
  return [...expanded, ...scheduler].sort((a, b) => a.date - b.date || a.event.title.localeCompare(b.event.title));
}

export function eventFormPayload(values) {
  if (!values.title.trim()) throw new Error("Event title is required.");
  let startsAt;
  let endsAt;
  if (values.allDay) {
    startsAt = values.startDate;
    endsAt = values.endDate;
    if (!startsAt || !endsAt) throw new Error("Choose start and end dates.");
  } else {
    const start = new Date(values.startDateTime || "");
    const end = new Date(values.endDateTime || "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Choose complete start and end times.");
    startsAt = start.toISOString().replace(/\.\d{3}Z$/, "Z");
    endsAt = end.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (parseCalendarDate(endsAt, values.allDay) <= parseCalendarDate(startsAt, values.allDay)) throw new Error("End must be after start.");
  const repeat = values.repeat || "none";
  const rules = { daily: "FREQ=DAILY", weekly: "FREQ=WEEKLY", monthly: "FREQ=MONTHLY", yearly: "FREQ=YEARLY" };
  return {
    title: values.title.trim(),
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: Boolean(values.allDay),
    location: values.location.trim(),
    notes: values.notes.trim(),
    rrule: rules[repeat] || "",
  };
}

export function localInputValue(value) {
  const date = parseCalendarDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formFromEvent(event) {
  const rule = parseRRule(event.rrule);
  const repeat = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.FREQ) ? rule.FREQ.toLowerCase() : "none";
  return {
    title: event.title || "",
    allDay: Boolean(event.all_day),
    startDate: String(event.starts_at || "").slice(0, 10),
    endDate: String(event.ends_at || "").slice(0, 10),
    startDateTime: localInputValue(event.starts_at),
    endDateTime: localInputValue(event.ends_at),
    location: event.location || "",
    notes: event.notes || "",
    repeat,
  };
}
