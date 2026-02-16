# Roadmap

Future directions for Lucid Memory, grounded in cognitive science and practical utility.

---

## 0.5.0 — Episodic Memory

**Status:** Shipped (2026-02-04)

Memories are currently individual items with associations. Episodic memory captures *sequences* of events with causal and temporal structure—the difference between knowing facts and remembering experiences.

### The Problem

```
User: "What did we do before fixing that auth bug?"
Claude: "I remember the auth bug fix, but I can't reconstruct the sequence..."
```

### The Solution

Link events within sessions into coherent episodes with temporal ordering:

```
User: "Walk me through how we refactored the auth system"
Claude: "First we identified the race condition in session refresh,
then extracted the token logic into a separate module, tested it
in isolation, and finally integrated it back with the mutex fix."
```

### Key Features

| Feature | Description |
|---------|-------------|
| Temporal chains | Events linked by before/after relationships |
| Causal binding | "X happened because of Y" relationships |
| Episode boundaries | Automatic detection of coherent work units |
| Narrative retrieval | Query for sequences, not just items |

### Neuroscience Basis

- **Tulving (1972)** — Episodic vs. semantic memory distinction
- **Howard & Kahana (2002)** — Temporal context model (TCM)
- **Eichenbaum (2000)** — Hippocampal role in sequence learning

### Implementation Notes

- Extends session tracking from 0.4.0
- New `episodes` table linking memories with temporal order
- Episode boundary detection (task switches, time gaps, explicit markers)
- Retrieval query: "what happened before/after X?"

### What Shipped

| Component | Details |
|-----------|---------|
| Episode lifecycle | Auto-creates episodes on `store()` with boundary detection (time gap >5min, >50 events, project switch) |
| Temporal links | Forward/backward links with TCM asymmetry (forward=1.0, backward=0.7) and distance decay |
| Temporal spreading | Integrated into `retrieve()` pipeline — top 5 seeds spread activation through episode links |
| Temporal queries | `retrieveTemporalNeighbors(anchor, direction)` for "before/after X" |
| MCP tool | `memory_narrative` — exposes temporal queries to Claude |
| Native performance | Rust `spreadTemporalActivation` + `findTemporalNeighbors` with TypeScript fallback |
| Config | `EpisodicMemoryConfig` with 9 tunable parameters |
| Tests | 16 new tests (163 total passing) |

---

## 0.5.1 — Native Embeddings

**Status:** Shipped (2026-02-07)

Replaced Ollama dependency with an in-process BGE-base-en-v1.5 embedding model via ONNX Runtime. Zero external services required for text/visual embeddings.

### What Shipped

| Component | Details |
|-----------|---------|
| ONNX inference | BGE-base-en-v1.5 FP16 via `ort` crate, 768-dim embeddings |
| Auto-migration | Detects Ollama/OpenAI embeddings, re-embeds with native model on startup |
| CLI status | `lucid status` shows pending migration count with time estimates |
| Installer fixes | HuggingFace CDN downloads, partial download protection, no Ollama dependency |
| Tests | 27 new embedding migration tests (190 total passing) |

---

## 0.6.0 — Memory Consolidation

**Status:** Shipped (2026-02-15)

Lucid Memory is now a self-maintaining memory system. Background consolidation runs during idle time, implementing the two-window consolidation model (Stickgold & Walker 2013) with reconsolidation support.

### The Problem

- Weak memories persist indefinitely, cluttering retrieval
- Strong patterns aren't extracted into generalized knowledge
- No distinction between "I saw this once" and "I've learned this"

### The Solution

Background consolidation during idle time:

| Phase | Action |
|-------|--------|
| Strengthening | Recently accessed memories get encoding boosts |
| Pruning | Low-value memories, associations, and visuals decay and get pruned |
| State transitions | `fresh → consolidating → consolidated` with time-based windows |
| Reconsolidation | Similar new content updates existing traces instead of duplicating |

### Neuroscience Basis

- **Stickgold & Walker (2013)** — Sleep-dependent memory consolidation
- **McClelland et al. (1995)** — Complementary learning systems
- **Frankland & Bontempi (2005)** — Systems consolidation theory
- **Nader et al. (2000)** — Reconsolidation: retrieved memories become labile

### What Shipped

| Component | Details |
|-----------|---------|
| Two-window consolidation | Micro (5 min): strengthen recent, decay stale, decay associations. Full (1 hr): state transitions, prune associations/memories/visuals/contexts |
| Reconsolidation | PE zone routing: low=reinforce, moderate=reconsolidate, high=new trace. Dual-sigmoid model with age/use modulated thresholds |
| PRP encoding | High-importance stores activate 90-min protein synthesis window that boosts subsequent encoding |
| Association lifecycle | Exponential decay, co-retrieval reinforcement, threshold-based pruning |
| Instance noise | Per-memory noise scaled by encoding strength |
| Visual pruning | Rust `visualShouldPrune` in full consolidation cycle |
| Session management | Graceful shutdown, background session pruning, `touchSession` wiring |
| 5-gate audit | 25 tsc errors fixed, 6 storage methods wired, 7 NAPI functions wired, 13 methods made private |
| MCP tools | `visual_delete`, `memory_consolidation_status` |
| Tests | 307 total (92 Rust + 215 TS), 0 failures, 0 tsc errors |

---

## 0.7.0 — Encoding Specificity & Context Matching

**Status:** Planned

Retrieval currently ignores encoding context. Encoding specificity (Tulving 1983) predicts that memory retrieval is best when the retrieval context matches the encoding context.

### The Problem

```
User: "Find memories about the config system"
Claude: [Returns all config-related memories equally]

# But if Claude encoded a memory while debugging auth...
Claude: [Should boost that memory when debugging auth again]
```

### The Solution

Match retrieval context against encoding context:

```typescript
retrieve(probe, {
  context: { activity: "debugging", project: "auth-service" },
  // Boosts memories encoded in similar contexts
})
```

### Key Features

| Feature | Description |
|---------|-------------|
| Encoding context | Activity type, project, emotional state stored at encoding time |
| Context matching | Retrieval context compared against encoding context |
| Specificity boost | Matching contexts increase retrieval probability |
| `context_mismatch` fix | Benchmark scenario currently at 0% — this is the target |

### Neuroscience Basis

- **Tulving (1983)** — Encoding specificity principle
- **Godden & Baddeley (1975)** — Context-dependent memory
- **Smith & Vela (2001)** — Environmental context and memory

### Implementation Notes

- `encoding_context` column already populated by 0.6.0's `storeMemory`
- `EncodingSpecificityConfig` already defined in config.ts
- Context matching added to retrieval pipeline activation computation
- Target: `context_mismatch` benchmark scenario from 0% to 80%+

---

## 0.8.0 — Meta-Memory (Feeling of Knowing)

**Status:** Planned

Confidence calibration for retrieval results—knowing what you know vs. what you're uncertain about.

### The Problem

```
Claude: "The auth handler is in src/auth/handler.ts"
# But is Claude certain, or guessing from partial information?
```

### The Solution

Retrieval returns confidence alongside results:

| Confidence | Signal | Behavior |
|------------|--------|----------|
| High (>0.8) | Multiple strong traces, recent access | State with confidence |
| Medium (0.4-0.8) | Single trace or older access | Qualify with uncertainty |
| Low (<0.4) | Weak/partial matches | Suggest verification |

### Key Features

| Feature | Description |
|---------|-------------|
| Confidence scores | Per-result certainty estimation |
| Source attribution | "I remember this from session X" |
| Uncertainty communication | Natural language hedging |
| Verification prompts | "I'm not certain—should I check?" |

### Neuroscience Basis

- **Metcalfe & Shimamura (1994)** — Metacognition and memory
- **Koriat (1993)** — Feeling of knowing judgments
- **Nelson & Narens (1990)** — Metamemory framework

### Implementation Notes

- Confidence from: trace count, activation strength, recency, consistency
- Calibration: track prediction accuracy over time
- UI: confidence indicators in retrieval results
- Threshold for "I should verify this" suggestions

---

## Future Explorations

Features under consideration for later releases:

### Prospective Memory
"Remember to X when Y happens" — memory for future intentions.
- Deferred tasks triggered by context
- "Remind me to update the tests when I touch auth"

### Interference & Active Forgetting
Similar memories compete; losers are actively suppressed.
- Retrieval-induced forgetting
- More aggressive pruning of redundant traces

### Multi-Agent Memory Sharing
Share memory traces across Claude instances.
- Team knowledge base
- Privacy-preserving memory federation

### Emotional Regulation
Modulate emotional weights based on outcomes.
- Success → positive emotional binding
- Failure → reconsolidation opportunity

---

## Contributing

Interested in working on any of these features? See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

The cognitive science foundations are as important as the code—we welcome contributions to both the implementation and the theoretical grounding.

---

## References

### Episodic Memory
- Tulving, E. (1972). Episodic and semantic memory. In E. Tulving & W. Donaldson (Eds.), *Organization of Memory*
- Howard, M. W., & Kahana, M. J. (2002). A distributed representation of temporal context. *Journal of Mathematical Psychology*, 46(3), 269-299.
- Eichenbaum, H. (2000). A cortical-hippocampal system for declarative memory. *Nature Reviews Neuroscience*, 1(1), 41-50.

### Memory Consolidation
- Stickgold, R., & Walker, M. P. (2013). Sleep-dependent memory triage. *Nature Neuroscience*, 16(2), 139-145.
- McClelland, J. L., McNaughton, B. L., & O'Reilly, R. C. (1995). Why there are complementary learning systems. *Psychological Review*, 102(3), 419-457.
- Frankland, P. W., & Bontempi, B. (2005). The organization of recent and remote memories. *Nature Reviews Neuroscience*, 6(2), 119-130.

### Goal-Directed Cognition
- Miller, E. K., & Cohen, J. D. (2001). An integrative theory of prefrontal cortex function. *Annual Review of Neuroscience*, 24(1), 167-202.
- Desimone, R., & Duncan, J. (1995). Neural mechanisms of selective visual attention. *Annual Review of Neuroscience*, 18(1), 193-222.
- Botvinick, M. M., Braver, T. S., Barch, D. M., Carter, C. S., & Cohen, J. D. (2001). Conflict monitoring and cognitive control. *Psychological Review*, 108(3), 624-652.

### Meta-Memory
- Metcalfe, J., & Shimamura, A. P. (1994). *Metacognition: Knowing about knowing*. MIT Press.
- Koriat, A. (1993). How do we know that we know? The accessibility model of the feeling of knowing. *Psychological Review*, 100(4), 609-639.
- Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings. *Psychology of Learning and Motivation*, 26, 125-173.
