"use strict";

const byId = (id) => document.getElementById(id);
const modeSelect = byId("mode");
const search = byId("task-search");
const traderSelect = byId("task-trader");
const statusSelect = byId("task-status");
const list = byId("task-list");
const status = byId("status");
const params = new URLSearchParams(location.search);
const cache = new Map();
let mode = params.get("mode") === "pve" ? "pve" : "pvp";
let tasks = null;
let request = 0;

modeSelect.value = mode;
search.value = params.get("q") || "";

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function taskRow(task, names, completed) {
  const isDone = completed.has(task.id);
  const row = el("li", null, isDone ? "task-row done" : "task-row");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = isDone;
  checkbox.id = `task-${task.id}`;
  checkbox.addEventListener("change", () => {
    const neighboringRow = row.nextElementSibling || row.previousElementSibling;
    const nextCheckbox = neighboringRow?.querySelector("input")?.id;
    setCompletedRequirement(mode, task.id, checkbox.checked);
    render();
    (byId(checkbox.id) || byId(nextCheckbox) || search).focus({preventScroll: true});
  });

  const content = el("div");
  const label = el("label", task.name, "task-name");
  label.htmlFor = checkbox.id;
  content.append(label);
  const metadata = [
    task.trader, task.level ? `PMC level ${task.level}` : "",
    /^(bear|usec)$/i.test(task.faction || "") ? task.faction.toUpperCase() : "",
  ].filter(Boolean);
  if (metadata.length) content.append(el("p", metadata.join(" · "), "sub"));
  if (task.requirements.length) {
    const prerequisites = task.requirements.map(([id, states]) =>
      states.length === 1 && states[0] === "complete"
        ? names.get(id)
        : `${names.get(id)} (${states.join(" or ")})`);
    content.append(el("p", `Requires ${prerequisites.join(" · ")}`, "sub"));
  }
  row.append(checkbox, content);
  if (task.url) {
    const link = el("a", "Wiki ↗", "task-wiki");
    link.href = task.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Wiki for ${task.name}`);
    row.append(link);
  }
  return row;
}

function updateLinks() {
  const query = new URLSearchParams({mode});
  const term = search.value.trim();
  if (term) query.set("q", term);
  history.replaceState(null, "", `?${query}`);
  byId("compare-link").href = `./?mode=${mode}`;
  byId("loot-link").href = `loot.html?mode=${mode}`;
}

function render() {
  updateLinks();
  if (!tasks) return;
  const completed = completedRequirements(mode);
  const done = tasks.items.filter((task) => completed.has(task.id)).length;
  const term = search.value.trim().toLowerCase();
  const selected = tasks.items.filter((task) => {
    if (traderSelect.value && traderSelect.value !== task.trader) return false;
    if (statusSelect.value === "remaining" && completed.has(task.id)) return false;
    if (statusSelect.value === "completed" && !completed.has(task.id)) return false;
    return !term || task.name.toLowerCase().includes(term);
  });
  list.replaceChildren(...selected.map((task) => taskRow(task, tasks.names, completed)));
  status.textContent = `${done} of ${tasks.items.length} completed · ${selected.length ? `${selected.length} shown` : "No matching tasks"}`;
}

function populateTraders(items) {
  const previous = traderSelect.value;
  const traders = [...new Set(items.map((task) => task.trader).filter(Boolean))].sort();
  traderSelect.replaceChildren(new Option("All traders", ""), ...traders.map((name) => new Option(name, name)));
  if (traders.includes(previous)) traderSelect.value = previous;
}

async function load() {
  const version = ++request;
  const current = mode;
  tasks = null;
  list.replaceChildren();
  status.textContent = "Loading tasks…";
  byId("snapshot").textContent = "";
  updateLinks();

  try {
    if (!cache.has(current)) {
      const snapshot = await readSnapshot(`tasks-${current}.json.gz`);
      cache.set(current, {...snapshot, names: new Map(snapshot.items.map((item) => [item.id, item.name]))});
    }
    if (version !== request) return;
    tasks = cache.get(current);
    populateTraders(tasks.items);
    byId("snapshot").textContent = `Data snapshot · ${tasks.date}`;
    render();
  } catch {
    if (version !== request) return;
    const retry = el("button", "Retry");
    retry.addEventListener("click", load, {once: true});
    status.replaceChildren("Tasks could not load. ", retry);
  }
}

search.addEventListener("input", render);
traderSelect.addEventListener("change", render);
statusSelect.addEventListener("change", render);
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value;
  load();
});
window.addEventListener("storage", (event) => {
  if (event.key === progressKey(mode) || event.key === null) render();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) render();
});
load();
