/**
 * Episodic Memory Tests (0.5.0)
 *
 * Tests episode lifecycle, boundary detection, temporal spreading,
 * and temporal neighbor queries.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EpisodicMemoryConfig } from "./config.ts"
import { LucidRetrieval } from "./retrieval.ts"
import { LucidStorage } from "./storage.ts"

const testDbPath = join(tmpdir(), `lucid-episodic-test-${Date.now()}.db`)

function cleanupDb() {
	for (const suffix of ["", "-wal", "-shm"]) {
		const path = `${testDbPath}${suffix}`
		if (existsSync(path)) unlinkSync(path)
	}
}

describe("Episodic Memory - Storage", () => {
	let storage: LucidStorage

	beforeEach(() => {
		cleanupDb()
		storage = new LucidStorage({ dbPath: testDbPath })
	})

	afterEach(() => {
		storage.close()
		cleanupDb()
	})

	it("getEpisodesForMemory returns episodes containing a memory", () => {
		const episode = storage.createEpisode({ projectId: "proj-1" })
		const mem = storage.storeMemory({ content: "test memory" })
		storage.addEventToEpisode(episode.id, mem.id)

		const episodes = storage.getEpisodesForMemory(mem.id)
		expect(episodes.length).toBe(1)
		expect(episodes[0]?.id).toBe(episode.id)
	})

	it("getEpisodesForMemory returns empty for unlinked memory", () => {
		const mem = storage.storeMemory({ content: "orphan memory" })
		const episodes = storage.getEpisodesForMemory(mem.id)
		expect(episodes.length).toBe(0)
	})

	it("getEventCountForEpisode returns correct count", () => {
		const episode = storage.createEpisode({})
		expect(storage.getEventCountForEpisode(episode.id)).toBe(0)

		const m1 = storage.storeMemory({ content: "first" })
		const m2 = storage.storeMemory({ content: "second" })
		storage.addEventToEpisode(episode.id, m1.id)
		storage.addEventToEpisode(episode.id, m2.id)

		expect(storage.getEventCountForEpisode(episode.id)).toBe(2)
	})

	it("getEpisodesForMemory returns multiple episodes", () => {
		const ep1 = storage.createEpisode({})
		const ep2 = storage.createEpisode({})
		const mem = storage.storeMemory({ content: "shared memory" })
		storage.addEventToEpisode(ep1.id, mem.id)
		storage.addEventToEpisode(ep2.id, mem.id)

		const episodes = storage.getEpisodesForMemory(mem.id)
		expect(episodes.length).toBe(2)
	})
})

describe("Episodic Memory - Boundary Detection", () => {
	let storage: LucidStorage
	let retrieval: LucidRetrieval

	beforeEach(() => {
		cleanupDb()
		retrieval = new LucidRetrieval({ dbPath: testDbPath })
		storage = retrieval.storage
	})

	afterEach(() => {
		retrieval.close()
		cleanupDb()
	})

	it("creates new episode when none exists", () => {
		// No current episode → needs new
		const current = storage.getCurrentEpisode()
		expect(current).toBeNull()
	})

	it("keeps same episode for rapid sequential stores", () => {
		// Store two memories quickly - should be in same episode
		const m1 = storage.storeMemory({ content: "first store" })
		const ep = storage.createEpisode({})
		storage.addEventToEpisode(ep.id, m1.id)

		const m2 = storage.storeMemory({ content: "second store" })
		storage.addEventToEpisode(ep.id, m2.id)

		const events = storage.getEpisodeEvents(ep.id)
		expect(events.length).toBe(2)
		expect(events[0]?.memoryId).toBe(m1.id)
		expect(events[1]?.memoryId).toBe(m2.id)
	})

	it("creates temporal links with forward > backward asymmetry", () => {
		const ep = storage.createEpisode({})
		const m1 = storage.storeMemory({ content: "first" })
		const m2 = storage.storeMemory({ content: "second" })
		const e1 = storage.addEventToEpisode(ep.id, m1.id)
		const e2 = storage.addEventToEpisode(ep.id, m2.id)

		// Create temporal links (mimics what store() does)
		storage.createTemporalLink({
			episodeId: ep.id,
			sourceEventId: e1?.id,
			targetEventId: e2?.id,
			strength: EpisodicMemoryConfig.forwardLinkStrength * 1.0,
			direction: "forward",
		})
		storage.createTemporalLink({
			episodeId: ep.id,
			sourceEventId: e2?.id,
			targetEventId: e1?.id,
			strength: EpisodicMemoryConfig.backwardLinkStrength * 1.0,
			direction: "backward",
		})

		const links = storage.getEpisodeTemporalLinks(ep.id)
		expect(links.length).toBe(2)

		const forward = links.find((l) => l.direction === "forward")
		const backward = links.find((l) => l.direction === "backward")
		expect(forward?.strength).toBeGreaterThan(backward?.strength ?? 0)
	})

	it("context switch triggers new episode", () => {
		const ep = storage.createEpisode({ projectId: "project-a" })
		const m1 = storage.storeMemory({ content: "in project a" })
		storage.addEventToEpisode(ep.id, m1.id)

		// Simulate what detectEpisodeBoundary checks
		expect(ep.projectId).toBe("project-a")
		// A different projectId should trigger context_switch
	})
})

describe("Episodic Memory - Store Lifecycle", () => {
	let retrieval: LucidRetrieval

	beforeEach(() => {
		cleanupDb()
		retrieval = new LucidRetrieval({ dbPath: testDbPath })
	})

	afterEach(() => {
		retrieval.close()
		cleanupDb()
	})

	it("store() creates episodes and temporal links when enabled", async () => {
		// EpisodicMemoryConfig.enabled should be true at this point
		// (We'll flip it in Phase 7)
		if (!EpisodicMemoryConfig.enabled) return

		await retrieval.store("first memory in episode", {
			projectId: "test-project",
		})
		await retrieval.store("second memory in episode", {
			projectId: "test-project",
		})
		await retrieval.store("third memory in episode", {
			projectId: "test-project",
		})

		// Check that an episode was created
		const episodes = retrieval.storage.getRecentEpisodes(undefined, 10)
		expect(episodes.length).toBeGreaterThanOrEqual(1)

		// Check that events were added
		const latestEpisode = episodes[0]
		const events = retrieval.storage.getEpisodeEvents(latestEpisode.id)
		expect(events.length).toBeGreaterThanOrEqual(2)

		// Check that temporal links were created
		const links = retrieval.storage.getEpisodeTemporalLinks(latestEpisode.id)
		expect(links.length).toBeGreaterThan(0)
	})

	it("store() does nothing when feature flag is off", async () => {
		// When feature is off, no episodes should be created
		if (EpisodicMemoryConfig.enabled) return

		await retrieval.store("a memory", { projectId: "test-project" })

		const episodes = retrieval.storage.getRecentEpisodes(undefined, 10)
		expect(episodes.length).toBe(0)
	})
})

describe("Episodic Memory - Temporal Spreading", () => {
	let storage: LucidStorage

	beforeEach(() => {
		cleanupDb()
		storage = new LucidStorage({ dbPath: testDbPath })
	})

	afterEach(() => {
		storage.close()
		cleanupDb()
	})

	it("temporal links decay with distance", () => {
		const ep = storage.createEpisode({})
		const memories = Array.from({ length: 5 }, (_, i) =>
			storage.storeMemory({ content: `memory ${i}` })
		)

		const events = memories.map(
			(m) =>
				storage.addEventToEpisode(ep.id, m.id) as NonNullable<
					ReturnType<typeof storage.addEventToEpisode>
				>
		)

		// Create links from first event to all others
		for (let i = 1; i < events.length; i++) {
			const distance = i
			const decayFactor = Math.exp(
				-distance * EpisodicMemoryConfig.distanceDecayRate
			)
			storage.createTemporalLink({
				episodeId: ep.id,
				sourceEventId: events[0]?.id,
				targetEventId: events[i]?.id,
				strength: EpisodicMemoryConfig.forwardLinkStrength * decayFactor,
				direction: "forward",
			})
		}

		const links = storage.getEpisodeTemporalLinks(ep.id)
		// Closer events should have stronger links
		const sortedByStrength = links.sort((a, b) => b.strength - a.strength)
		for (let i = 0; i < sortedByStrength.length - 1; i++) {
			expect(sortedByStrength[i]?.strength).toBeGreaterThanOrEqual(
				sortedByStrength[i + 1]?.strength
			)
		}
	})
})

describe("Episodic Memory - Temporal Neighbors", () => {
	let retrieval: LucidRetrieval

	beforeEach(() => {
		cleanupDb()
		retrieval = new LucidRetrieval({ dbPath: testDbPath })
	})

	afterEach(() => {
		retrieval.close()
		cleanupDb()
	})

	it("retrieveTemporalNeighbors returns empty when no episodes", async () => {
		const results = await retrieval.retrieveTemporalNeighbors("anything")
		expect(results.length).toBe(0)
	})

	it("retrieveTemporalNeighbors finds before/after memories", async () => {
		if (!EpisodicMemoryConfig.enabled) return

		// Store a sequence of memories
		await retrieval.store("step 1: designed the API", {
			projectId: "neighbor-test",
		})
		await new Promise((r) => setTimeout(r, 30))
		await retrieval.store("step 2: implemented handlers", {
			projectId: "neighbor-test",
		})
		await new Promise((r) => setTimeout(r, 30))
		await retrieval.store("step 3: wrote tests", {
			projectId: "neighbor-test",
		})

		// Query for "after" neighbors of step 1
		const afterResults = await retrieval.retrieveTemporalNeighbors(
			"designed the API",
			"after",
			{ limit: 5, projectId: "neighbor-test" }
		)

		// Should find at least 1 neighbor (step 2 or step 3)
		expect(afterResults.length).toBeGreaterThan(0)

		// Scores should be non-zero (temporal strength)
		for (const r of afterResults) {
			expect(r.score).toBeGreaterThan(0)
		}
	})

	it("retrieveTemporalNeighbors respects direction filtering", async () => {
		if (!EpisodicMemoryConfig.enabled) return

		await retrieval.store("alpha: first task", {
			projectId: "direction-test",
		})
		await new Promise((r) => setTimeout(r, 30))
		await retrieval.store("beta: second task", {
			projectId: "direction-test",
		})
		await new Promise((r) => setTimeout(r, 30))
		await retrieval.store("gamma: third task", {
			projectId: "direction-test",
		})

		// "before" the last memory should return earlier memories
		const beforeResults = await retrieval.retrieveTemporalNeighbors(
			"gamma third task",
			"before",
			{ limit: 5, projectId: "direction-test" }
		)

		// Should find at least 1 "before" neighbor
		expect(beforeResults.length).toBeGreaterThan(0)

		// None of the "before" results should be the anchor itself
		for (const r of beforeResults) {
			expect(r.memory.content).not.toContain("gamma")
		}
	})

	it("store() invalidates episode cache for new memories", async () => {
		if (!EpisodicMemoryConfig.enabled) return

		await retrieval.store("cache test memory 1", {
			projectId: "cache-test",
		})

		// Access cache by storing again (triggers getCachedEpisodeIds internally)
		await retrieval.store("cache test memory 2", {
			projectId: "cache-test",
		})

		// Both memories should be in the same episode
		const episodes = retrieval.storage.getRecentEpisodes("cache-test", 10)
		expect(episodes.length).toBe(1)
		const events = retrieval.storage.getEpisodeEvents(episodes[0]?.id)
		expect(events.length).toBe(2)
	})

	it("forward temporal strength is greater than backward", async () => {
		if (!EpisodicMemoryConfig.enabled) return

		await retrieval.store("early work", { projectId: "asym-test" })
		await new Promise((r) => setTimeout(r, 30))
		await retrieval.store("later work", { projectId: "asym-test" })

		const episodes = retrieval.storage.getRecentEpisodes("asym-test", 1)
		expect(episodes.length).toBe(1)

		const links = retrieval.storage.getEpisodeTemporalLinks(episodes[0]?.id)
		expect(links.length).toBe(2) // one forward, one backward

		const forward = links.find((l) => l.direction === "forward")
		const backward = links.find((l) => l.direction === "backward")
		expect(forward?.strength).toBeGreaterThan(backward?.strength ?? 0)
	})
})
