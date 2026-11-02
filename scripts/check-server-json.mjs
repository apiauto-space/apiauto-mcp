// Validates server.json against the schema the registry publishes today, and says when the copy
// in test/fixtures, which the offline test uses, has gone out of date. Needs network.
import { readFileSync } from "node:fs";

import Ajv from "ajv";
import addFormats from "ajv-formats";

const server = JSON.parse(readFileSync("server.json", "utf8"));
const response = await fetch(server.$schema);
if (!response.ok) throw new Error(`${server.$schema}: HTTP ${response.status}`);
const text = await response.text();
const schema = JSON.parse(text);

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats.default(ajv);
const validate = ajv.compile(schema);
if (!validate(server)) {
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}
const same = JSON.stringify(JSON.parse(readFileSync("test/fixtures/server.schema.json", "utf8"))) === JSON.stringify(schema);
console.log(`server.json is valid against ${server.$schema}`);
console.log(same ? "The offline copy of the schema is current." : "The offline copy of the schema differs: refresh test/fixtures/server.schema.json.");
