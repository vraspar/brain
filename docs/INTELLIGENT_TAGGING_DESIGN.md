# Intelligent Tagging Design

## Problem

Brain's auto-tagging uses a 56-term hardcoded dictionary (`KNOWN_TECH_TERMS` in `src/utils/tags.ts`). It matches keywords like "docker" and "kubernetes" but cannot discover domain-specific terms, extract multi-word concepts, or understand what makes an entry distinctive within the corpus. The relationship system in `src/core/links.ts` uses 4 shallow heuristic signals (shared tags, title overlap, same author, content cross-reference) that miss meaningful connections between entries with different vocabulary.

Example: a deployment guide about "payment service" gets tagged `docker` but not `payments`, `deployment-pipeline`, or `microservices`. Two entries about Redis timeouts and connection pooling aren't linked because they share no tags or title words.

## Research summary

Two independent research tracks converged on the same conclusion: replace keyword matching with corpus-aware statistical extraction.

**Architect research** (42K words): Proposed a tiered intelligence system with TF-IDF as the foundation, markdown-aware tokenization with zone weighting, bigram detection via PMI, tag co-occurrence clustering via Louvain algorithm, and optional embedding/LLM tiers.

**Radical Thinker research**: Proposed a three-layer system: RAKE keyphrase extraction (per-document, no corpus needed), entity extraction (regex-based), and TF-IDF cosine similarity (corpus-aware linking). Argued for dropping the "same author" signal as noise, not signal.

Both approaches require zero new dependencies for the core implementation.

## Chosen approach

Combine both proposals into a unified system:

1. **RAKE** for per-document keyphrase extraction (discovers multi-word concepts without a corpus)
2. **TF-IDF with zone weighting** for corpus-aware tag scoring (terms that are distinctive to an entry score higher)
3. **Entity extraction** for structured elements (CLI commands, file paths, URLs, tools)
4. **TF-IDF cosine similarity** replaces the 4-signal heuristic linker
5. **Louvain clustering** on tag co-occurrence for auto-discovered topic groups

Optional tiers for teams that want deeper intelligence:
- **Tier 2**: Local embeddings via `@xenova/transformers` (all-MiniLM-L6-v2, 384-dim)
- **Tier 3**: LLM tagging via OpenAI/Anthropic/Ollama APIs

## Architecture

### Module structure

```
src/intelligence/
├── tokenizer.ts        # Markdown zone extraction + weighted tokens
├── stopwords.ts        # 200 English + 50 code + 20 markdown stopwords
├── tfidf.ts            # Corpus index: build/query/IDF computation
├── bigrams.ts          # PMI detection + known compounds dictionary (~200 terms)
├── rake.ts             # RAKE keyphrase extraction (~60 lines)
├── entities.ts         # Regex extraction: commands, paths, URLs, tools
├── tag-extractor.ts    # Orchestrator: tokenize -> TF-IDF -> bigrams -> rank
├── similarity.ts       # TF-IDF vector cosine similarity for linking
├── clusters.ts         # Louvain community detection for topic groups
└── types.ts            # Shared interfaces
```

### SQLite schema additions

```sql
-- Corpus statistics for IDF computation
CREATE TABLE IF NOT EXISTS corpus_stats (
  term TEXT PRIMARY KEY,
  doc_frequency INTEGER NOT NULL,
  total_occurrences INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS corpus_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- e.g. ('doc_count', '523'), ('last_rebuilt', '2026-03-27T22:00:00Z')
);

-- Tag co-occurrence for clustering
CREATE TABLE IF NOT EXISTS tag_cooccurrence (
  tag_a TEXT NOT NULL,
  tag_b TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tag_a, tag_b)
);

-- Auto-discovered topic groups
CREATE TABLE IF NOT EXISTS topic_clusters (
  tag TEXT PRIMARY KEY,
  cluster_id INTEGER NOT NULL,
  cluster_label TEXT
);

-- Structured entities extracted from entries
CREATE TABLE IF NOT EXISTS entry_entities (
  entry_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,  -- 'command', 'path', 'url', 'tool'
  entity_value TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id)
);
CREATE INDEX IF NOT EXISTS idx_entity_value ON entry_entities(entity_value);
```

### Zone weighting

Markdown content is tokenized with awareness of document structure. Tokens from different zones receive different weight multipliers:

| Zone | Weight | Rationale |
|------|--------|-----------|
| Title | 3x | Strongest signal for what the entry is about |
| Headings (H2-H6) | 2x | Section topics |
| Code blocks | 1.5x | Technical terms in context |
| Inline code / bold | 1.5x | Emphasized terms |
| Body text | 1x | Baseline |

### Tag extraction pipeline

```
Input: markdown content + title
  |
  v
1. Tokenize with zone awareness -> WeightedToken[]
2. RAKE: extract keyphrases from raw text -> Keyphrase[]
3. TF-IDF: score tokens against corpus IDF -> scored terms
4. Bigrams: detect compound terms (PMI + known dict) -> boost compounds
5. Merge RAKE keyphrases + TF-IDF top terms
6. Rank by combined score, take top 8
  |
  v
Output: TagResult[] with tag, score, source
```

### Relationship scoring (replaces links.ts heuristics)

| Signal | Weight | Cap | Notes |
|--------|--------|-----|-------|
| TF-IDF cosine similarity | 0.3 * sim | 0.3 | Primary signal, replaces keyword overlap |
| Shared tags | 0.15/tag | 0.5 | Reduced from current 0.6 |
| Title keyword overlap | 0.15/word | 0.25 | Reduced from current 0.3 |
| Content cross-reference | 0.2/direction | 0.4 | Explicit mentions of entry ID/title |
| Topic cluster match | 0.1 | 0.1 | Entries in same Louvain cluster |
| Entity overlap | boost | 0.15 | Shared commands, paths, tools |

Same author signal dropped (noise, not content signal). Threshold remains 0.2.

## Formulas

**TF-IDF:**
```
TF(t, d) = count(t in d) / total_words(d)
IDF(t, D) = log(|D| / docs_containing(t))
TF-IDF(t, d, D) = TF(t, d) * IDF(t, D)
```

**RAKE phrase scoring:**
```
score(phrase) = degree(phrase) / frequency(phrase)
```
where degree = sum of word co-occurrence degrees within the phrase.

**Pointwise Mutual Information (compound detection):**
```
PMI(w1, w2) = log(P(w1, w2) / (P(w1) * P(w2)))
```

**Cosine similarity:**
```
sim(A, B) = dot(A, B) / (|A| * |B|)
```

## Tiered design

### Tier 1: Zero dependencies (always active)

- TF-IDF with zone-weighted tokenization
- RAKE keyphrase extraction
- Bigram/compound detection (PMI + known dictionary)
- Entity extraction (regex)
- Tag co-occurrence + Louvain clustering
- TF-IDF cosine similarity for relationships
- Corpus index in SQLite

### Tier 2: Local embeddings (optional, ~40MB model)

- `@xenova/transformers` with all-MiniLM-L6-v2 (384-dim vectors)
- Semantic similarity scoring for relationships
- ~80ms per entry, incremental updates
- Enable: `brain config set intelligence.embeddings true`
- Adds a 0.4 * sim signal (capped at 0.4) to relationship scoring

### Tier 3: LLM tagging (optional, API key required)

- OpenAI, Anthropic, or local Ollama
- LLM-generated tags merged with Tier 1 tags (2x weight boost)
- 1-3s latency per entry
- Enable: `brain config set intelligence.llm.provider openai`

Tier interaction: each tier's output feeds into the next. Final tags are the merged, ranked result of all active tiers.

## Implementation plan

| Phase | Component | Effort | Priority |
|-------|-----------|--------|----------|
| 1 | RAKE keyphrase extraction | ~3 hrs | P0 |
| 2 | TF-IDF + zone-weighted tokenizer | ~3 hrs | P0 |
| 3 | Entity extraction (regex) | ~2 hrs | P1 |
| 4 | TF-IDF cosine similarity for linking | ~2 hrs | P1 |
| 5 | Louvain clustering | ~2 hrs | P1 |
| 6 | Integration: push/ingest/sync pipelines | ~1 hr | P0 |
| **Total Tier 1** | | **~13 hrs** | |
| 7 | Tier 2: Local embeddings | ~4 hrs | P2 |
| 8 | Tier 3: LLM tagging | ~3 hrs | P2 |

## Performance budget

| Operation | Target | Estimated |
|-----------|--------|-----------|
| Tag extraction (1 entry) | <5ms | ~2ms |
| Corpus build (500 entries) | <500ms | ~100ms |
| Corpus build (5000 entries) | <2s | ~800ms |
| Louvain clustering | <50ms | ~10ms |
| Tier 2 embed (1 entry) | <200ms | ~80ms |

## Backward compatibility

- Existing tags in frontmatter are preserved
- Intelligent extraction only applies when no tags are present or when explicitly requested
- The 56-term dictionary stays as a fallback for entries that fail extraction
- No surprising changes on `brain sync`

## Open questions

1. **Tag limit**: Current cap is 5. Proposed increase to 8 with adaptive scoring (always include >0.5, up to 8 if >0.1). Needs UX testing.
2. **RAKE vs TextRank**: RAKE is simpler (~60 lines) but TextRank may extract more precise keyphrases. Defer TextRank to V2 if RAKE precision is insufficient.
3. **Corpus rebuild frequency**: Full rebuild on sync, incremental on push. At 5000 entries, O(n^2) pairwise comparison takes ~2 minutes. Consider caching and delta updates.
4. **Stopword list scope**: 200 English + 50 code + 20 markdown. May need tuning per team's domain.

## Critical reviewer concerns

1. **Complexity budget**: Adding `src/intelligence/` (8 files) is a large surface area. Response: each file is small (50-120 lines), well-bounded, and independently testable. The module is isolated from core.
2. **Performance at scale**: O(n^2) pairwise comparison for 5000 entries. Response: mitigated by incremental updates on push (only new entry vs existing), full rebuild only on sync.
3. **BM25 confusion**: BM25 is for search (query vs documents). TF-IDF is for tagging (term distinctiveness within a document). Different use cases, both appropriate.
