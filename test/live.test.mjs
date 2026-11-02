// A one-off run against the real API, through the built server over stdio. Skipped without
// APIAUTO_E2E_KEY. Spends at most 7 records on a paid plan (7 requests on the demo):
// kr 1 + next page 1 + car 1 + cn 1 + us 1 + changes 1 + a filtered search 1.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.APIAUTO_E2E_KEY?.trim();
const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ENV = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? "" };

async function open(apiKey) {
  const stderr = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN],
    env: { ...ENV, APIAUTO_API_KEY: apiKey },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
  const client = new Client({ name: "live-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, stderr };
}

describe("the live API", { skip: !KEY && "APIAUTO_E2E_KEY is not set", timeout: 180_000 }, () => {
  let client, stderr, startUsage;
  const seen = [];

  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    seen.push(JSON.stringify(result));
    return result;
  };
  const ok = async (name, args) => {
    const result = await call(name, args);
    assert.notEqual(result.isError, true, `${name}: ${result.content?.[0]?.text}`);
    assert.match(result.structuredContent.untrusted_data_notice, /UNTRUSTED DATA/);
    return result.structuredContent;
  };

  before(async () => {
    ({ client, stderr } = await open(KEY));
    startUsage = (await ok("get_usage")).data;
  });
  after(async () => {
    await client?.close();
  });

  it("free tools spend nothing: usage before and after them is the same", async () => {
    const first = await ok("get_usage");
    assert.equal(typeof first.data.plan, "string");
    const markets = await ok("get_markets");
    assert.deepEqual(markets.data.items.map((m) => m.market).sort(), ["cn", "kr", "us"]);
    const brands = await ok("list_brands", { market: "cn", limit: 3 });
    assert.equal(brands.data.items.length, 3);
    assert.ok(brands.meta.total > 3);
    const found = await ok("list_brands", { market: "kr", name_contains: "hyundai" });
    assert.equal(found.data.items[0].name, "Hyundai");
    const models = await ok("list_models", { market: "kr", brand: "Hyundai", limit: 3 });
    assert.ok(models.data.items.length > 0);
    const dictionaries = await ok("get_dictionaries");
    for (const field of ["fuel", "transmission", "body_type"]) {
      for (const value of Object.keys(dictionaries.data[field])) {
        assert.match(value, /^[a-z0-9_-]{1,64}$/, `the ${field} filter refuses the real value ${value}`);
      }
    }
    const second = await ok("get_usage");
    assert.equal(second.data.quota_used, first.data.quota_used);
  });

  it("Encar: a compact page of one, the next page by cursor, one car by id", async () => {
    const page = await ok("search_cars", { market: "kr", limit: 1 });
    assert.equal(page.data.items.length, 1);
    assert.match(page.data.items[0].id, /^encar:/);
    assert.equal(page.data.items[0].price.currency, "KRW");
    assert.equal(page.meta.records_returned, 1);
    assert.equal(typeof page.meta.quota.remaining, "number");
    assert.equal(page.meta.has_more, true);

    const next = await ok("search_cars", { market: "kr", limit: 1, cursor: page.meta.next_cursor });
    assert.notEqual(next.data.items[0].id, page.data.items[0].id);
    assert.equal(next.meta.quota.remaining, page.meta.quota.remaining - 1, "one car, one record");

    const car = await ok("get_car", { id: page.data.items[0].id });
    assert.equal(car.data.id, page.data.items[0].id);
    assert.equal(typeof car.data.raw, "object");
    for (const photo of car.data.photos) assert.ok(photo.startsWith("https://api.apiauto.space/img/"));
    // The link filter must keep what the API really sends.
    assert.ok(car.data.photos.length > 0, "real photos must survive the filter");
    assert.match(car.data.listing_url, /^https:\/\/fem\.encar\.com\/cars\/detail\//);
    assert.ok(!JSON.stringify(car.data).includes("[link removed]"), "nothing real was removed");
  });

  it("Che168 has no VIN and a real filter works; US lots come from Copart or IAAI", async () => {
    const cn = await ok("search_cars", { market: "cn", limit: 1, fuel: "gasoline", has_photos: true });
    assert.match(cn.data.items[0].id, /^che168:/);
    assert.equal(cn.data.items[0].vin, null);
    assert.equal(cn.data.items[0].fuel, "gasoline");
    assert.match(cn.data.items[0].listing_url, /^https:\/\/[\w.-]*che168\.com\//);
    assert.ok(cn.data.items[0].photo.startsWith("https://api.apiauto.space/img/"));
    const us = await ok("search_cars", { market: "us", limit: 1 });
    assert.match(us.data.items[0].id, /^(copart|iaai):/);
    assert.equal(us.data.items[0].listing_url, null);
  });

  it("the change feed answers", async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const changes = await ok("get_changes", { market: "cn", since, limit: 1 });
    assert.ok(changes.data.items.length <= 1);
  });

  it("an unknown car is a clean 404", async () => {
    const result = await call("get_car", { id: "encar:0" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /404/);
  });

  it("no tool touched the paid live US counter, and the run spent what it promised", async () => {
    const { tools } = await client.listTools();
    assert.ok(!tools.some((tool) => /live/i.test(tool.name)));
    const usage = await ok("get_usage");
    assert.equal(usage.data.live_us_used, startUsage.live_us_used);
    assert.ok(usage.data.quota_used - startUsage.quota_used <= 7, "at most 7 records or requests");
    console.log(`quota spent by this run: ${usage.data.quota_used - startUsage.quota_used} ${usage.data.quota_unit}`);
  });

  it("the key is nowhere: results, errors, logs", () => {
    const everything = seen.join("\n") + stderr.join("");
    assert.ok(seen.length > 10);
    assert.ok(!everything.includes(KEY));
  });

  it("a wrong key is a clear 401 and spends nothing", async () => {
    const wrong = await open(`au_live_${"0".repeat(32)}`);
    const result = await wrong.client.callTool({ name: "get_usage", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /401/);
    assert.match(result.content[0].text, /t\.me\/apiautospace_bot/);
    await wrong.client.close();
  });
});
