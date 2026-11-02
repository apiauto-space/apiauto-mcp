// A real MCP client over stdio against the packed tarball, installed the way a customer gets it.
// The API is faked by a preload module (fixtures/fake-api-preload.mjs): the package has no switch for it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { packAndInstall } from "./packed.mjs";

const KEY = "au_live_5ca1ab1e5ca1ab1e5ca1ab1e5ca1ab1e";
const PRELOAD = pathToFileURL(fileURLToPath(new URL("./fixtures/fake-api-preload.mjs", import.meta.url))).href;
const BASE_ENV = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? "", TEMP: tmpdir(), TMP: tmpdir() };

function textOf(result) {
  return result.content.map((part) => part.text).join("\n");
}

describe("the packed server over stdio", { timeout: 600_000 }, () => {
  let pack;
  const temporary = [];
  const tempDir = (prefix) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    temporary.push(dir);
    return dir;
  };
  before(async () => {
    pack = await packAndInstall();
  }, { timeout: 240_000 });
  after(() => {
    pack?.cleanup();
    for (const dir of temporary) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  async function open(env = {}) {
    const stderr = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", PRELOAD, pack.bin],
      env: { ...BASE_ENV, FAKE_API_SENTRY: "1", ...env },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    return { client, stderr, call: (name, args = {}) => client.callTool({ name, arguments: args }) };
  }

  /** The server as a raw process, to see every byte it writes. */
  function raw(lines, env = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", PRELOAD, pack.bin], {
        env: { ...BASE_ENV, FAKE_API_SENTRY: "1", APIAUTO_API_KEY: KEY, ...env },
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve({ stdout, stderr, code, signal }));
      (async () => {
        for (const line of lines) {
          child.stdin.write(`${line}\n`);
          await new Promise((r) => setTimeout(r, 60));
        }
        await new Promise((r) => setTimeout(r, 300));
        child.stdin.end();
      })();
    });
  }

  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
  });
  const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
  const toolCall = (id, name, args = {}) =>
    JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

  it("the tarball holds only the files it should", () => {
    const unexpected = pack.files.filter(
      (file) =>
        !/^dist\/(api|index|no-codegen|sanitize|tools|version)\.js$/.test(file) &&
        !["README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md", "package.json", "npm-shrinkwrap.json"].includes(file),
    );
    assert.deepEqual(unexpected, []);
    assert.ok(pack.files.includes("dist/index.js"));
    assert.ok(pack.files.includes("npm-shrinkwrap.json"));
  });

  it("the shrinkwrap pins the installed tree", () => {
    const lock = JSON.parse(readFileSync(new URL("../npm-shrinkwrap.json", import.meta.url), "utf8"));
    let checked = 0;
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || entry.dev || entry.optional) continue;
      const installed = JSON.parse(readFileSync(join(pack.dir, path, "package.json"), "utf8")).version;
      assert.equal(installed, entry.version, path);
      checked++;
    }
    assert.ok(checked > 50, `only ${checked} packages checked`);
    assert.ok(!existsSync(join(pack.dir, "node_modules", "typescript")), "dev dependencies must not install");
  });

  it("starts without a key: lists tools, explains each call", async () => {
    const { client, stderr, call } = await open();
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    const result = await call("search_cars", { market: "kr" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /APIAUTO_API_KEY is not set/);
    assert.match(textOf(result), /https:\/\/t\.me\/apiautospace_bot\?start=demo/);
    assert.match(stderr.join(""), /key is NOT set/);
    assert.deepEqual(stderr.join("").split("\n").filter((line) => line.startsWith("SENTRY:")), [], "listing tools needs no network");
    await client.close();
  });

  it("a listing with an injected instruction arrives as marked data", async () => {
    const { client, call } = await open({ APIAUTO_API_KEY: KEY });
    const result = await call("search_cars", { market: "kr" });
    assert.ok(result.isError !== true);
    const parsed = JSON.parse(result.content[0].text);
    assert.match(parsed.untrusted_data_notice, /UNTRUSTED DATA/);
    assert.match(parsed.data.items[0].title, /IGNORE ALL PREVIOUS INSTRUCTIONS/);
    assert.ok(!parsed.data.items[0].title.includes("evil.example"), "the link in it is gone");
    assert.deepEqual(result.structuredContent, parsed);
    assert.equal(parsed.meta.quota.remaining, 99);
    await client.close();
  });

  it("errors reach the client as tool errors: 401, 403, a lost connection, 404", async () => {
    const { client, call } = await open({ APIAUTO_API_KEY: KEY });
    assert.match(textOf(await call("get_markets")), /401/);
    assert.match(textOf(await call("list_brands", { market: "cn" })), /403.*not in the plan/);
    const lost = await call("get_dictionaries");
    assert.equal(lost.isError, true);
    assert.match(textOf(lost), /ECONNRESET/);
    assert.match(textOf(await call("get_car", { id: "encar:404" })), /404/);
    assert.equal((await client.listTools()).tools.length, 8, "the server must still answer");
    await client.close();
  });

  it("schema refusals reach the client as errors, without a request", async () => {
    const log = join(tempDir("apiauto-calls-"), "calls.log");
    const { client, call } = await open({ APIAUTO_API_KEY: KEY, FAKE_API_CALL_LOG: log, FAKE_API_SENTRY: "0" });
    const traversal = await call("get_car", { id: "encar:../../usage" }).catch((error) => error);
    assert.ok(traversal instanceof Error || traversal.isError === true);
    const unknown = await call("get_usage", { url: "https://evil.example/" }).catch((error) => error);
    assert.ok(unknown instanceof Error || unknown.isError === true);
    assert.equal(existsSync(log), false, "nothing must have been requested");
    await client.close();
  });

  it("each request goes to the fixed host, HTTPS, no redirects, key only in the header", async () => {
    const log = join(tempDir("apiauto-calls-"), "calls.log");
    const { client, call } = await open({ APIAUTO_API_KEY: KEY, FAKE_API_CALL_LOG: log, FAKE_API_SENTRY: "0" });
    await call("search_cars", { market: "kr", q: "a&b=c" });
    await call("get_car", { id: "encar:1" });
    await call("get_usage");
    await client.close();
    const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.length, 3);
    for (const entry of calls) {
      const url = new URL(entry.url);
      assert.equal(url.origin, "https://api.apiauto.space");
      assert.equal(entry.redirect, "manual");
      assert.equal(entry.key, KEY);
      assert.ok(!entry.url.includes(KEY));
    }
    assert.equal(new URL(calls[0].url).searchParams.get("q"), "a&b=c");
  });

  it("stdout holds only protocol messages, and the key is in neither stream", async () => {
    const { stdout, stderr } = await raw([
      initialize,
      initialized,
      toolCall(2, "search_cars", { market: "kr" }),
      toolCall(3, "get_usage"), // the fake API echoes the key here
      toolCall(4, "get_markets"),
      toolCall(5, "get_car", { id: `encar:1/${KEY}` }),
      toolCall(6, "get_usage", { [KEY]: 1 }), // the SDK's refusal repeats a field's name
    ]);
    const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(messages.every((message) => message.jsonrpc === "2.0"));
    assert.deepEqual(messages.map((message) => message.id).sort(), [1, 2, 3, 4, 5, 6]);
    assert.match(JSON.stringify(messages.find((message) => message.id === 3)), /\[redacted\]/);
    assert.match(JSON.stringify(messages.find((message) => message.id === 6)), /\[redacted\]/);
    assert.ok(!stdout.includes(KEY));
    assert.ok(!stderr.includes(KEY));
    assert.match(stderr, /\[apiauto-mcp\] GET \/cars: 200/);
  });

  it("garbage on stdin does not end the process, and it exits by itself when stdin closes", async () => {
    const { stdout, stderr, code, signal } = await raw([
      "this is not json",
      "{",
      '{"jsonrpc":"2.0"}',
      "\u0000\u0001",
      "[]",
      initialize,
      initialized,
      toolCall(2, "get_usage"),
      '{"jsonrpc":"2.0","id":3,"method":"no/such/method"}',
      toolCall(4, "no_such_tool"),
    ]);
    const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
    const ids = messages.map((message) => message.id).filter((id) => id !== undefined);
    assert.ok(ids.includes(1) && ids.includes(2) && ids.includes(3) && ids.includes(4), `ids: ${ids}`);
    assert.equal(messages.find((message) => message.id === 2).result.isError ?? false, false);
    assert.match(stderr, /transport/);
    assert.equal(code, 0);
    assert.equal(signal, null);
  });

  // Watches the public calls named in fake-api-preload.mjs. It is a tripwire for this code and its
  // dependencies, not a sandbox: a native addon or a captured reference would pass unseen.
  it("at run time none of the watched calls fire: file writes, processes, generated code, sockets, DNS", async () => {
    const { stdout, stderr } = await raw([
      initialize,
      initialized,
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      toolCall(3, "search_cars", { market: "kr" }),
      toolCall(4, "get_usage"),
      toolCall(5, "get_car", { id: "../x" }),
    ]);
    assert.deepEqual(stderr.split("\n").filter((line) => line.startsWith("SENTRY:")), []);
    assert.equal(stdout.trim().split("\n").length, 5, "every call must have been answered");
  });

  it("a malformed key: the server starts, lists tools intact, and each call explains", async () => {
    const { client, stderr, call } = await open({ APIAUTO_API_KEY: "object" });
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    assert.equal(tools[0].inputSchema.type, "object");
    assert.match(textOf(await call("get_usage")), /does not look like an apiauto\.space key/);
    assert.match(stderr.join(""), /key is MALFORMED/);
    await client.close();
  });

  it("APIAUTO_MAX_RECORDS_PER_SESSION works through the environment", async () => {
    const { client, call } = await open({ APIAUTO_API_KEY: KEY, APIAUTO_MAX_RECORDS_PER_SESSION: "1", FAKE_API_SENTRY: "0" });
    const first = await call("search_cars", { market: "kr", limit: 5 });
    assert.equal(first.structuredContent.meta.session_records_left, 0);
    const second = await call("search_cars", { market: "kr" });
    assert.equal(second.isError, true);
    assert.match(textOf(second), /APIAUTO_MAX_RECORDS_PER_SESSION/);
    await client.close();
  });

  it("the sentry itself works: a write would have been seen", async () => {
    // A preload that runs a write after setting the sentry must report it.
    const probe = new URL("./fixtures/sentry-probe.mjs", import.meta.url);
    const { stderr } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", PRELOAD, fileURLToPath(probe)], {
        env: { ...BASE_ENV, FAKE_API_SENTRY: "1" },
        stdio: "pipe",
      });
      let err = "";
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("error", reject);
      child.on("exit", () => resolve({ stderr: err }));
    });
    for (const what of [
      "fs.writeFileSync",
      "fs.openSync",
      "fs.copyFileSync",
      "child_process.spawnSync",
      "eval",
      "new Function",
      "net.connect",
      "net.Socket.connect",
      "dns.lookup",
    ]) {
      assert.ok(stderr.includes(`SENTRY:${what}`), what);
    }
  });

  it("runs through npx from the tarball, as `npx -y apiauto-mcp` will", async () => {
    const dir = tempDir("apiauto-npx-");
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", `--package=${pack.tarball}`, "apiauto-mcp"],
      cwd: dir,
      env: {
        ...BASE_ENV,
        APPDATA: process.env.APPDATA ?? "",
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
        USERPROFILE: dir,
        HOME: dir,
        npm_config_cache: join(dir, "cache"),
        npm_config_update_notifier: "false",
        APIAUTO_API_KEY: KEY,
        NODE_OPTIONS: `--import=${PRELOAD}`,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "npx-test", version: "1.0.0" }, {});
    await client.connect(transport, { timeout: 380_000 });
    assert.equal((await client.listTools()).tools.length, 8);
    const result = await client.callTool({ name: "search_cars", arguments: { market: "kr" } });
    assert.match(result.content[0].text, /UNTRUSTED DATA/);
    await client.close();
  }, { timeout: 400_000 });
});
