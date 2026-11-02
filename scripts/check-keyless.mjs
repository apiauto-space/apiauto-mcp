// Proves what a registry's sandbox will see: with no key and no network, the server builds, starts and
// lists its tools. `node scripts/check-keyless.mjs` runs the build; with --docker, the Dockerfile too.
import { execFileSync, spawn } from "node:child_process";

const REQUESTS = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "resources/list" },
  { jsonrpc: "2.0", id: 4, method: "prompts/list" },
];

function introspect(command, args) {
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? "" };
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command}: no answer in 60 s`));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.split("\n").filter(Boolean).length >= 4) child.stdin.end();
    });
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(out.trim().split("\n").map((line) => JSON.parse(line)));
    });
    for (const request of REQUESTS) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

function report(label, messages) {
  const tools = messages.find((message) => message.id === 2)?.result?.tools ?? [];
  if (tools.length !== 8) throw new Error(`${label}: expected 8 tools, got ${tools.length}`);
  console.log(`${label}: started without a key, tools/list gives ${tools.length}: ${tools.map((tool) => tool.name).join(", ")}`);
}

report("node dist/index.js", await introspect(process.execPath, ["dist/index.js"]));

if (process.argv.includes("--docker")) {
  const image = "apiauto-mcp-keyless-check";
  execFileSync("docker", ["build", "--quiet", "--tag", image, "."], { stdio: ["ignore", "ignore", "inherit"] });
  report("docker run --network none", await introspect("docker", ["run", "--rm", "-i", "--network", "none", image]));
}
