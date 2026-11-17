"use strict";

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const number = new Intl.NumberFormat("en");
let mode = params.get("mode") === "pvp" ? "pvp" : "pve";
let chapters = [];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function chapterCard(chapter, completed) {
  const id = `story:${chapter.id}`;
  const checked = completed.has(id);
  const card = el("li", null, checked ? "task-card done" : "task-card");
  card.id = chapter.id;
  const body = el("div", null, "task-card-body");
  body.append(el("h3", chapter.name, "task-name"));
  const items = el("ul", null, "story-items");
  for (const item of chapter.items) {
    const entry = el("li");
    const title = el(item.slug ? "a" : "strong", item.name);
    if (item.slug) title.href = `loot.html?${new URLSearchParams({mode, q: item.slug})}`;
    const detail = [item.count ? `×${number.format(item.count)}` : "", item.fir ? "Found in Raid" : "", item.action, item.note].filter(Boolean);
    entry.append(title, el("p", detail.join(" · "), "sub"));
    items.append(entry);
  }
  body.append(items);

  const footer = el("div", null, "task-card-footer");
  const label = el("label", null, "task-check");
  const box = el("input");
  box.type = "checkbox";
  box.checked = checked;
  box.setAttribute("aria-label", `Complete ${chapter.name}`);
  box.addEventListener("change", () => {
    setCompletedRequirement(mode, id, box.checked);
    render();
    byId(chapter.id).querySelector("input").focus({preventScroll: true});
  });
  label.append(box, el("span", checked ? "Completed" : "Mark chapter complete"));
  const wiki = el("a", "Chapter guide", "task-wiki");
  wiki.href = `https://escapefromtarkov.fandom.com/wiki/${chapter.wiki}`;
  footer.append(label, wiki);
  card.append(body, footer);
  return card;
}

function render() {
  byId("mode").value = mode;
  history.replaceState(null, "", `?mode=${mode}${location.hash}`);
  for (const [id, page] of [["compare-link", "./"], ["loot-link", "loot.html"], ["tasks-link", "tasks.html"]]) {
    byId(id).href = `${page}?mode=${mode}`;
  }
  if (!chapters.length) return;
  const completed = completedRequirements(mode);
  const done = chapters.filter((chapter) => completed.has(`story:${chapter.id}`)).length;
  byId("story-total").textContent = `${done} / ${chapters.length}`;
  byId("story-progress").value = done;
  byId("story-progress").max = chapters.length;
  byId("story-meter").hidden = false;
  byId("story-main").replaceChildren(...chapters.filter((chapter) => chapter.main).map((chapter) => chapterCard(chapter, completed)));
  byId("story-side").replaceChildren(...chapters.filter((chapter) => !chapter.main).map((chapter) => chapterCard(chapter, completed)));
}

async function loadStory() {
  try {
    chapters = await readSnapshot("story.json");
    byId("status").hidden = true;
    render();
    if (location.hash) byId(location.hash.slice(1))?.scrollIntoView();
  } catch {
    const retry = el("button", "Retry");
    retry.addEventListener("click", loadStory, {once: true});
    byId("status").replaceChildren("Story chapters could not load. ", retry);
  }
}
byId("mode").addEventListener("change", (event) => {
  mode = event.target.value;
  render();
});
window.addEventListener("storage", (event) => {
  if (event.key === progressKey(mode) || event.key === null) render();
});
window.addEventListener("pageshow", (event) => { if (event.persisted) render(); });
loadStory();
