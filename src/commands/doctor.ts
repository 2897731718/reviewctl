import { spawnSync } from "node:child_process";

import { detectAgent } from "../core/detect-agent.js";
import type { CommandRunner } from "../core/detect-agent.js";
import type { AgentHealth, AgentProvider, AgentSpec } from "../types.js";

const AGENTS: readonly AgentSpec[] = [
  { provider: "codex", command: "codex", versionArgs: ["--version"] },
  { provider: "claude", command: "claude", versionArgs: ["--version"] },
];

export interface DoctorResult {
  agents: AgentHealth[];
  usableProviders: number;
}

export interface AuthenticationDetectionOptions {
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
}

export function runDoctor(options: AuthenticationDetectionOptions = {}): DoctorResult {
  const agents = AGENTS.map((agent) => {
    const health = detectAgent(agent);
    return health.available ? { ...health, ...detectAuthentication(agent.provider, options) } : health;
  });
  return {
    agents,
    usableProviders: agents.filter((agent) => agent.available && agent.authenticated).length,
  };
}

export function formatDoctor(result: DoctorResult): string {
  const rows = result.agents.map((agent) => {
    const status = !agent.available ? "missing" : agent.authenticated ? "ready" : "login";
    const detail = [agent.version, agent.authDetail ?? agent.error].filter(Boolean).join("; ");
    return `${agent.provider.padEnd(8)} ${status.padEnd(8)} ${detail}`;
  });

  const summary = result.usableProviders > 0
    ? `${result.usableProviders} credential-configured provider(s) available. Environment keys are not validated.`
    : "No supported provider is available. Install and authenticate Codex or Claude.";

  return ["Provider Status   Detail", ...rows, "", summary].join("\n");
}

export function detectAuthentication(
  provider: AgentProvider,
  options: AuthenticationDetectionOptions = {},
): Pick<AgentHealth, "authenticated" | "authDetail" | "credentialSource"> {
  const env = options.env ?? process.env;
  const args = provider === "codex" ? ["login", "status"] : ["auth", "status"];
  const result = options.runner
    ? options.runner(provider, args)
    : spawnSync(provider, args, {
        encoding: "utf8",
        shell: false,
        timeout: 5_000,
        env,
      });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const environmentSource = detectEnvironmentCredential(provider, env);

  if (provider === "claude") {
    if (environmentSource) return environmentCredential(environmentSource);
    try {
      const status = JSON.parse(result.stdout ?? "") as {
        loggedIn?: unknown;
        authMethod?: unknown;
        apiKeySource?: unknown;
      };
      const authenticated = status.loggedIn === true;
      return {
        authenticated,
        authDetail: authenticated
          ? `authenticated (${String(status.authMethod ?? "unknown")})`
          : "run `claude auth login`",
        ...(authenticated ? { credentialSource: safeClaudeSource(status) } : {}),
      };
    } catch {
      return environmentSource
        ? environmentCredential(environmentSource)
        : { authenticated: false, authDetail: "unable to read Claude credential status" };
    }
  }

  const authenticated = result.status === 0 && /logged in/iu.test(output);
  if (authenticated) {
    return {
      authenticated: true,
      authDetail: output.split(/\r?\n/u).at(-1) ?? "authenticated",
      credentialSource: "codex credential store",
    };
  }
  if (environmentSource) return environmentCredential(environmentSource);
  return {
    authenticated: false,
    authDetail: "run `codex login` or configure OPENAI_API_KEY",
  };
}

function detectEnvironmentCredential(
  provider: AgentProvider,
  env: NodeJS.ProcessEnv,
): "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN" | undefined {
  if (provider === "codex") return hasValue(env.OPENAI_API_KEY) ? "OPENAI_API_KEY" : undefined;
  if (hasValue(env.ANTHROPIC_API_KEY)) return "ANTHROPIC_API_KEY";
  if (hasValue(env.ANTHROPIC_AUTH_TOKEN)) return "ANTHROPIC_AUTH_TOKEN";
  return undefined;
}

function environmentCredential(
  source: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN",
): Pick<AgentHealth, "authenticated" | "authDetail" | "credentialSource"> {
  return {
    authenticated: true,
    credentialSource: source,
    authDetail: `${source} configured (not validated)`,
  };
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function safeClaudeSource(status: { authMethod?: unknown; apiKeySource?: unknown }): string {
  const source = status.apiKeySource;
  if (source === "ANTHROPIC_API_KEY" || source === "ANTHROPIC_AUTH_TOKEN") return source;
  const method = status.authMethod;
  return typeof method === "string" && /^[a-z0-9_-]{1,32}$/u.test(method)
    ? `claude ${method}`
    : "claude credential store";
}
