/**
 * Cognitive Feature Configuration
 *
 * All tuneable parameters for Lucid Memory's cognitive features in one place.
 * See docs/FORMULAS.md for the canonical formula reference and justifications.
 *
 * Parameters are organized by feature and include:
 * - Default values (empirically validated where possible)
 * - Valid ranges
 * - Cognitive science justification references
 */

// ============================================================================
// Working Memory (validated against Baddeley 2000, Miller 1956, Cowan 2001)
// ============================================================================

export const WorkingMemoryConfig = {
	/** Working memory capacity - K≈4-7 items (Miller 1956, Cowan 2001) */
	capacity: 7,

	/** Decay time constant in ms - τ≈4 seconds (Baddeley 2000) */
	decayMs: 4000,

	/** Maximum boost for WM items - 1.0 + maxBoost = 2.0x activation */
	maxBoost: 1.0,

	/** Remove items after this many time constants (5τ = 20 seconds) */
	cutoffMultiplier: 5,

	/** Feature flag */
	enabled: true,
} as const

// ============================================================================
// Instance Noise / Encoding Strength (MINERVA 2, Hintzman 1984)
// ============================================================================

export const InstanceNoiseConfig = {
	/** Minimum encoding strength (ensures all memories are retrievable) */
	encodingBase: 0.3,

	/** Contribution from explicit importance marking */
	attentionWeight: 0.2,

	/** Contribution from emotional_weight field (Cahill & McGaugh 1998) */
	emotionalWeight: 0.2,

	/** Contribution from access_count (rehearsal effect, Ebbinghaus 1885) */
	rehearsalWeight: 0.3,

	/** Cap for rehearsal contribution (diminishing returns) */
	maxRehearsalCount: 10,

	/** Base noise parameter for retrieval probability */
	noiseBase: 0.25,

	/** Feature flag */
	enabled: true,
} as const

// ============================================================================
// Partial Matching (ACT-R, Anderson 1993)
// ============================================================================

export const PartialMatchingConfig = {
	/** Embedding dimensions above this are considered "active features" */
	featureThreshold: 0.3,

	/** Bonus scale for matching features */
	featureBonusScale: 0.3,

	/** Penalty scale for missing expected features (ACT-R PM parameter) */
	mismatchPenaltyScale: 0.5,

	/** Feature flag */
	enabled: false,
} as const

// ============================================================================
// Association Decay (Wixted 2004, Stickgold & Walker 2013)
// ============================================================================

export const AssociationDecayConfig = {
	/** Decay tau for fresh memories (< 1 hour old) - in days */
	tauFreshDays: 1 / 24, // 1 hour

	/** Decay tau for consolidating memories (1-24 hours old) - in days */
	tauConsolidatingDays: 1, // 1 day

	/** Decay tau for consolidated memories - in days */
	tauConsolidatedDays: 30,

	/** Decay tau for reconsolidating memories (reactivated) - in days */
	tauReconsolidatingDays: 7,

	/** Strength boost when associations are co-accessed */
	reinforcementBoost: 0.05,

	/** Associations below this strength are candidates for pruning */
	pruneThreshold: 0.1,

	/** Feature flag */
	enabled: true,
} as const

// ============================================================================
// Encoding Specificity / Context (Tulving 1983)
// ============================================================================

export const EncodingSpecificityConfig = {
	/** Weight for task context similarity */
	taskWeight: 0.35,

	/** Weight for same project */
	projectWeight: 0.3,

	/** Weight for same session */
	sessionWeight: 0.2,

	/** Weight for location (file path) similarity */
	locationWeight: 0.15,

	/** Maximum boost for perfect context match (1.0 + maxBoost = 1.3x) */
	maxContextBoost: 0.3,

	/** Feature flag */
	enabled: false,
} as const

// ============================================================================
// Episodic Memory (Howard & Kahana 2002 TCM)
// ============================================================================

export const EpisodicMemoryConfig = {
	/** Time gap in minutes that triggers new episode boundary */
	boundaryGapMinutes: 5,

	/** Maximum events per episode before auto-boundary */
	maxEventsPerEpisode: 50,

	/** Forward temporal link strength multiplier (A→B) */
	forwardLinkStrength: 1.0,

	/** Backward temporal link strength multiplier (B→A) - asymmetric per TCM */
	backwardLinkStrength: 0.7,

	/** Decay rate for temporal link strength with position distance */
	distanceDecayRate: 0.3,

	/** Activation boost for memories linked via episode */
	episodeBoost: 1.2,

	/** TCM context persistence parameter (beta) */
	contextPersistence: 0.7,

	/** Maximum temporal distance (positions) to link within episode */
	maxTemporalDistance: 10,

	/** Feature flag */
	enabled: true,
} as const

// ============================================================================
// Memory Consolidation (Mattar & Daw 2018 EVB, Stickgold & Walker 2013)
// ============================================================================

export const ConsolidationConfig = {
	/** Micro-consolidation interval in ms (5 minutes) */
	microIntervalMs: 5 * 60 * 1000,

	/** Full consolidation interval in ms (1 hour) */
	fullIntervalMs: 60 * 60 * 1000,

	/** Encoding strength multiplier for recently accessed memories */
	microStrengthenFactor: 1.1,

	/** Encoding strength decay for stale memories per cycle */
	verbatimDecayFactor: 0.98,

	/** Window for "recently accessed" (30 minutes) */
	recentAccessWindowMs: 30 * 60 * 1000,

	/** Days without access before verbatim decay applies */
	staleThresholdDays: 7,

	/** Minimum encoding strength floor */
	encodingStrengthFloor: 0.1,

	/** Number of memories to process per consolidation cycle */
	batchSize: 100,

	/** Feature flag */
	enabled: true,
} as const

// ============================================================================
// Reconsolidation (Nader et al. 2000, Lee 2009)
// ============================================================================

export const ReconsolidationConfig = {
	/** Lower PE threshold (below = reinforce existing) */
	thetaLow: 0.1,

	/** Upper PE threshold (above = create new trace) */
	thetaHigh: 0.55,

	/** Sigmoid steepness for reconsolidation probability */
	beta: 10.0,

	/** How much encoding strength shifts θ_high down */
	strengthShift: 0.15,

	/** How much memory age shifts θ_low up */
	ageShift: 0.05,

	/** Baseline access count for modulation normalization */
	baselineCount: 5.0,

	/** Baseline days for modulation normalization */
	baselineDays: 1.0,

	/** Minimum similarity to consider reconsolidation */
	similarityThreshold: 0.4,

	/** Feature flag */
	enabled: true,
} as const

// ============================================================================
// Protein Synthesis (PRP) Tagging (Frey & Morris 1997)
// ============================================================================

export const PrpConfig = {
	/** PRP half-life in ms (90 minutes) */
	halfLifeMs: 90 * 60 * 1000,

	/** Emotional weight threshold to activate PRP */
	activationThreshold: 0.7,

	/** Maximum PRP-derived encoding boost */
	maxStrength: 0.5,

	/** Feature flag */
	enabled: true,
} as const

// ============================================================================
// Emotional Decay / Fading Affect Bias
// ============================================================================

export const EmotionalDecayConfig = {
	/** Decay rate for negative emotions per sleep cycle (~15% reduction) */
	negativeDecayRate: 0.85,

	/** Decay rate for positive emotions per sleep cycle (~5% reduction) */
	positiveDecayRate: 0.95,

	/** Decay rate for arousal toward baseline */
	arousalDecayRate: 0.9,

	/** Feature flag */
	enabled: false,
} as const

// ============================================================================
// Core ACT-R Activation (Anderson & Lebiere 1998)
// ============================================================================

export const ActivationConfig = {
	/** Weight for probe activation (similarity) */
	probeWeight: 0.4,

	/** Weight for base-level activation (recency/frequency) */
	baseLevelWeight: 0.3,

	/** Weight for spreading activation */
	spreadingWeight: 0.3,

	/** Decay rate for base-level activation (d parameter) */
	baseLevelDecay: 0.5,

	/** Maximum spreading activation strength */
	spreadingMax: 1.6,

	/** Decay per hop in spreading activation */
	spreadingDecayPerHop: 0.7,

	/** Maximum hops for spreading activation */
	spreadingMaxHops: 3,

	/** Retrieval threshold (tau) */
	retrievalThreshold: 0.0,

	/** Minimum probability for result inclusion */
	minProbability: 0.1,

	/** Maximum results to return */
	maxResults: 10,
} as const

// ============================================================================
// Session Tracking
// ============================================================================

export const SessionConfig = {
	/** Session inactivity timeout in ms (30 minutes) */
	inactivityTimeoutMs: 30 * 60 * 1000,

	/** Session boost for same-session memories */
	sameSessionBoost: 1.5,

	/** Cache TTL for session lookups in ms */
	cacheTtlMs: 60 * 1000,
} as const

// ============================================================================
// Combined Config Export
// ============================================================================

export const CognitiveConfig = {
	workingMemory: WorkingMemoryConfig,
	instanceNoise: InstanceNoiseConfig,
	partialMatching: PartialMatchingConfig,
	associationDecay: AssociationDecayConfig,
	encodingSpecificity: EncodingSpecificityConfig,
	episodicMemory: EpisodicMemoryConfig,
	consolidation: ConsolidationConfig,
	reconsolidation: ReconsolidationConfig,
	prp: PrpConfig,
	emotionalDecay: EmotionalDecayConfig,
	activation: ActivationConfig,
	session: SessionConfig,
} as const

export type CognitiveConfigType = typeof CognitiveConfig

// ============================================================================
// Feature Flag Helpers
// ============================================================================

/** Check if a cognitive feature is enabled */
export function isFeatureEnabled(
	feature:
		| "instanceNoise"
		| "partialMatching"
		| "associationDecay"
		| "encodingSpecificity"
		| "episodicMemory"
		| "consolidation"
		| "reconsolidation"
		| "prp"
		| "emotionalDecay"
): boolean {
	return CognitiveConfig[feature].enabled
}

/** Get all enabled features */
export function getEnabledFeatures(): string[] {
	const features = [
		"instanceNoise",
		"partialMatching",
		"associationDecay",
		"encodingSpecificity",
		"episodicMemory",
		"consolidation",
		"reconsolidation",
		"prp",
		"emotionalDecay",
	] as const
	return features.filter((f) => CognitiveConfig[f].enabled)
}
