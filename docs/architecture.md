# V0.1 architecture

## Objective

Prove that one or more locally authenticated AI coding-agent CLIs can be
orchestrated into an isolated, resumable, evidence-driven review workflow.

## Modules

```text
CLI
 ├─ doctor
 ├─ review / status
 ├─ resume / report regeneration
 │
Orchestrator ─ PolicyEngine
 │
 ├─ AgentAdapter
 │   ├─ CodexAdapter
 │   └─ ClaudeAdapter
 ├─ EvidenceRunner
 └─ EventLedger ─ Snapshot ─ Report
```

- **CLI** parses user intent and renders results.
- **Orchestrator** owns phase transitions, retries, cancellation, and recovery.
- **AgentAdapter** contains provider-specific process and output handling.
- **PolicyEngine** owns permissions, budgets, and stop conditions.
- **EvidenceRunner** is the only component allowed to run approved checks.
- **EventLedger** is the append-only source of truth.
- **Report** derives human-readable and machine-readable output from snapshots.

## Review lifecycle

```text
CREATED -> PREFLIGHT -> INDEPENDENT_REVIEW -> CROSS_CHALLENGE
        -> REBUTTAL -> EVIDENCE_VERIFICATION -> ADJUDICATION -> COMPLETED
```

Any running phase can become `PAUSED`; recovery resumes from the first
incomplete phase by replaying ledger events. Provider session IDs may improve
continuity but are never required for correctness.

## Provider selection

- Codex and Claude available: prefer cross-provider review.
- Only one provider available: create isolated reviewer, challenger, and judge
  sessions using that provider and disclose the limitation in the report.
- No provider available: fail during preflight with remediation instructions.

## Initial storage

```text
.ai-review/reviews/<review-id>/
├── manifest.json
├── events.ndjson
├── snapshot.json
├── artifacts/
└── report.md
```

Writes to `events.ndjson` are append-only. Snapshots are replaceable derived
state and must be rebuildable from the event stream.

## Security boundary

Reviews are read-only by default. Agent output is data, not executable input.
Commands are launched without a shell, repository content is treated as
untrusted, and checks require explicit allowlisting. Fixes are a separate phase
that requires the user to choose findings and an executor.

Each provider process receives only a provider-specific environment allowlist.
Codex review processes ignore user configuration and rules, and model-invoked
shell commands inherit no CLI environment variables. Provider output is
redacted before persistence and validated against the complete phase schema;
invalid nested values are rejected and retried once.

## Implemented V0.1 slice

- Provider installation and authentication checks.
- Automatic cross-provider or isolated single-provider participant selection.
- Independent review, cross-challenge, and adjudication phases.
- Structured output schemas for both supported CLIs.
- Append-only events, redacted provider artifacts, atomic snapshot, and Markdown report.
- Per-agent timeout and output-size limits.
- Repository path containment and report active-content escaping.
- Phase-level resume from ledger events, stale-lock recovery, and report regeneration.
- One retry when a provider returns invalid structured output.
- Provider-specific environment allowlists, credential redaction, and strict nested schema validation.
- Read-only finding verification with separate current-state results and preserved verdict history.

Deterministic command-based evidence execution and the separately authorized
fix workflow remain planned work.
