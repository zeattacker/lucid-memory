//! Node.js bindings for lucid-core memory retrieval engine.
//!
//! Provides high-performance memory retrieval via napi-rs.

// napi-rs requires owned types at the FFI boundary - can't use references
#![allow(clippy::needless_pass_by_value)]
// Memory indices will never exceed u32::MAX in practice
#![allow(clippy::cast_possible_truncation)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

use lucid_core::{
	location::{
		compute_association_strength as core_association_strength,
		compute_familiarity as core_compute_familiarity,
		get_associated_locations as core_get_associated,
		infer_activity_type as core_infer_activity, is_well_known as core_is_well_known,
		ActivityInference, ActivityType, LocationAssociation, LocationConfig,
	},
	retrieval::{retrieve as core_retrieve, RetrievalConfig as CoreConfig, RetrievalInput},
	spreading::Association as CoreAssociation,
	visual::{
		retrieve_visual as core_retrieve_visual, should_prune as core_should_prune, VisualConfig,
		VisualRetrievalConfig, VisualRetrievalInput,
	},
};

/// Association between two memories for spreading activation.
#[napi(object)]
#[derive(Clone)]
pub struct JsAssociation {
	pub source: u32,
	pub target: u32,
	pub forward_strength: f64,
	pub backward_strength: f64,
}

/// Configuration for retrieval.
#[napi(object)]
#[derive(Clone)]
pub struct JsRetrievalConfig {
	/// Decay rate for base-level activation (default: 0.5)
	pub decay_rate: Option<f64>,
	/// Retrieval threshold (default: 0.3)
	pub activation_threshold: Option<f64>,
	/// Noise parameter (default: 0.1)
	pub noise_parameter: Option<f64>,
	/// Spreading activation depth (default: 3)
	pub spreading_depth: Option<u32>,
	/// Spreading decay per hop (default: 0.7)
	pub spreading_decay: Option<f64>,
	/// Minimum probability to include (default: 0.1)
	pub min_probability: Option<f64>,
	/// Maximum results to return (default: 10)
	pub max_results: Option<u32>,
	/// Whether to spread bidirectionally (default: true)
	pub bidirectional: Option<bool>,
}

/// Result candidate from retrieval.
#[napi(object)]
pub struct JsRetrievalCandidate {
	/// Memory index
	pub index: u32,
	/// Base-level activation from access history
	pub base_level: f64,
	/// Probe-trace activation (cubed similarity)
	pub probe_activation: f64,
	/// Spreading activation from associated memories
	pub spreading: f64,
	/// Emotional weight factor
	pub emotional_weight: f64,
	/// Combined total activation
	pub total_activation: f64,
	/// Retrieval probability (0-1)
	pub probability: f64,
}

/// Full retrieval pipeline using ACT-R spreading activation and MINERVA 2.
///
/// This is the core retrieval function that combines:
/// 1. Probe-trace similarity (cosine similarity)
/// 2. Working Memory boost (applied to similarity before cubing)
/// 3. Nonlinear activation (MINERVA 2's cubic function)
/// 4. Base-level activation (recency/frequency from ACT-R)
/// 5. Spreading activation through association graph
///
/// # Arguments
///
/// * `probe_embedding` - The query embedding vector
/// * `memory_embeddings` - All memory embedding vectors (2D array)
/// * `access_histories_ms` - Access timestamps (ms) for each memory
/// * `emotional_weights` - Emotional weight (0-1) for each memory
/// * `decay_rates` - Decay rate for each memory (or use config default)
/// * `working_memory_boosts` - WM boost for each memory (1.0 = no boost, up to 2.0)
/// * `current_time_ms` - Current time in milliseconds
/// * `associations` - Optional association graph edges
/// * `config` - Optional retrieval configuration
#[napi]
pub fn retrieve(
	probe_embedding: Vec<f64>,
	memory_embeddings: Vec<Vec<f64>>,
	access_histories_ms: Vec<Vec<f64>>,
	emotional_weights: Vec<f64>,
	decay_rates: Vec<f64>,
	working_memory_boosts: Vec<f64>,
	current_time_ms: f64,
	associations: Option<Vec<JsAssociation>>,
	config: Option<JsRetrievalConfig>,
) -> Vec<JsRetrievalCandidate> {
	let config = config.unwrap_or(JsRetrievalConfig {
		decay_rate: None,
		activation_threshold: None,
		noise_parameter: None,
		spreading_depth: None,
		spreading_decay: None,
		min_probability: None,
		max_results: None,
		bidirectional: None,
	});

	let core_config = CoreConfig {
		decay_rate: config.decay_rate.unwrap_or(0.5),
		activation_threshold: config.activation_threshold.unwrap_or(0.3),
		noise_parameter: config.noise_parameter.unwrap_or(0.1),
		spreading_depth: config.spreading_depth.unwrap_or(3) as usize,
		spreading_decay: config.spreading_decay.unwrap_or(0.7),
		min_probability: config.min_probability.unwrap_or(0.1),
		max_results: config.max_results.unwrap_or(10) as usize,
		bidirectional: config.bidirectional.unwrap_or(true),
	};

	let associations: Vec<CoreAssociation> = associations
		.unwrap_or_default()
		.into_iter()
		.map(|a| CoreAssociation {
			source: a.source as usize,
			target: a.target as usize,
			forward_strength: a.forward_strength,
			backward_strength: a.backward_strength,
		})
		.collect();

	let input = RetrievalInput {
		probe_embedding: &probe_embedding,
		memory_embeddings: &memory_embeddings,
		access_histories_ms: &access_histories_ms,
		emotional_weights: &emotional_weights,
		decay_rates: &decay_rates,
		working_memory_boosts: &working_memory_boosts,
		associations: &associations,
		current_time_ms,
	};

	let candidates = core_retrieve(&input, &core_config);

	candidates
		.into_iter()
		.map(|c| JsRetrievalCandidate {
			index: c.index as u32,
			base_level: c.base_level,
			probe_activation: c.probe_activation,
			spreading: c.spreading,
			emotional_weight: c.emotional_weight,
			total_activation: c.total_activation,
			probability: c.probability,
		})
		.collect()
}

/// Compute cosine similarity between two vectors.
#[napi]
pub fn cosine_similarity(a: Vec<f64>, b: Vec<f64>) -> f64 {
	lucid_core::cosine_similarity(&a, &b)
}

/// Batch compute cosine similarity between probe and all memories.
#[napi]
pub fn cosine_similarity_batch(probe: Vec<f64>, memories: Vec<Vec<f64>>) -> Vec<f64> {
	lucid_core::activation::cosine_similarity_batch(&probe, &memories)
}

/// Compute base-level activation from access history.
///
/// B(m) = ln[Σ(t_k)^(-d)]
#[napi]
pub fn compute_base_level(access_times_ms: Vec<f64>, current_time_ms: f64, decay: f64) -> f64 {
	lucid_core::compute_base_level(&access_times_ms, current_time_ms, decay)
}

/// Apply nonlinear activation (MINERVA 2's cubic function).
///
/// A(i) = S(i)³
#[napi]
pub fn nonlinear_activation(similarity: f64) -> f64 {
	lucid_core::nonlinear_activation(similarity)
}

/// Compute retrieval probability using logistic function.
///
/// P(retrieval) = 1 / (1 + e^((τ - A) / s))
#[napi]
pub fn retrieval_probability(activation: f64, threshold: f64, noise: f64) -> f64 {
	lucid_core::retrieval_probability(activation, threshold, noise)
}

/// Compute surprise (prediction error) between expected and actual.
#[napi]
pub fn compute_surprise(
	expected_embedding: Vec<f64>,
	actual_embedding: Vec<f64>,
	memory_age_days: f64,
	memory_strength: f64,
	base_threshold: f64,
) -> f64 {
	lucid_core::retrieval::compute_surprise(
		&expected_embedding,
		&actual_embedding,
		memory_age_days,
		memory_strength,
		base_threshold,
	)
}

// ============================================================================
// Working Memory
// ============================================================================

/// Configuration for working memory boost calculation.
#[napi(object)]
#[derive(Clone)]
pub struct JsWorkingMemoryConfig {
	/// Decay time constant in milliseconds (default: 4000)
	pub decay_ms: Option<f64>,
	/// Maximum boost multiplier (default: 1.0, giving range [1.0, 2.0])
	pub max_boost: Option<f64>,
}

/// Compute working memory boost for a memory.
///
/// Returns boost in range [1.0, 1.0 + `max_boost`].
/// Recently activated memories get higher boost.
#[napi]
pub fn compute_working_memory_boost(
	activated_at_ms: f64,
	current_time_ms: f64,
	config: Option<JsWorkingMemoryConfig>,
) -> f64 {
	let core_config =
		config.map_or_else(lucid_core::activation::WorkingMemoryConfig::default, |c| {
			lucid_core::activation::WorkingMemoryConfig {
				decay_ms: c.decay_ms.unwrap_or(4000.0),
				max_boost: c.max_boost.unwrap_or(1.0),
			}
		});
	lucid_core::compute_working_memory_boost(activated_at_ms, current_time_ms, &core_config)
}

/// Batch compute working memory boosts.
#[napi]
pub fn compute_working_memory_boost_batch(
	activated_at_ms: Vec<f64>,
	current_time_ms: f64,
	config: Option<JsWorkingMemoryConfig>,
) -> Vec<f64> {
	let core_config =
		config.map_or_else(lucid_core::activation::WorkingMemoryConfig::default, |c| {
			lucid_core::activation::WorkingMemoryConfig {
				decay_ms: c.decay_ms.unwrap_or(4000.0),
				max_boost: c.max_boost.unwrap_or(1.0),
			}
		});
	lucid_core::compute_working_memory_boost_batch(&activated_at_ms, current_time_ms, &core_config)
}

// ============================================================================
// Session Decay Rate
// ============================================================================

/// Compute session-aware decay rate based on recency.
///
/// Returns decay rate in range [0.3, 0.5]:
/// - Last 30 min: 0.3
/// - Last 2 hours: 0.4
/// - Last 24 hours: 0.45
/// - Older: 0.5
#[napi]
pub fn compute_session_decay_rate(last_access_ms: f64, current_time_ms: f64) -> f64 {
	lucid_core::compute_session_decay_rate(last_access_ms, current_time_ms)
}

/// Batch compute session-aware decay rates.
#[napi]
pub fn compute_session_decay_rate_batch(
	last_access_ms: Vec<f64>,
	current_time_ms: f64,
) -> Vec<f64> {
	lucid_core::compute_session_decay_rate_batch(&last_access_ms, current_time_ms)
}

// ============================================================================
// Instance Noise / Encoding Strength
// ============================================================================

/// Configuration for instance noise calculation.
#[napi(object)]
#[derive(Clone)]
pub struct JsInstanceNoiseConfig {
	/// Minimum encoding strength (default: 0.3)
	pub encoding_base: Option<f64>,
	/// Contribution from attention (default: 0.2)
	pub attention_weight: Option<f64>,
	/// Contribution from emotion (default: 0.2)
	pub emotional_weight: Option<f64>,
	/// Contribution from rehearsal (default: 0.3)
	pub rehearsal_weight: Option<f64>,
	/// Max rehearsal count before diminishing returns (default: 10)
	pub max_rehearsal_count: Option<u32>,
	/// Base noise parameter (default: 0.25)
	pub noise_base: Option<f64>,
}

/// Compute encoding strength for a memory.
///
/// Stronger encoding = more reliable retrieval.
#[napi]
pub fn compute_encoding_strength(
	attention: f64,
	emotional_weight: f64,
	access_count: u32,
	config: Option<JsInstanceNoiseConfig>,
) -> f64 {
	let core_config = js_instance_noise_config_to_core(config);
	lucid_core::compute_encoding_strength(attention, emotional_weight, access_count, &core_config)
}

/// Compute per-memory noise parameter from encoding strength.
///
/// Stronger encoding = lower noise.
#[napi]
pub fn compute_instance_noise(encoding_strength: f64, noise_base: f64) -> f64 {
	lucid_core::compute_instance_noise(encoding_strength, noise_base)
}

// ============================================================================
// Association Decay
// ============================================================================

/// Configuration for association decay.
#[napi(object)]
#[derive(Clone)]
pub struct JsAssociationDecayConfig {
	/// Decay tau for fresh associations in days (default: 1/24 = 1 hour)
	pub tau_fresh_days: Option<f64>,
	/// Decay tau for consolidating associations in days (default: 1)
	pub tau_consolidating_days: Option<f64>,
	/// Decay tau for consolidated associations in days (default: 30)
	pub tau_consolidated_days: Option<f64>,
	/// Decay tau for reconsolidating associations in days (default: 7)
	pub tau_reconsolidating_days: Option<f64>,
	/// Strength boost when co-accessed (default: 0.05)
	pub reinforcement_boost: Option<f64>,
	/// Prune threshold (default: 0.1)
	pub prune_threshold: Option<f64>,
}

/// Compute decayed association strength.
///
/// state: "fresh", "consolidating", "consolidated", "reconsolidating"
#[napi]
pub fn compute_association_decay(
	initial_strength: f64,
	days_since_reinforced: f64,
	state: String,
	config: Option<JsAssociationDecayConfig>,
) -> f64 {
	let core_config = js_assoc_decay_config_to_core(config);
	let core_state = parse_association_state(&state);
	lucid_core::compute_association_decay(
		initial_strength,
		days_since_reinforced,
		core_state,
		&core_config,
	)
}

/// Reinforce an association (co-access boost).
#[napi]
pub fn reinforce_association(
	current_strength: f64,
	config: Option<JsAssociationDecayConfig>,
) -> f64 {
	let core_config = js_assoc_decay_config_to_core(config);
	lucid_core::reinforce_association(current_strength, &core_config)
}

/// Check if an association should be pruned.
#[napi]
pub fn should_prune_association(strength: f64, config: Option<JsAssociationDecayConfig>) -> bool {
	let core_config = js_assoc_decay_config_to_core(config);
	lucid_core::should_prune_association(strength, &core_config)
}

// ============================================================================
// Reconsolidation
// ============================================================================

/// Configuration for reconsolidation calculations.
#[napi(object)]
#[derive(Clone)]
pub struct JsReconsolidationConfig {
	/// Lower PE threshold (default: 0.10)
	pub theta_low: Option<f64>,
	/// Upper PE threshold (default: 0.55)
	pub theta_high: Option<f64>,
	/// Sigmoid steepness (default: 10.0)
	pub beta: Option<f64>,
	/// How much encoding strength shifts `θ_high` down (default: 0.15)
	pub strength_shift: Option<f64>,
	/// How much memory age shifts `θ_low` up (default: 0.05)
	pub age_shift: Option<f64>,
	/// Baseline access count for normalization (default: 5.0)
	pub baseline_count: Option<f64>,
	/// Baseline days since access for normalization (default: 1.0)
	pub baseline_days: Option<f64>,
}

/// Compute reconsolidation probability using dual-sigmoid bell curve.
///
/// Returns probability of reconsolidation (peaks in the middle PE zone).
#[napi]
pub fn reconsolidation_probability(pe_abs: f64, theta_low: f64, theta_high: f64, beta: f64) -> f64 {
	lucid_core::reconsolidation_probability(pe_abs, theta_low, theta_high, beta)
}

/// Compute effective thresholds with boundary modulators.
///
/// Returns `[effective_theta_low, effective_theta_high]`.
#[napi]
pub fn compute_effective_thresholds(
	theta_low: f64,
	theta_high: f64,
	access_count: u32,
	days_since_last_access: f64,
	config: Option<JsReconsolidationConfig>,
) -> Vec<f64> {
	let core_config = js_recon_config_to_core(config);
	let (low, high) = lucid_core::compute_effective_thresholds(
		theta_low,
		theta_high,
		access_count,
		days_since_last_access,
		&core_config,
	);
	vec![low, high]
}

/// Determine prediction error zone.
///
/// Returns `"reinforce"`, `"reconsolidate"`, or `"new_trace"`.
#[napi]
pub fn pe_zone(pe_abs: f64, theta_low_eff: f64, theta_high_eff: f64) -> String {
	lucid_core::pe_zone(pe_abs, theta_low_eff, theta_high_eff).to_string()
}

// ============================================================================
// Temporal Spreading (Episodic Memory)
// ============================================================================

/// Configuration for temporal spreading.
#[napi(object)]
#[derive(Clone)]
pub struct JsTemporalSpreadingConfig {
	/// Forward link strength multiplier (default: 1.0)
	pub forward_strength: Option<f64>,
	/// Backward link strength multiplier (default: 0.7)
	pub backward_strength: Option<f64>,
	/// Distance decay rate (default: 0.3)
	pub distance_decay_rate: Option<f64>,
	/// Episode boost (default: 1.2)
	pub episode_boost: Option<f64>,
	/// Context persistence (default: 0.7)
	pub context_persistence: Option<f64>,
	/// Max temporal distance (default: 10)
	pub max_temporal_distance: Option<u32>,
}

/// A temporal link between memories.
#[napi(object)]
#[derive(Clone)]
pub struct JsTemporalLink {
	pub source_position: u32,
	pub target_position: u32,
	pub source_memory: u32,
	pub target_memory: u32,
	pub forward_strength: f64,
	pub backward_strength: f64,
}

/// Result of temporal spreading.
#[napi(object)]
pub struct JsTemporalSpreadingResult {
	pub activations: Vec<f64>,
	pub forward_activated: Vec<u32>,
	pub backward_activated: Vec<u32>,
}

/// Temporal neighbor result.
#[napi(object)]
pub struct JsTemporalNeighbor {
	pub memory_index: u32,
	pub strength: f64,
}

/// Create temporal links for an episode.
#[napi]
pub fn create_episode_links(
	event_memory_indices: Vec<u32>,
	config: Option<JsTemporalSpreadingConfig>,
) -> Vec<JsTemporalLink> {
	let core_config = js_temporal_config_to_core(config);
	let indices: Vec<usize> = event_memory_indices.iter().map(|&i| i as usize).collect();
	let links = lucid_core::create_episode_links(&indices, &core_config);

	links
		.into_iter()
		.map(|l| JsTemporalLink {
			source_position: l.source_position as u32,
			target_position: l.target_position as u32,
			source_memory: l.source_memory as u32,
			target_memory: l.target_memory as u32,
			forward_strength: l.forward_strength,
			backward_strength: l.backward_strength,
		})
		.collect()
}

/// Spread activation through temporal links.
#[napi]
pub fn spread_temporal_activation(
	num_memories: u32,
	temporal_links: Vec<JsTemporalLink>,
	seed_memory: u32,
	seed_activation: f64,
	config: Option<JsTemporalSpreadingConfig>,
) -> JsTemporalSpreadingResult {
	let core_config = js_temporal_config_to_core(config);
	let core_links: Vec<lucid_core::TemporalLink> = temporal_links
		.into_iter()
		.map(js_temporal_link_to_core)
		.collect();

	let result = lucid_core::spread_temporal_activation(
		num_memories as usize,
		&core_links,
		seed_memory as usize,
		seed_activation,
		&core_config,
	);

	JsTemporalSpreadingResult {
		activations: result.activations,
		forward_activated: result
			.forward_activated
			.into_iter()
			.map(|i| i as u32)
			.collect(),
		backward_activated: result
			.backward_activated
			.into_iter()
			.map(|i| i as u32)
			.collect(),
	}
}

/// Find temporally adjacent memories.
///
/// direction: "before", "after", or "both"
#[napi]
pub fn find_temporal_neighbors(
	temporal_links: Vec<JsTemporalLink>,
	anchor_memory: u32,
	direction: String,
	limit: u32,
) -> Vec<JsTemporalNeighbor> {
	let core_links: Vec<lucid_core::TemporalLink> = temporal_links
		.into_iter()
		.map(js_temporal_link_to_core)
		.collect();

	let neighbors = lucid_core::find_temporal_neighbors(
		&core_links,
		anchor_memory as usize,
		&direction,
		limit as usize,
	);

	neighbors
		.into_iter()
		.map(|(m, s)| JsTemporalNeighbor {
			memory_index: m as u32,
			strength: s,
		})
		.collect()
}

/// Library version
#[napi]
pub fn version() -> String {
	lucid_core::VERSION.to_string()
}

// ============================================================================
// Embedding (In-Process ONNX)
// ============================================================================

use std::sync::OnceLock;

static EMBEDDING_MODEL: OnceLock<lucid_core::embedding::EmbeddingModel> = OnceLock::new();

/// Embedding result returned to JavaScript.
#[napi(object)]
pub struct JsEmbeddingResult {
	/// The embedding vector (768 dimensions).
	pub vector: Vec<f64>,
	/// Model name.
	pub model: String,
	/// Number of dimensions.
	pub dimensions: u32,
}

/// Load the BGE-base-en-v1.5 embedding model from disk.
///
/// Call this once at startup. Subsequent calls are no-ops.
/// Returns true if the model is loaded (or was already loaded).
///
/// # Errors
///
/// Returns an error if model files are missing or ONNX Runtime fails to load.
#[napi]
pub fn load_embedding_model(
	model_path: Option<String>,
	tokenizer_path: Option<String>,
) -> napi::Result<bool> {
	if EMBEDDING_MODEL.get().is_some() {
		return Ok(true);
	}

	let config = lucid_core::embedding::EmbeddingModelConfig {
		model_path: model_path.map(std::path::PathBuf::from),
		tokenizer_path: tokenizer_path.map(std::path::PathBuf::from),
	};

	match lucid_core::embedding::EmbeddingModel::load(&config) {
		Ok(model) => {
			let _ = EMBEDDING_MODEL.set(model);
			Ok(true)
		}
		Err(e) => Err(napi::Error::from_reason(format!(
			"Failed to load embedding model: {e}"
		))),
	}
}

/// Check if the embedding model is currently loaded.
#[napi]
pub fn is_embedding_model_loaded() -> bool {
	EMBEDDING_MODEL.get().is_some()
}

/// Check if model files exist at the given (or default) paths.
#[napi]
pub fn is_embedding_model_available(
	model_path: Option<String>,
	tokenizer_path: Option<String>,
) -> bool {
	let config = lucid_core::embedding::EmbeddingModelConfig {
		model_path: model_path.map(std::path::PathBuf::from),
		tokenizer_path: tokenizer_path.map(std::path::PathBuf::from),
	};
	lucid_core::embedding::EmbeddingModel::is_available(&config)
}

/// Embed a single text. Returns { vector, model, dimensions }.
///
/// # Errors
///
/// Returns an error if the model is not loaded or embedding fails.
#[napi]
pub fn embed(text: String) -> napi::Result<JsEmbeddingResult> {
	let model = EMBEDDING_MODEL.get().ok_or_else(|| {
		napi::Error::from_reason("Embedding model not loaded. Call loadEmbeddingModel() first.")
	})?;

	let vector_f32 = model
		.embed(&text)
		.map_err(|e| napi::Error::from_reason(format!("Embedding failed: {e}")))?;

	Ok(JsEmbeddingResult {
		vector: vector_f32.into_iter().map(f64::from).collect(),
		model: model.model_name().to_string(),
		dimensions: model.dimensions() as u32,
	})
}

/// Embed a batch of texts.
///
/// # Errors
///
/// Returns an error if the model is not loaded or embedding fails.
#[napi]
pub fn embed_batch(texts: Vec<String>) -> napi::Result<Vec<JsEmbeddingResult>> {
	let model = EMBEDDING_MODEL.get().ok_or_else(|| {
		napi::Error::from_reason("Embedding model not loaded. Call loadEmbeddingModel() first.")
	})?;

	let text_refs: Vec<&str> = texts.iter().map(String::as_str).collect();
	let vectors = model
		.embed_batch(&text_refs)
		.map_err(|e| napi::Error::from_reason(format!("Batch embedding failed: {e}")))?;

	Ok(vectors
		.into_iter()
		.map(|v| JsEmbeddingResult {
			vector: v.into_iter().map(f64::from).collect(),
			model: model.model_name().to_string(),
			dimensions: model.dimensions() as u32,
		})
		.collect())
}

// ============================================================================
// Location Intuitions (Spatial Memory)
// ============================================================================

/// Result of activity type inference.
#[napi(object)]
pub struct JsActivityInference {
	/// The inferred activity type (reading, writing, debugging, refactoring, reviewing, unknown)
	pub activity_type: String,
	/// How it was inferred (explicit, keyword, tool, default)
	pub source: String,
	/// Confidence level (0-1)
	pub confidence: f64,
}

/// A location (file) with familiarity metrics.
#[napi(object)]
#[derive(Clone)]
pub struct JsLocationIntuition {
	/// Index in the location array
	pub id: u32,
	/// Familiarity level (0-1)
	pub familiarity: f64,
	/// Number of times accessed
	pub access_count: u32,
	/// Number of searches avoided
	pub searches_saved: u32,
	/// Last access timestamp (ms)
	pub last_accessed_ms: f64,
	/// Whether pinned (immune to decay)
	pub is_pinned: bool,
}

/// Association between two locations.
#[napi(object)]
#[derive(Clone)]
pub struct JsLocationAssociation {
	/// Source location index
	pub source: u32,
	/// Target location index
	pub target: u32,
	/// Association strength (0-1)
	pub strength: f64,
	/// Number of co-accesses
	pub co_access_count: u32,
}

/// Configuration for location operations.
#[napi(object)]
#[derive(Clone)]
pub struct JsLocationConfig {
	/// Familiarity curve coefficient (default: 0.1)
	pub familiarity_k: Option<f64>,
	/// Days before decay begins (default: 30)
	pub stale_threshold_days: Option<u32>,
	/// Maximum decay rate (default: 0.10)
	pub max_decay_rate: Option<f64>,
	/// How much familiarity reduces decay (default: 0.8)
	pub decay_dampening: Option<f64>,
	/// Minimum familiarity floor (default: 0.1)
	pub base_floor: Option<f64>,
	/// Extra floor for well-known locations (default: 0.4)
	pub sticky_bonus: Option<f64>,
	/// Threshold for "well-known" (default: 0.7)
	pub well_known_threshold: Option<f64>,
	/// Multiplier: task + same activity (default: 5.0)
	pub task_same_activity_multiplier: Option<f64>,
	/// Multiplier: task + different activity (default: 3.0)
	pub task_diff_activity_multiplier: Option<f64>,
	/// Multiplier: time + same activity (default: 2.0)
	pub time_same_activity_multiplier: Option<f64>,
	/// Multiplier: time + different activity (default: 1.0)
	pub time_diff_activity_multiplier: Option<f64>,
	/// Backward strength factor (default: 0.7)
	pub backward_strength_factor: Option<f64>,
}

/// Associated location result.
#[napi(object)]
pub struct JsAssociatedLocation {
	/// Location index
	pub location_id: u32,
	/// Association strength
	pub strength: f64,
}

/// Compute familiarity for a given access count.
///
/// Uses asymptotic curve: f(n) = 1 - 1/(1 + k*n)
#[napi]
pub fn location_compute_familiarity(access_count: u32, config: Option<JsLocationConfig>) -> f64 {
	let cfg = js_config_to_core(config);
	core_compute_familiarity(access_count, &cfg)
}

/// Infer activity type from context string and optional tool name.
///
/// Precedence: explicit > keyword > tool > default
#[napi]
pub fn location_infer_activity(
	context: String,
	tool_name: Option<String>,
	explicit_type: Option<String>,
) -> JsActivityInference {
	let explicit = explicit_type.and_then(|s| parse_activity_type(&s));
	let tool = tool_name.as_deref();
	let result = core_infer_activity(&context, tool, explicit);
	activity_inference_to_js(result)
}

/// Compute association strength with multiplier based on context.
#[napi]
pub fn location_association_strength(
	current_count: u32,
	is_same_task: bool,
	is_same_activity: bool,
	config: Option<JsLocationConfig>,
) -> f64 {
	let cfg = js_config_to_core(config);
	let multiplier =
		lucid_core::location::association_multiplier(is_same_task, is_same_activity, &cfg);
	core_association_strength(current_count, multiplier, &cfg)
}

/// Get locations associated with a given location, sorted by strength.
#[napi]
pub fn location_get_associated(
	location_id: u32,
	associations: Vec<JsLocationAssociation>,
	limit: u32,
) -> Vec<JsAssociatedLocation> {
	let assocs: Vec<LocationAssociation> = associations.into_iter().map(js_assoc_to_core).collect();
	core_get_associated(location_id, &assocs, limit as usize)
		.into_iter()
		.map(|(id, strength)| JsAssociatedLocation {
			location_id: id,
			strength,
		})
		.collect()
}

/// Check if a location is well-known based on familiarity threshold.
#[napi]
pub fn location_is_well_known(familiarity: f64, config: Option<JsLocationConfig>) -> bool {
	let cfg = js_config_to_core(config);
	core_is_well_known(familiarity, &cfg)
}

// ============================================================================
// Visual Memory
// ============================================================================

/// Where a visual memory originated.
#[napi(object)]
#[derive(Clone)]
pub struct JsVisualSource {
	/// Source type: "discord", "sms", "direct", "videoframe", "other"
	pub source_type: String,
}

/// Emotional context of a visual memory.
#[napi(object)]
#[derive(Clone)]
pub struct JsEmotionalContext {
	/// Pleasant (+1) to unpleasant (-1)
	pub valence: f64,
	/// High activation (1) to low activation (0)
	pub arousal: f64,
}

/// A visual memory with full metadata.
#[napi(object)]
#[derive(Clone)]
pub struct JsVisualMemory {
	/// Unique identifier
	pub id: u32,
	/// Short description (the "gist")
	pub description: String,
	/// Detailed description (optional)
	pub detailed_description: Option<String>,
	/// When captured
	pub captured_at_ms: f64,
	/// Last access timestamp
	pub last_accessed_ms: f64,
	/// Access count
	pub access_count: u32,
	/// Emotional valence (-1 to 1)
	pub emotional_valence: f64,
	/// Emotional arousal (0 to 1)
	pub emotional_arousal: f64,
	/// Significance score (0-1)
	pub significance: f64,
	/// Source type
	pub source: String,
	/// Who shared this
	pub shared_by: Option<String>,
	/// Video ID if frame
	pub video_id: Option<String>,
	/// Frame number
	pub frame_number: Option<u32>,
	/// Detected objects
	pub objects: Vec<String>,
	/// Tags
	pub tags: Vec<String>,
	/// Whether pinned
	pub is_pinned: bool,
}

/// Configuration for visual memory operations.
#[napi(object)]
#[derive(Clone)]
pub struct JsVisualConfig {
	/// Significance threshold for tagging (default: 0.6)
	pub tagging_significance_threshold: Option<f64>,
	/// Emotional retention threshold (default: 0.7)
	pub emotional_retention_threshold: Option<f64>,
	/// How much emotion reduces decay (default: 0.5)
	pub emotional_decay_reduction: Option<f64>,
	/// Base decay rate (default: 0.05)
	pub base_decay_rate: Option<f64>,
	/// Days before decay (default: 14)
	pub stale_threshold_days: Option<u32>,
	/// Significance floor (default: 0.1)
	pub significance_floor: Option<f64>,
	/// Pruning threshold (default: 0.2)
	pub pruning_threshold: Option<f64>,
	/// Pruning stale days (default: 90)
	pub pruning_stale_days: Option<u32>,
	/// Preserve keyframes (default: true)
	pub preserve_keyframes: Option<bool>,
}

/// Configuration for visual retrieval.
#[napi(object)]
#[derive(Clone)]
pub struct JsVisualRetrievalConfig {
	/// Decay rate (default: 0.5)
	pub decay_rate: Option<f64>,
	/// Activation threshold (default: 0.3)
	pub activation_threshold: Option<f64>,
	/// Noise parameter (default: 0.1)
	pub noise_parameter: Option<f64>,
	/// Spreading depth (default: 3)
	pub spreading_depth: Option<u32>,
	/// Spreading decay (default: 0.7)
	pub spreading_decay: Option<f64>,
	/// Min probability (default: 0.1)
	pub min_probability: Option<f64>,
	/// Max results (default: 10)
	pub max_results: Option<u32>,
	/// Bidirectional spreading (default: true)
	pub bidirectional: Option<bool>,
	/// Emotional boost (default: 0.3)
	pub emotional_boost: Option<f64>,
	/// Significance boost (default: 0.2)
	pub significance_boost: Option<f64>,
}

/// Result from visual retrieval.
#[napi(object)]
pub struct JsVisualRetrievalCandidate {
	/// Memory index
	pub index: u32,
	/// Base-level activation
	pub base_level: f64,
	/// Probe activation
	pub probe_activation: f64,
	/// Spreading activation
	pub spreading: f64,
	/// Emotional weight
	pub emotional_weight: f64,
	/// Significance boost applied
	pub significance_boost: f64,
	/// Total activation
	pub total_activation: f64,
	/// Retrieval probability
	pub probability: f64,
}

/// Consolidation state.
#[napi(object)]
pub struct JsVisualConsolidationState {
	/// State: "fresh", "consolidating", "consolidated", "reconsolidating"
	pub state: String,
	/// Consolidation strength (0-1)
	pub strength: f64,
	/// Reactivation count
	pub reactivation_count: u32,
}

/// Pruning candidate.
#[napi(object)]
pub struct JsPruningCandidate {
	/// Memory index
	pub index: u32,
	/// Current significance
	pub significance: f64,
	/// Days since access
	pub days_since_access: f64,
	/// Reason: "lowsignificance", "stale", "duplicate", "lowquality"
	pub reason: String,
	/// Pruning score
	pub score: f64,
}

/// Retrieve visual memories based on probe embedding.
#[napi]
pub fn visual_retrieve(
	probe_embedding: Vec<f64>,
	memory_embeddings: Vec<Vec<f64>>,
	access_histories_ms: Vec<Vec<f64>>,
	emotional_weights: Vec<f64>,
	significance_scores: Vec<f64>,
	current_time_ms: f64,
	associations: Option<Vec<JsAssociation>>,
	config: Option<JsVisualRetrievalConfig>,
) -> Vec<JsVisualRetrievalCandidate> {
	let config = js_visual_retrieval_config_to_core(config);

	let associations: Vec<CoreAssociation> = associations
		.unwrap_or_default()
		.into_iter()
		.map(|a| CoreAssociation {
			source: a.source as usize,
			target: a.target as usize,
			forward_strength: a.forward_strength,
			backward_strength: a.backward_strength,
		})
		.collect();

	let input = VisualRetrievalInput {
		probe_embedding: &probe_embedding,
		memory_embeddings: &memory_embeddings,
		access_histories_ms: &access_histories_ms,
		emotional_weights: &emotional_weights,
		significance_scores: &significance_scores,
		associations: &associations,
		current_time_ms,
	};

	let candidates = core_retrieve_visual(&input, &config);

	candidates
		.into_iter()
		.map(|c| JsVisualRetrievalCandidate {
			index: c.index as u32,
			base_level: c.base_level,
			probe_activation: c.probe_activation,
			spreading: c.spreading,
			emotional_weight: c.emotional_weight,
			significance_boost: c.significance_boost,
			total_activation: c.total_activation,
			probability: c.probability,
		})
		.collect()
}

/// Check if a visual memory should be pruned.
#[napi]
pub fn visual_should_prune(
	significance: f64,
	days_since_access: f64,
	is_pinned: bool,
	is_keyframe: bool,
	config: Option<JsVisualConfig>,
) -> bool {
	let cfg = js_visual_config_to_core(config);
	core_should_prune(
		significance,
		days_since_access,
		is_pinned,
		is_keyframe,
		&cfg,
	)
}

// ============================================================================
// Video Frame Selection
// ============================================================================

/// A candidate frame for description.
#[napi(object)]
#[derive(Clone)]
pub struct JsFrameCandidate {
	/// Frame index in the video
	pub index: u32,
	/// Timestamp in seconds
	pub timestamp_seconds: f64,
	/// Whether this is a keyframe (I-frame)
	pub is_keyframe: bool,
	/// Whether this is a scene change
	pub is_scene_change: bool,
	/// Quality score (0-1)
	pub quality_score: f64,
}

/// A transcript segment for context.
#[napi(object)]
#[derive(Clone)]
pub struct JsTranscriptSegment {
	/// Start timestamp in seconds
	pub start_seconds: f64,
	/// End timestamp in seconds
	pub end_seconds: f64,
	/// The transcribed text
	pub text: String,
}

/// Configuration for frame description prompts.
#[napi(object)]
#[derive(Clone)]
pub struct JsFrameDescriptionConfig {
	/// Whether to include emotional assessment
	pub include_emotion: Option<bool>,
	/// Whether to detect and list objects
	pub detect_objects: Option<bool>,
	/// Maximum description length guidance
	pub max_description_length: Option<u32>,
}

/// Select frames for description, respecting rate limits.
///
/// Prioritizes: keyframes, scene changes, even distribution, transcript moments.
///
/// # Returns
///
/// Indices of selected frames in chronological order.
#[napi]
pub fn video_select_frames(
	frames: Vec<JsFrameCandidate>,
	max_frames: u32,
	transcript_segments: Option<Vec<JsTranscriptSegment>>,
) -> Vec<u32> {
	use lucid_core::visual::{select_frames_for_description, FrameCandidate, TranscriptSegment};

	let core_frames: Vec<FrameCandidate> = frames
		.into_iter()
		.map(|f| FrameCandidate {
			index: f.index as usize,
			timestamp_seconds: f.timestamp_seconds,
			is_keyframe: f.is_keyframe,
			is_scene_change: f.is_scene_change,
			quality_score: f.quality_score,
		})
		.collect();

	let core_segments: Option<Vec<TranscriptSegment>> = transcript_segments.map(|segs| {
		segs.into_iter()
			.map(|s| TranscriptSegment {
				start_seconds: s.start_seconds,
				end_seconds: s.end_seconds,
				text: s.text,
			})
			.collect()
	});

	let result =
		select_frames_for_description(&core_frames, max_frames as usize, core_segments.as_deref());

	result.into_iter().map(|i| i as u32).collect()
}

/// Generate a prompt for Claude Haiku to describe a video frame.
///
/// Returns a prompt string to send to Claude Haiku along with the image.
#[napi]
pub fn video_prepare_for_subagent(
	timestamp_seconds: f64,
	video_duration_seconds: f64,
	transcript_near_frame: Option<String>,
	is_scene_change: bool,
	shared_by: Option<String>,
	config: Option<JsFrameDescriptionConfig>,
) -> String {
	use lucid_core::visual::{prepare_frame_description_prompt, FrameDescriptionConfig};

	let core_config = config.map_or_else(FrameDescriptionConfig::default, |c| {
		let default = FrameDescriptionConfig::default();
		FrameDescriptionConfig {
			include_emotion: c.include_emotion.unwrap_or(default.include_emotion),
			detect_objects: c.detect_objects.unwrap_or(default.detect_objects),
			max_description_length: c
				.max_description_length
				.map_or(default.max_description_length, |n| n as usize),
		}
	});

	prepare_frame_description_prompt(
		timestamp_seconds,
		video_duration_seconds,
		transcript_near_frame.as_deref(),
		is_scene_change,
		shared_by.as_deref(),
		&core_config,
	)
}

/// Generate a synthesis prompt for combining frame descriptions.
#[napi]
pub fn video_prepare_synthesis_prompt(
	descriptions: Vec<String>,
	valences: Vec<f64>,
	arousals: Vec<f64>,
	significances: Vec<f64>,
	timestamps: Vec<f64>,
	transcript: Option<String>,
	video_duration_seconds: f64,
) -> String {
	use lucid_core::visual::{prepare_synthesis_prompt, FrameDescriptionResult};

	let frame_descriptions: Vec<FrameDescriptionResult> = descriptions
		.into_iter()
		.zip(valences)
		.zip(arousals)
		.zip(significances)
		.map(|(((desc, val), aro), sig)| FrameDescriptionResult {
			description: desc,
			objects: vec![],
			valence: val,
			arousal: aro,
			significance: sig,
		})
		.collect();

	prepare_synthesis_prompt(
		&frame_descriptions,
		&timestamps,
		transcript.as_deref(),
		video_duration_seconds,
	)
}

// ============================================================================
// Type Conversions
// ============================================================================

fn js_visual_config_to_core(js: Option<JsVisualConfig>) -> VisualConfig {
	js.map_or_else(VisualConfig::default, |js| {
		let default = VisualConfig::default();
		VisualConfig {
			tagging_significance_threshold: js
				.tagging_significance_threshold
				.unwrap_or(default.tagging_significance_threshold),
			emotional_retention_threshold: js
				.emotional_retention_threshold
				.unwrap_or(default.emotional_retention_threshold),
			emotional_decay_reduction: js
				.emotional_decay_reduction
				.unwrap_or(default.emotional_decay_reduction),
			base_decay_rate: js.base_decay_rate.unwrap_or(default.base_decay_rate),
			stale_threshold_days: js
				.stale_threshold_days
				.unwrap_or(default.stale_threshold_days),
			significance_floor: js.significance_floor.unwrap_or(default.significance_floor),
			pruning_threshold: js.pruning_threshold.unwrap_or(default.pruning_threshold),
			pruning_stale_days: js.pruning_stale_days.unwrap_or(default.pruning_stale_days),
			preserve_keyframes: js.preserve_keyframes.unwrap_or(default.preserve_keyframes),
		}
	})
}

fn js_visual_retrieval_config_to_core(
	js: Option<JsVisualRetrievalConfig>,
) -> VisualRetrievalConfig {
	js.map_or_else(VisualRetrievalConfig::default, |js| {
		let default = VisualRetrievalConfig::default();
		VisualRetrievalConfig {
			decay_rate: js.decay_rate.unwrap_or(default.decay_rate),
			activation_threshold: js
				.activation_threshold
				.unwrap_or(default.activation_threshold),
			noise_parameter: js.noise_parameter.unwrap_or(default.noise_parameter),
			spreading_depth: js.spreading_depth.unwrap_or(default.spreading_depth as u32) as usize,
			spreading_decay: js.spreading_decay.unwrap_or(default.spreading_decay),
			min_probability: js.min_probability.unwrap_or(default.min_probability),
			max_results: js.max_results.unwrap_or(default.max_results as u32) as usize,
			bidirectional: js.bidirectional.unwrap_or(default.bidirectional),
			emotional_boost: js.emotional_boost.unwrap_or(default.emotional_boost),
			significance_boost: js.significance_boost.unwrap_or(default.significance_boost),
		}
	})
}

fn js_config_to_core(js: Option<JsLocationConfig>) -> LocationConfig {
	js.map_or_else(LocationConfig::default, |js| {
		let default = LocationConfig::default();
		LocationConfig {
			familiarity_k: js.familiarity_k.unwrap_or(default.familiarity_k),
			stale_threshold_days: js
				.stale_threshold_days
				.unwrap_or(default.stale_threshold_days),
			max_decay_rate: js.max_decay_rate.unwrap_or(default.max_decay_rate),
			decay_dampening: js.decay_dampening.unwrap_or(default.decay_dampening),
			base_floor: js.base_floor.unwrap_or(default.base_floor),
			sticky_bonus: js.sticky_bonus.unwrap_or(default.sticky_bonus),
			well_known_threshold: js
				.well_known_threshold
				.unwrap_or(default.well_known_threshold),
			task_same_activity_multiplier: js
				.task_same_activity_multiplier
				.unwrap_or(default.task_same_activity_multiplier),
			task_diff_activity_multiplier: js
				.task_diff_activity_multiplier
				.unwrap_or(default.task_diff_activity_multiplier),
			time_same_activity_multiplier: js
				.time_same_activity_multiplier
				.unwrap_or(default.time_same_activity_multiplier),
			time_diff_activity_multiplier: js
				.time_diff_activity_multiplier
				.unwrap_or(default.time_diff_activity_multiplier),
			backward_strength_factor: js
				.backward_strength_factor
				.unwrap_or(default.backward_strength_factor),
		}
	})
}

const fn js_assoc_to_core(js: JsLocationAssociation) -> LocationAssociation {
	LocationAssociation {
		source: js.source,
		target: js.target,
		strength: js.strength,
		co_access_count: js.co_access_count,
	}
}

fn activity_inference_to_js(ai: ActivityInference) -> JsActivityInference {
	JsActivityInference {
		activity_type: format!("{:?}", ai.activity_type).to_lowercase(),
		source: format!("{:?}", ai.source).to_lowercase(),
		confidence: ai.confidence,
	}
}

fn parse_activity_type(s: &str) -> Option<ActivityType> {
	match s.to_lowercase().as_str() {
		"reading" => Some(ActivityType::Reading),
		"writing" => Some(ActivityType::Writing),
		"debugging" => Some(ActivityType::Debugging),
		"refactoring" => Some(ActivityType::Refactoring),
		"reviewing" => Some(ActivityType::Reviewing),
		"unknown" => Some(ActivityType::Unknown),
		_ => None,
	}
}

fn js_instance_noise_config_to_core(
	js: Option<JsInstanceNoiseConfig>,
) -> lucid_core::activation::InstanceNoiseConfig {
	js.map_or_else(lucid_core::activation::InstanceNoiseConfig::default, |c| {
		let default = lucid_core::activation::InstanceNoiseConfig::default();
		lucid_core::activation::InstanceNoiseConfig {
			encoding_base: c.encoding_base.unwrap_or(default.encoding_base),
			attention_weight: c.attention_weight.unwrap_or(default.attention_weight),
			emotional_weight: c.emotional_weight.unwrap_or(default.emotional_weight),
			rehearsal_weight: c.rehearsal_weight.unwrap_or(default.rehearsal_weight),
			max_rehearsal_count: c.max_rehearsal_count.unwrap_or(default.max_rehearsal_count),
			noise_base: c.noise_base.unwrap_or(default.noise_base),
		}
	})
}

fn js_assoc_decay_config_to_core(
	js: Option<JsAssociationDecayConfig>,
) -> lucid_core::activation::AssociationDecayConfig {
	js.map_or_else(
		lucid_core::activation::AssociationDecayConfig::default,
		|c| {
			let default = lucid_core::activation::AssociationDecayConfig::default();
			lucid_core::activation::AssociationDecayConfig {
				tau_fresh_days: c.tau_fresh_days.unwrap_or(default.tau_fresh_days),
				tau_consolidating_days: c
					.tau_consolidating_days
					.unwrap_or(default.tau_consolidating_days),
				tau_consolidated_days: c
					.tau_consolidated_days
					.unwrap_or(default.tau_consolidated_days),
				tau_reconsolidating_days: c
					.tau_reconsolidating_days
					.unwrap_or(default.tau_reconsolidating_days),
				reinforcement_boost: c.reinforcement_boost.unwrap_or(default.reinforcement_boost),
				prune_threshold: c.prune_threshold.unwrap_or(default.prune_threshold),
			}
		},
	)
}

fn js_recon_config_to_core(
	js: Option<JsReconsolidationConfig>,
) -> lucid_core::activation::ReconsolidationConfig {
	js.map_or_else(
		lucid_core::activation::ReconsolidationConfig::default,
		|c| {
			let default = lucid_core::activation::ReconsolidationConfig::default();
			lucid_core::activation::ReconsolidationConfig {
				theta_low: c.theta_low.unwrap_or(default.theta_low),
				theta_high: c.theta_high.unwrap_or(default.theta_high),
				beta: c.beta.unwrap_or(default.beta),
				strength_shift: c.strength_shift.unwrap_or(default.strength_shift),
				age_shift: c.age_shift.unwrap_or(default.age_shift),
				baseline_count: c.baseline_count.unwrap_or(default.baseline_count),
				baseline_days: c.baseline_days.unwrap_or(default.baseline_days),
			}
		},
	)
}

fn parse_association_state(s: &str) -> lucid_core::activation::AssociationState {
	match s.to_lowercase().as_str() {
		"consolidating" => lucid_core::activation::AssociationState::Consolidating,
		"consolidated" => lucid_core::activation::AssociationState::Consolidated,
		"reconsolidating" => lucid_core::activation::AssociationState::Reconsolidating,
		// "fresh" and any invalid input defaults to Fresh
		_ => lucid_core::activation::AssociationState::Fresh,
	}
}

fn js_temporal_config_to_core(
	js: Option<JsTemporalSpreadingConfig>,
) -> lucid_core::spreading::TemporalSpreadingConfig {
	js.map_or_else(
		lucid_core::spreading::TemporalSpreadingConfig::default,
		|c| {
			let default = lucid_core::spreading::TemporalSpreadingConfig::default();
			lucid_core::spreading::TemporalSpreadingConfig {
				forward_strength: c.forward_strength.unwrap_or(default.forward_strength),
				backward_strength: c.backward_strength.unwrap_or(default.backward_strength),
				distance_decay_rate: c.distance_decay_rate.unwrap_or(default.distance_decay_rate),
				episode_boost: c.episode_boost.unwrap_or(default.episode_boost),
				context_persistence: c.context_persistence.unwrap_or(default.context_persistence),
				max_temporal_distance: c
					.max_temporal_distance
					.unwrap_or(default.max_temporal_distance as u32)
					as usize,
			}
		},
	)
}

const fn js_temporal_link_to_core(js: JsTemporalLink) -> lucid_core::spreading::TemporalLink {
	lucid_core::spreading::TemporalLink {
		source_position: js.source_position as usize,
		target_position: js.target_position as usize,
		source_memory: js.source_memory as usize,
		target_memory: js.target_memory as usize,
		forward_strength: js.forward_strength,
		backward_strength: js.backward_strength,
	}
}

#[cfg(test)]
#[allow(clippy::float_cmp, clippy::suboptimal_flops)]
mod tests {
	use super::*;

	#[test]
	fn test_cosine_similarity() {
		let a = vec![1.0, 0.0, 0.0];
		let b = vec![1.0, 0.0, 0.0];
		assert!((cosine_similarity(a, b) - 1.0).abs() < 1e-10);
	}

	#[test]
	fn test_retrieve_basic() {
		let probe = vec![1.0, 0.0, 0.0];
		let memories = vec![vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0]];
		let now = 1_000_000.0;

		let results = retrieve(
			probe,
			memories,
			vec![vec![now - 1000.0], vec![now - 1000.0]],
			vec![0.5, 0.5],
			vec![0.5, 0.5],
			vec![1.0, 1.0], // No WM boost
			now,
			None,
			Some(JsRetrievalConfig {
				min_probability: Some(0.0),
				decay_rate: None,
				activation_threshold: None,
				noise_parameter: None,
				spreading_depth: None,
				spreading_decay: None,
				max_results: None,
				bidirectional: None,
			}),
		);

		assert!(!results.is_empty());
		assert_eq!(results[0].index, 0);
	}

	// Location Intuitions tests

	#[test]
	fn test_location_familiarity() {
		// First access
		let f1 = location_compute_familiarity(1, None);
		assert!((f1 - 0.091).abs() < 0.01);

		// 10th access
		let f10 = location_compute_familiarity(10, None);
		assert!((f10 - 0.5).abs() < 0.01);

		// With custom config (faster learning)
		let config = JsLocationConfig {
			familiarity_k: Some(0.2), // 2x faster learning
			stale_threshold_days: None,
			max_decay_rate: None,
			decay_dampening: None,
			base_floor: None,
			sticky_bonus: None,
			well_known_threshold: None,
			task_same_activity_multiplier: None,
			task_diff_activity_multiplier: None,
			time_same_activity_multiplier: None,
			time_diff_activity_multiplier: None,
			backward_strength_factor: None,
		};
		// f(10) with k=0.2 = 1 - 1/(1 + 2) = 0.667 > 0.5
		let f10_fast = location_compute_familiarity(10, Some(config));
		assert!(f10_fast > f10); // Faster learning = higher familiarity at same count
	}

	#[test]
	fn test_location_infer_activity() {
		// Keyword inference
		let result = location_infer_activity("debugging the issue".to_string(), None, None);
		assert_eq!(result.activity_type, "debugging");
		assert_eq!(result.source, "keyword");

		// Tool inference
		let result =
			location_infer_activity("opening file".to_string(), Some("Read".to_string()), None);
		assert_eq!(result.activity_type, "reading");
		assert_eq!(result.source, "tool");

		// Explicit override
		let result = location_infer_activity(
			"reading code".to_string(),
			Some("Read".to_string()),
			Some("debugging".to_string()),
		);
		assert_eq!(result.activity_type, "debugging");
		assert_eq!(result.source, "explicit");
	}

	#[test]
	fn test_location_association_strength() {
		// Task + same activity = strongest
		let task_same = location_association_strength(1, true, true, None);
		let task_diff = location_association_strength(1, true, false, None);
		let time_same = location_association_strength(1, false, true, None);
		let time_diff = location_association_strength(1, false, false, None);

		assert!(task_same > task_diff);
		assert!(task_diff > time_same);
		assert!(time_same > time_diff);
	}

	#[test]
	fn test_location_is_well_known() {
		assert!(!location_is_well_known(0.5, None));
		assert!(!location_is_well_known(0.69, None));
		assert!(location_is_well_known(0.7, None));
		assert!(location_is_well_known(0.9, None));
	}

	#[test]
	fn test_location_get_associated() {
		let associations = vec![
			JsLocationAssociation {
				source: 0,
				target: 1,
				strength: 0.5,
				co_access_count: 5,
			},
			JsLocationAssociation {
				source: 0,
				target: 2,
				strength: 0.9,
				co_access_count: 10,
			},
			JsLocationAssociation {
				source: 0,
				target: 3,
				strength: 0.3,
				co_access_count: 3,
			},
		];

		let results = location_get_associated(0, associations, 10);

		assert_eq!(results.len(), 3);
		assert_eq!(results[0].location_id, 2); // Highest strength first
		assert_eq!(results[1].location_id, 1);
		assert_eq!(results[2].location_id, 3);
	}
}
