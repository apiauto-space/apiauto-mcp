// Node's real fetch and real sockets against local servers. Each request's origin is rewritten to
// the local server just before fetch, and the options pass through untouched, so redirects,
// timeouts, gzip and dropped connections behave as they do against the real host.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import { ApiClient, ApiError } from "../dist/api.js";
import { KEY } from "./helpers.mjs";

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      server.origin = `http://127.0.0.1:${server.address().port}`;
      resolve(server);
    });
  });
}

const stop = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to fail");
};

describe("real sockets", () => {
  let api, attacker, attackerHits, seenHeaders;
  const routes = {};

  const local = (origin, options = {}) =>
    new ApiClient({
      apiKey: KEY,
      fetch: (url, init) => fetch(url.replace("https://api.apiauto.space", origin), init),
      sleep: async () => undefined,
      ...options,
    });

  before(async () => {
    attackerHits = [];
    attacker = await listen((req, res) => {
      attackerHits.push({ url: req.url, headers: req.headers });
      res.end("{}");
    });
    api = await listen((req, res) => {
      seenHeaders = req.headers;
      const route = routes[new URL(req.url, "http://x").pathname];
      if (route) route(req, res);
      else {
        res.setHeader("content-type", "application/json");
        res.end('{"ok":true}');
      }
    });
  });
  after(async () => {
    await stop(api);
    await stop(attacker);
  });

  it("sends the key in the header on the wire, and only there", async () => {
    let seenUrl;
    routes["/v1/usage"] = (req, res) => {
      seenUrl = req.url;
      res.end("{}");
    };
    await local(api.origin).get("/usage", "free");
    assert.equal(seenHeaders["x-api-key"], KEY);
    assert.match(seenHeaders["user-agent"], /^apiauto-mcp\//);
    assert.ok(!seenUrl.includes(KEY));
  });

  for (const status of [301, 302, 303, 307, 308]) {
    it(`a ${status} to another host is not followed and the key does not go there`, async () => {
      attackerHits.length = 0;
      routes["/v1/usage"] = (_req, res) => {
        res.statusCode = status;
        res.setHeader("location", `${attacker.origin}/steal`);
        res.end();
      };
      const error = await failure(local(api.origin).get("/usage", "free"));
      assert.equal(error.kind, "redirect");
      assert.equal(attackerHits.length, 0);
    });
  }

  it("a timeout on headers is an error, not a hang", async () => {
    routes["/v1/usage"] = () => undefined; // never answers
    const error = await failure(local(api.origin, { attemptTimeoutMs: 100 }).get("/usage", "free"));
    assert.equal(error.kind, "timeout");
  });

  it("a timeout also covers a body that stalls halfway", async () => {
    routes["/v1/cars"] = (_req, res) => {
      res.write('{"items":[');
    };
    const started = Date.now();
    const error = await failure(local(api.origin, { attemptTimeoutMs: 150 }).get("/cars", "paid"));
    assert.equal(error.kind, "timeout");
    assert.ok(Date.now() - started < 5000);
  });

  it("a connection dropped mid-body is an error, not a crash", async () => {
    routes["/v1/cars"] = (req, res) => {
      res.write('{"items":[');
      setTimeout(() => req.socket.destroy(), 10);
    };
    const error = await failure(local(api.origin).get("/cars", "paid"));
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, "connection");
  });

  it("a connection dropped before any answer is an error, not a crash", async () => {
    routes["/v1/cars"] = (req) => req.socket.destroy();
    const error = await failure(local(api.origin).get("/cars", "paid"));
    assert.equal(error.kind, "connection");
  });

  it("a refused connection is an error, and a retried one for a free call", async () => {
    let attempts = 0;
    const dead = new ApiClient({
      apiKey: KEY,
      fetch: (url, init) => {
        attempts++;
        return fetch(url.replace("https://api.apiauto.space", "http://127.0.0.1:9"), init);
      },
      sleep: async () => undefined,
    });
    const error = await failure(dead.get("/usage", "free"));
    assert.equal(error.kind, "connection");
    assert.equal(attempts, 3);
  });

  it("an endless body stops at the limit", async () => {
    let closed = false;
    routes["/v1/cars"] = (_req, res) => {
      const chunk = Buffer.alloc(64 * 1024, 32);
      const pump = () => {
        while (!res.destroyed && res.write(chunk));
        if (!res.destroyed) res.once("drain", pump);
      };
      res.on("close", () => {
        closed = true;
      });
      pump();
    };
    const error = await failure(local(api.origin, { maxResponseBytes: 256 * 1024 }).get("/cars", "paid"));
    assert.equal(error.kind, "too_large");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(closed, true, "the connection should be dropped");
  });

  it("a gzip bomb stops at the limit, counted after decompression", async () => {
    const bomb = gzipSync(Buffer.alloc(50 * 1024 * 1024, 32));
    assert.ok(bomb.length < 256 * 1024);
    routes["/v1/cars"] = (_req, res) => {
      res.setHeader("content-encoding", "gzip");
      res.setHeader("content-length", String(bomb.length));
      res.end(bomb);
    };
    const before = process.memoryUsage().rss;
    const error = await failure(local(api.origin, { maxResponseBytes: 256 * 1024 }).get("/cars", "paid"));
    assert.equal(error.kind, "too_large");
    assert.ok(process.memoryUsage().rss - before < 40 * 1024 * 1024);
  });

  it("gzip of a normal answer works", async () => {
    routes["/v1/usage"] = (_req, res) => {
      res.setHeader("content-encoding", "gzip");
      res.end(gzipSync(Buffer.from('{"plan":"max"}')));
    };
    assert.deepEqual((await local(api.origin).get("/usage", "free")).body, { plan: "max" });
  });
});
