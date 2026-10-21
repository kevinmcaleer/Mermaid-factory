// Dashboard: list, search, filter and manage the user's diagrams.

import { api, confirmDialog, copyWithToast, debounce, markdownFence, readJson, relativeTime, toast, wireMenus } from "./common.js";
import { lazyThumb, thumbObserver } from "./thumbs.js";

const $ = (sel) => document.querySelector(sel);
const typeLabels = readJson("type-labels") || {};
const grid = $("#diagram-grid");
const template = $("#card-template");
const observer = thumbObserver();
const PER_PAGE = 48;

const params = new URLSearchParams(location.search);
const filters = { q: params.get("q") || "", type: params.get("type") || "", tag: params.get("tag") || "" };
let page = 1;
let pages = 1;
let loading = false;
let requestSeq = 0;

$("#search").value = filters.q;

function syncUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

async function load({ append = false } = {}) {
  if (loading && append) return;
  loading = true;
  const seq = ++requestSeq;
  const p = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  try {
    const data = await api("GET", `/api/diagrams?${p}`);
    if (seq !== requestSeq) return;
    pages = data.pages;
    if (!append) grid.innerHTML = "";
    for (const item of data.items) grid.append(card(item));
    renderChips(data);
    const filtered = Object.values(filters).some(Boolean);
    const anyAtAll = data.types.length > 0;
    $("#empty-state").hidden = anyAtAll;
    $("#no-results").hidden = !anyAtAll || data.total > 0 || !filtered;
    $("#load-more").hidden = page >= pages;
    const all = data.types.reduce((n, t) => n + t.count, 0);
    $("#diagram-total").textContent = all ? (filtered ? `(${data.total} of ${all})` : `(${all})`) : "";
  } catch (err) {
    toast(err.message, "error");
  } finally {
    loading = false;
  }
}

function chip(label, count, pressed, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip";
  btn.setAttribute("aria-pressed", String(pressed));
  btn.textContent = label;
  if (count !== null) {
    const c = document.createElement("span");
    c.className = "count";
    c.textContent = count;
    btn.append(c);
  }
  btn.addEventListener("click", onClick);
  return btn;
}

function renderChips(data) {
  const types = $("#type-chips");
  types.innerHTML = "";
  if (data.types.length > 1 || filters.type) {
    types.append(chip("All types", null, !filters.type, () => setFilter("type", "")));
    for (const t of data.types) {
      types.append(chip(t.label, t.count, filters.type === t.type, () => setFilter("type", filters.type === t.type ? "" : t.type)));
    }
  }
  const tags = $("#tag-chips");
  tags.innerHTML = "";
  for (const tag of data.tags) {
    tags.append(chip(`#${tag}`, null, filters.tag.toLowerCase() === tag.toLowerCase(), () => setFilter("tag", filters.tag === tag ? "" : tag)));
  }
}

function setFilter(key, value) {
  filters[key] = value;
  page = 1;
  syncUrl();
  load();
}

const onSearch = debounce(() => setFilter("q", $("#search").value.trim()), 250);
$("#search").addEventListener("input", onSearch);
$("#load-more").addEventListener("click", () => {
  page += 1;
  load({ append: true });
});

function card(item) {
  const node = template.content.firstElementChild.cloneNode(true);
  const href = `/diagrams/${item.id}/edit`;
  node.dataset.id = item.id;
  node.querySelector(".dcard-thumb").href = href;
  const title = node.querySelector(".dcard-title");
  title.href = href;
  title.textContent = item.title;
  const badge = node.querySelector(".badge");
  badge.textContent = typeLabels[item.diagram_type] || item.diagram_type;
  node.querySelector(".dcard-shared").hidden = !item.shared;
  const time = node.querySelector("time");
  time.dateTime = item.updated_at;
  time.textContent = relativeTime(item.updated_at);
  time.title = new Date(item.updated_at).toLocaleString();
  const tags = node.querySelector(".dcard-tags");
  for (const t of item.tags) {
    const s = document.createElement("span");
    s.className = "tag";
    s.textContent = `#${t}`;
    tags.append(s);
  }
  lazyThumb(observer, node.querySelector(".thumb-inner"), {
    source: item.source,
    theme: item.theme,
    config: item.config,
    cacheKey: `${item.id}:${item.updated_at}`,
  });
  node.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", () => act(btn.dataset.action, item, node)),
  );
  return node;
}

function startRename(item, node) {
  const title = node.querySelector(".dcard-title");
  const input = node.querySelector(".dcard-rename");
  input.value = item.title;
  title.hidden = true;
  input.hidden = false;
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    input.hidden = true;
    title.hidden = false;
    const value = input.value.trim();
    if (!commit || !value || value === item.title) return;
    try {
      const d = await api("PUT", `/api/diagrams/${item.id}`, { title: value });
      item.title = d.title;
      title.textContent = d.title;
      toast("Renamed");
    } catch (err) {
      toast(err.message, "error");
    }
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  };
  input.onblur = () => finish(true);
}

async function act(action, item, node) {
  switch (action) {
    case "open":
      location.href = `/diagrams/${item.id}/edit`;
      break;
    case "rename":
      startRename(item, node);
      break;
    case "duplicate":
      try {
        await api("POST", `/api/diagrams/${item.id}/duplicate`);
        toast("Duplicated");
        page = 1;
        load();
      } catch (err) {
        toast(err.message, "error");
      }
      break;
    case "copy":
      copyWithToast(item.source, "Code copied");
      break;
    case "copy-md":
      copyWithToast(markdownFence(item.source), "Markdown copied");
      break;
    case "delete": {
      const ok = await confirmDialog({
        title: "Delete diagram?",
        message: `"${item.title}" and its history will be permanently deleted.`,
      });
      if (!ok) return;
      try {
        await api("DELETE", `/api/diagrams/${item.id}`);
        node.remove();
        toast("Deleted");
        load();
      } catch (err) {
        toast(err.message, "error");
      }
      break;
    }
  }
}

wireMenus();
load();
