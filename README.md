<p align="center">
  <strong>forgespec</strong><br>
  <em>Multi-agent SDD plugin — contracts, task board, file reservation</em>
</p>

<p align="center">
  <a href="https://github.com/lleontor705/forgespec/actions/workflows/ci.yml"><img src="https://github.com/lleontor705/forgespec/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/forgespec"><img src="https://img.shields.io/npm/v/forgespec" alt="npm" /></a>
  <a href="https://github.com/lleontor705/forgespec/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
</p>

---

Spec-Driven Development infrastructure for multi-agent AI systems. Zod contract validation for 9 SDD phases, SQLite-backed task board with dependency auto-unblocking, and advisory file locking for parallel agent coordination.

Compatible with **OpenCode**, **Claude**, **Gemini**, and **Codex**.

## Install

```json
{
  "plugin": ["forgespec@latest"]
}
```

## SDD Pipeline

```
init --> explore --> propose --> spec --> design --> tasks --> apply --> verify --> archive
```

Each phase produces a **typed JSON contract** validated with Zod schemas, ensuring structured handoffs between agents.

## Features

### Contract Validation

| Tool | Description |
|------|-------------|
| `sdd_validate` | Validate a JSON contract against its phase schema |
| `sdd_parse_contract` | Extract and validate contract from agent output |

### Task Board

SQLite-backed task tracking with dependency auto-unblocking and quality gate hooks.

| Tool | Description |
|------|-------------|
| `tb_create_board` | Create a task board from decomposed tasks |
| `tb_status` | Get current board state |
| `tb_claim` | Claim a task (atomic lock) |
| `tb_update` | Update task status |
| `tb_unblocked` | List ready tasks |
| `tb_get` | Get task details |
| `tb_add_task` | Add a follow-up task |

### File Reservation

Advisory locking for parallel agent coordination (15min TTL).

| Tool | Description |
|------|-------------|
| `file_reserve` | Reserve files or globs |
| `file_check` | Check reservations |
| `file_release` | Release reservations |

## Exports

Other plugins can import shared utilities:

```typescript
import { getDatabase, cleanupOldMessages, consumeNotifications } from "forgespec";
import { validateJson, extractContract, SDD_PHASES } from "forgespec";
import { formatTaskStatus, formatBoardSummary, globOverlaps } from "forgespec";
```

## Development

```bash
bun install
bun test
bun run typecheck
```

## Contributing

1. Fork the repo
2. Create a feature branch from `develop`: `git checkout -b feat/my-feature develop`
3. Make your changes and add tests
4. Run `bun test && bun run typecheck`
5. Open a PR to `develop`

## License

MIT
