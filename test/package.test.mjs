// Static checks of the source, the package and the repository's files. No network.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";

import { VERSION } from "../dist/version.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const server = JSON.parse(read("server.json"));

const sources = readdirSync(join(ROOT, "src")).map((name) => [`src/${name}`, read(`src/${name}`)]);
const built = readdirSync(join(ROOT, "dist")).map((name) => [`dist/${name}`, read(`dist/${name}`)]);

describe("the source", () => {
  const forbidden = [
    ["a shell or a process", /child_process|cross-spawn|execa|\bexecSync\b|\bspawn\(/],
    ["eval or generated code", /\beval\s*\(|new Function\b/],
    ["the file system", /from\s+"(node:)?fs(\/promises)?"|require\(["'](node:)?fs/],
    ["a dynamic import", /\bimport\s*\(/],
    ["other network modules", /from\s+"(node:)?(http|https|net|tls|dgram|dns)"/],
    ["console output, which could reach stdout", /\bconsole\.(log|info|debug|dir|table)\b/],
    ["writing to stdout outside the transport", /process\.stdout\.write/],
    ["telemetry", /telemetry|analytics|sentry|posthog|segment\.io|datadog/i],
  ];
  for (const [what, pattern] of forbidden) {
    it(`uses no ${what}`, () => {
      for (const [path, text] of [...sources, ...built]) assert.ok(!pattern.test(text), path);
    });
  }

  it("has one hard-coded host and no variable or option to change it", () => {
    const all = sources.map(([, text]) => text).join("\n");
    const hosts = new Set([...all.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]));
    for (const host of hosts) {
      assert.ok(["t.me", "apiauto.space"].includes(host), host);
    }
    assert.match(read("src/api.ts"), /^const API_HOST = "api\.apiauto\.space";$/m);
    assert.match(read("src/api.ts"), /^const API_ORIGIN = `https:\/\/\$\{API_HOST\}`;$/m);
    const env = [...all.matchAll(/process\.env\[?["'.]?(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(env)].sort(), ["APIAUTO_API_KEY", "APIAUTO_MAX_RECORDS_PER_SESSION"]);
    assert.ok(!/baseUrl|BASE_URL|base_url/.test(all));
    assert.match(read("src/api.ts"), /redirect: "manual"/);
  });

  it("only the server's entry point runs the client's fetch without an injected one", () => {
    assert.ok(!read("src/index.ts").includes("fetch"));
  });

  it("does not mention the live US path outside the note on why it is excluded", () => {
    const matches = sources.flatMap(([path, text]) =>
      text.split("\n").filter((line) => /us\/live/.test(line)).map((line) => `${path}: ${line.trim()}`),
    );
    assert.equal(matches.length, 1, matches.join("\n"));
    assert.match(matches[0], /left out on purpose/);
  });

  it("holds no invisible characters that could hide code from a reviewer", () => {
    const invisible = /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\ufff9-\ufffb]/u;
    const files = ["README.md", "server.json", "package.json", ...sources.map(([path]) => path)];
    for (const path of files) assert.ok(!invisible.test(read(path)), path);
  });
});

describe("package.json", () => {
  it("pins dependencies exactly and keeps them few", () => {
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@modelcontextprotocol/sdk", "zod"]);
    for (const deps of [pkg.dependencies, pkg.devDependencies]) {
      for (const [name, version] of Object.entries(deps)) assert.match(version, /^\d+\.\d+\.\d+$/, name);
    }
  });

  it("the shrinkwrap exists, matches, and no package runs install scripts", () => {
    const lock = JSON.parse(read("npm-shrinkwrap.json"));
    assert.equal(lock.packages[""].version, pkg.version);
    assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
    for (const [name, entry] of Object.entries(lock.packages)) {
      assert.ok(!entry.hasInstallScript, `${name} has an install script`);
      if (name && !entry.link) {
        assert.ok(entry.resolved?.startsWith("https://registry.npmjs.org/"), `${name} comes from elsewhere`);
        assert.ok(entry.integrity, `${name} has no integrity hash`);
      }
    }
    assert.ok(!existsSync(join(ROOT, "package-lock.json")), "the shrinkwrap replaces the lock file");
  });

  it("has a small file list, a bin and no scripts that run at install", () => {
    assert.deepEqual(pkg.files, ["dist", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md", "npm-shrinkwrap.json"]);
    assert.equal(pkg.bin["apiauto-mcp"], "dist/index.js");
    for (const script of ["preinstall", "install", "postinstall", "prepare"]) {
      assert.equal(pkg.scripts[script], undefined, script);
    }
    assert.ok(read("dist/index.js").startsWith("#!/usr/bin/env node"));
  });

  it("the version is the same everywhere", () => {
    assert.equal(VERSION, pkg.version);
    assert.equal(server.version, pkg.version);
    assert.equal(server.packages[0].version, pkg.version);
    assert.match(read("CHANGELOG.md"), new RegExp(`\\[${pkg.version.replaceAll(".", "\\.")}\\]`));
  });
});

describe("server.json", () => {
  const schema = JSON.parse(read("test/fixtures/server.schema.json"));

  it("is valid against the registry's published schema", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(schema);
    assert.ok(validate(server), JSON.stringify(validate.errors, null, 2));
    assert.equal(server.$schema, schema.$id);
  });

  it("matches package.json the way the registry checks it", () => {
    assert.equal(server.name, "io.github.apiauto-space/apiauto-mcp");
    assert.equal(pkg.mcpName, server.name);
    assert.equal(server.packages[0].registryType, "npm");
    assert.equal(server.packages[0].identifier, pkg.name);
    assert.equal(server.packages[0].transport.type, "stdio");
    assert.ok(server.description.length <= 100, `${server.description.length} characters`);
    assert.equal(server.remotes, undefined);
    assert.equal(server.repository.url, "https://github.com/apiauto-space/apiauto-mcp");
  });

  it("declares the key as a secret, and the optional cap", () => {
    const [variable, cap, ...rest] = server.packages[0].environmentVariables;
    assert.deepEqual(rest, []);
    assert.equal(variable.name, "APIAUTO_API_KEY");
    assert.equal(variable.isSecret, true);
    assert.equal(variable.isRequired, true);
    assert.equal(cap.name, "APIAUTO_MAX_RECORDS_PER_SESSION");
    assert.equal(cap.isRequired, false);
    assert.equal(cap.isSecret, false);
  });
});

describe("CI", () => {
  const workflows = readdirSync(join(ROOT, ".github/workflows")).map((name) => [
    name,
    read(`.github/workflows/${name}`).replaceAll("\r\n", "\n"),
  ]);
  const workflow = (name) => workflows.find(([file]) => file === name)[1];
  /** The workflow's jobs by name, and what stands before them. */
  const parse = (text) => {
    const [top, rest] = text.split(/^jobs:\n/m);
    const parts = rest.split(/^ {2}([\w-]+):\n/m).slice(1);
    const jobs = {};
    for (let i = 0; i < parts.length; i += 2) jobs[parts[i]] = parts[i + 1];
    return { top, jobs };
  };

  it("pins every action to a full commit SHA", () => {
    for (const [name, text] of workflows) {
      const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      assert.ok(uses.length > 0, name);
      for (const action of uses) assert.match(action, /^[\w./-]+@[0-9a-f]{40}$/, `${name}: ${action}`);
    }
  });

  it("sets minimal permissions and uses no secrets", () => {
    for (const [name, text] of workflows) {
      assert.match(parse(text).top, /^permissions:\n\s+contents: read$/m, name);
      assert.ok(!/id-token/.test(parse(text).top), `${name}: no OIDC token at the top level`);
      assert.ok(!/secrets\./.test(text), `${name} should need no secret`);
      assert.ok(!/pull_request_target/.test(text), name);
    }
    const ci = workflow("ci.yml");
    assert.ok(!/id-token/.test(ci));
    assert.match(ci, /npm ci --ignore-scripts/);
    assert.match(ci, /npm audit/);
    assert.match(ci, /check:keyless/);
  });

  it("publish.yml: the job that builds has no token, the job with the token runs no repository code", () => {
    const { jobs } = parse(workflow("publish.yml"));
    assert.deepEqual(Object.keys(jobs), ["build", "publish"]);
    assert.ok(!jobs.build.includes("id-token"));
    assert.ok(!jobs.build.includes("npm publish"));
    assert.match(jobs.build, /npm test/);
    assert.match(jobs.build, /npm pack/);
    assert.match(jobs.build, /upload-artifact/);

    assert.match(jobs.publish, /permissions:\n\s+id-token: write/);
    assert.ok(!jobs.publish.includes("contents:"));
    assert.match(jobs.publish, /environment: npm/);
    assert.match(jobs.publish, /needs: build/);
    assert.match(jobs.publish, /download-artifact/);
    assert.match(jobs.publish, /sha256sum --check/);
    assert.match(jobs.publish, /npm publish "\.\/\$TARBALL" --ignore-scripts/);
    for (const forbidden of ["actions/checkout", "npm ci", "npm run", "npm test", "npm pack"]) {
      assert.ok(!jobs.publish.includes(forbidden), `the publish job must not use ${forbidden}`);
    }
  });

  it("publish.yml: the tag must be on main, and Node and npm are exact versions", () => {
    const text = workflow("publish.yml");
    assert.match(parse(text).jobs.build, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
    assert.match(parse(text).jobs.build, /fetch-depth: 0/);
    for (const [, version] of text.matchAll(/node-version: (\S+)/g)) assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.match(text, /npm@\d+\.\d+\.\d+/);
  });

  it("publish-registry.yml: only from main or a tag, through an environment, on main's history", () => {
    const { jobs } = parse(workflow("publish-registry.yml"));
    assert.match(jobs.publish, /if: github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.match(jobs.publish, /environment: mcp-registry/);
    assert.match(jobs.publish, /id-token: write/);
    assert.match(jobs.publish, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
    assert.match(jobs.publish, /cosign verify-blob/);
    assert.match(jobs.publish, /MCP_PUBLISHER_VERSION: v\d+\.\d+\.\d+/);
  });

  it("the live test key is never given to CI", () => {
    for (const [, text] of workflows) assert.ok(!text.includes("APIAUTO_E2E_KEY"));
  });
});

describe("the files registries read", () => {
  it("the Dockerfile pins its base, runs as a user and holds no key", () => {
    const docker = read("Dockerfile");
    assert.match(docker, /^FROM node:[\d.]+-slim@sha256:[0-9a-f]{64}$/m);
    assert.match(docker, /^USER node$/m);
    assert.match(docker, /--ignore-scripts/);
    assert.ok(!/APIAUTO|au_live_|^ENV /m.test(docker));
    assert.match(read(".dockerignore"), /^\*$/m);
  });

  it("glama.json matches Glama's schema", () => {
    const glama = JSON.parse(read("glama.json"));
    assert.equal(glama.$schema, "https://glama.ai/mcp/schemas/server.json");
    assert.ok(Array.isArray(glama.maintainers) && glama.maintainers.length > 0);
  });

  it("the listings keep the same version and short description, and no paid placement slips in as a step", () => {
    const listings = read("REGISTRY_LISTINGS.md");
    assert.ok(listings.includes(server.description));
    assert.ok(listings.includes(`apiauto-mcp@${pkg.version}`));
    assert.ok(listings.includes(server.name));
    assert.match(listings, /Вариант отправки \| Бесплатно/);
  });
});

describe("the repository's documents", () => {
  for (const file of ["README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "PUBLISHING.md", "GITHUB_ABOUT.md"]) {
    it(`${file} exists`, () => assert.ok(read(file).length > 100));
  }

  it("the README names every tool and disclaims affiliation", () => {
    const readme = read("README.md");
    for (const tool of ["search_cars", "get_car", "get_changes", "list_brands", "list_models", "get_dictionaries", "get_markets", "get_usage"]) {
      assert.ok(readme.includes(`\`${tool}\``), tool);
    }
    assert.match(readme, /not affiliated/i);
    assert.match(readme, /APIAUTO_API_KEY/);
    assert.match(readme, /APIAUTO_MAX_RECORDS_PER_SESSION/);
    assert.ok(readme.includes(`npx -y apiauto-mcp@${pkg.version}`), "the quick start names an exact version");
    assert.ok(readme.includes(`--global --ignore-scripts apiauto-mcp@${pkg.version}`), "the global variant too");
  });

  it("the first paragraphs say what it is, that it is unofficial, its sources, and the price in numbers", () => {
    const opening = read("README.md").split("## Quick start")[0];
    for (const word of ["MCP server", "Unofficial", "Encar", "Che168", "Copart", "IAAI", "100 requests", "$59"]) {
      assert.ok(opening.includes(word), word);
    }
  });

  it("no document or tool text points at the API's status page, which is the owner's own", () => {
    const files = ["README.md", "SECURITY.md", "CHANGELOG.md", "PUBLISHING.md", "GITHUB_ABOUT.md", "REGISTRY_LISTINGS.md", "server.json", "package.json"];
    for (const [path, text] of [...files.map((file) => [file, read(file)]), ...sources]) {
      assert.ok(!/status page|apiauto\.space\/status|страниц\S* статуса/i.test(text), path);
    }
  });

  it("no text calls this official next to someone else's mark", () => {
    for (const file of ["README.md", "GITHUB_ABOUT.md", "SECURITY.md"]) {
      assert.ok(!/official[^.\n]{0,60}(Encar|Che168|Copart|IAAI)/i.test(read(file)), file);
      assert.ok(!/(Encar|Che168|Copart|IAAI)[^.\n]{0,60}\bofficial/i.test(read(file).replace(/Unofficial/g, "")), file);
    }
    assert.ok(!/\bofficial/i.test(server.description.replace(/Unofficial/g, "")));
  });

  it("the README keeps to the length that works, and SECURITY does not promise provenance for 0.1.0", () => {
    const words = read("README.md").replace(/```[\s\S]*?```/g, "").split(/\s+/).length;
    assert.ok(words <= 950, `${words} words outside code`);
    assert.match(read("SECURITY.md"), /0\.1\.0 is published by hand and has no provenance/);
  });
});
