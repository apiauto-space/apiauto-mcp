// Packs this package and installs what is inside the tarball, by the shrinkwrap inside the tarball.
// `npm install <tarball>` would ignore that shrinkwrap: npm follows it only for a package from a registry
// that marks it, so that install changes whenever a dependency has a new release.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

/** @returns the folder of the unpacked package, the tarball's path, what is inside it and the path of the bin */
export async function packAndInstall() {
  const dir = mkdtempSync(join(tmpdir(), "apiauto-mcp-"));
  const { stdout } = await npm(["pack", "--json", "--pack-destination", dir]);
  const [info] = JSON.parse(stdout);
  const tarball = join(dir, info.filename);
  // A relative name: tar on Windows reads "C:" in a path as a remote host.
  await run("tar", ["-xzf", info.filename], { cwd: dir });
  const installed = join(dir, "package");
  await npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev"], { cwd: installed });
  return {
    dir: installed,
    tarball,
    files: info.files.map((file) => file.path.replaceAll("\\", "/")),
    bin: join(installed, "dist", "index.js"),
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }),
  };
}
