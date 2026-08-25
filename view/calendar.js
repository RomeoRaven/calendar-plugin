import { calendarOccurrences, eventFormPayload, formFromEvent, localDateKey, monthGrid, parseCalendarDate, weekDays } from "./calendar-model.js";

let kit;
let started = false;
const state = {
  events: [], jobs: [], sources: [], google: { available: false, configured: false, events: [], error: "" },
  mode: localStorage.getItem("calendar.mode") || "month", anchor: new Date(), busy: false,
};
const el = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = (date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (date) => date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export function start(pluginKit) {
  kit = pluginKit;
  if (started) return;
  started = true;
  bind(); render(); loadAll();
}

function bind() {
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode; localStorage.setItem("calendar.mode", state.mode); render();
  }));
  el("previous-button").addEventListener("click", () => step(-1));
  el("next-button").addEventListener("click", () => step(1));
  el("today-button").addEventListener("click", () => { state.anchor = new Date(); render(); });
  el("new-button").addEventListener("click", () => openEvent());
  el("calendars-button").addEventListener("click", openCalendars);
  el("event-close").addEventListener("click", closeEvent);
  el("event-cancel").addEventListener("click", closeEvent);
  el("event-all-day").addEventListener("change", syncEventRows);
  el("event-form").addEventListener("submit", saveEvent);
  el("event-delete").addEventListener("click", deleteEvent);
  el("calendars-close").addEventListener("click", () => { if (!state.busy) el("calendars-dialog").close(); });
  el("source-form").addEventListener("submit", addSource);
  el("source-list").addEventListener("click", sourceAction);
  el("calendar-view").addEventListener("click", (event) => {
    const button = event.target.closest("[data-event]");
    if (!button) return;
    const item = allEvents().find((value) => value.id === button.dataset.event);
    if (item) openEvent(item);
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "protoagent:event" && event.data.topic === "scheduler.fired") loadAll(true);
  });
  parent.postMessage({ type: "protoagent:subscribe", patterns: ["scheduler.fired"] }, "*");
  window.addEventListener("keydown", (event) => {
    if (event.key === "n" && !event.metaKey && !event.ctrlKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      event.preventDefault(); openEvent(); return;
    }
    const combo = [event.metaKey || event.ctrlKey ? "mod" : "", event.shiftKey ? "shift" : "", event.altKey ? "alt" : "", event.key.toLowerCase()].filter(Boolean).join("+");
    parent.postMessage({ type: "protoagent:keydown", combo, editable: /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") }, "*");
  });
}

async function apiJson(path, options = {}, optional = false) {
  const response = await kit.apiFetch(path, options);
  if (optional && response.status === 404) return null;
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try { const payload = await response.json(); detail = payload.detail || payload.error || detail; } catch {}
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

async function loadAll(quiet = false, required = false) {
  if (!quiet) el("loading").hidden = false;
  try {
    const [calendar, sources, scheduler] = await Promise.all([
      apiJson("/api/plugins/calendar/events"), apiJson("/api/plugins/calendar/sources"), apiJson("/api/scheduler/jobs"),
    ]);
    state.events = calendar.events || [];
    state.sources = sources.sources || [];
    state.jobs = scheduler.jobs || [];
    await loadGoogle();
    showError(""); render();
    if (el("calendars-dialog").open) renderSources();
    return true;
  } catch (error) {
    showError(`Could not load calendars: ${error.message}`);
    if (required) throw error;
    return false;
  } finally { el("loading").hidden = true; }
}

async function loadGoogle() {
  state.google = { available: false, configured: false, events: [], error: "" };
  try {
    const status = await apiJson("/api/plugins/google/status", {}, true);
    if (!status) return;
    state.google.available = true;
    state.google.configured = Boolean(status.configured);
    if (!status.configured) return;
    const upcoming = await apiJson("/api/plugins/google/upcoming", {}, true);
    if (!upcoming) return;
    state.google.error = upcoming.error || "";
    state.google.events = (upcoming.events || []).map((event) => ({
      id: `google:${event.id}`, title: event.title || "Untitled Google event", starts_at: event.start,
      ends_at: event.end || event.start, all_day: !String(event.start || "").includes("T"),
      location: event.location || "", notes: "", rrule: "", readonly: true,
      source_kind: "google", source_name: "Google Calendar", source_color: "#16a34a", link: event.link || "",
    }));
  } catch (error) {
    state.google.available = true; state.google.error = error.message;
  }
}

function allEvents() { return [...state.events, ...state.google.events]; }
function step(direction) {
  const date = state.anchor;
  if (state.mode === "month") state.anchor = new Date(date.getFullYear(), date.getMonth() + direction, 1);
  else if (state.mode === "week") state.anchor = addDays(date, direction * 7);
  else if (state.mode === "day") state.anchor = addDays(date, direction);
  else state.anchor = addDays(date, direction * 30);
  render();
}

function render() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.setAttribute("aria-selected", String(active)); button.classList.toggle("active", active);
  });
  const view = el("calendar-view");
  if (state.mode === "month") renderMonth(view);
  else if (state.mode === "week") renderWeek(view);
  else if (state.mode === "day") renderDay(view);
  else renderAgenda(view);
}

function rangeOccurrences(start, end) { return calendarOccurrences(allEvents(), state.jobs, start, end); }
function groupByDay(items) {
  const grouped = new Map();
  items.forEach((item) => { if (!grouped.has(item.key)) grouped.set(item.key, []); grouped.get(item.key).push(item); });
  return grouped;
}

function renderMonth(view) {
  el("period-label").textContent = state.anchor.toLocaleDateString([], { month: "long", year: "numeric" });
  const cells = monthGrid(state.anchor);
  const byDay = groupByDay(rangeOccurrences(cells[0].date, addDays(cells.at(-1).date, 1)));
  view.className = "calendar-view month-view";
  view.innerHTML = `<div class="weekday-head">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span>${d}</span>`).join("")}</div><div class="month-grid">${cells.map((cell) => dayCell(cell, byDay.get(cell.key) || [])).join("")}</div>`;
}

function renderWeek(view) {
  const days = weekDays(state.anchor);
  el("period-label").textContent = `${fmtDay(days[0].date)} – ${fmtDay(days[6].date)}`;
  const byDay = groupByDay(rangeOccurrences(days[0].date, addDays(days[6].date, 1)));
  view.className = "calendar-view week-view";
  view.innerHTML = days.map((day) => `<section class="week-column${day.key === localDateKey(new Date()) ? " today" : ""}"><h3>${esc(fmtDay(day.date))}</h3><div class="event-stack">${eventButtons(byDay.get(day.key) || [], "No events")}</div></section>`).join("");
}

function renderDay(view) {
  const start = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), state.anchor.getDate());
  const end = addDays(start, 1);
  const items = rangeOccurrences(start, end);
  const allDay = items.filter((item) => item.event.all_day);
  const byHour = new Map();
  items.filter((item) => !item.event.all_day).forEach((item) => {
    const hour = item.date.getHours();
    if (!byHour.has(hour)) byHour.set(hour, []);
    byHour.get(hour).push(item);
  });
  el("period-label").textContent = start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  view.className = "calendar-view day-view";
  view.innerHTML = `<section class="all-day-lane"><h3>All day</h3><div class="event-stack">${eventButtons(allDay, "No all-day events")}</div></section><section class="day-timeline" aria-label="Daily schedule">${Array.from({ length: 24 }, (_, hour) => {
    const label = new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
    const current = hour === new Date().getHours() && localDateKey(start) === localDateKey(new Date());
    return `<div class="hour-row${current ? " current-hour" : ""}"><time class="hour-label">${esc(label)}</time><div class="hour-events">${eventButtons(byHour.get(hour) || [], "")}</div></div>`;
  }).join("")}</section>`;
}

function renderAgenda(view) {
  el("period-label").textContent = "Upcoming events";
  const start = addDays(new Date(), -1);
  const items = rangeOccurrences(start, addDays(start, 366));
  view.className = "calendar-view agenda-view";
  view.innerHTML = items.length ? items.map((item) => {
    const event = item.event;
    return `<button class="agenda-row" type="button" data-event="${esc(event.id)}"><time datetime="${esc(item.date.toISOString())}">${esc(fmtDay(item.date))}<strong>${event.all_day ? "All day" : esc(fmtTime(item.date))}</strong></time><span><strong>${esc(event.title)}</strong><small><i style="--source:${esc(event.source_color || "#2563eb")}"></i>${esc(event.source_name || "My calendar")}${item.recurring ? " · recurring" : ""}${event.location ? ` · ${esc(event.location)}` : ""}</small></span></button>`;
  }).join("") : empty("No upcoming events");
}

function dayCell(cell, items) {
  const today = cell.key === localDateKey(new Date());
  return `<section class="day-cell${cell.inMonth ? "" : " outside"}${today ? " today" : ""}" aria-label="${esc(cell.date.toDateString())}"><span class="day-number">${cell.date.getDate()}</span><div class="event-stack">${eventButtons(items, "")}</div></section>`;
}

function eventButtons(items, fallback) {
  if (!items.length) return fallback ? `<span class="empty-inline">${esc(fallback)}</span>` : "";
  return items.map((item) => {
    const event = item.event;
    return `<button class="event-chip ${esc(event.source_kind || "local")}" style="--source:${esc(event.source_color || "#2563eb")}" type="button" data-event="${esc(event.id)}" title="${esc(event.title)}"><time>${event.all_day ? "All day" : esc(fmtTime(item.date))}</time><span>${esc(event.title)}</span></button>`;
  }).join("");
}

function empty(text) { return `<div class="empty-state"><span aria-hidden="true">◫</span><p>${esc(text)}</p></div>`; }
function showError(message) { el("error").textContent = message; el("error").hidden = !message; }

function openEvent(event = null) {
  const readonly = Boolean(event?.readonly);
  const defaults = event ? formFromEvent(event) : newEventDefaults();
  el("event-dialog-title").textContent = event ? event.title : "New event";
  el("event-source").textContent = event?.source_name || "My calendar";
  el("event-id").value = event?.id || "";
  el("event-version").value = event?.version || "";
  el("event-title").value = defaults.title;
  el("event-all-day").checked = defaults.allDay;
  el("event-start-date").value = defaults.startDate;
  el("event-end-date").value = defaults.endDate;
  el("event-start-time").value = defaults.startDateTime;
  el("event-end-time").value = defaults.endDateTime;
  el("event-repeat").value = defaults.repeat;
  el("event-location").value = defaults.location;
  el("event-notes").value = defaults.notes;
  el("event-delete").hidden = !event || readonly;
  el("event-save").hidden = readonly;
  el("event-help").textContent = readonly ? `${event.source_name || "Subscribed calendar"} events are read-only here.` : "Events are saved to My calendar.";
  el("event-form").querySelectorAll("input,textarea,select").forEach((node) => { node.disabled = readonly; });
  syncEventRows();
  el("event-dialog").showModal();
  if (!readonly) el("event-title").focus();
}

function newEventDefaults() {
  const start = new Date(Date.now() + 3600000); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  const dateValue = (value) => `${localDateKey(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  return { title: "", allDay: false, startDate: localDateKey(start), endDate: localDateKey(addDays(start, 1)), startDateTime: dateValue(start), endDateTime: dateValue(end), location: "", notes: "", repeat: "none" };
}

function closeEvent() { if (!state.busy) el("event-dialog").close(); }
function syncEventRows() {
  const allDay = el("event-all-day").checked;
  el("timed-rows").hidden = allDay; el("all-day-rows").hidden = !allDay;
}

async function saveEvent(event) {
  event.preventDefault();
  try {
    const payload = eventFormPayload({
      title: el("event-title").value, allDay: el("event-all-day").checked,
      startDate: el("event-start-date").value, endDate: el("event-end-date").value,
      startDateTime: el("event-start-time").value, endDateTime: el("event-end-time").value,
      repeat: el("event-repeat").value, location: el("event-location").value, notes: el("event-notes").value,
    });
    const id = el("event-id").value;
    if (id) payload.expected_version = Number(el("event-version").value);
    await mutate(id ? `/api/plugins/calendar/events/${encodeURIComponent(id)}` : "/api/plugins/calendar/events", id ? "PATCH" : "POST", payload);
    el("event-dialog").close();
  } catch (error) { showError(error.message); }
}

async function deleteEvent() {
  const id = el("event-id").value;
  if (!id || !confirm(`Delete ${el("event-title").value}?`)) return;
  try {
    await mutate(`/api/plugins/calendar/events/${encodeURIComponent(id)}?expected_version=${encodeURIComponent(el("event-version").value)}`, "DELETE");
    el("event-dialog").close();
  } catch (error) { showError(error.message); }
}

async function mutate(path, method, body) {
  setBusy(true);
  try {
    await apiJson(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    await loadAll(true, true);
  } finally { setBusy(false); }
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("dialog button,dialog input,dialog textarea,dialog select").forEach((node) => { node.disabled = busy; });
  if (!busy && el("event-dialog").open) {
    const selected = allEvents().find((value) => value.id === el("event-id").value);
    if (!selected?.readonly) el("event-form").querySelectorAll("input,textarea,select").forEach((node) => { node.disabled = false; });
  }
}

function openCalendars() { renderSources(); el("calendars-dialog").showModal(); }
function sourceRow({ color, name, detail, actions = "" }) {
  return `<div class="source-row"><i style="--source:${esc(color)}"></i><span><strong>${esc(name)}</strong><small>${esc(detail)}</small></span><div class="source-actions">${actions}</div></div>`;
}

function renderSources() {
  const rows = [
    sourceRow({ color: "#2563eb", name: "My calendar", detail: "Local human events · editable" }),
    sourceRow({ color: "#0891b2", name: "Scheduler", detail: "Agent schedules · next occurrence overlay" }),
  ];
  let googleDetail = "Install Google Workspace plugin to connect";
  if (state.google.available && !state.google.configured) googleDetail = "Google Workspace installed · connection required";
  if (state.google.configured) googleDetail = `${state.google.events.length} upcoming event${state.google.events.length === 1 ? "" : "s"}${state.google.error ? ` · ${state.google.error}` : ""}`;
  rows.push(sourceRow({ color: "#16a34a", name: "Google Calendar", detail: googleDetail }));
  state.sources.forEach((source) => rows.push(sourceRow({
    color: source.color, name: source.name,
    detail: `${source.event_count} event${source.event_count === 1 ? "" : "s"} · ${source.url_host || "iCalendar"}${source.last_error ? ` · ${source.last_error}` : source.last_refreshed ? ` · refreshed ${new Date(source.last_refreshed).toLocaleString()}` : ""}`,
    actions: `<button class="pl-button" type="button" data-refresh-source="${esc(source.id)}">Refresh</button><button class="pl-button danger" type="button" data-delete-source="${esc(source.id)}">Remove</button>`,
  })));
  el("source-list").innerHTML = rows.join("");
}

async function addSource(event) {
  event.preventDefault(); setBusy(true);
  try {
    await apiJson("/api/plugins/calendar/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: el("source-name").value, url: el("source-url").value, color: el("source-color").value }) });
    el("source-form").reset(); el("source-color").value = "#7c3aed";
    await loadAll(true, true); renderSources();
  } catch (error) { showError(`Could not add calendar: ${error.message}`); await loadAll(true); renderSources(); }
  finally { setBusy(false); }
}

async function sourceAction(event) {
  const refresh = event.target.closest("[data-refresh-source]");
  const remove = event.target.closest("[data-delete-source]");
  if (!refresh && !remove) return;
  const id = refresh?.dataset.refreshSource || remove?.dataset.deleteSource;
  if (remove && !confirm("Remove this subscribed calendar and its imported events?")) return;
  setBusy(true);
  try {
    await apiJson(`/api/plugins/calendar/sources/${encodeURIComponent(id)}${refresh ? "/refresh" : ""}`, { method: refresh ? "POST" : "DELETE" });
    await loadAll(true, true); renderSources();
  } catch (error) { showError(error.message); await loadAll(true); renderSources(); }
  finally { setBusy(false); }
}
