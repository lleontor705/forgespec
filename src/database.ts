/**
 * Shared Database — Singleton SQLite DB
 *
 * Tables: threads, messages, messages_fts (FTS5), boards, tasks,
 *         file_reservations, notifications
 */

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "fs"
import { dirname, join } from "path"

export const DB_DIR = process.env.AGENT_MAILBOX_DIR ?? join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".agent-mailbox"
)
export const DB_PATH = process.env.AGENT_MAILBOX_DB ?? join(DB_DIR, "agent-mailbox.db")

let _db: Database | null = null

export function _resetDatabase(): void {
  if (_db) {
    try { _db.close() } catch { /* ignore */ }
    _db = null
  }
}

export function getDatabase(): Database {
  if (_db) return _db

  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const db = new Database(DB_PATH, { create: true })

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA foreign_keys = ON")

  db.run(`CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY, subject TEXT NOT NULL,
    participants TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent TEXT NOT NULL, to_agent TEXT NOT NULL,
    subject TEXT NOT NULL, body TEXT NOT NULL,
    thread_id TEXT, priority TEXT NOT NULL DEFAULT 'normal',
    session_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT, ack_at TEXT,
    FOREIGN KEY (thread_id) REFERENCES threads(id)
  )`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent, read_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_from_agent ON messages(from_agent)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC)`)

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    subject, body, from_agent, to_agent, content=messages, content_rowid=id
  )`)

  db.run(`CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, subject, body, from_agent, to_agent)
    VALUES (new.id, new.subject, new.body, new.from_agent, new.to_agent);
  END`)

  db.run(`CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, body, from_agent, to_agent)
    VALUES ('delete', old.id, old.subject, old.body, old.from_agent, old.to_agent);
  END`)

  db.run(`CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages
    WHEN old.subject != new.subject OR old.body != new.body
         OR old.from_agent != new.from_agent OR old.to_agent != new.to_agent
  BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, body, from_agent, to_agent)
    VALUES ('delete', old.id, old.subject, old.body, old.from_agent, old.to_agent);
    INSERT INTO messages_fts(rowid, subject, body, from_agent, to_agent)
    VALUES (new.id, new.subject, new.body, new.from_agent, new.to_agent);
  END`)

  db.run(`CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY, title TEXT NOT NULL,
    total_tasks INTEGER NOT NULL DEFAULT 0,
    completed_tasks INTEGER NOT NULL DEFAULT 0,
    failed_tasks INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT NOT NULL, board_id TEXT NOT NULL,
    title TEXT NOT NULL, agent TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    dependencies TEXT NOT NULL DEFAULT '[]',
    size TEXT NOT NULL DEFAULT 'M',
    plan_approval TEXT NOT NULL DEFAULT 'NO',
    description TEXT NOT NULL DEFAULT '',
    files TEXT NOT NULL DEFAULT '[]',
    input_context TEXT NOT NULL DEFAULT '',
    output_result TEXT, acceptance TEXT NOT NULL DEFAULT '',
    parallel_group INTEGER NOT NULL DEFAULT 1,
    claimed_by TEXT, claimed_at TEXT,
    started_at TEXT, completed_at TEXT,
    failed_reason TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, board_id),
    FOREIGN KEY (board_id) REFERENCES boards(id)
  )`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id, status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent, status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(board_id, parallel_group)`)

  db.run(`CREATE TABLE IF NOT EXISTS file_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL, reserved_by TEXT NOT NULL,
    board_id TEXT, task_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_pattern ON file_reservations(pattern)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_agent ON file_reservations(reserved_by)`)

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, source TEXT NOT NULL,
    target TEXT NOT NULL, payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT
  )`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target, consumed_at)`)

  _db = db
  return db
}

export function postNotification(db: Database, type: string, source: string, target: string, payload: object): void {
  db.run(`INSERT INTO notifications (type, source, target, payload) VALUES (?, ?, ?, ?)`,
    [type, source, target, JSON.stringify(payload)])
}

export function consumeNotifications(db: Database, target: string, limit = 50):
  Array<{ id: number; type: string; source: string; target: string; payload: string; created_at: string }> {
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE (target = ? OR target = 'broadcast') AND consumed_at IS NULL
    ORDER BY created_at ASC LIMIT ?
  `).all(target, limit) as any[]

  if (rows.length > 0) {
    const ids = rows.map((r: any) => r.id)
    db.run(`UPDATE notifications SET consumed_at = datetime('now') WHERE id IN (${ids.map(() => "?").join(",")})`, ids)
  }
  return rows
}

export function cleanupOldData(db: Database): void {
  try {
    db.run(`DELETE FROM tasks WHERE board_id IN (SELECT id FROM boards WHERE status = 'completed' AND updated_at < datetime('now', '-30 days'))`)
    db.run(`DELETE FROM boards WHERE status = 'completed' AND updated_at < datetime('now', '-30 days')`)
    db.run(`DELETE FROM file_reservations WHERE expires_at <= datetime('now')`)
    db.run(`DELETE FROM notifications WHERE consumed_at IS NOT NULL AND created_at < datetime('now', '-7 days')`)
  } catch { /* best-effort */ }
}

export function cleanupOldMessages(db: Database): void {
  try {
    db.run(`DELETE FROM messages WHERE ack_at IS NOT NULL AND created_at < datetime('now', '-7 days')`)
    db.run(`DELETE FROM messages WHERE read_at IS NOT NULL AND created_at < datetime('now', '-30 days')`)
    db.run(`DELETE FROM threads WHERE id NOT IN (SELECT DISTINCT thread_id FROM messages WHERE thread_id IS NOT NULL)`)
  } catch { /* best-effort */ }
}
