// Small helpers shared by every page.

export function csrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content ?? "";
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** JSON API call with the CSRF header. Throws ApiError with the server's detail. */
export async function api(method, url, body, { raw = false } = {}) {
  const headers = { "X-CSRF-Token": csrfToken(), Accept: "application/json" };
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = raw ? body : JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
  if (res.status === 401) {
    window.location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
    throw new ApiError("Please log in again.", 401);
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`;
    throw new ApiError(detail, res.status);
  }
  return data;
}

export function toast(message, kind = "info", ms = 2600) {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast" + (kind === "error" ? " error" : "");
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

/** Copy text, falling back to execCommand where the async Clipboard API is
 *  unavailable (plain HTTP on a LAN is not a secure context). */
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function markdownFence(source) {
  // Use a longer fence if the source itself contains ``` so the block stays intact.
  let fence = "```";
  while (source.includes(fence)) fence += "`";
  return `${fence}mermaid\n${source.replace(/\s+$/, "")}\n${fence}\n`;
}

export async function copyWithToast(text, label = "Copied") {
  const ok = await copyText(text);
  toast(ok ? label : "Copy failed. Select the text and copy it manually.", ok ? "info" : "error");
  return ok;
}

export function slugify(text) {
  return (
    String(text)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "diagram"
  );
}

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function relativeTime(iso) {
  const then = new Date(iso);
  const secs = Math.round((Date.now() - then.getTime()) / 1000);
  if (secs < 45) return "just now";
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (secs < 3600) return fmt.format(-Math.round(secs / 60), "minute");
  if (secs < 86400) return fmt.format(-Math.round(secs / 3600), "hour");
  if (secs < 604800) return fmt.format(-Math.round(secs / 86400), "day");
  return then.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function readJson(id) {
  const el = document.getElementById(id);
  return el ? JSON.parse(el.textContent) : null;
}

/** Ask for confirmation using the shared <dialog id="confirm-dialog">. */
export function confirmDialog({ title, message, ok = "Delete" }) {
  const dialog = document.getElementById("confirm-dialog");
  if (!dialog) return Promise.resolve(window.confirm(message));
  dialog.querySelector("#confirm-title").textContent = title;
  dialog.querySelector("#confirm-message").textContent = message;
  dialog.querySelector("#confirm-ok").textContent = ok;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
}

/** Close any open <details class="menu"> when clicking elsewhere or choosing an item. */
export function wireMenus(root = document) {
  root.addEventListener("click", (event) => {
    for (const menu of document.querySelectorAll("details.menu[open]")) {
      const insideSummary = menu.querySelector("summary")?.contains(event.target);
      if (!insideSummary) menu.open = false;
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      for (const menu of document.querySelectorAll("details.menu[open]")) menu.open = false;
    }
  });
}

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  keys(prefix) {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  },
};
