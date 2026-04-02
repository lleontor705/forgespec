# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests (Bun's built-in test runner)
bun run typecheck        # TypeScript strict checking (tsc --noEmit)
```

There is no separate build step — the package ships TypeScript directly (`"module": "index.ts"`). Tests live in `test/` and use `bun:test`. To run a single test file:

```bash
bun test test/contracts.test.ts
```

## Architecture

**forgespec** is an OpenCode plugin (`@opencode-ai/plugin`) that provides the infrastructure for Spec-Driven Development (SDD) with multi-agent AI coordination. It exports typed tools and hooks consumed by AI agents in an orchestrated pipeline.

### SDD Pipeline

Nine sequential phases, each with a Zod-validated contract schema:

```
init → explore → propose → spec → design → tasks → apply → verify → archive
```

Confidence thresholds vary by phase (0.5 for exploratory, up to 0.9 for quality gates). Contracts auto-migrate from v1.0 → v1.1.

### Core Modules

- **`index.ts`** — Plugin entry point. Registers 20 tools and 2 hooks (`experimental.chat.system.transform` for injecting SDD context into agent prompts, `tool.execute.after` for quality gates on task completion). This is the main integration surface.
- **`src/contracts.ts`** — Zod schemas for all 9 SDD phases, contract validation/extraction, version migration logic. Exports `RiskSchema`, `ArtifactSchema`, `SDD_PHASES`, and `SDD_AGENTS`.
- **`src/database.ts`** — SQLite singleton (WAL mode, 5s busy timeout). Schema includes: `threads`/`messages` (with FTS5) for inter-agent messaging, `boards`/`tasks` for task board state, `contracts` for SDD contract persistence, `file_reservations` for advisory locking (15-min TTL), `notifications` for event sourcing, `audit_log` for action traceability.
- **`src/task-board.ts`** — Task formatting, glob overlap detection (with LRU regex cache, max 512 entries), dependency auto-unblocking logic. Exports `TASK_STATUSES` constant.
- **`src/utils/id.ts`** — `generateId(prefix)` utility for prefixed UUID generation.
- **`src/sanitize.ts`** — Input sanitization (max length enforcement, null byte removal).

### Key Design Patterns

- **Singleton DB**: One shared SQLite instance per runtime, initialized lazily via `getDatabase()`.
- **Atomic transactions**: All multi-step DB operations wrapped in transactions.
- **Quality gates**: The `tool.execute.after` hook rejects `tb_update(status=completed)` if output is too short (<20 chars), too vague, or missing an SDD-CONTRACT block for SDD agents.
- **Advisory file locking**: Glob-pattern-based reservations prevent concurrent modification across parallel agents.

### Task Statuses

`pending` → `claimed` → `in_progress` → `in_review` → `completed`. Also: `blocked`, `failed`. Completing a task requires `in_progress` or `in_review` status first.

### Plugin Tools (exported)

**SDD Contracts**: `sdd_validate`, `sdd_parse_contract`, `sdd_save`, `sdd_get`, `sdd_list`, `sdd_history`, `sdd_phases`
**Task Board**: `tb_create_board`, `tb_status`, `tb_unblocked`, `tb_claim`, `tb_update`, `tb_get`, `tb_add_task`, `tb_delete_task`, `tb_add_notes`, `tb_list`
**File Reservation**: `file_reserve`, `file_check`, `file_release`

## Git Workflow

- **Branching**: Gitflow — `master` (production), `develop` (staging). Feature branches from `develop`.
- **CI**: GitHub Actions runs typecheck + tests on Ubuntu, Windows, macOS.
- **Release**: Push to `master` triggers cross-platform CI → manual approval gate → npm publish with provenance → GitHub release with git tag.

## Testing

Tests use isolated DB at `test/.test-db/test.db` (auto-created, gitignored). `bench.test.ts` contains performance baselines (e.g., glob overlap < 100ms for 10k calls). Tests run cross-platform in CI.

## Runtime

Requires **Bun >= 1.3.5**. The only production dependency is `@opencode-ai/plugin`. SQLite is provided by Bun's built-in `bun:sqlite`.
