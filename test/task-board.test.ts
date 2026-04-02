import { describe, test, expect } from "bun:test"
import { ensureString, formatTaskStatus, formatBoardSummary, globOverlaps, MAX_RETRIES, TASK_STATUSES } from "../src/task-board"

describe("ensureString", () => {
  test("string passthrough", () => { expect(ensureString("hello")).toBe("hello") })
  test("null fallback", () => { expect(ensureString(null)).toBe(""); expect(ensureString(undefined, "def")).toBe("def") })
  test("joins arrays", () => { expect(ensureString(["a", "b"])).toBe("a | b") })
  test("JSON objects", () => { expect(ensureString({ k: "v" })).toBe('{"k":"v"}') })
  test("numbers", () => { expect(ensureString(42)).toBe("42") })
})

describe("formatTaskStatus", () => {
  test("pending task", () => {
    const out = formatTaskStatus({ id: "T1", title: "Auth", agent: "dev", size: "M", parallel_group: 1, plan_approval: "YES", status: "pending", claimed_by: null, completed_at: null, failed_reason: null, dependencies: "[]", files: "[]" })
    expect(out).toContain("⏳"); expect(out).toContain("[T1]"); expect(out).toContain("@dev")
  })
  test("completed task", () => {
    const out = formatTaskStatus({ id: "T2", title: "Tests", agent: "qa", size: "S", parallel_group: 2, plan_approval: "NO", status: "completed", claimed_by: "qa", completed_at: "2026-01-01", failed_reason: null, dependencies: "[]", files: "[]" })
    expect(out).toContain("✅"); expect(out).toContain("by @qa"); expect(out).toContain("2026-01-01")
  })
  test("failed task", () => {
    const out = formatTaskStatus({ id: "T3", title: "Deploy", agent: "ops", size: "L", parallel_group: 3, plan_approval: "NO", status: "failed", claimed_by: "ops", completed_at: null, failed_reason: "timeout", dependencies: "[]", files: "[]" })
    expect(out).toContain("❌"); expect(out).toContain("timeout")
  })
})

describe("formatBoardSummary", () => {
  test("formats grouped board", () => {
    const board = { id: "b1", title: "Board", status: "active", total_tasks: 2, completed_tasks: 0, failed_tasks: 0, created_at: "2026-01-01", updated_at: "2026-01-01" }
    const tasks = [
      { id: "T1", title: "A", agent: "dev", size: "M", parallel_group: 1, plan_approval: "NO", status: "pending", claimed_by: null, completed_at: null, failed_reason: null, dependencies: "[]", files: "[]" },
      { id: "T2", title: "B", agent: "dev", size: "S", parallel_group: 2, plan_approval: "NO", status: "blocked", claimed_by: null, completed_at: null, failed_reason: null, dependencies: '["T1"]', files: "[]" },
    ]
    const out = formatBoardSummary(board, tasks)
    expect(out).toContain("## Task Board: Board"); expect(out).toContain("GROUP 1"); expect(out).toContain("GROUP 2")
  })
})

describe("globOverlaps", () => {
  test("exact match", () => { expect(globOverlaps("src/a.ts", "src/a.ts")).toBe(true) })
  test("different files", () => { expect(globOverlaps("src/a.ts", "src/b.ts")).toBe(false) })
  test("double-star", () => { expect(globOverlaps("src/**", "src/auth/h.ts")).toBe(true); expect(globOverlaps("src/auth/h.ts", "src/**")).toBe(true) })
  test("single-star", () => { expect(globOverlaps("src/auth/*.ts", "src/auth/h.ts")).toBe(true) })
  test("single-star no nested", () => { expect(globOverlaps("src/*.ts", "src/auth/h.ts")).toBe(false) })
  test("backslash globs", () => { expect(globOverlaps("src\\**", "src/auth/h.ts")).toBe(true) })
  test("different dirs", () => { expect(globOverlaps("src/**", "lib/a.ts")).toBe(false) })
})

describe("formatTaskStatus - in_review", () => {
  test("in_review task", () => {
    const out = formatTaskStatus({ id: "T4", title: "Review", agent: "qa", size: "M", parallel_group: 1, plan_approval: "NO", status: "in_review", claimed_by: "qa", completed_at: null, failed_reason: null, dependencies: "[]", files: "[]" })
    expect(out).toContain("🔍"); expect(out).toContain("[T4]")
  })
})

describe("Constants", () => {
  test("MAX_RETRIES is 3", () => { expect(MAX_RETRIES).toBe(3) })
  test("TASK_STATUSES contains all statuses", () => {
    expect(TASK_STATUSES).toContain("pending")
    expect(TASK_STATUSES).toContain("blocked")
    expect(TASK_STATUSES).toContain("claimed")
    expect(TASK_STATUSES).toContain("in_progress")
    expect(TASK_STATUSES).toContain("in_review")
    expect(TASK_STATUSES).toContain("completed")
    expect(TASK_STATUSES).toContain("failed")
    expect(TASK_STATUSES).toHaveLength(7)
  })
})
