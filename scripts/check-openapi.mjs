// Compares the tools' parameters with the API's published OpenAPI document: names, enums and
// ranges. Needs the network, no key. Run it after the API changes: npm run build && npm run check:openapi
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { ApiClient } from "../dist/api.js";
import { createServer } from "../dist/tools.js";

/** Tool parameters handled in this server, not sent to the API. */
const LOCAL = {
  search_cars: ["detail"],
  list_brands: ["name_contains", "limit"],
  list_models: ["name_contains", "limit"],
};
const ROUTES = {
  search_cars: "/v1/cars",
  get_car: "/v1/cars/{car_id}",
  get_changes: "/v1/changes",
  list_brands: "/v1/references/brands",
  list_models: "/v1/references/models",
  get_dictionaries: "/v1/references/dictionaries",
  get_markets: "/v1/references/markets",
  get_usage: "/v1/usage",
};
/** Tool parameter names that differ from the API's. */
const RENAMED = { get_car: { id: "car_id" } };

const response = await fetch("https://api.apiauto.space/openapi.json");
if (!response.ok) throw new Error(`openapi.json: HTTP ${response.status}`);
const spec = await response.json();

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "check", version: "1.0.0" });
await Promise.all([createServer(new ApiClient()).connect(serverSide), client.connect(clientSide)]);
const { tools } = await client.listTools();

const problems = [];
const flat = (schema) => schema.anyOf?.find((option) => option.type !== "null" && option.type !== "string") ?? schema.anyOf?.[0] ?? schema;

for (const tool of tools) {
  const route = spec.paths[ROUTES[tool.name]]?.get;
  if (!route) {
    problems.push(`${tool.name}: the API has no ${ROUTES[tool.name]}`);
    continue;
  }
  const api = new Map(route.parameters.filter((p) => p.name !== "x-api-key").map((p) => [p.name, p]));
  const renamed = RENAMED[tool.name] ?? {};
  const local = LOCAL[tool.name] ?? [];
  const properties = tool.inputSchema.properties ?? {};
  for (const [name, schema] of Object.entries(properties)) {
    if (local.includes(name)) continue;
    const param = api.get(renamed[name] ?? name);
    if (!param) {
      problems.push(`${tool.name}.${name}: not a parameter of the API`);
      continue;
    }
    const remote = flat(param.schema);
    if (schema.enum && remote.enum && [...schema.enum].sort().join() !== [...remote.enum].sort().join()) {
      problems.push(`${tool.name}.${name}: enum ${schema.enum} vs the API's ${remote.enum}`);
    }
    if (schema.maxLength !== undefined && remote.maxLength !== undefined && schema.maxLength > remote.maxLength) {
      problems.push(`${tool.name}.${name}: maxLength ${schema.maxLength} above the API's ${remote.maxLength}`);
    }
    if (schema.maximum !== undefined && remote.maximum !== undefined && schema.maximum > remote.maximum) {
      problems.push(`${tool.name}.${name}: maximum ${schema.maximum} above the API's ${remote.maximum}`);
    }
    if (schema.minimum !== undefined && remote.minimum !== undefined && schema.minimum < remote.minimum) {
      problems.push(`${tool.name}.${name}: minimum ${schema.minimum} below the API's ${remote.minimum}`);
    }
  }
  for (const [name, param] of api) {
    const ours = Object.entries(renamed).find(([, to]) => to === name)?.[0] ?? name;
    if (!properties[ours]) problems.push(`${tool.name}: the API's parameter ${name} is not offered (${param.required ? "required" : "optional"})`);
    if (param.required && !tool.inputSchema.required?.includes(ours)) problems.push(`${tool.name}.${ours}: required by the API`);
  }
}
await client.close();

const spec_paths = Object.keys(spec.paths).filter((path) => !Object.values(ROUTES).includes(path));
console.log(`Tools checked: ${tools.length}. API paths not offered as tools: ${spec_paths.join(", ")}`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("The tools' parameters match the API's OpenAPI document.");
