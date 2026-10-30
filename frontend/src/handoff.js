// "Open in Mermaid Factory" from another page: the code rides in the URL's
// fragment (#source=…, base64url of the UTF-8 text), so it never reaches a
// server log and isn't limited by URL length the way a query string is.
// The new-diagram editor picks it up, unsaved, and clears the fragment.
//
// Round trip: with `back` ({ origin, ref, label }) the editor also shows
// "Save to <label>", which posts { type: SAVE, ref, source, title } to the
// window that opened it (window.opener, at `origin`). That page answers with
// { type: SAVED, ref, ok, message }. openInFactory() is the opening page's side.

export const SAVE = "mermaid-factory:save";
export const SAVED = "mermaid-factory:saved";

const toBase64Url = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text) => {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** The fragment for `source` (and an optional `title` and `back`), without the leading "#". */
export function handoffHash(source, title, back) {
  const params = [["source", toBase64Url(new TextEncoder().encode(source))]];
  if (title) params.push(["title", title]);
  if (back) {
    params.push(["return", back.origin], ["ref", back.ref]);
    if (back.label) params.push(["label", back.label]);
  }
  return params.map(([k, v]) => `${k}=${k === "source" ? v : encodeURIComponent(v)}`).join("&");
}

/** The link that opens `source` as a new diagram in the Mermaid Factory at `base`. */
export function factoryLink(source, { base = "", title, back } = {}) {
  return `${base.replace(/\/+$/, "")}/diagrams/new/edit#${handoffHash(source, title, back)}`;
}

// Only a page's origin (http or https) can be a place to send a diagram back to.
function returnOrigin(text) {
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) && url.origin === text ? url.origin : null;
  } catch {
    return null;
  }
}

/** { source, title, back } from a location.hash made by handoffHash, or null. */
export function readHandoff(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const encoded = params.get("source");
  if (!encoded) return null;
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(encoded));
  } catch {
    return null;
  }
  const origin = returnOrigin(params.get("return") || "");
  const ref = params.get("ref");
  const back = origin && ref ? { origin, ref, label: params.get("label") || new URL(origin).host } : null;
  return { source, title: params.get("title") || null, back };
}

const newRef = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Opens `source` in the Mermaid Factory at `base`, in a new tab, with
 * "Save to <label>" there. Each save there calls `onSave(source, { title })`,
 * which returns (or resolves to) true when it was kept, or a message saying
 * why not; Mermaid Factory shows the outcome. Returns { window, stop }, where
 * stop() stops listening.
 */
export function openInFactory(source, { base, title, label, onSave }) {
  const factoryOrigin = new URL(base, location.href).origin;
  const ref = newRef();
  const url = factoryLink(source, { base, title, back: { origin: location.origin, ref, label } });
  // Not noopener: Mermaid Factory sends the diagram back through window.opener.
  const win = window.open(url, "_blank");
  const listener = async (e) => {
    const data = e.data;
    if (e.origin !== factoryOrigin || !data || data.type !== SAVE || data.ref !== ref) return;
    let result;
    try {
      result = await onSave(String(data.source ?? ""), { title: data.title ?? null });
    } catch (err) {
      result = err?.message || String(err);
    }
    const ok = result === true;
    e.source?.postMessage({ type: SAVED, ref, ok, message: ok ? null : String(result || "") }, factoryOrigin);
  };
  window.addEventListener("message", listener);
  return { window: win, stop: () => window.removeEventListener("message", listener) };
}
