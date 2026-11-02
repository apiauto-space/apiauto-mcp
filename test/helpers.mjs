import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { ApiClient } from "../dist/api.js";
import { createServer } from "../dist/tools.js";

/** A key shaped like a real one; a test fails if it shows up anywhere it should not. */
export const KEY = "au_live_c0ffee00c0ffee00c0ffee00c0ffee00";

export function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export const QUOTA = {
  "x-quota-limit": "1000",
  "x-quota-remaining": "995",
  "x-quota-reset": "2026-12-01T00:00:00Z",
  "x-data-age-seconds": "120",
};

export function car(overrides = {}) {
  return {
    id: "encar:43071811",
    market: "kr",
    source: "encar",
    source_id: "43071811",
    title: "2016 Hyundai Aslan G330 Premium",
    brand: "Hyundai",
    model: "Aslan",
    generation: null,
    trim: "G330 Premium",
    year: 2016,
    mileage_km: 161877,
    fuel: "gasoline",
    transmission: null,
    engine_cc: null,
    body_type: null,
    color: null,
    vin: null,
    price: { amount: "5790000.00", currency: "KRW" },
    price_usd: "4336.21",
    location: { country: "KR", region: "Gyeonggi", city: null },
    photos: [
      "https://api.apiauto.space/img/encar:43071811/1.jpg?exp=1793714400&sig=c724fa4d0e6fd311edab2918348b84a2",
      "https://api.apiauto.space/img/encar:43071811/2.jpg?exp=1793714400&sig=30a0ede9eb8205e2190d9b1aac6dca42",
    ],
    photo_count: 2,
    listing_url: "https://fem.encar.com/cars/detail/43071811",
    is_active: true,
    first_seen_at: "2026-11-02T02:48:21.593646Z",
    last_seen_at: "2026-11-02T02:48:21.593646Z",
    disappeared_at: null,
    updated_at: "2026-11-02T02:48:21.593646Z",
    raw: { has_accident: false, sell_type: "normal", form_year: "201507", source_values: { fuel: "가솔린" } },
    source_mode: "replica",
    ...overrides,
  };
}

/** A fake fetch: `handler(url, init)` answers, every call is recorded in `.calls`. */
export function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return handler(new URL(url), init, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** An MCP client connected in memory to a server built around a fake fetch. */
export async function connect(handler, { apiKey = KEY, maxRecordsPerSession = null, make = (options) => new ApiClient(options) } = {}) {
  const fetchImpl = fakeFetch(handler);
  const logs = [];
  const sleeps = [];
  // Logs are collected raw: the logger in src/index.ts redacts, but a test must see what it is given.
  const api = make({
    apiKey,
    fetch: fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    log: (message) => logs.push(message),
  });
  const server = createServer(api, { maxRecordsPerSession });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    fetch: fetchImpl,
    logs,
    sleeps,
    call: (name, args = {}) => client.callTool({ name, arguments: args }),
    close: () => client.close(),
  };
}

export function textOf(result) {
  return result.content.map((part) => part.text).join("\n");
}
