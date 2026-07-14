import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "./agent-adapter.js";
import { runProcess } from "./process.js";
import type { ProcessRunner } from "./process.js";
import { buildAgentEnvironment } from "../security/environment.js";

export class CodexAdapter implements AgentAdapter {
  readonly provider = "codex" as const;

  constructor(
    private readonly processRunner: ProcessRunner = runProcess,
    private readonly sourceEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const schemaPath = join(request.artifactDir, `${request.runId}.schema.json`);
    const outputPath = join(request.artifactDir, `${request.runId}.result.json`);
    await writeFile(schemaPath, `${JSON.stringify(strictSchema(request.schema), null, 2)}\n`, "utf8");

    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "--color", "never",
      "--sandbox", "read-only",
      "--config", "shell_environment_policy.inherit=none",
      "--cd", request.repoPath,
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "-",
    ];
    const result = await this.processRunner("codex", args, {
      cwd: request.repoPath,
      stdin: request.prompt,
      timeoutMs: request.timeoutMs,
      env: buildAgentEnvironment(this.provider, this.sourceEnv),
    });
    const rawOutput = normalizeOptionalNulls(await readFile(outputPath, "utf8"), request.schema);
    return { provider: this.provider, rawOutput, stdout: result.stdout, stderr: result.stderr };
  }
}

function strictSchema(schema: object): object {
  return transformSchema(schema, schema) as object;
}

function transformSchema(value: unknown, root: object): unknown {
  if (Array.isArray(value)) return value.map((item) => transformSchema(item, root));
  if (!isRecord(value)) return value;

  const transformed = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, transformSchema(item, root)]),
  );
  if ("const" in value && !("type" in value)) transformed.type = jsonType(value.const);
  if (Array.isArray(value.enum) && !("type" in value)) {
    const candidate = value.enum.find((item) => item !== null);
    if (candidate !== undefined) transformed.type = jsonType(candidate);
  }

  if (isRecord(value.properties)) {
    const required = new Set(Array.isArray(value.required) ? value.required : []);
    const properties = Object.fromEntries(Object.entries(value.properties).map(([key, item]) => {
      const strict = transformSchema(item, root);
      return [key, required.has(key) ? strict : { anyOf: [strict, { type: "null" }] }];
    }));
    transformed.properties = properties;
    transformed.required = Object.keys(properties);
  }
  return transformed;
}

function normalizeOptionalNulls(raw: string, schema: object): string {
  try {
    return JSON.stringify(stripOptionalNulls(JSON.parse(raw) as unknown, schema, schema));
  } catch {
    return raw;
  }
}

function stripOptionalNulls(value: unknown, schema: unknown, root: object): unknown {
  const resolved = resolveSchema(schema, root);
  if (!resolved) return value;
  if (Array.isArray(value) && resolved.items !== undefined) {
    return value.map((item) => stripOptionalNulls(item, resolved.items, root));
  }
  if (!isRecord(value) || !isRecord(resolved.properties)) return value;

  const properties = resolved.properties;
  const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const propertySchema = properties[key];
    if (propertySchema === undefined || (item === null && !required.has(key))) return [];
    return [[key, stripOptionalNulls(item, propertySchema, root)]];
  }));
}

function resolveSchema(schema: unknown, root: object): Record<string, unknown> | undefined {
  if (!isRecord(schema)) return undefined;
  if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/$defs/")) return schema;
  const name = schema.$ref.slice("#/$defs/".length);
  const definitions = isRecord(root) && isRecord(root.$defs) ? root.$defs : undefined;
  const resolved = definitions?.[name];
  return isRecord(resolved) ? resolved : schema;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
