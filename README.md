# forgespec

Multi-agent SDD (Spec-Driven Development) plugin — contract validation, task board, file reservation, and shared SQLite database. Compatible with **OpenCode**, **Claude**, **Gemini**, and **Codex**.

## Install

```json
{
  "plugin": ["forgespec@latest"]
}
```

```bash
bun install
```

## Features

### SDD Contract Validation

Zod schemas for all 9 SDD phases with schema migration, confidence thresholds, and transition rules.

| Tool | Description |
|------|-------------|
| `sdd_validate` | Validate a JSON contract against its phase schema |
| `sdd_parse_contract` | Extract + validate contract from agent output |

**Pipeline:** `init` → `explore` → `propose` → `spec` → `design` → `tasks` → `apply` → `verify` → `archive`

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

Advisory locking for parallel agent coordination.

| Tool | Description |
|------|-------------|
| `file_reserve` | Reserve files/globs (TTL 15min) |
| `file_check` | Check reservations |
| `file_release` | Release reservations |

## Exports

Other plugins can import shared utilities:

```typescript
import { getDatabase, cleanupOldMessages, consumeNotifications } from "forgespec"
import { validateJson, extractContract, SDD_PHASES } from "forgespec"
import { formatTaskStatus, formatBoardSummary, globOverlaps } from "forgespec"
```

## Development

```bash
bun install
bun test
```

## License

MIT
