/**
 * SDD Contracts — Zod schemas for the 9 SDD phases
 */

import { z } from "zod"

export const SDD_PHASES = [
  "init", "explore", "propose", "spec", "design",
  "tasks", "apply", "verify", "archive",
] as const

export type SddPhase = (typeof SDD_PHASES)[number]

const SddPhaseEnum = z.enum(SDD_PHASES)
const RiskLevel = z.enum(["low", "medium", "high", "critical"])

export const CURRENT_SCHEMA_VERSION = "1.1"
const SUPPORTED_VERSIONS = ["1.0", "1.1"] as const
const SchemaVersion = z.enum(SUPPORTED_VERSIONS)

export function migrateContract(parsed: any): any {
  if (!parsed || !parsed.schema_version) return parsed
  if (parsed.schema_version === "1.0") {
    return { ...parsed, schema_version: "1.1", timestamp: parsed.timestamp ?? new Date().toISOString() }
  }
  return parsed
}

export const BaseEnvelope = z.object({
  schema_version: SchemaVersion,
  phase: SddPhaseEnum,
  timestamp: z.string().max(64).optional(),
  change_name: z.string().min(1).max(100),
  project: z.string().min(1).max(200),
  status: z.enum(["success", "partial", "failed", "blocked"]),
  confidence: z.number().min(0).max(1),
  executive_summary: z.string().min(10).max(500),
  artifacts_saved: z.array(z.object({ topic_key: z.string().max(300), type: z.enum(["engram", "openspec", "inline"]) }).strict()),
  next_recommended: z.array(z.string().max(50)),
  risks: z.array(z.object({ description: z.string().max(500), level: RiskLevel }).strict()),
}).strict()

const InitContract = BaseEnvelope.extend({
  phase: z.literal("init"),
  data: z.object({
    project_name: z.string().max(200), tech_stack: z.array(z.string().max(100)).min(1),
    persistence_mode: z.enum(["engram", "openspec", "hybrid", "none"]),
    conventions_detected: z.array(z.string().max(200)),
    architecture_pattern: z.string().max(200).optional(), skill_registry_saved: z.boolean(),
  }).strict(),
})

const ExploreContract = BaseEnvelope.extend({
  phase: z.literal("explore"),
  data: z.object({
    topic: z.string().max(300), focus: z.enum(["architecture", "investigation", "migration", "general"]),
    affected_files: z.array(z.string().max(500)),
    approaches: z.array(z.object({ name: z.string().max(200), effort: z.enum(["low", "medium", "high"]), recommended: z.boolean() }).strict()).min(1),
    recommendation: z.string().max(2000), ready_for_proposal: z.boolean(),
    root_cause: z.object({ location: z.string().max(500), description: z.string().max(1000) }).strict().optional(),
  }).strict(),
})

const ProposeContract = BaseEnvelope.extend({
  phase: z.literal("propose"),
  data: z.object({
    change_title: z.string().max(300), intent: z.string().min(10).max(2000),
    scope_in: z.array(z.string().max(500)).min(1), scope_out: z.array(z.string().max(500)),
    approach: z.string().min(10).max(5000),
    affected_areas: z.array(z.object({ path: z.string().max(500), impact: z.enum(["new", "modified", "removed"]) }).strict()),
    risk_level: RiskLevel, has_rollback_plan: z.boolean(),
    success_criteria: z.array(z.string().max(500)).min(1), dependencies: z.array(z.string().max(200)),
  }).strict(),
})

const SpecContract = BaseEnvelope.extend({
  phase: z.literal("spec"),
  data: z.object({
    domains: z.array(z.object({
      name: z.string().max(200), type: z.enum(["delta", "new"]),
      requirements_added: z.number().int().min(0), requirements_modified: z.number().int().min(0),
      requirements_removed: z.number().int().min(0), total_scenarios: z.number().int().min(1),
    }).strict()).min(1),
    coverage: z.object({
      happy_paths: z.enum(["covered", "partial", "missing"]),
      edge_cases: z.enum(["covered", "partial", "missing"]),
      error_states: z.enum(["covered", "partial", "missing"]),
    }).strict(),
    total_requirements: z.number().int().min(1), total_scenarios: z.number().int().min(1),
  }).strict(),
})

const DesignContract = BaseEnvelope.extend({
  phase: z.literal("design"),
  data: z.object({
    approach_summary: z.string().max(5000),
    decisions: z.array(z.object({ title: z.string().max(300), choice: z.string().max(500), rationale: z.string().max(1000) }).strict()).min(1),
    file_changes: z.array(z.object({ path: z.string().max(500), action: z.enum(["create", "modify", "delete"]) }).strict()).min(1),
    testing_strategy: z.object({ unit: z.boolean(), integration: z.boolean(), e2e: z.boolean() }).strict(),
    open_questions: z.array(z.string().max(500)), requires_migration: z.boolean(),
  }).strict(),
})

const TasksContract = BaseEnvelope.extend({
  phase: z.literal("tasks"),
  data: z.object({
    total_tasks: z.number().int().min(1), total_phases: z.number().int().min(1),
    phases: z.array(z.object({ phase_number: z.number().int().min(1), name: z.string().max(200), task_count: z.number().int().min(1) }).strict()),
    parallel_groups: z.number().int().min(1), task_board_json_included: z.boolean(),
    task_types: z.array(z.enum(["IMPLEMENTATION", "REFACTOR", "DATABASE", "INFRASTRUCTURE", "DOCUMENTATION", "TEST"])),
  }).strict(),
})

const ApplyContract = BaseEnvelope.extend({
  phase: z.literal("apply"),
  data: z.object({
    mode: z.enum(["tdd", "standard"]),
    tasks_completed: z.array(z.string().max(100)), tasks_remaining: z.array(z.string().max(100)),
    tasks_total: z.number().int().min(1),
    files_changed: z.array(z.object({ path: z.string().max(500), action: z.enum(["created", "modified", "deleted"]) }).strict()),
    deviations_from_design: z.array(z.string().max(1000)), issues_found: z.array(z.string().max(1000)),
    completion_ratio: z.number().min(0).max(1),
  }).strict(),
})

const VerifyContract = BaseEnvelope.extend({
  phase: z.literal("verify"),
  data: z.object({
    completeness: z.object({ tasks_total: z.number().int(), tasks_complete: z.number().int(), tasks_incomplete: z.number().int() }).strict(),
    build: z.object({ passed: z.boolean(), error: z.string().max(2000).optional() }).strict(),
    tests: z.object({ passed: z.number().int(), failed: z.number().int(), skipped: z.number().int() }).strict(),
    coverage_pct: z.number().min(0).max(100).optional(),
    compliance: z.object({ total_scenarios: z.number().int(), compliant: z.number().int(), failing: z.number().int(), untested: z.number().int(), partial: z.number().int() }).strict(),
    issues: z.object({ critical: z.number().int(), high: z.number().int(), major: z.number().int(), minor: z.number().int() }).strict(),
    verdict: z.enum(["pass", "pass_with_warnings", "fail"]),
  }).strict(),
})

const ArchiveContract = BaseEnvelope.extend({
  phase: z.literal("archive"),
  data: z.object({
    specs_synced: z.array(z.object({ domain: z.string().max(200), action: z.enum(["created", "updated"]) }).strict()),
    artifact_ids: z.record(z.string().max(100), z.string().max(200)), archive_location: z.string().max(500),
    all_tasks_complete: z.boolean(), verification_verdict: z.enum(["pass", "pass_with_warnings"]),
  }).strict(),
})

export const SCHEMAS: Record<SddPhase, any> = {
  init: InitContract, explore: ExploreContract, propose: ProposeContract,
  spec: SpecContract, design: DesignContract, tasks: TasksContract,
  apply: ApplyContract, verify: VerifyContract, archive: ArchiveContract,
}

export function extractContract(text: string): string | null {
  const open = "<!-- SDD-CONTRACT -->", close = "<!-- /SDD-CONTRACT -->"
  const s = text.indexOf(open)
  if (s === -1) return null
  const e = text.indexOf(close, s + open.length)
  if (e === -1) return null
  const block = text.slice(s + open.length, e)
  const js = block.indexOf("{"), je = block.lastIndexOf("}")
  if (js === -1 || je === -1 || je <= js) return null
  return block.slice(js, je + 1).trim()
}

export const CONFIDENCE_THRESHOLDS: Record<SddPhase, number> = {
  init: 0.5, explore: 0.5, propose: 0.7, design: 0.7,
  spec: 0.8, tasks: 0.8, apply: 0.6, verify: 0.9, archive: 0.9,
}

export const VALID_TRANSITIONS: Record<SddPhase, SddPhase[]> = {
  init: ["explore", "propose"], explore: ["propose", "explore"],
  propose: ["spec", "design"], spec: ["design", "tasks"],
  design: ["tasks", "spec"], tasks: ["apply"],
  apply: ["verify", "apply"], verify: ["archive", "apply"], archive: [],
}

export function validateJson(phase: SddPhase, jsonStr: string): { valid: boolean; contract: unknown; errors: string[]; migrated: boolean } {
  let parsed: unknown, migrated = false
  try { parsed = JSON.parse(jsonStr) } catch (e) {
    return { valid: false, contract: null, errors: [`Invalid JSON: ${e}`], migrated: false }
  }
  const p = parsed as any
  if (p?.schema_version && p.schema_version !== CURRENT_SCHEMA_VERSION) { parsed = migrateContract(p); migrated = true }
  const schema = SCHEMAS[phase]
  if (!schema || typeof schema.safeParse !== "function")
    return { valid: false, contract: parsed, errors: [`Unknown schema for phase: "${phase}"`], migrated }
  const result = schema.safeParse(parsed)
  if (result.success) return { valid: true, contract: result.data, errors: [], migrated }
  return { valid: false, contract: parsed, errors: result.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`), migrated }
}

export const SDD_AGENTS = new Set([
  "bootstrap", "investigate", "draft-proposal", "write-specs",
  "architect", "decompose", "implement", "validate", "finalize",
])

export const AGENT_CONTRACT_INJECTION = `
---
## SDD Contract
At the END of your output, include a JSON contract between \`<!-- SDD-CONTRACT -->\` and \`<!-- /SDD-CONTRACT -->\` markers inside a \`\`\`json fence.
Required fields: schema_version("1.1"), phase, change_name, project, status(success|partial|failed|blocked), confidence(0-1), timestamp(ISO 8601), executive_summary, artifacts_saved[{topic_key,type}], next_recommended[], risks[{description,level}], data{phase-specific}.
Call \`sdd_validate(phase, json)\` before returning to catch errors.
`

export const ORCHESTRATOR_CONTRACT_INJECTION = `
---
## Contract Validation (Fail-Fast)
After each SDD sub-agent: call \`sdd_parse_contract(phase, output)\`.
- valid + confidence >= threshold -> proceed. Thresholds: init/explore:0.5, propose/design:0.7, spec/tasks:0.8, apply:0.6, verify/archive:0.9
- invalid/missing -> retry (max 2) with errors in prompt
- low confidence -> warn user, ask proceed/retry
- status=blocked -> halt, report to user
`
