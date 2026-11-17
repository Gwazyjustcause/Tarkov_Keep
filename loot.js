"use strict";

const byId = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en");
const rubles = (value) => value ? `${number.format(value)} ₽` : "—";
const aliases = {"gpu": "graphics card", "salewa kit": "salewa", "t-plug": "t-shaped plug"};
const filter = byId("loot-filter");
const query = byId("loot-search");
const results = byId("loot-results");
const modeSelect = byId("mode");
const params = new URLSearchParams(location.search);
const filters = new Set([...filter.options].map((option) => option.value));
const cache = new Map();
const openItems = new Set();
const pageSize = 24;
let limit = pageSize;
let mode = params.get("mode") === "pve" ? "pve" : "pvp";
let request = 0;
let data = null;

modeSelect.value = mode;
query.value = params.get("q") || "";
filter.value = filters.has(params.get("show")) ? params.get("show") : "all";

function el(tag, content, className) {
  const element = document.createElement(tag);
  if (content != null) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function unpack(snapshot) {
  return snapshot.items.map(([id, name, short, slots, flea, trader, needs, slug, banned]) => {
    const valuePerSlot = slots ? Math.floor(Math.max(flea, trader) / slots) : 0;
    return {id, name, short, slots, flea, trader, needs, slug, banned, valuePerSlot};
  });
}

function rank(need) {
  if (need.kappa) return 0;
  if (need.action === "Sell for task") return 5;
  if (need.optional || need.alternative) return 4;
  if (need.kind === "task") return need.fir ? 1 : 2;
  return 3;
}

function statusFor(item, completed) {
  const remaining = item.needs.filter((need) => !completed.has(need.group));
  const relevant = remaining.filter((need) => need.action !== "Sell for task");
  const required = relevant.filter((need) => !need.optional && !need.alternative);
  const kappa = required.some((need) => need.kappa);
  const task = required.some((need) => need.kind === "task");
  const hideout = required.some((need) => need.kind === "hideout");
  const fir = required.some((need) => need.fir);
  if (kappa) return {label: "Keep for Collector / Kappa", kappa, fir, hideout, keep: true};
  if (task) return {label: "Keep for tasks", fir, hideout, keep: true};
  if (hideout) return {label: "Keep for Hideout", fir, hideout, keep: true};
  if (relevant.length) return {label: "Optional or alternate task item", alternate: true};
  if (remaining.length) return {label: "Can sell for a task"};
  if (item.needs.length) return {label: "No remaining requirements"};
  return {label: "No listed task or Hideout use"};
}

function matchesFilter(status) {
  switch (filter.value) {
    case "needed": return status.keep;
    case "fir": return status.fir;
    case "kappa": return status.kappa;
    case "hideout": return status.hideout;
    case "sell": return !status.keep && !status.alternate;
    default: return true;
  }
}

function tradeStats(item) {
  const row = el("div", null, "loot-detail-prices");
  row.append(el("span", `Stash space: ${item.slots} ${item.slots === 1 ? "slot" : "slots"}`));
  return row;
}

function appendNeeds(body, item, completed) {
  const groups = new Map();
  for (const need of [...item.needs].sort((a, b) =>
    Number(completed.has(a.group)) - Number(completed.has(b.group)) ||
    rank(a) - rank(b) || a.name.localeCompare(b.name))) {
    const group = groups.get(need.group) || [];
    group.push(need);
    groups.set(need.group, group);
  }

  if (!groups.size) {
    body.append(el("p", "No task or Hideout requirement was found for this item.", "sub"));
  }
  for (const [group, needs] of groups) {
    const first = needs[0];
    const checked = completed.has(group);
    const row = el("div", null, checked ? "need done" : "need");
    const desc = el("div", null, "need-name");
    const title = first.url ? el("a", first.name) : el("strong", first.name);
    if (first.url) {
      title.href = first.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    desc.append(title);
    for (const need of needs) {
      const tokens = [need.action];
      if (need.count != null) tokens.push(need.alternative ? `${number.format(need.count)} total across eligible items` : `×${number.format(need.count)}`);
      if (need.fir) tokens.push("Found in Raid");
      if (need.alternative && need.count == null) tokens.push("One option");
      if (need.optional) tokens.push("Optional objective");
      desc.append(el("p", tokens.join(" · "), "sub"));
    }
    const label = el("label");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.dataset.group = group;
    checkbox.setAttribute("aria-label", `Mark ${first.name} complete`);
    checkbox.addEventListener("change", () => {
      setCompletedRequirement(mode, group, checkbox.checked);
      render();
      const updated = document.getElementById(`item-${item.id}`);
      const target = updated?.querySelector(`input[data-group="${CSS.escape(group)}"]`);
      (target || query).focus({preventScroll: !!target});
    });
    label.append(checkbox, " Complete");
    row.append(desc, label);
    body.append(row);
  }
}

function priceLine(label, value) {
  const row = el("span", null, "loot-price-line");
  row.append(el("span", label, "sub"), el("strong", value));
  return row;
}

function card(item, status, completed) {
  const details = el("details", null, "loot-item");
  details.id = `item-${item.id}`;
  details.open = openItems.has(item.id);
  details.addEventListener("toggle", () => {
    if (details.open) openItems.add(item.id);
    else openItems.delete(item.id);
  });
  const summary = el("summary");
  const icon = el("img", null, "loot-icon");
  icon.src = `https://assets.tarkov.dev/${item.id}-icon.webp`;
  icon.alt = "";
  icon.loading = "lazy";
  icon.addEventListener("error", () => { icon.style.visibility = "hidden"; }, {once: true});
  const heading = el("span");
  const badges = el("span", null, "loot-meta");
  badges.append(el("span", status.label, status.keep ? "badge keep" : "badge"));
  if (status.fir) badges.append(el("span", "Found in Raid", "badge fir"));
  heading.append(el("span", item.name, "loot-title"), badges);
  const pricing = el("span", null, "loot-price");
  pricing.append(
    priceLine("Flea", item.banned ? "Banned" : rubles(item.flea)),
    priceLine("Trader sell", rubles(item.trader)),
  );
  if (item.valuePerSlot) pricing.append(el("span", `${rubles(item.valuePerSlot)}/slot`, "sub"));
  summary.append(icon, heading, pricing);

  const body = el("div", null, "loot-details");
  body.append(tradeStats(item));
  appendNeeds(body, item, completed);
  details.append(summary, body);
  return details;
}

function setURL() {
  const state = new URLSearchParams({mode});
  const term = query.value.trim();
  if (term) state.set("q", term);
  if (filter.value !== "all") state.set("show", filter.value);
  history.replaceState(null, "", `?${state}`);
  byId("compare-link").href = `./?mode=${mode}`;
  byId("tasks-link").href = `tasks.html?mode=${mode}`;
}

function searchScore(item, term) {
  const name = item.name.toLowerCase();
  const short = item.short.toLowerCase();
  if (term === name || term === short) return 3;
  if (name.startsWith(term) || short.startsWith(term)) return 2;
  if (term === item.slug || term.split(/\s+/).every((word) => name.includes(word) || short.includes(word))) return 1;
  return 0;
}

function render() {
  setURL();
  if (!data) return;
  const raw = query.value.trim().toLowerCase();
  const term = Object.hasOwn(aliases, raw) ? aliases[raw] : raw;
  const completed = completedRequirements(mode);
  const selected = data.items.flatMap((item) => {
    const score = term ? searchScore(item, term) : 1;
    if (!score) return [];
    const status = statusFor(item, completed);
    return matchesFilter(status) ? [{item, status, score}] : [];
  });
  selected.sort((a, b) => b.score - a.score ||
    (term ? a.item.name.localeCompare(b.item.name) : b.item.valuePerSlot - a.item.valuePerSlot));
  const shown = selected.slice(0, limit);
  results.replaceChildren(...shown.map(({item, status}) => card(item, status, completed)));
  byId("status").textContent = selected.length
    ? `Showing ${number.format(shown.length)} of ${number.format(selected.length)} items`
    : "No loot matches this search and filter.";
  byId("more").hidden = shown.length === selected.length;
}

async function load() {
  const version = ++request;
  const current = mode;
  data = null;
  results.replaceChildren();
  byId("more").hidden = true;
  byId("snapshot").textContent = "";
  byId("status").textContent = "Loading loot…";
  setURL();
  try {
    if (!cache.has(current)) {
      const snapshot = await readSnapshot(`loot-${current}.json.gz`);
      cache.set(current, {date: snapshot.date, items: unpack(snapshot)});
    }
    if (version !== request) return;
    data = cache.get(current);
    byId("snapshot").textContent = `Data snapshot · ${data.date}`;
    render();
  } catch {
    if (version !== request) return;
    const retry = el("button", "Retry");
    retry.addEventListener("click", load, {once: true});
    byId("status").replaceChildren("Loot data could not load. ", retry);
  }
}

function updateResults() {
  limit = pageSize;
  render();
}

query.addEventListener("input", updateResults);
filter.addEventListener("change", updateResults);
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value;
  limit = pageSize;
  openItems.clear();
  load();
});
byId("more").addEventListener("click", () => {
  const previous = limit;
  limit += pageSize;
  render();
  results.children[previous]?.querySelector("summary")?.focus();
});
window.addEventListener("storage", (event) => {
  if (event.key === progressKey(mode) || event.key === null) render();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) render();
});
load();
