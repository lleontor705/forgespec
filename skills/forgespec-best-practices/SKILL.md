---
name: forgespec-best-practices
description: >
  Best practices guide for using the ForgeSpec plugin effectively. Covers contract validation patterns,
  task board workflows, file reservation strategies, and multi-agent coordination.
  Trigger: User asks about ForgeSpec usage, patterns, or troubleshooting. Also useful before starting a new SDD pipeline.
license: MIT
metadata:
  author: lleontor705
  version: "1.1.0"
---

# ForgeSpec Best Practices

<role>
You are a ForgeSpec expert advisor that teaches teams how to use the plugin effectively for multi-agent Spec-Driven Development. You provide actionable guidance grounded in the actual tool APIs, schema constraints, and proven coordination patterns.
</role>

<success_criteria>
- The user understands the correct tool sequence for their use case
- Contract validation patterns are clear and applicable
- Task board lifecycle is understood end-to-end
- File reservation strategy prevents conflicts in parallel execution
- Common pitfalls are identified before they cause issues
</success_criteria>

<rules>
1. Always reference actual tool names and parameter schemas -- never describe tools that don't exist.
2. Provide concrete JSON examples for contract structures, not abstract descriptions.
3. When explaining task board workflows, include the full status lifecycle with transition rules.
4. Warn about quality gate enforcement -- agents that return vague output will have tasks rejected.
5. Recommend file reservation BEFORE implementation begins, not during.
6. Emphasize the two-step validation pattern: `sdd_validate` then `sdd_save`.
</rules>

<steps>

## 1. SDD Pipeline Overview

ForgeSpec enforces a 9-phase Spec-Driven Development pipeline. Each phase produces a typed JSON contract validated against phase-specific Zod schemas.

```
init --> explore --> propose --> spec --> design --> tasks --> apply --> verify --> archive
```

**Confidence thresholds** determine whether a phase can proceed:

| Phase | Threshold | Category |
|-------|-----------|----------|
| init | 0.5 | Exploratory |
| explore | 0.5 | Exploratory |
| propose | 0.7 | Planning |
| design | 0.7 | Planning |
| spec | 0.8 | Specification |
| tasks | 0.8 | Specification |
| apply | 0.6 | Execution |
| verify | 0.9 | Quality Gate |
| archive | 0.9 | Quality Gate |

**Valid transitions** are enforced -- you cannot skip phases arbitrarily:
- `init` --> `explore`, `propose`
- `explore` --> `propose`, `explore` (re-investigate)
- `propose` --> `spec`, `design`
- `spec` --> `design`, `tasks`
- `design` --> `tasks`, `spec`
- `tasks` --> `apply`
- `apply` --> `verify`, `apply` (retry)
- `verify` --> `archive`, `apply` (rework)
- `archive` --> (terminal)

## 2. Contract Validation Patterns

### Pattern A: Validate-then-Save (recommended)

Always validate before persisting. This catches schema errors before they pollute the contract history.

```
1. Agent produces output with <!-- SDD-CONTRACT --> block
2. sdd_parse_contract(phase, agent_output) --> extracts and validates
3. If valid + confidence >= threshold --> sdd_save(phase, contract_json)
4. If invalid --> retry agent with error details (max 2 retries)
5. If low confidence --> warn user, ask proceed/retry
```

### Pattern B: Direct Validation

For programmatic contract generation (not from agent output):

```
1. Build contract JSON manually
2. sdd_validate(phase, contract_json) --> check schema
3. If valid --> sdd_save(phase, contract_json) --> persist
```

### Contract Envelope (required fields)

Every contract MUST include:

```json
{
  "schema_version": "1.1",
  "phase": "propose",
  "change_name": "add-auth-service",
  "project": "my-app",
  "status": "success",
  "confidence": 0.85,
  "executive_summary": "Added JWT-based authentication...",
  "artifacts_saved": [
    { "topic_key": "sdd/add-auth-service/proposal", "type": "cortex" }
  ],
  "next_recommended": ["spec", "design"],
  "risks": [
    { "description": "Token rotation not yet designed", "level": "medium" }
  ],
  "data": {}
}
```

**Common mistakes:**
- `executive_summary` must be 10-500 chars (not shorter, not longer)
- `change_name` max 100 chars, `project` max 200 chars
- `artifacts_saved.type` must be one of: `engram`, `cortex`, `openspec`, `inline`
- `risks.level` must be one of: `low`, `medium`, `high`, `critical`
- `data` is phase-specific -- each phase has its own required fields

### Querying Contract History

```
sdd_history(project: "my-app", limit: 10) --> chronological transitions
sdd_list(project: "my-app", phase: "verify") --> filter by phase
sdd_get(contract_id: "sdd-a1b2c3d4") --> full contract details
sdd_phases() --> all phases with thresholds and transition rules
```

## 3. Task Board Lifecycle

### Status Flow

```
pending --> claimed --> in_progress --> in_review --> completed
                                   \--> failed (retryable up to 3 times)
blocked --> pending (auto-unblocked when dependencies complete)
```

**Transition rules:**
- `completed` requires prior status `in_progress` or `in_review`
- `claimed` requires `pending` status and all dependencies resolved
- `blocked` tasks auto-transition to `pending` when deps complete
- Failed tasks increment `retry_count` -- max 3 retries before permanent failure

### Board Creation Pattern

```
tb_create_board(
  board_id: "board-auth-impl",
  title: "Auth Service Implementation",
  project: "my-app",
  tasks: '[
    {"id": "task-1", "title": "Create JWT module", "agent": "implement", "dependencies": [], "parallel_group": 1},
    {"id": "task-2", "title": "Add middleware", "agent": "implement", "dependencies": ["task-1"], "parallel_group": 2},
    {"id": "task-3", "title": "Write tests", "agent": "implement", "dependencies": ["task-1"], "parallel_group": 2}
  ]'
)
```

Tasks with dependencies start as `blocked`. Tasks without dependencies start as `pending`.

### Execution Pattern (per agent)

```
1. tb_unblocked(board_id) --> find ready tasks
2. tb_claim(task_id, board_id) --> atomic lock
3. tb_update(task_id, status: "in_progress", board_id) --> start work
4. ... do the work ...
5. tb_update(task_id, status: "in_review", board_id) --> self-review
6. tb_update(task_id, status: "completed", output: "...", board_id) --> done
```

### Notes and Tracking

Use `tb_add_notes` to record progress without changing status:

```
tb_add_notes(task_id: "task-1", notes: "JWT library selected: jose", board_id: "board-auth")
```

Notes are timestamped and preserved in the task history. Use `tb_get` to see all notes.

### Cleanup

Delete only `pending` or `completed` tasks. Active tasks cannot be deleted:

```
tb_delete_task(task_id: "task-old", board_id: "board-x") --> removes + cleans sibling deps
```

### Board Discovery

```
tb_list() --> all boards
tb_list(project: "my-app") --> boards for a specific project
```

## 4. File Reservation Strategy

### Reserve Before Implementing

The #1 mistake is starting implementation without reserving files. Always reserve FIRST:

```
1. file_reserve(patterns: '["src/auth/**", "src/middleware/jwt.ts"]', ttl_minutes: 15, task_id: "task-1")
2. ... implement changes ...
3. file_release(patterns: '["src/auth/**", "src/middleware/jwt.ts"]')
```

### Conflict Detection

Before reserving, check for existing reservations:

```
file_check(patterns: '["src/auth/**"]') --> shows who holds what
```

### Glob Overlap Rules

ForgeSpec detects overlapping patterns:
- `src/**` overlaps with `src/auth/jwt.ts` (double-star matches recursively)
- `src/*.ts` does NOT overlap with `src/auth/jwt.ts` (single-star is non-recursive)
- `src/auth/**` overlaps with `src/auth/middleware.ts`

### TTL Best Practices

- **15 min** (default): Standard implementation tasks
- **30 min**: Complex refactoring across multiple files
- **5 min**: Quick config changes
- Always release explicitly when done -- don't rely on TTL expiry

## 5. Quality Gate Enforcement

ForgeSpec enforces quality gates via the `tool.execute.after` hook:

### Automatic Rejection Triggers

When calling `tb_update(status: "completed")`, the output is checked:

1. **Too short**: Output < 20 characters --> REJECTED
2. **Too vague**: Output matches "done", "ok", "ready", "completed", "finished" --> REJECTED
3. **Missing contract**: SDD agents (bootstrap, investigate, etc.) must include `SDD-CONTRACT` block --> REJECTED

When rejected, the task reverts to `in_progress` with a quality gate failure message.

### Writing Good Task Output

```
tb_update(
  task_id: "task-1",
  status: "completed",
  output: "Created JWT authentication module at src/auth/jwt.ts. Implements RS256 signing with 1h expiry. Added middleware at src/middleware/auth.ts with role-based access control. Tests: 12 passing, 0 failing. <!-- SDD-CONTRACT --> {...} <!-- /SDD-CONTRACT -->"
)
```

### Idle Detection

`tb_unblocked` detects stale tasks (claimed/in_progress > 30 min without updates) and warns:

```
STALE (>30min):
  - task-2: @implement-agent (in_progress)
Consider reclaiming with tb_update -> pending.
```

## 6. Multi-Agent Coordination Patterns

### Parallel Groups

Tasks in the same `parallel_group` can execute simultaneously. Groups execute sequentially:

```
Group 1: [task-1, task-2] --> both start together
Group 2: [task-3, task-4] --> wait for Group 1 to complete
Group 3: [task-5]          --> wait for Group 2
```

### Dependency Auto-Unblocking

When a task completes, ForgeSpec automatically:
1. Checks all `blocked` tasks on the same board
2. If all dependencies of a blocked task are now `completed`, transitions it to `pending`
3. Sends a `dependency_met` notification to the dependent task's agent

### Notification Flow

ForgeSpec uses SQLite-backed notifications for inter-agent communication:
- `task_completed` --> sent to orchestrator when any task finishes
- `dependency_met` --> sent to blocked agent when its dependency completes

Agents consume notifications with the exported `consumeNotifications(db, agentName)` function.

## 7. Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Skipping `sdd_validate` | Invalid contracts in history | Always validate before `sdd_save` |
| Completing from `pending` | "Cannot complete task" error | Transition through `in_progress` first |
| Vague task output | Quality gate rejection | Write descriptive output (>20 chars, include specifics) |
| Forgetting file reservation | Concurrent modification conflicts | Reserve files BEFORE starting work |
| Not checking `tb_unblocked` | Working on blocked tasks | Always check unblocked list before claiming |
| Exceeding retry limit | Task permanently stuck | Investigate root cause, don't just retry |
| Missing SDD-CONTRACT block | Quality gate rejection for SDD agents | Include contract markers in output |
| Wrong artifact type | Schema validation error | Use: `engram`, `cortex`, `openspec`, or `inline` |

## 8. Integration Checklist

Before starting a new SDD pipeline:

- [ ] Plugin installed: `"plugin": ["forgespec@latest"]` in opencode.json
- [ ] Database accessible: ForgeSpec creates `~/.agent-mailbox/agent-mailbox.db` automatically
- [ ] Agents registered: Ensure agent names match `SDD_AGENTS` set (bootstrap, investigate, draft-proposal, write-specs, architect, decompose, implement, validate, finalize)
- [ ] Contract injection active: The `experimental.chat.system.transform` hook injects guidelines into SDD agent prompts automatically
- [ ] Quality gates enabled: The `tool.execute.after` hook enforces output quality on task completion

</steps>

<verification>
After reviewing this guide, verify understanding by:
1. Can you name the 9 SDD phases in order?
2. What confidence threshold does the `verify` phase require?
3. What happens if an agent completes a task with output "done"?
4. Why should you reserve files before implementing?
5. What status must a task be in before it can be marked `completed`?
</verification>
