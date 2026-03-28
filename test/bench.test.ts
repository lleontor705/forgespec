import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { globOverlaps, _clearRegexpCache, _regexpCacheSize } from "../src/task-board"

describe("RegExp cache", () => {
  beforeAll(() => _clearRegexpCache())
  afterAll(() => _clearRegexpCache())

  test("caches compiled patterns", () => {
    _clearRegexpCache()
    globOverlaps("src/*.ts", "src/file.ts")
    expect(_regexpCacheSize()).toBe(1)
    globOverlaps("src/*.ts", "src/other.ts")
    expect(_regexpCacheSize()).toBe(1) // same pattern, no new entry
  })

  test("caches distinct patterns separately", () => {
    _clearRegexpCache()
    globOverlaps("src/*.ts", "src/file.ts")
    globOverlaps("lib/*.js", "lib/file.js")
    expect(_regexpCacheSize()).toBe(2)
  })

  test("evicts oldest when exceeding max", () => {
    _clearRegexpCache()
    for (let i = 0; i < 520; i++) {
      globOverlaps(`dir${i}/*.ts`, `dir${i}/file.ts`)
    }
    expect(_regexpCacheSize()).toBeLessThanOrEqual(512)
  })
})

describe("Performance baselines", () => {
  test("globOverlaps: 10k calls < 100ms", () => {
    _clearRegexpCache()
    const start = performance.now()
    for (let i = 0; i < 10_000; i++) {
      globOverlaps("src/auth/*.ts", `src/auth/file${i % 100}.ts`)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  test("globOverlaps with double-star: 10k calls < 100ms", () => {
    const start = performance.now()
    for (let i = 0; i < 10_000; i++) {
      globOverlaps("src/**", `src/auth/deep/file${i % 100}.ts`)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  test("globOverlaps exact match: 10k calls < 50ms", () => {
    const start = performance.now()
    for (let i = 0; i < 10_000; i++) {
      globOverlaps("src/auth/file.ts", "src/auth/file.ts")
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})
