// Runs from `npm version`: copies package.json's version wherever it is written down.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync("src/version.ts", `export const VERSION = "${version}";\n`);

const server = JSON.parse(readFileSync("server.json", "utf8"));
server.version = version;
for (const entry of server.packages) entry.version = version;
writeFileSync("server.json", `${JSON.stringify(server, null, 2)}\n`);

for (const file of ["README.md", "REGISTRY_LISTINGS.md"]) {
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/apiauto-mcp@\d+\.\d+\.\d+/g, `apiauto-mcp@${version}`));
}
