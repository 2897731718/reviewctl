export type AgentProvider = "codex" | "claude";

export interface AgentSpec {
  provider: AgentProvider;
  command: string;
  versionArgs: readonly string[];
}

export interface AgentHealth {
  provider: AgentProvider;
  command: string;
  available: boolean;
  authenticated?: boolean;
  credentialSource?: string;
  version?: string;
  authDetail?: string;
  error?: string;
}
