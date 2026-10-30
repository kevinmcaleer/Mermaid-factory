// "Open in Mermaid Factory" from another page: the code rides in the URL's
// fragment (#source=…, base64url of the UTF-8 text), so it never reaches a
// server log and isn't limited by URL length the way a query string is.
// The new-diagram editor picks it up, unsaved, and clears the fragment.

const toBase64Url = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text) => {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** The fragment for `source` (and an optional `title`), without the leading "#". */
export function handoffHash(source, title) {
  const parts = [`source=${toBase64Url(new TextEncoder().encode(source))}`];
  if (title) parts.push(`title=${encodeURIComponent(title)}`);
  return parts.join("&");
}

/** The link that opens `source` as a new diagram in the Mermaid Factory at `base`. */
export function factoryLink(source, { base = "", title } = {}) {
  return `${base.replace(/\/+$/, "")}/diagrams/new/edit#${handoffHash(source, title)}`;
}

/** { source, title } from a location.hash made by handoffHash, or null. */
export function readHandoff(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const encoded = params.get("source");
  if (!encoded) return null;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(encoded));
    return { source, title: params.get("title") || null };
  } catch {
    return null;
  }
}
