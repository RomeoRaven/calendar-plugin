const pad = (value) => String(value).padStart(2, "0");

export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

export function occurrenceFor(job) {
  const recurring = !/^\d{4}-\d{2}-\d{2}T/.test((job.schedule || "").trim());
  const when = recurring ? job.next_fire : job.schedule;
  const date = new Date(when || "");
  if (Number.isNaN(date.getTime())) return null;
  return { job, date, key: localDateKey(date), recurring };
}

export function occurrences(jobs) {
  return jobs.map(occurrenceFor).filter(Boolean).sort((a, b) => a.date - b.date);
}

export function scheduleFromForm(values) {
  const time = values.time || "09:00";
  const [hour, minute] = time.split(":").map(Number);
  if (values.type === "once") {
    const date = new Date(values.onceAt || "");
    if (Number.isNaN(date.getTime())) throw new Error("Choose a complete date and time.");
    return { schedule: date.toISOString().replace(/\.\d{3}Z$/, "Z") };
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Choose a complete time.");
  if (values.type === "daily") return { schedule: `${minute} ${hour} * * *`, timezone: values.timezone || undefined };
  if (values.type === "weekdays") return { schedule: `${minute} ${hour} * * 1-5`, timezone: values.timezone || undefined };
  if (values.type === "weekly") return { schedule: `${minute} ${hour} * * ${values.weekday}`, timezone: values.timezone || undefined };
  const cron = (values.cron || "").trim();
  if (cron.split(/\s+/).length !== 5) throw new Error("Cron needs exactly five fields.");
  return { schedule: cron, timezone: values.timezone || undefined };
}

export function formFromJob(job) {
  const schedule = (job.schedule || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(schedule)) {
    const date = new Date(schedule);
    const local = Number.isNaN(date.getTime()) ? "" : `${localDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return { type: "once", onceAt: local, time: "09:00", weekday: "1", cron: "", timezone: "" };
  }
  const [minute, hour, dom, month, dow] = schedule.split(/\s+/);
  const time = /^\d+$/.test(hour) && /^\d+$/.test(minute) ? `${pad(hour)}:${pad(minute)}` : "09:00";
  if (dom === "*" && month === "*" && dow === "*") return { type: "daily", time, weekday: "1", cron: "", timezone: job.timezone || "" };
  if (dom === "*" && month === "*" && dow === "1-5") return { type: "weekdays", time, weekday: "1", cron: "", timezone: job.timezone || "" };
  if (dom === "*" && month === "*" && /^[0-6]$/.test(dow)) return { type: "weekly", time, weekday: dow, cron: "", timezone: job.timezone || "" };
  return { type: "cron", time, weekday: "1", cron: schedule, timezone: job.timezone || "" };
}
