#!/usr/bin/env node
import "./no-codegen.js";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ApiClient } from "./api.js";
import { createServer, parseRecordLimit } from "./tools.js";

// stdout carries the protocol, so stderr is the only place for logs.
const client = new ApiClient({ apiKey: process.env["APIAUTO_API_KEY"], log });

function log(message: string): void {
  try {
    process.stderr.write(`[apiauto-mcp] ${client.redact(message)}\n`);
  } catch {
    // A closed stderr must not take the server down.
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

// One bad moment must not end the session of a client that is still connected.
process.on("uncaughtException", (error) => {
  if ((error as { code?: unknown }).code === "EPIPE") process.exit(0);
  log(`uncaught ${describe(error)}`);
});
process.on("unhandledRejection", (reason) => log(`unhandled ${describe(reason)}`));

const stop = () => process.exit(0);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.stdin.on("end", stop);
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  log(`stdout ${describe(error)}`);
});

const transport = new StdioServerTransport();
transport.onerror = (error) => log(`transport ${describe(error)}`);

// The last line of defence: what the SDK writes by itself, such as a refusal that repeats a field's
// name, goes through the same redaction as the tool results.
const send = transport.send.bind(transport);
transport.send = (message) =>
  send(
    JSON.parse(
      JSON.stringify(message, (_name, value: unknown) =>
        typeof value === "string" ? client.redact(value) : value,
      ),
    ),
  );

const maxRecordsPerSession = parseRecordLimit(process.env["APIAUTO_MAX_RECORDS_PER_SESSION"]);
await createServer(client, { maxRecordsPerSession }).connect(transport);
log(`started; key is ${client.keyState === "ok" ? "set" : client.keyState === "missing" ? "NOT set" : "MALFORMED"}`);
