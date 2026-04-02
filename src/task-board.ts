/**
 * Task Board — Helpers for task management, formatting, and file reservation
 */

import type { Database } from "bun:sqlite"

export const MAX_RETRIES = 3

export const TASK_STATUSES = [
  "pending", "blocked", "claimed", "in_progress", "in_review", "completed", "failed",
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export function ensureString(val: unknown, fallback = ""): string {
  if (val == null) return fallback
  if (typeof val === "string") return val
  if (Array.isArray(val)) return val.join(" | ")
  return JSON.stringify(val)
}

export function formatTaskStatus(task: any): string {
  const icons: Record<string, string> = {
    pending: "⏳", blocked: "🚫", claimed: "🔒",
    in_progress: "🔄", in_review: "🔍", completed: "✅", failed: "❌",
  }
  const icon = icons[task.status] ?? "❓"
  return (
    `${icon} [${task.id}] ${task.title}\n` +
    `   Agent: @${task.agent} | Size: ${task.size} | Group: ${task.parallel_group} | Plan Approval: ${task.plan_approval}\n` +
    `   Status: ${task.status}${task.claimed_by ? ` (by @${task.claimed_by})` : ""}` +
    `${task.completed_at ? ` | Completed: ${task.completed_at}` : ""}` +
    `${task.failed_reason ? ` | Failure: ${task.failed_reason}` : ""}\n` +
    `   Dependencies: ${task.dependencies}\n` +
    `   Files: ${task.files}`
  )
}

export function formatBoardSummary(board: any, tasks: any[]): string {
  const groups = new Map<number, any[]>()
  for (const t of tasks) {
    const g = t.parallel_group
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(t)
  }
  let out = `## Task Board: ${board.title} [${board.id}]\n`
  out += `Status: ${board.status} | Total: ${board.total_tasks} | Completed: ${board.completed_tasks} | Failed: ${board.failed_tasks}\n`
  out += `Created: ${board.created_at} | Updated: ${board.updated_at}\n\n`
  for (const [num, gt] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    out += `### GROUP ${num}\n`
    for (const t of gt) out += formatTaskStatus(t) + "\n\n"
  }
  return out
}

export function unblockReadyTasks(db: Database, boardId: string, getBoardTasks: any): void {
  const allTasks = getBoardTasks.all({ $board_id: boardId }) as any[]
  db.transaction(() => {
    for (const t of allTasks) {
      if (t.status !== "blocked") continue
      const deps = JSON.parse(t.dependencies || "[]") as string[]
      if (deps.every((d: string) => { const x = allTasks.find((a: any) => a.id === d); return x && x.status === "completed" })) {
        db.run(`UPDATE tasks SET status = 'pending', updated_at = datetime('now') WHERE id = ? AND board_id = ?`, [t.id, boardId])
      }
    }
  })()
}

const _regexpCache = new Map<string, RegExp>()
const CACHE_MAX = 512

function getCachedRegExp(glob: string): RegExp {
  let re = _regexpCache.get(glob)
  if (re) return re
  re = new RegExp("^" + glob.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$")
  if (_regexpCache.size >= CACHE_MAX) {
    _regexpCache.delete(_regexpCache.keys().next().value!)
  }
  _regexpCache.set(glob, re)
  return re
}

export function _clearRegexpCache(): void { _regexpCache.clear() }
export function _regexpCacheSize(): number { return _regexpCache.size }

export function globOverlaps(a: string, b: string): boolean {
  if (a === b) return true
  const na = a.replace(/\\/g, "/"), nb = b.replace(/\\/g, "/")
  if (na.endsWith("/**") && nb.startsWith(na.slice(0, -2))) return true
  if (nb.endsWith("/**") && na.startsWith(nb.slice(0, -2))) return true
  if (na.includes("*")) {
    if (getCachedRegExp(na).test(nb)) return true
  }
  if (nb.includes("*")) {
    if (getCachedRegExp(nb).test(na)) return true
  }
  return false
}
