import { describe, test, expect } from "bun:test"
import { validateJson, extractContract, migrateContract, SDD_PHASES, CONFIDENCE_THRESHOLDS, VALID_TRANSITIONS, CURRENT_SCHEMA_VERSION } from "../src/contracts"
import type { SddPhase } from "../src/contracts"

function makeBase(phase: SddPhase, data: object) {
  return {
    schema_version: "1.1", phase, timestamp: new Date().toISOString(),
    change_name: "test-change", project: "test-project", status: "success", confidence: 0.9,
    executive_summary: "This is a test contract with enough characters to pass validation.",
    artifacts_saved: [{ topic_key: "sdd/test/artifact", type: "inline" }],
    next_recommended: [], risks: [{ description: "No risks identified", level: "low" }], data,
  }
}

const DATA: Record<SddPhase, object> = {
  init: { project_name: "test", tech_stack: ["typescript"], persistence_mode: "none", conventions_detected: ["eslint"], skill_registry_saved: true },
  explore: { topic: "auth", focus: "investigation", affected_files: ["src/auth.ts"], approaches: [{ name: "refactor", effort: "medium", recommended: true }], recommendation: "Refactor", ready_for_proposal: true },
  propose: { change_title: "Auth refactor", intent: "Refactor auth flow for better security", scope_in: ["src/auth/"], scope_out: [], approach: "Replace session tokens with JWT for stateless auth", affected_areas: [{ path: "src/auth.ts", impact: "modified" }], risk_level: "medium", has_rollback_plan: true, success_criteria: ["Tests pass"], dependencies: [] },
  spec: { domains: [{ name: "auth", type: "delta", requirements_added: 3, requirements_modified: 1, requirements_removed: 0, total_scenarios: 5 }], coverage: { happy_paths: "covered", edge_cases: "partial", error_states: "covered" }, total_requirements: 4, total_scenarios: 5 },
  design: { approach_summary: "JWT auth", decisions: [{ title: "Token format", choice: "JWT", rationale: "Standard" }], file_changes: [{ path: "src/auth.ts", action: "modify" }], testing_strategy: { unit: true, integration: true, e2e: false }, open_questions: [], requires_migration: false },
  tasks: { total_tasks: 3, total_phases: 2, phases: [{ phase_number: 1, name: "Impl", task_count: 2 }, { phase_number: 2, name: "Test", task_count: 1 }], parallel_groups: 2, task_board_json_included: true, task_types: ["IMPLEMENTATION", "TEST"] },
  apply: { mode: "standard", tasks_completed: ["T1"], tasks_remaining: ["T2"], tasks_total: 2, files_changed: [{ path: "src/auth.ts", action: "modified" }], deviations_from_design: [], issues_found: [], completion_ratio: 0.5 },
  verify: { completeness: { tasks_total: 2, tasks_complete: 2, tasks_incomplete: 0 }, build: { passed: true }, tests: { passed: 10, failed: 0, skipped: 1 }, compliance: { total_scenarios: 5, compliant: 5, failing: 0, untested: 0, partial: 0 }, issues: { critical: 0, high: 0, major: 0, minor: 0 }, verdict: "pass" },
  archive: { specs_synced: [{ domain: "auth", action: "updated" }], artifact_ids: { spec: "abc123" }, archive_location: "openspec/auth/", all_tasks_complete: true, verification_verdict: "pass" },
}

describe("Contract Validation", () => {
  for (const phase of SDD_PHASES) {
    test(`validates correct ${phase} contract`, () => {
      const r = validateJson(phase, JSON.stringify(makeBase(phase, DATA[phase])))
      expect(r.valid).toBe(true)
      expect(r.errors).toHaveLength(0)
    })
  }
  test("rejects invalid JSON", () => { expect(validateJson("init", "{{{").valid).toBe(false) })
  test("rejects missing fields", () => { expect(validateJson("init", '{"schema_version":"1.1"}').valid).toBe(false) })
  test("rejects wrong phase data", () => { expect(validateJson("init", JSON.stringify(makeBase("init", { wrong: true }))).valid).toBe(false) })
  test("rejects confidence > 1", () => { const c = makeBase("init", DATA.init); (c as any).confidence = 1.5; expect(validateJson("init", JSON.stringify(c)).valid).toBe(false) })
  test("rejects short summary", () => { const c = makeBase("init", DATA.init); c.executive_summary = "short"; expect(validateJson("init", JSON.stringify(c)).valid).toBe(false) })
})

describe("Migration", () => {
  test("v1.0 -> v1.1", () => { const m = migrateContract({ schema_version: "1.0", phase: "init" }); expect(m.schema_version).toBe("1.1"); expect(m.timestamp).toBeDefined() })
  test("v1.1 unchanged", () => { const o = { schema_version: "1.1", phase: "init" }; expect(migrateContract(o)).toEqual(o) })
  test("auto-migration in validation", () => { const c = makeBase("init", DATA.init); (c as any).schema_version = "1.0"; const r = validateJson("init", JSON.stringify(c)); expect(r.valid).toBe(true); expect(r.migrated).toBe(true) })
})

describe("Extraction", () => {
  test("extracts from markers", () => { expect(extractContract('text\n<!-- SDD-CONTRACT -->\n```json\n{"phase":"init"}\n```\n<!-- /SDD-CONTRACT -->\nmore')).toBe('{"phase":"init"}') })
  test("null without markers", () => { expect(extractContract("plain text")).toBeNull() })
  test("null with only open marker", () => { expect(extractContract("<!-- SDD-CONTRACT --> no close")).toBeNull() })
  test("null without JSON", () => { expect(extractContract("<!-- SDD-CONTRACT -->nothing<!-- /SDD-CONTRACT -->")).toBeNull() })
  test("handles nested braces", () => { const j = '{"data":{"nested":{"deep":true}}}'; expect(extractContract(`<!-- SDD-CONTRACT -->\n${j}\n<!-- /SDD-CONTRACT -->`)).toBe(j) })
})

describe("Constants", () => {
  test("9 phases", () => { expect(SDD_PHASES).toHaveLength(9) })
  test("all thresholds in [0,1]", () => { for (const p of SDD_PHASES) { expect(CONFIDENCE_THRESHOLDS[p]).toBeGreaterThanOrEqual(0); expect(CONFIDENCE_THRESHOLDS[p]).toBeLessThanOrEqual(1) } })
  test("all transitions defined", () => { for (const p of SDD_PHASES) expect(Array.isArray(VALID_TRANSITIONS[p])).toBe(true) })
  test("archive is terminal", () => { expect(VALID_TRANSITIONS.archive).toHaveLength(0) })
  test("schema version 1.1", () => { expect(CURRENT_SCHEMA_VERSION).toBe("1.1") })
})
