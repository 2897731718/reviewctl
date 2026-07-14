import type { Participant } from "../protocol/types.js";
import type { AgentProvider } from "../types.js";

const PROVIDERS: readonly AgentProvider[] = ["codex", "claude"];

export function selectReviewers(
  availableProviders: readonly AgentProvider[],
  requested = "auto",
): Participant[] {
  const available = PROVIDERS.filter((provider) => availableProviders.includes(provider));
  if (available.length === 0) throw new Error("No authenticated agent provider is available");

  let providers: AgentProvider[];
  if (requested === "auto") {
    providers = available.length >= 2 ? available.slice(0, 2) : [available[0]!, available[0]!];
  } else {
    providers = parseRequestedProviders(requested);
    for (const provider of providers) {
      if (!available.includes(provider)) {
        throw new Error(`Requested provider ${provider} is not installed and authenticated`);
      }
    }
    if (providers.length === 1) providers.push(providers[0]!);
  }

  if (providers.length > 4) throw new Error("At most four reviewer sessions are supported");
  return providers.map((provider, index) => ({
    actorId: `${provider}-reviewer-${index + 1}`,
    provider,
    role: "reviewer",
  }));
}

export function selectJudge(
  availableProviders: readonly AgentProvider[],
  requested = "auto",
): Participant {
  const provider = requested === "auto" ? availableProviders[0] : requested;
  if (!isProvider(provider) || !availableProviders.includes(provider)) {
    throw new Error(`Requested judge ${provider ?? "unknown"} is not installed and authenticated`);
  }
  return { actorId: `${provider}-judge`, provider, role: "judge" };
}

function parseRequestedProviders(value: string): AgentProvider[] {
  const providers: AgentProvider[] = [];
  for (const item of value.split(",")) {
    const match = /^(codex|claude)(?::([1-4]))?$/u.exec(item.trim());
    if (!match || !isProvider(match[1])) {
      throw new Error(`Invalid reviewer selection: ${item}`);
    }
    const count = Number(match[2] ?? "1");
    for (let index = 0; index < count; index += 1) providers.push(match[1]);
  }
  if (providers.length === 0) throw new Error("At least one reviewer must be selected");
  return providers;
}

function isProvider(value: unknown): value is AgentProvider {
  return value === "codex" || value === "claude";
}
