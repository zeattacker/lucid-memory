/**
 * Unit tests for buildAssociationIndex()
 *
 * Tests the association index builder used in spreading activation.
 * This function is a candidate for Rust migration.
 */

import { describe, expect, it } from "bun:test"
import { buildAssociationIndex } from "./retrieval.ts"
import type { Association } from "./storage.ts"

/**
 * Helper to create test associations
 */
function makeAssociation(
	sourceId: string,
	targetId: string,
	strength = 0.5,
	type: Association["type"] = "semantic"
): Association {
	return {
		sourceId,
		targetId,
		strength,
		type,
		lastReinforced: Date.now(),
		coAccessCount: 1,
	}
}

describe("buildAssociationIndex", () => {
	describe("empty and basic inputs", () => {
		it("should return empty map for empty array", () => {
			const result = buildAssociationIndex([])
			expect(result.size).toBe(0)
		})

		it("should handle single association", () => {
			const assoc = makeAssociation("A", "B")
			const result = buildAssociationIndex([assoc])

			// Should be indexed under both source and target
			expect(result.size).toBe(2)
			expect(result.get("A")).toEqual([assoc])
			expect(result.get("B")).toEqual([assoc])
		})
	})

	describe("bidirectional indexing", () => {
		it("should index association under both source and target", () => {
			const assoc = makeAssociation("source-1", "target-1", 0.8)
			const result = buildAssociationIndex([assoc])

			const fromSource = result.get("source-1")
			const fromTarget = result.get("target-1")

			expect(fromSource).toBeDefined()
			expect(fromTarget).toBeDefined()
			expect(fromSource).toContain(assoc)
			expect(fromTarget).toContain(assoc)
		})

		it("should allow lookup from either direction", () => {
			const associations = [
				makeAssociation("A", "B", 0.9),
				makeAssociation("B", "C", 0.7),
			]
			const result = buildAssociationIndex(associations)

			// B should have both associations (as target of A->B and source of B->C)
			const bAssocs = result.get("B")
			expect(bAssocs?.length).toBe(2)
		})
	})

	describe("multiple associations from same source", () => {
		it("should group multiple associations by source", () => {
			const associations = [
				makeAssociation("hub", "spoke-1", 0.8),
				makeAssociation("hub", "spoke-2", 0.7),
				makeAssociation("hub", "spoke-3", 0.6),
			]
			const result = buildAssociationIndex(associations)

			const hubAssocs = result.get("hub")
			expect(hubAssocs?.length).toBe(3)
		})

		it("should preserve association order", () => {
			const associations = [
				makeAssociation("A", "B", 0.1),
				makeAssociation("A", "C", 0.2),
				makeAssociation("A", "D", 0.3),
			]
			const result = buildAssociationIndex(associations)

			const aAssocs = result.get("A")
			expect(aAssocs?.[0]?.targetId).toBe("B")
			expect(aAssocs?.[1]?.targetId).toBe("C")
			expect(aAssocs?.[2]?.targetId).toBe("D")
		})
	})

	describe("self-loops", () => {
		it("should handle self-referential associations (A -> A)", () => {
			const selfLoop = makeAssociation("self", "self", 1.0)
			const result = buildAssociationIndex([selfLoop])

			// Self-loop should be indexed once but appear in the "self" key list twice
			// (once as source, once as target)
			const selfAssocs = result.get("self")
			expect(selfAssocs?.length).toBe(2)
			expect(selfAssocs?.[0]).toBe(selfLoop)
			expect(selfAssocs?.[1]).toBe(selfLoop)
		})
	})

	describe("duplicate associations", () => {
		it("should keep all duplicates (no deduplication)", () => {
			const assoc1 = makeAssociation("A", "B", 0.5)
			const assoc2 = makeAssociation("A", "B", 0.8) // Same pair, different strength
			const result = buildAssociationIndex([assoc1, assoc2])

			const aAssocs = result.get("A")
			expect(aAssocs?.length).toBe(2)

			const bAssocs = result.get("B")
			expect(bAssocs?.length).toBe(2)
		})
	})

	describe("association types", () => {
		it("should preserve association type in index", () => {
			const semantic = makeAssociation("A", "B", 0.5, "semantic")
			const temporal = makeAssociation("A", "C", 0.5, "temporal")
			const causal = makeAssociation("A", "D", 0.5, "causal")

			const result = buildAssociationIndex([semantic, temporal, causal])
			const aAssocs = result.get("A")

			expect(aAssocs?.find((a) => a.type === "semantic")).toBeDefined()
			expect(aAssocs?.find((a) => a.type === "temporal")).toBeDefined()
			expect(aAssocs?.find((a) => a.type === "causal")).toBeDefined()
		})
	})

	describe("large scale", () => {
		it("should handle 1000+ associations efficiently", () => {
			const associations: Association[] = []
			for (let i = 0; i < 1000; i++) {
				associations.push(makeAssociation(`node-${i}`, `node-${i + 1}`, 0.5))
			}

			const start = performance.now()
			const result = buildAssociationIndex(associations)
			const elapsed = performance.now() - start

			// Should complete in under 50ms
			expect(elapsed).toBeLessThan(50)

			// Should have 1001 unique keys (node-0 through node-1000)
			expect(result.size).toBe(1001)

			// Spot check: middle node should have 2 associations
			// (as target of previous and source of next)
			const middleAssocs = result.get("node-500")
			expect(middleAssocs?.length).toBe(2)
		})

		it("should handle 10000 associations for hub-and-spoke pattern", () => {
			const associations: Association[] = []
			for (let i = 0; i < 10000; i++) {
				associations.push(makeAssociation("central-hub", `spoke-${i}`, 0.5))
			}

			const start = performance.now()
			const result = buildAssociationIndex(associations)
			const elapsed = performance.now() - start

			// Should complete in under 100ms
			expect(elapsed).toBeLessThan(100)

			// Hub should have all 10000 associations
			const hubAssocs = result.get("central-hub")
			expect(hubAssocs?.length).toBe(10000)
		})
	})

	describe("edge cases", () => {
		it("should handle empty string IDs", () => {
			const assoc = makeAssociation("", "B")
			const result = buildAssociationIndex([assoc])

			expect(result.get("")).toEqual([assoc])
			expect(result.get("B")).toEqual([assoc])
		})

		it("should handle special characters in IDs", () => {
			const assoc = makeAssociation("id-with-émoji-🔥", "target/with/slashes")
			const result = buildAssociationIndex([assoc])

			expect(result.get("id-with-émoji-🔥")).toEqual([assoc])
			expect(result.get("target/with/slashes")).toEqual([assoc])
		})

		it("should handle very long IDs", () => {
			const longId = "a".repeat(1000)
			const assoc = makeAssociation(longId, "short")
			const result = buildAssociationIndex([assoc])

			expect(result.get(longId)).toEqual([assoc])
		})

		it("should preserve null lastReinforced", () => {
			const assoc: Association = {
				sourceId: "A",
				targetId: "B",
				strength: 0.5,
				type: "semantic",
				lastReinforced: null,
				coAccessCount: 0,
			}
			const result = buildAssociationIndex([assoc])

			expect(result.get("A")?.[0]?.lastReinforced).toBeNull()
		})
	})
})
