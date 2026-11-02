/**
 * Everything that leaves this process passes through here: tool results, tool errors and logs.
 * Listing text is untrusted, so it is cleaned of invisible characters and clipped, and anything
 * that looks like an API key is removed even when the upstream sends it back.
 */

const KEY_PATTERN = /au_live_[A-Za-z0-9_-]+/g;
export const REDACTED = "[redacted]";

const MAX_STRING = 2_000;
const MAX_ENTRIES = 200;
const MAX_DEPTH = 8;
const CLIPPED = "…[clipped]";

// Controls except \t \n \r, zero-width and bidi format characters, variation selectors and the
// Unicode tag block: these are how instructions are hidden from a person who reads the same text
// as the model.
const INVISIBLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const LINK_REMOVED = "[link removed]";

/** The API's signed photos and nothing else on its host. */
const PHOTO_HOST = "api.apiauto.space";
const PHOTO_PATH = "/img/";
/** The pages the API's normalizer lets through as `listing_url`. Copart and IAAI have none. */
const LISTING_HOSTS = ["fem.encar.com", "www.che168.com"];
const LISTING_SUFFIX = ".che168.com";

// A scheme with slashes either way, a host with no scheme, www., or a script or data scheme. It runs
// on cleaned text, so a zero-width character cannot split a scheme. Bare domains are left alone:
// without a scheme nothing renders them, and "2.4L" or "A/C" must survive.
const LINK =
  /!*(?:\b[a-z][a-z0-9+.-]*:[\\/]{2}|(?<![\w:/\\])[\\/]{2}(?=[a-z0-9-]+\.)|\bwww\.(?=[a-z0-9-]+\.)|\b(?:javascript|vbscript|data):(?=\S))[^\s<>"'`]*/gi;
// The brackets of Markdown images and links, with whatever would rebuild them next to the marker.
const MARKDOWN = /!+\[\(*|!*\]\(+/g;
// Characters that have no place in a link we vouch for, though URL would accept some of them.
const LINK_BREAKERS = /[\s\\()<>[\]{}|^`"'\u0000-\u001f\u007f]/;

function parseLink(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048 || LINK_BREAKERS.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const plain = url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "";
  return plain ? url : null;
}

/** A link to one of the API's photos, normalized, or null. */
export function safePhotoUrl(value: unknown): string | null {
  const url = parseLink(value);
  return url && url.hostname === PHOTO_HOST && url.pathname.startsWith(PHOTO_PATH) ? url.href : null;
}

/** A link to a listing at its source, normalized, or null. */
export function safeListingUrl(value: unknown): string | null {
  const url = parseLink(value);
  const allowed = url && (LISTING_HOSTS.includes(url.hostname) || url.hostname.endsWith(LISTING_SUFFIX));
  return url && allowed ? url.href : null;
}

function removeLinks(text: string): string {
  return text
    .replace(LINK, (link) => safePhotoUrl(link) ?? safeListingUrl(link) ?? LINK_REMOVED)
    .replace(MARKDOWN, LINK_REMOVED);
}

export type Redact = (text: string) => string;

/** Removes the given key and any key-shaped string from a text. */
export function makeRedactor(apiKey: string | null): Redact {
  return (text) => {
    const clean = apiKey ? text.split(apiKey).join(REDACTED) : text;
    return clean.replace(KEY_PATTERN, REDACTED);
  };
}

/** Removes invisible characters and foreign links, and clips a string from an untrusted source. */
export function cleanText(text: string, redact: Redact, max = MAX_STRING): string {
  const clean = redact(removeLinks(text.replace(INVISIBLE, "")));
  return clean.length > max ? clean.slice(0, max) + CLIPPED : clean;
}

/**
 * A copy of an untrusted JSON value with every string and key cleaned, and bounded depth and
 * width. What is cut is marked in place, so the result never looks more complete than it is.
 */
export function cleanValue(value: unknown, redact: Redact, depth = 0, maxEntries = MAX_ENTRIES): unknown {
  if (typeof value === "string") return cleanText(value, redact);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value !== "object" || value === undefined) return null;
  if (depth >= MAX_DEPTH) return CLIPPED;

  if (Array.isArray(value)) {
    const items = value.slice(0, maxEntries).map((item) => cleanValue(item, redact, depth + 1, maxEntries));
    if (value.length > maxEntries) items.push(CLIPPED);
    return items;
  }

  const entries = Object.entries(value);
  const out: Record<string, unknown> = {};
  for (const [name, item] of entries.slice(0, maxEntries)) {
    // Checked after cleaning: "__pro<zero-width>to__" becomes the real thing only here.
    const key = cleanText(name, redact, 200);
    if (FORBIDDEN_KEYS.has(key)) continue;
    Object.defineProperty(out, key, {
      value: cleanValue(item, redact, depth + 1, maxEntries),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (entries.length > maxEntries) out[CLIPPED] = true;
  return out;
}
