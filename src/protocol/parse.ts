import { Ajv, type ValidateFunction } from "ajv";

import {
  CHALLENGE_OUTPUT_SCHEMA,
  REVIEW_OUTPUT_SCHEMA,
  VERDICT_OUTPUT_SCHEMA,
  VERIFICATION_OUTPUT_SCHEMA,
} from "./schema.js";
import type {
  ChallengePayload,
  ReviewPayload,
  VerdictPayload,
  VerificationPayload,
} from "./types.js";

export type ExpectedPhase =
  | ReviewPayload["phase"]
  | ChallengePayload["phase"]
  | VerdictPayload["phase"]
  | VerificationPayload["phase"];

const ajv = new Ajv({ allErrors: true, strict: true });
const validators: Record<ExpectedPhase, ValidateFunction> = {
  independent_review: ajv.compile(REVIEW_OUTPUT_SCHEMA),
  cross_challenge: ajv.compile(CHALLENGE_OUTPUT_SCHEMA),
  adjudication: ajv.compile(VERDICT_OUTPUT_SCHEMA),
  verification: ajv.compile(VERIFICATION_OUTPUT_SCHEMA),
};

export function parseStructuredOutput<T>(raw: string, expectedPhase: ExpectedPhase): T {
  const outer = parseJson(stripFence(raw));
  const candidate = unwrapProviderOutput(outer);

  const validate = validators[expectedPhase];
  if (!validate(candidate)) {
    throw new Error(`Agent output failed ${expectedPhase} schema validation: ${ajv.errorsText(validate.errors)}`);
  }

  return candidate as T;
}

function unwrapProviderOutput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value.structured_output)) return value.structured_output;
  if (typeof value.result === "string") return parseJson(stripFence(value.result));
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Agent returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stripFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
