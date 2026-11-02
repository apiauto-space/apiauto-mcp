// Packs this package and installs the tarball into a temporary folder, as a customer would get it.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** npm is a .cmd on Windows, which execFile starts only through a shell. */
export function npm(args, options = {}) {
  return run("npm", args, {
    cwd: ROOT,
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

/** @returns the folder, the tarball's path, what is inside it and the path of the installed bin */
export async function packAndInstall() {
  const dir = mkdtempSync(join(tmpdir(), "apiauto-mcp-"));
  const { stdout } = await npm(["pack", "--json", "--pack-destination", dir]);
  const [info] = JSON.parse(stdout);
  const tarball = join(dir, info.filename);
  writeFileSync(join(dir, "package.json"), '{"name":"t","version":"1.0.0","private":true}');
  await npm(["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev"], { cwd: dir });
  return {
    dir,
    tarball,
    files: info.files.map((file) => file.path.replaceAll("\\", "/")),
    bin: join(dir, "node_modules", "apiauto-mcp", "dist", "index.js"),
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }),
  };
}
