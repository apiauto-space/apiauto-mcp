// Does what the server must never do, to prove the sentry in fake-api-preload.mjs notices it.
import { spawnSync } from "node:child_process";
import { copyFileSync, openSync, closeSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(tmpdir(), "apiauto-mcp-sentry-probe.txt");
writeFileSync(file, "x");
closeSync(openSync(file, "a"));
copyFileSync(file, `${file}.copy`);
lookup("localhost", () => undefined);
spawnSync(process.execPath, ["--version"]);
globalThis.eval("1");
new Function("return 1")();
connect(9, "127.0.0.1").on("error", () => undefined);
