import type { AgentProvider } from "../types.js";
import type { AgentAdapter } from "./agent-adapter.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";

export type AdapterFactory = (provider: AgentProvider) => AgentAdapter;

export const createAdapter: AdapterFactory = (provider) => (
  provider === "codex" ? new CodexAdapter() : new ClaudeAdapter()
);
