/**
 * Consolidation & Reconsolidation Tests (0.6.0)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	AssociationDecayConfig,
	ConsolidationConfig,
	InstanceNoiseConfig,
	PrpConfig,
	ReconsolidationConfig,
} from "./config.ts"
import { ConsolidationEngine } from "./consolidation.ts"
import { LucidStorage } from "./storage.ts"

const testDbPath = join(tmpdir(), `lucid-consolidation-test-${Date.now()}.db`)

type RawDb = { prepare(sql: string): { run(...args: unknown[]): void } }
function testSql(s: LucidStorage, sql: string, ...params: unknown[]) {
	;(s as unknown as { db: RawDb }).db.prepare(sql).run(...params)
}

describe("ConsolidationEngine", () => {
	let storage: LucidStorage
	let engine: ConsolidationEngine

	beforeEach(() => {
		storage = new LucidStorage({ dbPath: testDbPath })
		engine = new ConsolidationEngine(storage)
	})

	afterEach(() => {
		storage.close()
		for (const ext of ["", "-wal", "-shm"]) {
			const p = `${testDbPath}${ext}`
			if (existsSync(p)) unlinkSync(p)
		}
	})

	// =========================================================================
	// 1. Micro-consolidation strengthening
	// =========================================================================

	describe("micro-consolidation strengthening", () => {
		it("strengthens recently accessed memories", () => {
			const memory = storage.storeMemory({
				content: "test memory for strengthening",
				encodingStrength: 0.5,
			})

			// Access it so it's "recently accessed"
			storage.recordAccess(memory.id)

			const stats = engine.runMicroConsolidation()
			expect(stats.strengthened).toBeGreaterThan(0)

			const updated = storage.getMemory(memory.id)
			expect(updated?.encodingStrength).toBeGreaterThan(0.5)
		})

		it("caps encoding strength at 1.0", () => {
			const memory = storage.storeMemory({
				content: "strong memory",
				encodingStrength: 0.99,
			})
			storage.recordAccess(memory.id)

			engine.runMicroConsolidation()

			const updated = storage.getMemory(memory.id)
			expect(updated?.encodingStrength).toBeLessThanOrEqual(1.0)
		})
	})

	// =========================================================================
	// 2. Verbatim decay
	// =========================================================================

	describe("verbatim decay", () => {
		it("decays stale memories", () => {
			const memory = storage.storeMemory({
				content: "old memory that should decay",
				encodingStrength: 0.8,
			})

			// Manually make the memory stale by backdating last_accessed
			const staleDate =
				Date.now() -
				ConsolidationConfig.staleThresholdDays * 24 * 60 * 60 * 1000 -
				1000
			testSql(
				storage,
				"UPDATE memories SET last_accessed = ? WHERE id = ?",
				staleDate,
				memory.id
			)

			const stats = engine.runMicroConsolidation()
			expect(stats.decayed).toBeGreaterThan(0)

			const updated = storage.getMemory(memory.id)
			expect(updated?.encodingStrength).toBeLessThan(0.8)
		})

		it("respects encoding strength floor", () => {
			const memory = storage.storeMemory({
				content: "weak old memory",
				encodingStrength: 0.11,
			})

			// Make stale
			const staleDate =
				Date.now() -
				ConsolidationConfig.staleThresholdDays * 24 * 60 * 60 * 1000 -
				1000
			testSql(
				storage,
				"UPDATE memories SET last_accessed = ? WHERE id = ?",
				staleDate,
				memory.id
			)

			engine.runMicroConsolidation()

			const updated = storage.getMemory(memory.id)
			expect(updated?.encodingStrength).toBeGreaterThanOrEqual(
				ConsolidationConfig.encodingStrengthFloor
			)
		})
	})

	// =========================================================================
	// 3. Full consolidation state transitions
	// =========================================================================

	describe("full consolidation state transitions", () => {
		it("transitions fresh → consolidating after 1 hour", () => {
			const memory = storage.storeMemory({ content: "fresh memory" })
			expect(memory.consolidationState).toBe("fresh")

			// Backdate to > 1 hour
			const oldTime = Date.now() - 2 * 60 * 60 * 1000
			testSql(
				storage,
				"UPDATE memories SET created_at = ? WHERE id = ?",
				oldTime,
				memory.id
			)

			engine.runFullConsolidation()

			const updated = storage.getMemory(memory.id)
			expect(updated?.consolidationState).toBe("consolidating")
		})

		it("transitions consolidating → consolidated after 24 hours", () => {
			const memory = storage.storeMemory({ content: "consolidating memory" })

			// Set to consolidating and backdate
			storage.updateConsolidationState(memory.id, "consolidating")
			const oldTime = Date.now() - 25 * 60 * 60 * 1000
			testSql(
				storage,
				"UPDATE memories SET created_at = ? WHERE id = ?",
				oldTime,
				memory.id
			)

			const stats = engine.runFullConsolidation()
			expect(stats.consolidatingToConsolidated).toBeGreaterThan(0)

			const updated = storage.getMemory(memory.id)
			expect(updated?.consolidationState).toBe("consolidated")
		})

		it("transitions reconsolidating → consolidated", () => {
			const memory = storage.storeMemory({ content: "reconsolidating memory" })
			storage.updateConsolidationState(memory.id, "reconsolidating")

			// Backdate last_consolidated to > 24 hours
			const oldTime = Date.now() - 25 * 60 * 60 * 1000
			testSql(
				storage,
				"UPDATE memories SET last_consolidated = ? WHERE id = ?",
				oldTime,
				memory.id
			)

			const stats = engine.runFullConsolidation()
			expect(stats.reconsolidatingToConsolidated).toBeGreaterThan(0)

			const updated = storage.getMemory(memory.id)
			expect(updated?.consolidationState).toBe("consolidated")
		})
	})

	// =========================================================================
	// 4. Reconsolidation PE zones
	// =========================================================================

	describe("reconsolidation PE zones", () => {
		it("stores encoding strength from MemoryInput", () => {
			const memory = storage.storeMemory({
				content: "memory with custom encoding",
				encodingStrength: 0.9,
			})
			expect(memory.encodingStrength).toBe(0.9)
		})

		it("updateConsolidationState updates state and timestamp", () => {
			const memory = storage.storeMemory({ content: "test" })
			storage.updateConsolidationState(memory.id, "reconsolidating")

			const updated = storage.getMemory(memory.id)
			expect(updated?.consolidationState).toBe("reconsolidating")
			expect(updated?.lastConsolidated).not.toBeNull()
		})

		it("findMostSimilarMemory returns null when no embeddings", () => {
			storage.storeMemory({ content: "no embedding" })
			const result = storage.findMostSimilarMemory([1, 0, 0])
			expect(result).toBeNull()
		})

		it("findMostSimilarMemory finds similar embeddings", () => {
			const memory = storage.storeMemory({ content: "embedded memory" })
			storage.storeEmbedding(memory.id, [1, 0, 0], "test-model")

			const result = storage.findMostSimilarMemory([0.9, 0.1, 0])
			expect(result).not.toBeNull()
			expect(result?.memoryId).toBe(memory.id)
			expect(result?.similarity).toBeGreaterThan(0.4)
		})

		it("findMostSimilarMemory respects threshold", () => {
			const memory = storage.storeMemory({ content: "embedded memory" })
			storage.storeEmbedding(memory.id, [1, 0, 0], "test-model")

			// Orthogonal vector — similarity near 0
			const result = storage.findMostSimilarMemory([0, 1, 0], undefined, 0.4)
			expect(result).toBeNull()
		})
	})

	// =========================================================================
	// 5. Association decay and pruning
	// =========================================================================

	describe("association decay and pruning", () => {
		it("prunes weak associations", () => {
			const m1 = storage.storeMemory({ content: "memory 1" })
			const m2 = storage.storeMemory({ content: "memory 2" })

			// Create a very weak association
			storage.associate(m1.id, m2.id, 0.05, "semantic")

			const pruned = storage.pruneWeakAssociations(
				AssociationDecayConfig.pruneThreshold
			)
			expect(pruned).toBe(1)

			const remaining = storage.getAssociations(m1.id)
			expect(remaining).toHaveLength(0)
		})

		it("reinforceAssociation updates strength and co_access_count", () => {
			const m1 = storage.storeMemory({ content: "memory 1" })
			const m2 = storage.storeMemory({ content: "memory 2" })
			storage.associate(m1.id, m2.id, 0.5, "semantic")

			storage.reinforceAssociation(m1.id, m2.id, 0.6)

			const assocs = storage.getAssociations(m1.id)
			const assoc = assocs.find(
				(a) => a.sourceId === m1.id && a.targetId === m2.id
			)
			expect(assoc).toBeDefined()
			expect(assoc?.strength).toBe(0.6)
			// co_access_count should be incremented (was 1 from associate, +1 from reinforce)
			expect(assoc?.coAccessCount).toBeGreaterThanOrEqual(2)
		})

		it("micro-consolidation decays associations", () => {
			const m1 = storage.storeMemory({ content: "memory 1" })
			const m2 = storage.storeMemory({ content: "memory 2" })
			storage.associate(m1.id, m2.id, 0.3, "semantic")

			// Backdate last_reinforced to 3 days ago
			const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
			testSql(
				storage,
				"UPDATE associations SET last_reinforced = ? WHERE source_id = ? AND target_id = ?",
				threeDaysAgo,
				m1.id,
				m2.id
			)

			const stats = engine.runMicroConsolidation()
			// Should have either decayed or pruned
			expect(
				stats.associationsDecayed + stats.associationsPruned
			).toBeGreaterThan(0)
		})
	})

	// =========================================================================
	// 6. PRP encoding boost
	// =========================================================================

	describe("PRP config", () => {
		it("PRP config has expected defaults", () => {
			expect(PrpConfig.enabled).toBe(true)
			expect(PrpConfig.halfLifeMs).toBe(90 * 60 * 1000)
			expect(PrpConfig.activationThreshold).toBe(0.7)
			expect(PrpConfig.maxStrength).toBe(0.5)
		})
	})

	// =========================================================================
	// 7. Instance noise
	// =========================================================================

	describe("instance noise config", () => {
		it("InstanceNoiseConfig is enabled", () => {
			expect(InstanceNoiseConfig.enabled).toBe(true)
		})

		it("stronger encoding gives lower noise", () => {
			const noiseStrong = InstanceNoiseConfig.noiseBase * (2.0 - 1.0)
			const noiseWeak = InstanceNoiseConfig.noiseBase * (2.0 - 0.3)
			expect(noiseStrong).toBeLessThan(noiseWeak)
		})
	})

	// =========================================================================
	// 8. Feature flags disabled
	// =========================================================================

	describe("feature flags", () => {
		it("consolidation config is enabled by default", () => {
			expect(ConsolidationConfig.enabled).toBe(true)
		})

		it("reconsolidation config is enabled by default", () => {
			expect(ReconsolidationConfig.enabled).toBe(true)
		})

		it("association decay config is enabled by default", () => {
			expect(AssociationDecayConfig.enabled).toBe(true)
		})
	})

	// =========================================================================
	// Storage query methods
	// =========================================================================

	describe("consolidation storage queries", () => {
		it("getConsolidationCounts returns correct distribution", () => {
			storage.storeMemory({ content: "fresh 1" })
			storage.storeMemory({ content: "fresh 2" })

			const m3 = storage.storeMemory({ content: "consolidating" })
			storage.updateConsolidationState(m3.id, "consolidating")

			const counts = storage.getConsolidationCounts()
			expect(counts.fresh).toBe(2)
			expect(counts.consolidating).toBe(1)
			expect(counts.consolidated).toBe(0)
		})

		it("getMemoriesByConsolidationState filters correctly", () => {
			storage.storeMemory({ content: "fresh" })
			const m2 = storage.storeMemory({ content: "consolidated" })
			storage.updateConsolidationState(m2.id, "consolidated")

			const fresh = storage.getMemoriesByConsolidationState("fresh", 10)
			const consolidated = storage.getMemoriesByConsolidationState(
				"consolidated",
				10
			)

			expect(fresh).toHaveLength(1)
			expect(consolidated).toHaveLength(1)
			expect(consolidated[0]?.id).toBe(m2.id)
		})

		it("updateEncodingStrength persists", () => {
			const memory = storage.storeMemory({
				content: "test",
				encodingStrength: 0.5,
			})
			storage.updateEncodingStrength(memory.id, 0.9)

			const updated = storage.getMemory(memory.id)
			expect(updated?.encodingStrength).toBe(0.9)
		})

		it("getRecentlyAccessedMemories returns recent", () => {
			const m1 = storage.storeMemory({ content: "recent" })
			storage.recordAccess(m1.id) // This sets last_accessed

			const recent = storage.getRecentlyAccessedMemories(60 * 1000, 10)
			expect(recent.length).toBeGreaterThan(0)
		})
	})
})
