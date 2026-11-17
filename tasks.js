"use strict";

const byId = (id) => document.getElementById(id);
const modeSelect = byId("mode");
const search = byId("task-search");
const traderSelect = byId("task-trader");
const statusSelect = byId("task-status");
const list = byId("task-list");
const status = byId("status");
const more = byId("task-more");
const clearTask = byId("task-clear");
const number = new Intl.NumberFormat("en");
const pageSize = 18;
const params = new URLSearchParams(location.search);
const cache = new Map();
let mode = params.get("mode") === "pve" ? "pve" : "pvp";
let tasks = null;
let request = 0;
let limit = pageSize;
let focusedTask = params.get("task") || "";

modeSelect.value = mode;
search.value = params.get("q") || "";

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function taskImage(url, className) {
  const image = el("img", null, className);
  image.src = url;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  return image;
}

function taskArtwork(task, isDone) {
  const artwork = el("div", null, "task-artwork");
  function fallback() {
    if (!task.portrait) return;
    const portrait = taskImage(task.portrait, "task-portrait");
    portrait.addEventListener("error", () => portrait.remove(), {once: true});
    artwork.prepend(portrait);
  }
  if (task.image) {
    const image = taskImage(task.image, "task-scene");
    image.addEventListener("error", () => {
      image.remove();
      fallback();
    }, {once: true});
    artwork.append(image);
  } else {
    fallback();
  }
  if (isDone) artwork.append(el("span", "Completed", "task-completed"));
  return artwork;
}

function appendObjectives(content, objectives) {
  if (!objectives?.length) return;
  const section = el("section", null, "task-detail");
  section.append(el("h4", "Objectives"));
  const rows = objectives.map((objective) => {
    const row = el("li", null);
    const quantity = objective.count ? `×${number.format(objective.count)} · ` : "";
    row.append(el("span", `${quantity}${objective.text}`));
    if (objective.optional) row.append(el("span", "Optional", "task-note"));
    if (objective.specs?.length) row.append(el("small", objective.specs.join(" · "), "sub task-specs"));
    return row;
  });
  const list = el("ul", null, "task-detail-list");
  list.append(...rows.slice(0, 3));
  section.append(list);
  if (rows.length > 3) {
    const details = el("details", null, "task-expand");
    const rest = el("ul", null, "task-detail-list");
    rest.append(...rows.slice(3));
    details.append(el("summary", `Show ${rows.length - 3} more objectives`), rest);
    section.append(details);
  }
  content.append(section);
}

function itemLink([id, name]) {
  const link = el("a", name, "task-item-link");
  link.href = `loot.html?${new URLSearchParams({mode, q: id})}`;
  return link;
}

function requirementRow(requirement) {
  const {action, count, fir, optional, alternative, items} = requirement;
  const row = el("li", null, "task-item-row");
  const summary = el("div", null, "task-item-label");
  const quantity = count != null ? ` ×${number.format(count)}${alternative ? " total" : ""}` : "";
  summary.append(el("span", `${action}${quantity}`));
  if (fir) summary.append(el("span", "Found in Raid", "badge fir"));
  if (optional) summary.append(el("span", "Optional", "task-note"));
  row.append(summary);
  if (items.length === 1) {
    const item = tasks.catalogue[items[0]];
    if (item) row.append(itemLink(item));
    return row;
  }
  const options = el("details", null, "task-expand");
  const label = alternative ? `See ${items.length} eligible options` : `See ${items.length} listed items`;
  options.append(el("summary", label));
  options.addEventListener("toggle", () => {
    if (!options.open) return;
    const list = el("ul", null, "task-detail-list");
    for (const ref of items) {
      const item = tasks.catalogue[ref];
      if (item) {
        const option = el("li");
        option.append(itemLink(item));
        list.append(option);
      }
    }
    options.append(list);
  }, {once: true});
  row.append(options);
  return row;
}

function appendItems(content, requirements) {
  if (!requirements?.length) return;
  const section = el("section", null, "task-detail");
  section.append(el("h4", "Items needed"));
  const list = el("ul", null, "task-detail-list");
  list.append(...requirements.slice(0, 3).map(requirementRow));
  section.append(list);
  if (requirements.length > 3) {
    const details = el("details", null, "task-expand");
    const rest = el("ul", null, "task-detail-list");
    rest.append(...requirements.slice(3).map(requirementRow));
    details.append(el("summary", `Show ${requirements.length - 3} more item requirements`), rest);
    section.append(details);
  }
  content.append(section);
}

function taskRow(task, names, completed) {
  const isDone = completed.has(task.id);
  const row = el("li", null, isDone ? "task-card done" : "task-card");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = isDone;
  checkbox.id = `task-${task.id}`;
  checkbox.setAttribute("aria-label", `Complete ${task.name}`);
  checkbox.addEventListener("change", () => {
    const neighboringRow = row.nextElementSibling || row.previousElementSibling;
    const nextCheckbox = neighboringRow?.querySelector("input")?.id;
    setCompletedRequirement(mode, task.id, checkbox.checked);
    render();
    (byId(checkbox.id) || byId(nextCheckbox) || search).focus({preventScroll: true});
  });

  const content = el("div", null, "task-card-body");
  const metadata = [
    task.trader, task.level ? `PMC level ${task.level}` : "",
    /^(bear|usec)$/i.test(task.faction || "") ? task.faction.toUpperCase() : "",
  ].filter(Boolean);
  const meta = el("div", null, "task-meta");
  if (task.portrait) {
    const portrait = taskImage(task.portrait, "task-portrait");
    portrait.addEventListener("error", () => portrait.remove(), {once: true});
    meta.append(portrait);
  }
  if (metadata.length) meta.append(el("span", metadata.join(" · "), "sub"));
  content.append(meta, el("h3", task.name, "task-name"));
  if (task.requirements.length) {
    const prerequisites = task.requirements.map(([id, states]) =>
      !states.length || (states.length === 1 && states[0] === "complete")
        ? names.get(id)
        : `${names.get(id)} (${states.join(" or ")})`);
    content.append(el("p", `Requires ${prerequisites.join(" · ")}`, "task-prereqs sub"));
  }

  if (task.traderRequirements?.length) {
    content.append(el("p", task.traderRequirements.join(" · "), "task-prereqs sub"));
  }

  appendObjectives(content, task.objectives);
  appendItems(content, task.itemRequirements);

  const footer = el("div", null, "task-card-footer");
  const label = el("label", null, "task-check");
  label.append(checkbox, el("span", isDone ? "Completed" : "Mark complete"));
  footer.append(label);
  if (task.url) {
    const link = el("a", "Wiki", "task-wiki");
    link.href = task.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Wiki for ${task.name}`);
    footer.append(link);
  }
  row.append(taskArtwork(task, isDone), content, footer);
  return row;
}

function updateLinks() {
  const query = new URLSearchParams({mode});
  const term = search.value.trim();
  if (term) query.set("q", term);
  if (focusedTask) query.set("task", focusedTask);
  clearTask.hidden = !focusedTask;
  history.replaceState(null, "", `?${query}`);
  byId("compare-link").href = `./?mode=${mode}`;
  byId("loot-link").href = `loot.html?mode=${mode}`;
  byId("story-link").href = `story.html?mode=${mode}`;
}

function render() {
  updateLinks();
  if (!tasks) return;
  const completed = completedRequirements(mode);
  const done = tasks.items.filter((task) => completed.has(task.id)).length;
  const term = search.value.trim().toLowerCase();
  const selected = tasks.items.filter((task) => {
    if (focusedTask) return focusedTask === task.id;
    if (traderSelect.value && traderSelect.value !== task.trader) return false;
    if (statusSelect.value === "remaining" && completed.has(task.id)) return false;
    if (statusSelect.value === "completed" && !completed.has(task.id)) return false;
    return !term || task.name.toLowerCase().includes(term);
  });
  const shown = selected.slice(0, limit);
  list.replaceChildren(...shown.map((task) => taskRow(task, tasks.names, completed)));
  byId("task-total").textContent = `${done} / ${tasks.items.length}`;
  const meter = byId("task-progress");
  meter.max = tasks.items.length;
  meter.value = done;
  byId("task-meter").hidden = false;
  status.textContent = selected.length ? `Showing ${shown.length} of ${selected.length} tasks` : focusedTask ? "This task is unavailable in the selected mode." : "No matching tasks";
  more.hidden = shown.length === selected.length;
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
  byId("task-meter").hidden = true;
  more.hidden = true;
  byId("snapshot").textContent = "";
  updateLinks();

  try {
    if (!cache.has(current)) {
      const snapshot = await readSnapshot(`tasks-${current}.json.gz`, "4");
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

function filterTasks() {
  focusedTask = "";
  limit = pageSize;
  render();
}

clearTask.addEventListener("click", () => {
  search.value = "";
  filterTasks();
  search.focus();
});
search.addEventListener("input", filterTasks);
traderSelect.addEventListener("change", filterTasks);
statusSelect.addEventListener("change", filterTasks);
more.addEventListener("click", () => {
  const firstNew = limit;
  limit += pageSize;
  render();
  list.children[firstNew]?.querySelector("input")?.focus();
});
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value;
  limit = pageSize;
  load();
});
window.addEventListener("storage", (event) => {
  if (event.key === progressKey(mode) || event.key === null) render();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) render();
});
load();
