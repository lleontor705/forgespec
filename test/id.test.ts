import { describe, test, expect } from "bun:test"
import { generateId } from "../src/utils/id"

describe("generateId", () => {
  test("with prefix", () => {
    const id = generateId("sdd")
    expect(id).toMatch(/^sdd-[0-9a-f]{8}$/)
  })
  test("without prefix", () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })
  test("empty prefix", () => {
    const id = generateId("")
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })
  test("unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("t")))
    expect(ids.size).toBe(100)
  })
  test("various prefixes", () => {
    expect(generateId("board")).toMatch(/^board-/)
    expect(generateId("task")).toMatch(/^task-/)
    expect(generateId("res")).toMatch(/^res-/)
  })
})
