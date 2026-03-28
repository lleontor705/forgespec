import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, rmSync, mkdirSync } from "fs"
import { join } from "path"

const TEST_DIR = join(import.meta.dir, ".test-db")
const TEST_DB = join(TEST_DIR, "test.db")
process.env.AGENT_MAILBOX_DIR = TEST_DIR
process.env.AGENT_MAILBOX_DB = TEST_DB

import { getDatabase, postNotification, consumeNotifications, cleanupOldData, cleanupOldMessages, _resetDatabase } from "../src/database"

beforeAll(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }); mkdirSync(TEST_DIR, { recursive: true }) })
afterAll(() => { _resetDatabase(); if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }) })

describe("Database Singleton", () => {
  test("creates and returns instance", () => { expect(getDatabase()).toBeInstanceOf(Database) })
  test("returns same instance", () => { expect(getDatabase()).toBe(getDatabase()) })
  test("creates all tables", () => {
    const names = (getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]).map(t => t.name)
    for (const t of ["boards", "tasks", "threads", "messages", "file_reservations", "notifications"]) expect(names).toContain(t)
  })
  test("creates FTS5 table", () => { expect(getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'`).all()).toHaveLength(1) })
})

describe("Notifications", () => {
  test("post and consume", () => {
    const db = getDatabase()
    postNotification(db, "evt", "a", "b", { msg: "hello" })
    postNotification(db, "evt", "a", "b", { msg: "world" })
    const n = consumeNotifications(db, "b")
    expect(n).toHaveLength(2)
    expect(JSON.parse(n[0].payload)).toEqual({ msg: "hello" })
    expect(consumeNotifications(db, "b")).toHaveLength(0)
  })
  test("broadcast", () => {
    const db = getDatabase()
    postNotification(db, "bc", "sys", "broadcast", { info: "up" })
    const n = consumeNotifications(db, "any-agent")
    expect(n.find(x => x.type === "bc")).toBeDefined()
  })
  test("respects limit", () => {
    const db = getDatabase()
    for (let i = 0; i < 5; i++) postNotification(db, "bulk", "s", "rl", { i })
    expect(consumeNotifications(db, "rl", 2)).toHaveLength(2)
  })
})

describe("Cleanup", () => {
  test("cleanupOldData runs", () => { expect(() => cleanupOldData(getDatabase())).not.toThrow() })
  test("cleanupOldMessages runs", () => { expect(() => cleanupOldMessages(getDatabase())).not.toThrow() })
})
