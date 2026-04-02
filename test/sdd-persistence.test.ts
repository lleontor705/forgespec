import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "fs"
import { join } from "path"

const TEST_DIR = join(import.meta.dir, ".test-db-sdd")
const TEST_DB = join(TEST_DIR, "test.db")
process.env.AGENT_MAILBOX_DIR = TEST_DIR
process.env.AGENT_MAILBOX_DB = TEST_DB

import { getDatabase, logAudit, _resetDatabase } from "../src/database"
import { generateId } from "../src/utils/id"

beforeAll(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }); mkdirSync(TEST_DIR, { recursive: true }) })
afterAll(() => { _resetDatabase(); if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }) })

describe("Contracts table", () => {
  test("table exists", () => {
    const db = getDatabase()
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]).map(t => t.name)
    expect(names).toContain("contracts")
  })

  test("insert and get by ID", () => {
    const db = getDatabase()
    const id = generateId("sdd")
    db.run(`INSERT INTO contracts (id, phase, change_name, project, status, confidence, executive_summary, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, "propose", "test-change", "my-project", "success", 0.85, "Test contract", "{}"])
    const row = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(id) as any
    expect(row).toBeDefined()
    expect(row.phase).toBe("propose")
    expect(row.project).toBe("my-project")
    expect(row.confidence).toBe(0.85)
  })

  test("list by project", () => {
    const db = getDatabase()
    const id2 = generateId("sdd")
    db.run(`INSERT INTO contracts (id, phase, change_name, project, status, confidence, executive_summary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id2, "spec", "test-change", "my-project", "success", 0.9, "Spec contract"])
    const rows = db.prepare(`SELECT * FROM contracts WHERE project = ? ORDER BY created_at DESC`).all("my-project") as any[]
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  test("filter by phase", () => {
    const db = getDatabase()
    const rows = db.prepare(`SELECT * FROM contracts WHERE project = ? AND phase = ?`).all("my-project", "spec") as any[]
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.every((r: any) => r.phase === "spec")).toBe(true)
  })

  test("history with limit", () => {
    const db = getDatabase()
    const rows = db.prepare(`SELECT * FROM contracts WHERE project = ? ORDER BY created_at DESC LIMIT ?`).all("my-project", 1) as any[]
    expect(rows).toHaveLength(1)
  })
})

describe("Audit log", () => {
  test("table exists", () => {
    const db = getDatabase()
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]).map(t => t.name)
    expect(names).toContain("audit_log")
  })

  test("logAudit inserts", () => {
    const db = getDatabase()
    logAudit(db, "contract_saved", "contract", "sdd-abc123", "test-agent", "phase=propose")
    const row = db.prepare(`SELECT * FROM audit_log WHERE entity_id = ?`).get("sdd-abc123") as any
    expect(row).toBeDefined()
    expect(row.action).toBe("contract_saved")
    expect(row.agent_name).toBe("test-agent")
  })

  test("logAudit without optional fields", () => {
    const db = getDatabase()
    logAudit(db, "task_deleted", "task", "task-xyz")
    const row = db.prepare(`SELECT * FROM audit_log WHERE entity_id = ?`).get("task-xyz") as any
    expect(row).toBeDefined()
    expect(row.agent_name).toBeNull()
    expect(row.details).toBeNull()
  })
})

describe("Schema migrations", () => {
  test("tasks has notes column", () => {
    const db = getDatabase()
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain("notes")
  })

  test("boards has project column", () => {
    const db = getDatabase()
    const cols = db.prepare(`PRAGMA table_info(boards)`).all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain("project")
  })
})
