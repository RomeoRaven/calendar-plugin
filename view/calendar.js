import { formFromJob, localDateKey, monthGrid, occurrences, scheduleFromForm, weekDays } from "./calendar-model.js";

let kit;
let started = false;
const state = { jobs: [], mode: localStorage.getItem("calendar.mode") || "month", anchor: new Date(), busy: false };
const el = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = (date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (date) => date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

export function start(pluginKit) {
  kit = pluginKit;
  if (started) return;
  started = true;
  bind();
  render();
  loadJobs();
}

function bind() {
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    localStorage.setItem("calendar.mode", state.mode);
    render();
  }));
  el("previous-button").addEventListener("click", () => step(-1));
  el("next-button").addEventListener("click", () => step(1));
  el("today-button").addEventListener("click", () => { state.anchor = new Date(); render(); });
  el("new-button").addEventListener("click", () => openDialog());
  el("dialog-close").addEventListener("click", closeDialog);
  el("cancel-button").addEventListener("click", closeDialog);
  el("schedule-type").addEventListener("change", syncFormRows);
  el("schedule-form").addEventListener("submit", saveSchedule);
  el("delete-button").addEventListener("click", deleteSchedule);
  el("calendar-view").addEventListener("click", (event) => {
    const button = event.target.closest("[data-job]");
    if (!button) return;
    openDialog(state.jobs.find((job) => job.id === button.dataset.job));
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "protoagent:event" && event.data.topic === "scheduler.fired") loadJobs(true);
  });
  parent.postMessage({ type: "protoagent:subscribe", patterns: ["scheduler.fired"] }, "*");
  window.addEventListener("keydown", (event) => {
    if (event.key === "n" && !event.metaKey && !event.ctrlKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      event.preventDefault(); openDialog(); return;
    }
    const combo = [event.metaKey || event.ctrlKey ? "mod" : "", event.shiftKey ? "shift" : "", event.altKey ? "alt" : "", event.key.toLowerCase()].filter(Boolean).join("+");
    parent.postMessage({ type: "protoagent:keydown", combo, editable: /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") }, "*");
  });
}

async function loadJobs(quiet = false, required = false) {
  if (!quiet) el("loading").hidden = false;
  try {
    const response = await kit.apiFetch("/api/scheduler/jobs");
    if (!response.ok) throw new Error(`Scheduler returned HTTP ${response.status}.`);
    const body = await response.json();
    state.jobs = Array.isArray(body.jobs) ? body.jobs : [];
    showError("");
    render();
    return true;
  } catch (error) {
    showError(`Could not load schedules: ${error.message}`);
    if (required) throw error;
    return false;
  } finally {
    el("loading").hidden = true;
  }
}

function step(direction) {
  const date = state.anchor;
  if (state.mode === "month") state.anchor = new Date(date.getFullYear(), date.getMonth() + direction, 1);
  else state.anchor = new Date(date.getFullYear(), date.getMonth(), date.getDate() + direction * (state.mode === "week" ? 7 : 30));
  render();
}

function render() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.setAttribute("aria-selected", String(active));
    button.classList.toggle("active", active);
  });
  const view = el("calendar-view");
  if (state.mode === "month") renderMonth(view);
  else if (state.mode === "week") renderWeek(view);
  else renderAgenda(view);
}

function renderMonth(view) {
  el("period-label").textContent = state.anchor.toLocaleDateString([], { month: "long", year: "numeric" });
  const byDay = groupByDay();
  view.className = "calendar-view month-view";
  view.innerHTML = `<div class="weekday-head">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span>${d}</span>`).join("")}</div><div class="month-grid">${monthGrid(state.anchor).map((cell) => dayCell(cell, byDay.get(cell.key) || [])).join("")}</div>`;
}

function renderWeek(view) {
  const days = weekDays(state.anchor);
  el("period-label").textContent = `${fmtDay(days[0].date)} – ${fmtDay(days[6].date)}`;
  const byDay = groupByDay();
  view.className = "calendar-view week-view";
  view.innerHTML = days.map((day) => `<section class="week-column"><h3>${esc(fmtDay(day.date))}</h3><div class="event-stack">${eventButtons(byDay.get(day.key) || [], "No schedules")}</div></section>`).join("");
}

function renderAgenda(view) {
  el("period-label").textContent = "Upcoming schedules";
  const items = occurrences(state.jobs).filter((item) => item.date >= new Date(Date.now() - 86400000));
  view.className = "calendar-view agenda-view";
  view.innerHTML = items.length ? items.map((item) => `<button class="agenda-row" type="button" data-job="${esc(item.job.id)}"><time datetime="${esc(item.date.toISOString())}">${esc(fmtDay(item.date))}<strong>${esc(fmtTime(item.date))}</strong></time><span><strong>${esc(item.job.prompt)}</strong><small>${item.recurring ? "Recurring · next occurrence" : "One time"}${item.job.timezone ? ` · ${esc(item.job.timezone)}` : ""}</small></span></button>`).join("") : empty("No upcoming schedules");
}

function groupByDay() {
  const grouped = new Map();
  occurrences(state.jobs).forEach((item) => {
    if (!grouped.has(item.key)) grouped.set(item.key, []);
    grouped.get(item.key).push(item);
  });
  return grouped;
}

function dayCell(cell, items) {
  const today = cell.key === localDateKey(new Date());
  return `<section class="day-cell${cell.inMonth ? "" : " outside"}${today ? " today" : ""}" aria-label="${esc(cell.date.toDateString())}"><span class="day-number">${cell.date.getDate()}</span><div class="event-stack">${eventButtons(items, "")}</div></section>`;
}

function eventButtons(items, fallback) {
  if (!items.length) return fallback ? `<span class="empty-inline">${esc(fallback)}</span>` : "";
  return items.map((item) => `<button class="event-chip${item.recurring ? " recurring" : ""}" type="button" data-job="${esc(item.job.id)}" title="${esc(item.job.prompt)}"><time>${esc(fmtTime(item.date))}</time><span>${esc(item.job.prompt)}</span></button>`).join("");
}

function empty(text) { return `<div class="empty-state"><span aria-hidden="true">◫</span><p>${esc(text)}</p></div>`; }
function showError(message) { el("error").textContent = message; el("error").hidden = !message; }

function openDialog(job = null) {
  const values = job ? formFromJob(job) : { type: "once", onceAt: nextHour(), time: "09:00", weekday: "1", cron: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "" };
  el("dialog-title").textContent = job ? "Edit schedule" : "New schedule";
  el("edit-id").value = job?.id || "";
  el("prompt").value = job?.prompt || "";
  el("job-id").value = "";
  el("job-id-row").hidden = Boolean(job);
  el("schedule-type").value = values.type;
  el("once-at").value = values.onceAt || "";
  el("repeat-time").value = values.time || "09:00";
  el("weekday").value = values.weekday || "1";
  el("cron").value = values.cron || "";
  el("timezone").value = values.timezone || "";
  el("delete-button").hidden = !job;
  syncFormRows();
  el("schedule-dialog").showModal();
  el("prompt").focus();
}

function closeDialog() { if (!state.busy) el("schedule-dialog").close(); }
function syncFormRows() {
  const type = el("schedule-type").value;
  el("once-row").hidden = type !== "once";
  el("time-row").hidden = !["daily", "weekdays", "weekly"].includes(type);
  el("weekday-row").hidden = type !== "weekly";
  el("cron-row").hidden = type !== "cron";
  el("timezone-row").hidden = type === "once";
}

async function saveSchedule(event) {
  event.preventDefault();
  const editId = el("edit-id").value;
  try {
    const schedule = scheduleFromForm({ type: el("schedule-type").value, onceAt: el("once-at").value, time: el("repeat-time").value, weekday: el("weekday").value, cron: el("cron").value, timezone: el("timezone").value.trim() });
    const body = { prompt: el("prompt").value.trim(), ...schedule };
    if (!body.prompt) throw new Error("Prompt is required.");
    if (!editId && el("job-id").value.trim()) body.job_id = el("job-id").value.trim();
    await mutate(editId ? `/api/scheduler/jobs/${encodeURIComponent(editId)}` : "/api/scheduler/jobs", editId ? "PUT" : "POST", body);
  } catch (error) { showError(error.message); }
}

async function deleteSchedule() {
  const id = el("edit-id").value;
  if (!id || !confirm(`Delete schedule ${id}?`)) return;
  try { await mutate(`/api/scheduler/jobs/${encodeURIComponent(id)}`, "DELETE"); } catch (error) { showError(error.message); }
}

async function mutate(path, method, body) {
  setBusy(true);
  try {
    const response = await kit.apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) {
      let detail = `Scheduler returned HTTP ${response.status}.`;
      try { const payload = await response.json(); detail = payload.detail || detail; } catch {}
      throw new Error(detail);
    }
    await loadJobs(true, true);
    el("schedule-dialog").close();
  } finally { setBusy(false); }
}

function setBusy(busy) {
  state.busy = busy;
  el("schedule-form").querySelectorAll("button,input,textarea,select").forEach((node) => { node.disabled = busy; });
  el("save-button").textContent = busy ? "Saving…" : "Save";
}

function nextHour() {
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(0, 0, 0);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
