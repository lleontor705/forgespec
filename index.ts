/**
 * forgespec — Multi-agent SDD plugin
 *
 * Contract validation, task board, file reservation, shared SQLite DB.
 * Compatible with OpenCode, Claude, Gemini, and Codex.
 *
 * Install: add "forgespec" to plugin array in opencode.json
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export { getDatabase, postNotification, consumeNotifications, cleanupOldData, cleanupOldMessages, DB_DIR, DB_PATH, _resetDatabase } from "./src/database"
export { SDD_PHASES, SCHEMAS, CONFIDENCE_THRESHOLDS, VALID_TRANSITIONS, CURRENT_SCHEMA_VERSION, BaseEnvelope, validateJson, extractContract, migrateContract, SDD_AGENTS, AGENT_CONTRACT_INJECTION, ORCHESTRATOR_CONTRACT_INJECTION } from "./src/contracts"
export type { SddPhase } from "./src/contracts"
export { MAX_RETRIES, ensureString, formatTaskStatus, formatBoardSummary, unblockReadyTasks, globOverlaps, _clearRegexpCache, _regexpCacheSize } from "./src/task-board"
export { sanitizeInput } from "./src/sanitize"

import { getDatabase, postNotification, cleanupOldData } from "./src/database"
import { type SddPhase, CONFIDENCE_THRESHOLDS, VALID_TRANSITIONS, validateJson, extractContract, SDD_AGENTS, AGENT_CONTRACT_INJECTION, ORCHESTRATOR_CONTRACT_INJECTION } from "./src/contracts"
import { MAX_RETRIES, ensureString, formatTaskStatus, formatBoardSummary, unblockReadyTasks, globOverlaps } from "./src/task-board"

export default (async (ctx) => {
  const db = getDatabase()
  cleanupOldData(db)

  const insertBoard = db.prepare(`INSERT INTO boards (id, title, total_tasks) VALUES ($id, $title, $total_tasks)`)
  const updateBoard = db.prepare(`UPDATE boards SET completed_tasks = (SELECT COUNT(*) FROM tasks WHERE board_id = $id AND status = 'completed'), failed_tasks = (SELECT COUNT(*) FROM tasks WHERE board_id = $id AND status = 'failed'), updated_at = datetime('now'), status = CASE WHEN (SELECT COUNT(*) FROM tasks WHERE board_id = $id AND status IN ('pending','blocked','claimed','in_progress')) = 0 THEN 'completed' ELSE 'active' END WHERE id = $id`)
  const insertTask = db.prepare(`INSERT OR IGNORE INTO tasks (id, board_id, title, agent, status, dependencies, size, plan_approval, description, files, input_context, acceptance, parallel_group) VALUES ($id, $board_id, $title, $agent, $status, $dependencies, $size, $plan_approval, $description, $files, $input_context, $acceptance, $parallel_group)`)
  const getBoard = db.prepare(`SELECT * FROM boards WHERE id = $id`)
  const getActiveBoard = db.prepare(`SELECT * FROM boards WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`)
  const getBoardTasks = db.prepare(`SELECT * FROM tasks WHERE board_id = $board_id ORDER BY parallel_group, id`)
  const getTask = db.prepare(`SELECT * FROM tasks WHERE id = $id AND board_id = $board_id`)
  const claimTask = db.prepare(`UPDATE tasks SET status = 'claimed', claimed_by = $agent, claimed_at = datetime('now'), updated_at = datetime('now') WHERE id = $id AND board_id = $board_id AND status IN ('pending', 'blocked') AND NOT EXISTS (SELECT 1 FROM tasks dep WHERE dep.board_id = $board_id AND dep.id IN (SELECT value FROM json_each(tasks.dependencies)) AND dep.status != 'completed')`)
  const updateTaskStatus = db.prepare(`UPDATE tasks SET status = $status, output_result = COALESCE($output, output_result), failed_reason = $failed_reason, started_at = CASE WHEN $status = 'in_progress' AND started_at IS NULL THEN datetime('now') ELSE started_at END, completed_at = CASE WHEN $status IN ('completed', 'failed') THEN datetime('now') ELSE completed_at END, retry_count = CASE WHEN $status = 'failed' THEN retry_count + 1 ELSE retry_count END, updated_at = datetime('now') WHERE id = $id AND board_id = $board_id`)
  const getUnblockedTasks = db.prepare(`SELECT t.* FROM tasks t WHERE t.board_id = $board_id AND t.status = 'pending' AND NOT EXISTS (SELECT 1 FROM tasks dep WHERE dep.board_id = t.board_id AND dep.id IN (SELECT value FROM json_each(t.dependencies)) AND dep.status != 'completed') ORDER BY t.parallel_group, t.id`)
  const insertReservation = db.prepare(`INSERT INTO file_reservations (pattern, reserved_by, board_id, task_id, expires_at) VALUES ($pattern, $reserved_by, $board_id, $task_id, $expires_at)`)
  const checkReservationExact = db.prepare(`SELECT * FROM file_reservations WHERE pattern = $pattern AND expires_at > datetime('now') AND reserved_by != $agent`)
  const getAllActiveReservationsExcept = db.prepare(`SELECT * FROM file_reservations WHERE expires_at > datetime('now') AND reserved_by != $agent`)
  const releaseReservations = db.prepare(`DELETE FROM file_reservations WHERE reserved_by = $agent`)
  const releaseByPattern = db.prepare(`DELETE FROM file_reservations WHERE pattern = $pattern AND reserved_by = $agent`)
  const cleanExpired = db.prepare(`DELETE FROM file_reservations WHERE expires_at <= datetime('now')`)

  function checkConflict(pattern: string, agent: string, cachedReservations?: any[]): any | null {
    const exact = checkReservationExact.get({ $pattern: pattern, $agent: agent }) as any
    if (exact) return exact
    const reservations = cachedReservations ?? getAllActiveReservationsExcept.all({ $agent: agent }) as any[]
    for (const r of reservations) {
      if (globOverlaps(pattern, r.pattern) || globOverlaps(r.pattern, pattern)) return r
    }
    return null
  }

  function resolveBoard(boardId?: string): any {
    return boardId ? getBoard.get({ $id: boardId }) : getActiveBoard.get()
  }

  function notifyComplete(boardId: string, taskId: string, agent: string, output: string) {
    try {
      postNotification(db, "task_completed", "task-board", "orchestrator", { boardId, taskId, agent, outputSummary: (output ?? "").slice(0, 500) })
      for (const t of (getBoardTasks.all({ $board_id: boardId }) as any[]).filter((t: any) => {
        const deps = JSON.parse(t.dependencies || "[]") as string[]
        return deps.includes(taskId) && (t.status === "pending" || t.status === "blocked")
      })) {
        postNotification(db, "dependency_met", "task-board", t.agent, { boardId, completedTaskId: taskId, unblockedTaskId: t.id, completedBy: agent })
      }
    } catch (e) { console.error(`[forgespec] notify failed:`, e instanceof Error ? e.message : e) }
  }

  return {
    tool: {
      sdd_validate: tool({
        description: "Validate an SDD phase contract JSON block against its typed schema.",
        args: {
          phase: tool.schema.enum(["init", "explore", "propose", "spec", "design", "tasks", "apply", "verify", "archive"]).describe("SDD phase"),
          contract_json: tool.schema.string().describe("JSON string to validate"),
        },
        async execute(args) {
          const r = validateJson(args.phase as SddPhase, args.contract_json)
          return JSON.stringify({ valid: r.valid, errors: r.errors, migrated: r.migrated })
        },
      }),

      sdd_parse_contract: tool({
        description: "Extract and validate SDD contract from agent output text.",
        args: {
          phase: tool.schema.enum(["init", "explore", "propose", "spec", "design", "tasks", "apply", "verify", "archive"]).describe("SDD phase"),
          agent_output: tool.schema.string().describe("Full agent output text"),
        },
        async execute(args) {
          const phase = args.phase as SddPhase
          const jsonStr = extractContract(args.agent_output)
          if (!jsonStr) return JSON.stringify({ valid: false, contract: null, errors: ["No SDD-CONTRACT block found."] })
          const r = validateJson(phase, jsonStr)
          const contract = r.valid ? (r.contract as any) : null
          const threshold = CONFIDENCE_THRESHOLDS[phase]
          const confidence = contract?.confidence ?? 0
          const tw: string[] = []
          if (contract?.next_recommended) {
            const valid = VALID_TRANSITIONS[phase] ?? []
            for (const rec of contract.next_recommended) {
              if (valid.length > 0 && !valid.includes(rec as SddPhase)) tw.push(`Invalid transition: ${phase} -> ${rec}`)
            }
          }
          return JSON.stringify({ valid: r.valid, contract, confidence_ok: confidence >= threshold, confidence, threshold, transition_valid: tw.length === 0, transition_warnings: tw, errors: [...r.errors, ...tw] })
        },
      }),

      tb_create_board: tool({
        description: "Create a task board from decomposed tasks.",
        args: {
          board_id: tool.schema.string().describe("Unique board ID"),
          title: tool.schema.string().describe("Board title"),
          tasks: tool.schema.string().describe("JSON array of task objects"),
        },
        async execute(args) {
          let list: any[]
          try { const raw = typeof args.tasks === "string" ? JSON.parse(args.tasks) : args.tasks; list = Array.isArray(raw) ? raw : (Array.isArray(raw?.tasks) ? raw.tasks : [raw]) } catch { return "ERROR: Invalid JSON in tasks." }
          if (!list.length) return "ERROR: Empty task list."
          db.transaction(() => {
            insertBoard.run({ $id: args.board_id, $title: args.title, $total_tasks: list.length })
            for (const t of list) {
              const deps = t.dependencies ?? []
              insertTask.run({ $id: t.id, $board_id: args.board_id, $title: ensureString(t.title, "Untitled"), $agent: ensureString(t.agent, "developer"), $status: deps.length > 0 ? "blocked" : "pending", $dependencies: JSON.stringify(deps), $size: ensureString(t.size, "M"), $plan_approval: ensureString(t.plan_approval, "NO"), $description: ensureString(t.description), $files: JSON.stringify(t.files ?? []), $input_context: ensureString(t.input ?? t.input_context), $acceptance: ensureString(t.acceptance), $parallel_group: t.parallel_group ?? t.group ?? 1 })
            }
          })()
          return formatBoardSummary(getBoard.get({ $id: args.board_id }) as any, getBoardTasks.all({ $board_id: args.board_id }) as any[])
        },
      }),

      tb_status: tool({
        description: "Get current task board state.",
        args: { board_id: tool.schema.string().optional().describe("Board ID (omit for active board)") },
        async execute(args) {
          const b = resolveBoard(args.board_id) as any
          if (!b) return "No active task board found."
          return formatBoardSummary(b, getBoardTasks.all({ $board_id: b.id }) as any[])
        },
      }),

      tb_claim: tool({
        description: "Claim a task (atomic lock, dependency check).",
        args: { task_id: tool.schema.string().describe("Task ID"), board_id: tool.schema.string().optional().describe("Board ID") },
        async execute(args, context) {
          const agent = context.agent ?? "unknown"
          const b = resolveBoard(args.board_id) as any
          if (!b) return "ERROR: No active task board."
          const r = claimTask.run({ $id: args.task_id, $board_id: b.id, $agent: agent })
          if (r.changes === 0) {
            const t = getTask.get({ $id: args.task_id, $board_id: b.id }) as any
            if (!t) return `ERROR: Task ${args.task_id} not found.`
            if (t.status === "completed") return `Task ${args.task_id} already completed.`
            if (t.status === "claimed" || t.status === "in_progress") return `Task ${args.task_id} already claimed by @${t.claimed_by}.`
            const deps = JSON.parse(t.dependencies || "[]") as string[]
            const allTasks = getBoardTasks.all({ $board_id: b.id }) as any[]
            const taskMap = new Map(allTasks.map((at: any) => [at.id, at]))
            const unmet = deps.filter((d: string) => { const x = taskMap.get(d); return x && x.status !== "completed" }).map((d: string) => { const x = taskMap.get(d); return `${d} (${x?.status})` })
            if (unmet.length) return `BLOCKED: Unmet dependencies: ${unmet.join(", ")}.`
            return `ERROR: Could not claim. Status: ${t.status}.`
          }
          return `Task ${args.task_id} claimed by @${agent}.`
        },
      }),

      tb_update: tool({
        description: "Update task status with auto-notification.",
        args: {
          task_id: tool.schema.string().describe("Task ID"), status: tool.schema.enum(["in_progress", "completed", "failed", "pending"]).describe("New status"),
          output: tool.schema.string().optional().describe("Output summary"), failed_reason: tool.schema.string().optional().describe("Failure reason"),
          board_id: tool.schema.string().optional().describe("Board ID"),
        },
        async execute(args, context) {
          const agent = context.agent ?? "unknown"
          const b = resolveBoard(args.board_id) as any
          if (!b) return "ERROR: No active task board."
          if (args.status === "pending" || args.status === "in_progress") {
            const cur = getTask.get({ $id: args.task_id, $board_id: b.id }) as any
            if (cur && cur.retry_count >= MAX_RETRIES) return `ERROR: Task ${args.task_id} exceeded max retries (${MAX_RETRIES}).`
          }
          updateTaskStatus.run({ $id: args.task_id, $board_id: b.id, $status: args.status, $output: args.output ?? null, $failed_reason: args.failed_reason ?? null })
          updateBoard.run({ $id: b.id })
          if (args.status === "completed") { unblockReadyTasks(db, b.id, getBoardTasks); notifyComplete(b.id, args.task_id, agent, args.output ?? "") }
          const ut = getTask.get({ $id: args.task_id, $board_id: b.id }) as any
          const ub = getBoard.get({ $id: b.id }) as any
          return `Task ${args.task_id} -> '${args.status}'.\nProgress: ${ub.completed_tasks}/${ub.total_tasks} completed, ${ub.failed_tasks} failed.\n\n${formatTaskStatus(ut)}`
        },
      }),

      tb_unblocked: tool({
        description: "List tasks ready to execute (all deps completed).",
        args: { board_id: tool.schema.string().optional().describe("Board ID") },
        async execute(args) {
          const b = resolveBoard(args.board_id) as any
          if (!b) return "No active task board."
          unblockReadyTasks(db, b.id, getBoardTasks)
          const all = getBoardTasks.all({ $board_id: b.id }) as any[]
          const statusMap = new Map(all.map((t: any) => [t.id, t.status]))
          const ready = all.filter((t: any) => {
            if (t.status !== "pending") return false
            const deps = JSON.parse(t.dependencies || "[]") as string[]
            return deps.every((d: string) => statusMap.get(d) === "completed")
          })
          const staleMinutes = 30
          const stale = all.filter((t: any) =>
            ["claimed", "in_progress"].includes(t.status) && t.updated_at &&
            (Date.now() - new Date(t.updated_at + "Z").getTime()) > staleMinutes * 60000
          )
          const staleWarning = stale.length ? `\n\n⚠️ STALE (>${staleMinutes}min):\n${stale.map((t: any) => `  - ${t.id}: @${t.claimed_by} (${t.status})`).join("\n")}\nConsider reclaiming with tb_update -> pending.` : ""
          if (!ready.length) {
            const rem = all.filter((t: any) => !["completed", "failed"].includes(t.status))
            if (!rem.length) return "All tasks completed! Board is done."
            const ip = rem.filter((t: any) => ["claimed", "in_progress"].includes(t.status))
            if (ip.length) return `No new tasks. ${ip.length} in progress:\n${ip.map((t: any) => `  - ${t.id}: @${t.claimed_by} (${t.status})`).join("\n")}` + staleWarning
            return `No unblocked tasks. ${rem.length} still blocked.` + staleWarning
          }
          return `${ready.length} task(s) ready:\n\n${ready.map((t: any) => formatTaskStatus(t)).join("\n\n")}` + staleWarning
        },
      }),

      tb_get: tool({
        description: "Get full task details.",
        args: { task_id: tool.schema.string().describe("Task ID"), board_id: tool.schema.string().optional().describe("Board ID") },
        async execute(args) {
          const b = resolveBoard(args.board_id) as any
          if (!b) return "No active task board."
          const t = getTask.get({ $id: args.task_id, $board_id: b.id }) as any
          if (!t) return `Task ${args.task_id} not found.`
          let out = formatTaskStatus(t) + `\n   Description: ${t.description}\n   Input: ${t.input_context}\n   Acceptance: ${t.acceptance}`
          if (t.output_result) out += `\n   Output: ${t.output_result}`
          if (t.failed_reason) out += `\n   Failure: ${t.failed_reason}`
          return out
        },
      }),

      tb_add_task: tool({
        description: "Add a single task to an existing board.",
        args: { board_id: tool.schema.string().optional().describe("Board ID"), task: tool.schema.string().describe("JSON task object") },
        async execute(args) {
          const b = resolveBoard(args.board_id) as any
          if (!b) return "ERROR: No active task board."
          let t: any
          try { t = typeof args.task === "string" ? JSON.parse(args.task) : args.task } catch { return "ERROR: Invalid JSON." }
          const deps = t.dependencies ?? [], status = deps.length > 0 ? "blocked" : "pending"
          insertTask.run({ $id: t.id, $board_id: b.id, $title: ensureString(t.title, "Untitled"), $agent: ensureString(t.agent, "developer"), $status: status, $dependencies: JSON.stringify(deps), $size: ensureString(t.size, "M"), $plan_approval: ensureString(t.plan_approval, "NO"), $description: ensureString(t.description), $files: JSON.stringify(t.files ?? []), $input_context: ensureString(t.input ?? t.input_context), $acceptance: ensureString(t.acceptance), $parallel_group: t.parallel_group ?? 99 })
          db.run(`UPDATE boards SET total_tasks = total_tasks + 1, updated_at = datetime('now') WHERE id = ?`, [b.id])
          return `Task ${t.id} added. Status: ${status}.`
        },
      }),

      file_reserve: tool({
        description: "Reserve files/globs with TTL (default 15min).",
        args: { patterns: tool.schema.string().describe("JSON array of patterns"), ttl_minutes: tool.schema.number().optional().describe("TTL in minutes"), task_id: tool.schema.string().optional().describe("Task ID") },
        async execute(args, context) {
          const agent = context.agent ?? "unknown", ttl = args.ttl_minutes ?? 15
          const exp = (db.prepare(`SELECT datetime('now', '+' || ? || ' minutes') as t`).get(ttl) as any).t as string
          cleanExpired.run()
          let patterns: string[]
          try { patterns = JSON.parse(args.patterns) } catch { patterns = [args.patterns] }
          const conflicts: string[] = [], reserved: string[] = [], board = getActiveBoard.get() as any
          const activeReservations = getAllActiveReservationsExcept.all({ $agent: agent }) as any[]
          db.transaction(() => {
            for (const p of patterns) {
              const ex = checkConflict(p, agent, activeReservations) as any
              if (ex) { conflicts.push(`${p} — by @${ex.reserved_by} until ${ex.expires_at}`); continue }
              insertReservation.run({ $pattern: p, $reserved_by: agent, $board_id: board?.id ?? null, $task_id: args.task_id ?? null, $expires_at: exp })
              reserved.push(p)
            }
          })()
          let r = ""
          if (reserved.length) r += `Reserved ${reserved.length} by @${agent} until ${exp}:\n${reserved.map(p => `  ✅ ${p}`).join("\n")}\n`
          if (conflicts.length) r += `\n⚠️ ${conflicts.length} conflict(s):\n${conflicts.map(c => `  🚫 ${c}`).join("\n")}`
          return r || "No patterns to reserve."
        },
      }),

      file_check: tool({
        description: "Check if files are reserved by another agent.",
        args: { patterns: tool.schema.string().describe("JSON array of file paths") },
        async execute(args, context) {
          const agent = context.agent ?? "unknown"; cleanExpired.run()
          let patterns: string[]
          try { patterns = JSON.parse(args.patterns) } catch { patterns = [args.patterns] }
          const activeReservations = getAllActiveReservationsExcept.all({ $agent: agent }) as any[]
          return patterns.map(p => { const ex = checkConflict(p, agent, activeReservations) as any; return ex ? `🚫 ${p} — by @${ex.reserved_by} until ${ex.expires_at}` : `✅ ${p} — available` }).join("\n")
        },
      }),

      file_release: tool({
        description: "Release file reservations.",
        args: { patterns: tool.schema.string().optional().describe("JSON array of patterns (omit for all)") },
        async execute(args, context) {
          const agent = context.agent ?? "unknown"
          if (!args.patterns) { const r = releaseReservations.run({ $agent: agent }); return `Released all by @${agent} (${r.changes}).` }
          let patterns: string[]
          try { patterns = JSON.parse(args.patterns) } catch { patterns = [args.patterns] }
          let n = 0; for (const p of patterns) n += releaseByPattern.run({ $pattern: p, $agent: agent }).changes
          return `Released ${n} reservation(s) by @${agent}.`
        },
      }),
    },

    "experimental.chat.system.transform": async (input: any, output: any) => {
      const agent = input.agent ?? ""
      if (SDD_AGENTS.has(agent)) output.system.push(AGENT_CONTRACT_INJECTION)
      else if (agent === "orchestrator") output.system.push(ORCHESTRATOR_CONTRACT_INJECTION)
    },

    "tool.execute.after": async (input: any, output: any) => {
      if (input.tool === "tb_update" && input.args?.status === "completed") {
        const taskOutput = input.args?.output ?? "", issues: string[] = []
        if (!taskOutput || taskOutput.trim().length < 20) issues.push("Output too short (min 20 chars).")
        const agent = input.agent ?? ""
        if (typeof agent === "string" && agent.startsWith("sdd-") && !taskOutput.includes("SDD-CONTRACT") && !taskOutput.includes("sdd-contract")) issues.push("Missing SDD-CONTRACT block.")
        if (/^(done|completed|finished|ok|listo|ready|hecho)\.?$/i.test(taskOutput.trim())) issues.push("Output too vague.")
        if (issues.length) {
          try { updateTaskStatus.run({ $id: input.args.task_id, $board_id: input.args.board_id ?? (getActiveBoard.get() as any)?.id ?? "", $status: "in_progress", $output: null, $failed_reason: null }) } catch {}
          output.output = (output.output ?? "") + `\n\n⚠️ REJECTED — Quality gate failed:\n${issues.map((i, n) => `  ${n + 1}. ${i}`).join("\n")}\nTask remains in_progress.`
          return
        }
      }
      if (input.tool === "tb_unblocked" && typeof output.output === "string" && (output.output.includes("No new tasks") || output.output.includes("No unblocked"))) {
        const board = getActiveBoard.get() as any
        if (board?.status === "active") {
          const tasks = getBoardTasks.all({ $board_id: board.id }) as any[]
          const hints: string[] = []
          const failed = tasks.filter((t: any) => t.status === "failed")
          const blocked = tasks.filter((t: any) => t.status === "blocked")
          const ip = tasks.filter((t: any) => t.status === "in_progress" || t.status === "claimed")
          if (failed.length) hints.push(`${failed.length} failed task(s) to retry: ${failed.map((t: any) => t.id).join(", ")}`)
          if (blocked.length && !ip.length) hints.push(`${blocked.length} blocked with no in-progress work`)
          if (hints.length) output.output += `\n\n💡 IDLE HINT:\n${hints.map(h => `  - ${h}`).join("\n")}`
        }
      }
    },
  }
}) satisfies Plugin
