"use strict";

const byId = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const percent = (value) => `${number.format(value * 100)}%`;
const rubles = (value) => `${number.format(value)} ₽`;
const plain = (value) => String(value);
const definitions = {
  rig: ["Armored rigs", ["banshee-plate-carrier", "cpc-plate-carrier-goons-edition", "avs-plate-carrier-ranger-green"]],
  armor: ["Body armor", ["6b43-zabralo", "6b45-body-armor", "thor-integrated"]],
  plate: ["Plates", ["granit-4", "granit-br5", "sapi"]],
  weapon: ["Weapons", ["colt-m4a1-556x45", "ak-74n-545x39", "hk-416a5-556x45"]],
  helmet: ["Helmets", ["6b47-ratnik", "ulach", "fast-mt"]],
  headset: ["Headsets", ["peltor-comtac-vi-headset-coyote", "peltor-comtac-v-headset", "sordin"]],
  backpack: ["Backpacks", ["pilgrim-tourist", "berkut", "tri-zip"]],
};

const protection = [
  ["class", "Armor class as sold", plain, "max"],
  ["softClass", "Highest built-in armor class", plain, "max"],
  ["zones", "Built-in coverage"],
  ["plateSlots", "Plate slots", (value) => value || "None"],
];
const mobility = [
  ["speedPenalty", "Movement speed", percent, "max"],
  ["turnPenalty", "Turning speed", percent, "max"],
  ["ergoPenalty", "Ergonomics", percent, "max"],
];
const storage = [["capacity", "Capacity", (value) => `${value} slots`, "max"], ["pockets", "Pocket sizes"]];
const metrics = {
  rig: [...protection, ...storage, ...mobility],
  armor: [...protection, ...mobility],
  plate: [["class", "Armor class", plain, "max"], ["durability", "Durability", plain, "max"], ["material", "Material"]],
  helmet: [
    ["class", "Armor class", plain, "max"], ["zones", "Coverage"],
    ["durability", "Durability", plain, "max"], ["deafening", "Sound muffling"],
    ["blocksHeadset", "Blocks headset", (value) => value ? "Yes" : "No"], ...mobility,
  ],
  headset: [
    ["distanceModifier", "Hearing range bonus", (value) => percent(value - 1), "max"],
    ["distortion", "Distortion", percent, "min"],
    ["ambientVolume", "Ambient volume", (value) => `${value} dB`],
    ["compressorGain", "Compressor gain", (value) => `${value} dB`],
  ],
  backpack: [...storage, ...mobility],
  weapon: [
    ["caliber", "Caliber"], ["preset", "Default preset"],
    ["ergonomics", "Ergonomics · default preset", plain, "max"],
    ["recoilVertical", "Vertical recoil · default preset", plain, "min"],
    ["recoilHorizontal", "Horizontal recoil · default preset", plain, "min"],
    ["moa", "Accuracy · default preset", (value) => `${number.format(value)} MOA`, "min"],
    ["fireRate", "Fire rate", (value) => `${number.format(value)} rounds/min`],
    ["effectiveDistance", "Effective distance", (value) => `${number.format(value)} m`],
  ],
};
const common = [
  ["weight", "Weight", (value) => `${number.format(value)} kg`, "min"],
  ["footprint", "Stash footprint"],
  ["flea", "Flea price · 24h average", rubles, "min"],
  ["vendor", "Best trader sell price", rubles, "max"],
];

const params = new URLSearchParams(location.search);
const initialGroup = params.get("category");
let group = Object.hasOwn(definitions, initialGroup) ? initialGroup : "rig";
let mode = params.get("mode") === "pve" ? "pve" : "pvp";
let data;
let loadVersion = 0;
const saved = new Map();
const cache = new Map();
if (params.has("items")) saved.set(group, params.get("items").split(",").slice(0, 3));
byId("mode").value = mode;
byId("differences").checked = params.get("diff") === "1";

function make(tag, content, className) {
  const element = document.createElement(tag);
  if (content != null) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function catalogue() {
  return data.items.filter((item) => item.group === group &&
    (group !== "rig" || item.stats.class > 0));
}

function selection() {
  if (!saved.has(group)) {
    const items = catalogue();
    const taken = new Set();
    saved.set(group, definitions[group][1].map((term) => {
      const item = items.find((entry) => entry.slug.includes(term) && !taken.has(entry.id))
        || items.find((entry) => !taken.has(entry.id));
      if (item) taken.add(item.id);
      return item?.id || "";
    }));
  }
  const ids = saved.get(group);
  return [ids[0] || "", ids[1] || "", ids[2] || ""];
}

function updateUrl(ids) {
  const state = new URLSearchParams({ category: group, mode, items: ids.join(",") });
  if (byId("differences").checked) state.set("diff", "1");
  history.replaceState(null, "", `?${state}`);
  byId("loot-link").href = `loot.html?mode=${mode}`;
  byId("tasks-link").href = `tasks.html?mode=${mode}`;
  byId("story-link").href = `story.html?mode=${mode}`;
}

function card(item, column, ids, items) {
  const cell = make("th");
  cell.scope = "col";
  const picker = make("div", null, "pick");
  const input = make("input");
  input.type = "search";
  input.placeholder = item ? "Replace item…" : "Search gear…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", `Search for item ${column + 1}`);
  input.setAttribute("aria-controls", `results-${column}`);
  const results = make("div", null, "results");
  results.id = `results-${column}`;
  results.hidden = true;

  function choose(id) {
    ids[column] = id;
    saved.set(group, ids);
    render();
    if (document.activeElement === document.body) {
      const replacement = byId("cards").querySelectorAll("input")[column];
      replacement.addEventListener("focus", () => { resultsFor(replacement).hidden = true; }, { once: true });
      replacement.focus();
    }
  }

  function show() {
    const search = input.value.toLowerCase().trim().split(/\s+/);
    const matches = items.filter((option) => !ids.includes(option.id) &&
      search.every((word) => `${option.name} ${option.short}`.toLowerCase().includes(word)));
    results.replaceChildren();
    if (!input.value && item) {
      const clear = make("button", "Clear this column");
      clear.addEventListener("click", () => choose(""));
      results.append(clear);
    }
    for (const option of matches.slice(0, 20)) {
      const button = make("button", option.name);
      button.type = "button";
      button.addEventListener("click", () => choose(option.id));
      results.append(button);
    }
    if (!matches.length && !results.childElementCount) results.append(make("p", "No matching gear"));
    results.hidden = false;
  }

  input.addEventListener("focus", show);
  input.addEventListener("click", show);
  input.addEventListener("input", show);
  picker.addEventListener("focusout", (event) => {
    if (!picker.contains(event.relatedTarget)) results.hidden = true;
  });
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.focus();
      results.hidden = true;
    }
    if (event.key === "ArrowDown" && !results.hidden) {
      const choices = [...results.querySelectorAll("button")];
      const current = choices.indexOf(document.activeElement);
      choices[Math.min(current + 1, choices.length - 1)]?.focus();
      event.preventDefault();
    }
    if (event.key === "ArrowUp" && !results.hidden && document.activeElement !== input) {
      const choices = [...results.querySelectorAll("button")];
      (choices[choices.indexOf(document.activeElement) - 1] || input).focus();
      event.preventDefault();
    }
    if (event.key === "Enter" && document.activeElement === input && input.value && !results.hidden) {
      results.querySelector("button")?.click();
    }
  });
  picker.append(input, results);
  cell.append(picker);
  const content = make("div", null, "item");
  if (item) {
    if (item.image) {
      const image = make("img");
      image.src = item.image;
      image.alt = "";
      image.addEventListener("error", () => image.remove(), { once: true });
      content.append(image);
    }
    content.append(make("h2", item.name));
    if (item.url) {
      const link = make("a", "Open item ↗");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      content.append(link);
    }
  } else {
    content.append(make("small", "Choose an item to compare"));
  }
  cell.append(content);
  return cell;
}

function resultsFor(input) {
  return byId(input.getAttribute("aria-controls"));
}

function renderRows(items) {
  const body = byId("stats");
  body.replaceChildren();
  for (const [key, label, format = plain, direction] of [...metrics[group], ...common]) {
    const values = items.map((item) => item?.stats[key] ?? null);
    const shown = values.map((value, index) => {
      if (key === "flea" && items[index]?.fleaAllowed === false) return "Flea-banned";
      return value == null ? "—" : format(value);
    });
    const active = shown.filter((_, index) => items[index]);
    if (active.every((value) => value === "—")) continue;
    if (byId("differences").checked && active.length > 1 && new Set(active).size === 1) continue;
    const comparable = values.filter((value) => typeof value === "number");
    const varied = new Set(comparable).size > 1;
    const best = direction && varied ? Math[direction](...comparable) : null;
    const row = make("tr");
    const name = make("th", label);
    name.scope = "row";
    row.append(name);
    for (let index = 0; index < items.length; index++) {
      const wins = best !== null && values[index] === best;
      const cell = make("td", shown[index], wins ? "best" : "");
      if (wins) cell.title = "Best value in this row";
      row.append(cell);
    }
    body.append(row);
  }
  if (!body.childElementCount) {
    const row = make("tr");
    const cell = make("td", "No statistics to show.");
    cell.colSpan = 4;
    row.append(cell);
    body.append(row);
  }
}

function render() {
  const items = catalogue();
  const ids = selection();
  const selected = ids.map((id) => items.find((item) => item.id === id));
  const header = make("tr");
  const label = make("th", "Statistic");
  label.scope = "col";
  header.append(label);
  selected.forEach((item, column) => header.append(card(item, column, ids, items)));
  byId("cards").replaceChildren(header);
  renderRows(selected);
  byId("comparison").hidden = false;
  byId("status").textContent = `${items.length} items · ${selected.filter(Boolean).length} selected`;
  byId("snapshot").textContent = `Data snapshot · ${data.date}`;
  updateUrl(ids);
  for (const button of byId("categories").children) {
    button.setAttribute("aria-pressed", String(button.dataset.group === group));
  }
}

async function load() {
  const version = ++loadVersion;
  const current = mode;
  byId("comparison").hidden = true;
  byId("status").textContent = "Loading gear…";
  byId("snapshot").textContent = "";
  try {
    if (!cache.has(current)) {
      const [gear, weapons] = await Promise.all([
        readSnapshot(`${current}.json`), readSnapshot(`weapons-${current}.json.gz`),
      ]);
      cache.set(current, { date: gear.date, items: [...gear.items, ...weapons.items] });
    }
    if (version !== loadVersion) return;
    data = cache.get(current);
    render();
  } catch {
    if (version !== loadVersion) return;
    data = null;
    const retry = make("button", "Retry");
    retry.addEventListener("click", load, { once: true });
    byId("status").replaceChildren("Gear data could not load. ", retry);
  }
}

for (const [key, [label]] of Object.entries(definitions)) {
  const button = make("button", label);
  button.dataset.group = key;
  button.setAttribute("aria-pressed", String(key === group));
  button.addEventListener("click", () => {
    group = key;
    if (data && !byId("comparison").hidden) render();
  });
  byId("categories").append(button);
}
byId("mode").addEventListener("change", (event) => {
  mode = event.target.value;
  load();
});
byId("differences").addEventListener("change", () => {
  if (!data || byId("comparison").hidden) return;
  const ids = selection();
  const items = catalogue();
  renderRows(ids.map((id) => items.find((item) => item.id === id)));
  updateUrl(ids);
});
load();
