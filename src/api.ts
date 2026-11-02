import { cleanText, makeRedactor, type Redact } from "./sanitize.js";
import { VERSION } from "./version.js";

/** The only host this server talks to. There is deliberately no option or variable to change it. */
const API_HOST = "api.apiauto.space";
const API_ORIGIN = `https://${API_HOST}`;
const API_PREFIX = "/v1";

/** Paths a request may have. `/us/live` is left out on purpose: it spends the provider's paid quota. */
const ALLOWED_PATH =
  /^\/(cars|changes|usage|references\/(brands|models|dictionaries|markets)|cars\/[^/?#]+)$/;

export const DEMO_KEY_URL = "https://t.me/apiautospace_bot?start=demo";

/** The shape `issue_api_key` gives every key. */
const KEY_SHAPE = /^au_live_[0-9a-fA-F]{32}$/;

export const MAY_HAVE_SPENT = "This call may already have spent quota; check get_usage before repeating it.";

export const ATTEMPT_TIMEOUT_MS = 20_000;
export const TOTAL_BUDGET_MS = 45_000;
const MAX_ATTEMPTS = 3;
/** A longer wait is not slept through: the model gets the error and `retry_after` instead. */
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Failed before the request was sent, so the quota cannot have been spent. */
const NOT_SENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * `paid` requests spend quota once the API has done the work, so only the answers it gives before
 * that are retried: 429 from the rate limiter and 503 from a stale copy. A lost connection, a 500
 * or a gateway's 502 and 504 may already have cost the customer records.
 */
export type Cost = "free" | "paid";
const RETRY_PAID = new Set([429, 503]);
const RETRY_FREE = new Set([429, 500, 502, 503, 504]);

export type Query = Record<string, string | number | boolean | readonly string[] | undefined>;

export interface Quota {
  limit: number | null;
  remaining: number | null;
  reset_at: string | null;
}

export interface ApiResult {
  body: unknown;
  quota: Quota | null;
  dataAgeSeconds: number | null;
}

export type ApiErrorKind =
  | "no_key"
  | "bad_key"
  | "cancelled"
  | "session_limit"
  | "http"
  | "redirect"
  | "too_large"
  | "bad_response"
  | "timeout"
  | "connection";

/** A failed request. `message` is safe to show: it holds no key and no raw upstream body. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfter: number | null;
  readonly resetAt: string | null;
  readonly markets: readonly string[] | null;
  /** The outcome of a paid request is unknown, so it may have cost records. */
  readonly mayHaveSpent: boolean;

  constructor(
    kind: ApiErrorKind,
    message: string,
    fields: {
      status?: number | null;
      code?: string | null;
      retryAfter?: number | null;
      resetAt?: string | null;
      markets?: readonly string[] | null;
      mayHaveSpent?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = fields.status ?? null;
    this.code = fields.code ?? null;
    this.retryAfter = fields.retryAfter ?? null;
    this.resetAt = fields.resetAt ?? null;
    this.markets = fields.markets ?? null;
    this.mayHaveSpent = fields.mayHaveSpent ?? false;
  }

  /** The same error for a paid request whose outcome is unknown. */
  spentUnknown(): ApiError {
    if (this.mayHaveSpent) return this;
    return new ApiError(this.kind, `${this.message} ${MAY_HAVE_SPENT}`, { ...this, mayHaveSpent: true });
  }
}

export interface ClientOptions {
  /** The key, normally `process.env.APIAUTO_API_KEY`. */
  apiKey?: string | undefined;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
  maxResponseBytes?: number;
}

/**
 * A request's URL, checked after it is built. Whatever an id or a query holds, the result is an
 * allowed path on the allowed host, or an exception.
 */
export function buildUrl(path: string, query?: Query): URL {
  if (!ALLOWED_PATH.test(path)) throw new TypeError("apiauto-mcp: path is not allowed");
  const url = new URL(API_ORIGIN + API_PREFIX + path);
  // URL normalizes dot segments, so comparing the path afterwards catches traversal.
  if (
    url.protocol !== "https:" ||
    url.hostname !== API_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== API_PREFIX + path
  ) {
    throw new TypeError("apiauto-mcp: URL is not allowed");
  }
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    for (const item of typeof value === "object" ? value : [value]) {
      url.searchParams.append(name, String(item));
    }
  }
  return url;
}

/** Encodes a car id as one path segment; the id's colon stays readable, as in the API's docs. */
export function carPath(id: string): string {
  return `/cars/${encodeURIComponent(id).replace(/%3A/gi, ":")}`;
}

export class ApiClient {
  readonly redact: Redact;
  readonly log: (message: string) => void;
  readonly keyState: "missing" | "malformed" | "ok";
  readonly #apiKey: string | null;
  readonly #keyProblem: ApiError | null;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #attemptTimeoutMs: number;
  readonly #totalBudgetMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey?.trim() || null;
    const valid = apiKey !== null && KEY_SHAPE.test(apiKey);
    // A malformed value is never sent, and redacting it could eat the protocol: the "key" may be
    // a word like `object`. Anything key-shaped is removed regardless.
    this.redact = makeRedactor(valid ? apiKey : null);
    this.keyState = apiKey === null ? "missing" : valid ? "ok" : "malformed";
    this.#apiKey = valid ? apiKey : null;
    this.#keyProblem = keyProblem(this.keyState);
    this.#fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = options.log ?? (() => undefined);
    this.#attemptTimeoutMs = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
    this.#totalBudgetMs = options.totalBudgetMs ?? TOTAL_BUDGET_MS;
    this.#maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  /** Masks the key if the client is ever logged or serialized. */
  toJSON(): Record<string, unknown> {
    return { host: API_HOST, apiKey: this.#apiKey ? "[redacted]" : null };
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `ApiClient { host: '${API_HOST}', apiKey: ${this.#apiKey ? "'[redacted]'" : "null"} }`;
  }

  async get(path: string, cost: Cost, query?: Query, signal?: AbortSignal): Promise<ApiResult> {
    if (this.#keyProblem) throw this.#keyProblem;
    const url = buildUrl(path, query);
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      if (signal?.aborted) throw new ApiError("cancelled", "The call was cancelled.");
      try {
        return await this.#attempt(url, path, this.#totalBudgetMs - (Date.now() - started), signal);
      } catch (error) {
        if (!(error instanceof AttemptFailure)) throw error;
        if (signal?.aborted) {
          const cancelled = new ApiError("cancelled", "The call was cancelled.");
          throw cost === "paid" ? cancelled.spentUnknown() : cancelled;
        }
        const delay = attempt < MAX_ATTEMPTS ? retryDelay(error, cost, attempt) : null;
        const inBudget = delay !== null && Date.now() - started + delay < this.#totalBudgetMs;
        this.log(`GET ${path}: failed, ${error.error.kind} ${error.error.status ?? ""} attempt ${attempt}`);
        if (delay === null || !inBudget) throw finalError(error, cost);
        await sleepUnlessAborted(this.#sleep(delay), signal);
      }
    }
  }

  async #attempt(url: URL, path: string, budgetMs: number, signal?: AbortSignal): Promise<ApiResult> {
    const timeoutMs = Math.max(1, Math.min(this.#attemptTimeoutMs, budgetMs));
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.#fetch(url.href, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": `apiauto-mcp/${VERSION}`,
          "X-API-Key": this.#apiKey as string,
        },
        redirect: "manual",
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
      if (isRedirect(response)) {
        void response.body?.cancel().catch(() => undefined);
        throw new ApiError("redirect", "The API answered with a redirect, which is not followed.", {
          status: response.status,
        });
      }
      text = await readLimited(response, this.#maxResponseBytes);
    } catch (cause) {
      if (cause instanceof ApiError) throw new AttemptFailure(cause, false);
      throw connectionFailure(cause, timeoutMs);
    }

    this.log(`GET ${path}: ${response.status}`);
    const body = parseJson(text);
    if (!response.ok) {
      throw new AttemptFailure(this.#httpError(response, body), false);
    }
    if (body === undefined) {
      throw new AttemptFailure(
        new ApiError("bad_response", "The API's answer is not valid JSON.", { status: response.status }),
        false,
      );
    }
    return {
      body,
      quota: readQuota(response.headers, this.redact),
      dataAgeSeconds: toNumber(response.headers.get("x-data-age-seconds")),
    };
  }

  #httpError(response: Response, body: unknown): ApiError {
    const fields = isRecord(body) ? body : {};
    const status = response.status;
    const code =
      typeof fields["error"] === "string" && /^[a-z0-9_]{1,64}$/.test(fields["error"])
        ? fields["error"]
        : null;
    // `detail` and `reset_at` are shown; the rest of a body (an HTML error page, say) never is.
    const detail =
      typeof fields["detail"] === "string" ? cleanText(fields["detail"], this.redact, 300) : null;
    const resetAt =
      typeof fields["reset_at"] === "string" ? cleanText(fields["reset_at"], this.redact, 40) : null;
    const retryAfter =
      toNumber(fields["retry_after"]) ?? toNumber(response.headers.get("retry-after"));
    const markets = Array.isArray(fields["markets"])
      ? fields["markets"].filter((m): m is string => typeof m === "string" && /^[a-z]{2}$/.test(m))
      : null;
    return new ApiError("http", describeHttpError(status, code, detail, resetAt, retryAfter, markets), {
      status,
      code,
      retryAfter,
      resetAt,
      markets,
    });
  }
}

/** One attempt failed. `connection`: no answer came; `notSent`: it surely never reached the API. */
class AttemptFailure extends Error {
  constructor(
    readonly error: ApiError,
    readonly notSent: boolean,
    readonly connection = false,
  ) {
    super(error.message);
  }
}

function keyProblem(state: ApiClient["keyState"]): ApiError | null {
  if (state === "missing") {
    return new ApiError(
      "no_key",
      `APIAUTO_API_KEY is not set. Add your key to the "env" block of this MCP server's config. ` +
        `A free demo key (one day, 100 requests, all three markets) comes in Telegram within a minute: ${DEMO_KEY_URL}`,
    );
  }
  if (state === "malformed") {
    return new ApiError(
      "bad_key",
      `APIAUTO_API_KEY does not look like an apiauto.space key, which is au_live_ and 32 hexadecimal characters. ` +
        `No request was sent. Copy it again from the bot: ${DEMO_KEY_URL}`,
    );
  }
  return null;
}

/** The error the caller sees once no more attempts will be made. */
function finalError(failure: AttemptFailure, cost: Cost): ApiError {
  const { error } = failure;
  const transient = failure.connection || (error.status !== null && error.status >= 500);
  if (cost === "free") {
    return transient ? new ApiError(error.kind, `${error.message} Try again later.`, { ...error }) : error;
  }
  if (failure.connection) {
    if (!failure.notSent) return error.spentUnknown();
    return new ApiError(error.kind, `${error.message} The request did not leave, so no quota was spent.`, { ...error });
  }
  const unknown =
    error.kind === "too_large" ||
    error.kind === "bad_response" ||
    (error.status !== null && error.status >= 500 && !RETRY_PAID.has(error.status));
  return unknown ? error.spentUnknown() : error;
}

function sleepUnlessAborted(sleep: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep;
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
    void sleep.then(resolve);
  });
}

function isRedirect(response: Response): boolean {
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

function retryDelay(failure: AttemptFailure, cost: Cost, attempt: number): number | null {
  const { error } = failure;
  if (failure.connection) {
    if (cost === "paid" && !failure.notSent) return null;
  } else if (error.status === null || !(cost === "paid" ? RETRY_PAID : RETRY_FREE).has(error.status)) {
    return null;
  }
  if (error.retryAfter !== null) {
    const ms = error.retryAfter * 1000;
    return ms <= MAX_RETRY_AFTER_MS ? ms : null;
  }
  const backoff = 500 * 2 ** (attempt - 1);
  return Math.round(backoff * (0.75 + Math.random() * 0.25));
}

function connectionFailure(cause: unknown, timeoutMs: number): AttemptFailure {
  const name = (cause as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    const seconds = Math.round(timeoutMs / 1000);
    return new AttemptFailure(
      new ApiError("timeout", `The API did not answer within ${seconds} s.`),
      false,
      true,
    );
  }
  const code = causeCode(cause);
  // The underlying message is left out: it can quote the failing URL or header.
  return new AttemptFailure(
    new ApiError(
      "connection",
      `Could not reach ${API_HOST}${code ? ` (${code})` : ""}.`,
    ),
    code !== null && NOT_SENT_CODES.has(code),
    true,
  );
}

function causeCode(error: unknown): string | null {
  for (const candidate of [(error as { cause?: unknown } | null)?.cause, error]) {
    const code = (candidate as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return null;
}

/** Reads a body up to a limit, counted after decompression, so a gzip bomb stops at the limit too. */
async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const tooLarge = () =>
    new ApiError("too_large", `The API's answer is larger than ${maxBytes} bytes and was dropped.`, {
      status: response.status,
    });
  const declared = toNumber(response.headers.get("content-length"));
  if (declared !== null && declared > maxBytes && !response.headers.get("content-encoding")) {
    void response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
}

function parseJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readQuota(headers: Headers, redact: Redact): Quota | null {
  const limit = toNumber(headers.get("x-quota-limit"));
  const remaining = toNumber(headers.get("x-quota-remaining"));
  const reset = headers.get("x-quota-reset");
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, reset_at: reset === null ? null : cleanText(reset, redact, 40) };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeHttpError(
  status: number,
  code: string | null,
  detail: string | null,
  resetAt: string | null,
  retryAfter: number | null,
  markets: readonly string[] | null,
): string {
  const label = code ? `${status} ${code}` : `${status}`;
  const extra = detail ? ` ${detail}` : "";
  const wait = retryAfter !== null ? ` Retry after ${retryAfter} s.` : "";
  switch (status) {
    case 400:
      return `${label}: the API refused the parameters.${extra}`;
    case 401:
      return (
        `${label}: the key in APIAUTO_API_KEY was refused: it is wrong or revoked, or the subscription ` +
        `has ended. Get a key: ${DEMO_KEY_URL}`
      );
    case 402:
      return `${label}: the quota of this period is spent${resetAt ? `; it resets at ${resetAt}` : ""}.`;
    case 403:
      if (code === "market_not_in_plan") {
        return `${label}: this market is not in the plan${markets ? `; the plan includes: ${markets.join(", ")}` : ""}.`;
      }
      return `${label}: the plan does not include this.${extra}`;
    case 404:
      return `${label}: nothing with this id. A car taken off sale is kept for 14 days.`;
    case 429:
      return `${label}: too many requests per second.${wait}`;
    default:
      return status >= 500
        ? `${label}: the API failed on its side.${extra}${wait}`
        : `${label}: the API refused the request.${extra}`;
  }
}
