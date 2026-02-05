/**
 * Episodic Memory End-to-End Benchmark
 *
 * Tests the full episodic pipeline through LucidRetrieval:
 * - store() → episode creation, boundary detection, temporal links
 * - retrieve() → temporal spreading boosts episodically linked memories
 * - retrieveTemporalNeighbors() → "before/after X" queries
 *
 * This benchmark uses the actual SQLite-backed pipeline (not raw Rust)
 * because episodic memory requires the episode tables + TypeScript orchestration.
 */

import { existsSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LucidRetrieval } from "../../packages/lucid-server/src/retrieval.ts"

const VERBOSE = process.argv.includes("--verbose")
const benchDbPath = join(tmpdir(), `lucid-episodic-bench-${Date.now()}.db`)

function cleanup() {
	for (const suffix of ["", "-wal", "-shm"]) {
		const path = `${benchDbPath}${suffix}`
		if (existsSync(path)) unlinkSync(path)
	}
}

interface ScenarioResult {
	name: string
	score: number
	maxScore: number
	details: string
	pass: boolean
}

// ============================================================================
// Scenario 1: Episode Retrieval - "What was I working on before X?"
//
// Stores a sequence of memories in temporal order, then queries for
// what came before a specific event. Without episodic memory, the system
// would return semantically similar but temporally wrong results.
// ============================================================================
async function episodeRetrievalScenario(): Promise<ScenarioResult> {
	cleanup()
	const retrieval = new LucidRetrieval({ dbPath: benchDbPath })

	try {
		// Simulate a work session: bug investigation → fix → tests → deploy
		// Each store() goes into the same episode with temporal links

		const projectId = "bench-project"

		// Phase 1: Bug investigation (the "before" we want to find)
		await retrieval.store("Investigated memory leak in user-service, found connection pool not closing", {
			type: "bug",
			projectId,
			tags: ["user-service", "memory-leak"],
		})
		await sleep(50)

		await retrieval.store("Traced the leak to session-handler.ts, the pool.release() was missing in error path", {
			type: "bug",
			projectId,
			tags: ["session-handler", "pool"],
		})
		await sleep(50)

		await retrieval.store("Checked user-tests.ts to see if connection cleanup was covered - it was not", {
			type: "context",
			projectId,
			tags: ["testing", "coverage"],
		})
		await sleep(50)

		// Phase 2: The "anchor" event - auth refactor
		await retrieval.store("Refactored auth module to use centralized token management instead of per-request tokens", {
			type: "decision",
			projectId,
			tags: ["auth", "refactor"],
		})
		await sleep(50)

		// Phase 3: After auth refactor (should NOT be returned for "before" query)
		await retrieval.store("Updated auth middleware to use the new token manager", {
			type: "learning",
			projectId,
			tags: ["auth", "middleware"],
		})
		await sleep(50)

		await retrieval.store("Added integration tests for the new auth token flow", {
			type: "context",
			projectId,
			tags: ["auth", "testing"],
		})

		// Now query: "What was I working on before the auth refactor?"
		const results = await retrieval.retrieveTemporalNeighbors(
			"auth refactor token management",
			"before",
			{ limit: 5, projectId }
		)

		// Evaluate: Should find bug investigation memories, NOT auth follow-up
		const resultContents = results.map((r) => r.memory.content)
		const beforeContents = [
			"memory leak",
			"session-handler",
			"user-tests",
		]
		const afterContents = [
			"middleware",
			"integration tests",
		]

		let beforeFound = 0
		let afterFound = 0
		for (const content of resultContents) {
			if (beforeContents.some((kw) => content.toLowerCase().includes(kw))) beforeFound++
			if (afterContents.some((kw) => content.toLowerCase().includes(kw))) afterFound++
		}

		// Score: 0.6 for finding 2+ "before" memories, 0.4 for not finding "after" memories
		let score = 0
		if (beforeFound >= 2) score += 0.6 * (Math.min(beforeFound, 3) / 3)
		if (afterFound === 0) score += 0.4
		else if (afterFound === 1) score += 0.2

		return {
			name: "episode_retrieval",
			score,
			maxScore: 1,
			details: `BeforeFound=${beforeFound}/3, AfterFound=${afterFound}, Results=${results.length}, Contents=[${resultContents.map((c) => c.slice(0, 40)).join("; ")}]`,
			pass: score >= 0.7,
		}
	} finally {
		retrieval.close()
		cleanup()
	}
}

// ============================================================================
// Scenario 2: Temporal Continuity - Sequential stores land in same episode
//
// Rapid sequential stores should be in the same episode.
// A long gap should trigger a new episode.
// ============================================================================
async function temporalContinuityScenario(): Promise<ScenarioResult> {
	cleanup()
	const retrieval = new LucidRetrieval({ dbPath: benchDbPath })

	try {
		const projectId = "continuity-project"

		// Store 5 memories quickly (same episode)
		for (let i = 0; i < 5; i++) {
			await retrieval.store(`Sequential memory ${i}: working on feature-${i}`, {
				type: "context",
				projectId,
			})
			await sleep(20)
		}

		// Check: should have 1 episode with 5 events
		const episodes = retrieval.storage.getRecentEpisodes(undefined, 10)
		const mainEpisode = episodes[0]
		const eventCount = mainEpisode
			? retrieval.storage.getEventCountForEpisode(mainEpisode.id)
			: 0
		const linkCount = mainEpisode
			? retrieval.storage.getEpisodeTemporalLinks(mainEpisode.id).length
			: 0

		// Score: episode created, correct event count, temporal links exist
		let score = 0
		if (episodes.length >= 1) score += 0.3
		if (eventCount === 5) score += 0.4
		if (linkCount > 0) score += 0.3

		return {
			name: "temporal_continuity",
			score,
			maxScore: 1,
			details: `Episodes=${episodes.length}, Events=${eventCount}, Links=${linkCount}`,
			pass: score >= 0.7,
		}
	} finally {
		retrieval.close()
		cleanup()
	}
}

// ============================================================================
// Scenario 3: TCM Asymmetry - Forward links stronger than backward
//
// Temporal Context Model predicts forward associations are stronger.
// "What came after X" should have higher strength than "what came before X".
// ============================================================================
async function tcmAsymmetryScenario(): Promise<ScenarioResult> {
	cleanup()
	const retrieval = new LucidRetrieval({ dbPath: benchDbPath })

	try {
		const projectId = "asymmetry-project"

		await retrieval.store("Step 1: designed the API schema", {
			type: "decision",
			projectId,
		})
		await sleep(30)

		await retrieval.store("Step 2: implemented the endpoint handlers", {
			type: "learning",
			projectId,
		})
		await sleep(30)

		await retrieval.store("Step 3: wrote integration tests for the API", {
			type: "context",
			projectId,
		})

		// Query for neighbors of the middle event
		const afterResults = await retrieval.retrieveTemporalNeighbors(
			"implemented endpoint handlers",
			"after",
			{ limit: 5, projectId }
		)
		const beforeResults = await retrieval.retrieveTemporalNeighbors(
			"implemented endpoint handlers",
			"before",
			{ limit: 5, projectId }
		)

		// Forward (after) links from step 2 → step 3 should be stronger
		// than backward (before) links from step 2 → step 1
		const afterStrength = afterResults.length > 0 ? afterResults[0]!.score : 0
		const beforeStrength = beforeResults.length > 0 ? beforeResults[0]!.score : 0

		let score = 0
		if (afterResults.length > 0) score += 0.3
		if (beforeResults.length > 0) score += 0.3
		if (afterStrength > beforeStrength) score += 0.4 // TCM asymmetry

		return {
			name: "tcm_asymmetry",
			score,
			maxScore: 1,
			details: `AfterStrength=${afterStrength.toFixed(3)}, BeforeStrength=${beforeStrength.toFixed(3)}, ForwardBias=${afterStrength > beforeStrength}`,
			pass: score >= 0.7,
		}
	} finally {
		retrieval.close()
		cleanup()
	}
}

// ============================================================================
// Scenario 4: Distance Decay - Closer events have stronger links
//
// Events at position distance 1 should have stronger temporal links
// than events at position distance 5.
// ============================================================================
async function distanceDecayScenario(): Promise<ScenarioResult> {
	cleanup()
	const retrieval = new LucidRetrieval({ dbPath: benchDbPath })

	try {
		const projectId = "decay-project"

		// Store a sequence of 7 memories
		const contents = [
			"Started reviewing the database migration plan",
			"Checked the schema changes for users table",
			"Verified foreign key constraints are correct",
			"Ran the migration on staging environment",
			"Tested the rollback procedure works",
			"Applied migration to production database",
			"Monitored production for errors after migration",
		]

		for (const content of contents) {
			await retrieval.store(content, { type: "context", projectId })
			await sleep(30)
		}

		// Query neighbors of the first memory
		const neighbors = await retrieval.retrieveTemporalNeighbors(
			"reviewing database migration plan",
			"after",
			{ limit: 6, projectId }
		)

		// Closer neighbors should have higher strength
		let decayCorrect = 0
		let totalPairs = 0
		for (let i = 0; i < neighbors.length - 1; i++) {
			totalPairs++
			if (neighbors[i]!.score >= neighbors[i + 1]!.score) {
				decayCorrect++
			}
		}

		let score = 0
		if (neighbors.length >= 3) score += 0.4
		if (totalPairs > 0) {
			score += 0.6 * (decayCorrect / totalPairs)
		}

		return {
			name: "distance_decay",
			score,
			maxScore: 1,
			details: `Neighbors=${neighbors.length}, DecayOrder=${decayCorrect}/${totalPairs}, Strengths=[${neighbors.map((n) => n.score.toFixed(3)).join(",")}]`,
			pass: score >= 0.7,
		}
	} finally {
		retrieval.close()
		cleanup()
	}
}

// ============================================================================
// Scenario 5: Context Switch Boundary - Project change creates new episode
// ============================================================================
async function contextSwitchScenario(): Promise<ScenarioResult> {
	cleanup()
	const retrieval = new LucidRetrieval({ dbPath: benchDbPath })

	try {
		// Store memories in project A
		await retrieval.store("Working on frontend components for project alpha", {
			type: "context",
			projectId: "project-alpha",
		})
		await sleep(30)
		await retrieval.store("Styling the header component in project alpha", {
			type: "context",
			projectId: "project-alpha",
		})
		await sleep(30)

		// Switch to project B (should trigger new episode)
		await retrieval.store("Setting up CI/CD pipeline for project beta", {
			type: "context",
			projectId: "project-beta",
		})
		await sleep(30)
		await retrieval.store("Configuring deployment targets for project beta", {
			type: "context",
			projectId: "project-beta",
		})

		// Check: should have 2 episodes (one per project)
		const allEpisodes = retrieval.storage.getRecentEpisodes(undefined, 10)

		// At minimum we need separate episodes for the two projects
		const projectIds = new Set(allEpisodes.map((e) => e.projectId))

		let score = 0
		if (allEpisodes.length >= 2) score += 0.5
		if (projectIds.size >= 2) score += 0.5

		return {
			name: "context_switch_boundary",
			score,
			maxScore: 1,
			details: `Episodes=${allEpisodes.length}, UniqueProjects=${projectIds.size}, ProjectIds=[${Array.from(projectIds).join(",")}]`,
			pass: score >= 0.7,
		}
	} finally {
		retrieval.close()
		cleanup()
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Run all scenarios
// ============================================================================

async function main() {
	console.log(
		"╔════════════════════════════════════════════════════════════════════╗"
	)
	console.log(
		"║         Episodic Memory End-to-End Benchmarks (0.5.0)            ║"
	)
	console.log(
		"║                                                                    ║"
	)
	console.log(
		"║  Tests the full episodic pipeline: store → episodes → retrieve   ║"
	)
	console.log(
		"╚════════════════════════════════════════════════════════════════════╝\n"
	)

	const scenarios = [
		episodeRetrievalScenario,
		temporalContinuityScenario,
		tcmAsymmetryScenario,
		distanceDecayScenario,
		contextSwitchScenario,
	]

	const results: ScenarioResult[] = []

	for (const scenario of scenarios) {
		const result = await scenario()
		results.push(result)

		if (VERBOSE) {
			const icon = result.pass ? "✓" : "✗"
			console.log(
				`\n${icon} ${result.name} — ${(result.score * 100).toFixed(1)}%`
			)
			console.log(`  ${result.details}`)
		}
	}

	console.log("\n Results")
	console.log("═".repeat(80))
	console.log(
		"Scenario                      │  Score  │ Status  │ Details"
	)
	console.log("─".repeat(80))

	let passing = 0
	for (const r of results) {
		const name = r.name.slice(0, 28).padEnd(28)
		const score = `${(r.score * 100).toFixed(1)}%`.padStart(7)
		const status = r.pass ? "  PASS" : "  FAIL"
		console.log(`${name} │${score} │${status}  │ ${r.details.slice(0, 60)}`)
		if (r.pass) passing++
	}

	console.log("─".repeat(80))

	const avgScore =
		results.reduce((sum, r) => sum + r.score, 0) / results.length

	console.log(`\n Summary`)
	console.log("─".repeat(40))
	console.log(`Passing:       ${passing}/${results.length}`)
	console.log(`Average score: ${(avgScore * 100).toFixed(1)}%`)
	console.log(`Threshold:     70%`)

	if (passing === results.length) {
		console.log("\n All episodic memory scenarios passing!")
	} else {
		console.log(`\n ${results.length - passing} scenario(s) below threshold`)
		for (const r of results.filter((r) => !r.pass)) {
			console.log(`  ✗ ${r.name}: ${(r.score * 100).toFixed(1)}%`)
		}
	}
}

main().catch((error) => {
	console.error("Benchmark failed:", error)
	cleanup()
	process.exit(1)
})
