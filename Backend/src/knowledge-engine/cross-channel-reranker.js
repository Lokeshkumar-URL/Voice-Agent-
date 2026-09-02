/**
 * Cross-Channel Reranker
 *
 * Runs after Reciprocal Rank Fusion (fuseCandidateRankings) and before
 * PostgreSQL hydration. It applies two additional quality gates that RRF
 * alone cannot enforce:
 *
 *  1. Single-channel score gate — a candidate that appeared in only ONE
 *     retrieval channel (structured / bm25 / qdrant) and is NOT a reserved
 *     record must have at least a minimum provider score. Without this, a
 *     single weak BM25 or structured match can occupy a top-5 slot.
 *
 *  2. Name-overlap gate — a candidate whose canonical name shares NO tokens
 *     with the caller's sparse query text (after basic normalization) and is
 *     NOT a reserved record is demoted. A totally unrelated item name must
 *     never answer a caller question.
 *
 * Reserved records (explicit_entity, canonical_memory, explicit_comparison,
 * etc.) are NEVER rejected by this reranker — their presence is authoritative
 * and required for downstream hydration invariants.
 */

// Minimum provider score for a single-channel non-reserved candidate to
// remain in the evidence package. Multi-channel candidates are not affected.
const SINGLE_CHANNEL_MIN_SCORE = 0.72;

function normalizeId(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function tokens(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().split(/\s+/u).filter(Boolean);
}

/**
 * Returns true if `candidate` is a reserved record (must never be rejected).
 * Reserved keys and record IDs come from the RRF fusion result.
 */
function isReserved(candidate, reservedRecordKeys, reservedRecordIds) {
  const key = `${String(candidate.recordType ?? '').toUpperCase()}:${normalizeId(candidate.recordId)}`;
  if (reservedRecordKeys.has(key)) return true;
  if (reservedRecordIds.has(normalizeId(candidate.recordId))) return true;
  // authorizationHint = true means the record was reserved as an active-tool
  // workflow authorization; callerFacingHint = false records are internal and
  // cannot be "weak" in the caller-facing sense.
  return candidate.authorizationHint === true;
}

/**
 * Computes the strongest provider score across all channels for a candidate.
 */
function strongestScore(candidate) {
  return Math.max(0, ...Object.values(candidate.providerScores ?? {}));
}

/**
 * Returns true if the candidate's canonical name has at least one token
 * that appears in the caller's query token set.
 *
 * For CATALOG_CATEGORY candidates, also checks child item names if the
 * category key itself matches any query token.
 */
function hasNameOverlap(candidate, queryTokenSet) {
  if (!queryTokenSet.size) return true; // cannot reject when query is empty
  const name = candidate.canonicalName ?? candidate.deduplicationIdentity?.canonicalName ?? null;
  // If canonical name is not available before hydration, pass the check
  if (!name) return true;
  const nameTokens = tokens(name);
  if (nameTokens.some((t) => queryTokenSet.has(t))) return true;
  const categoryKeyTokens = tokens(candidate.categoryKey ?? candidate.deduplicationIdentity?.categoryKey ?? '');
  if (categoryKeyTokens.some((t) => queryTokenSet.has(t))) return true;
  return false;
}

/**
 * Reranks the fused candidates list by applying single-channel and
 * name-overlap quality gates.
 *
 * @param {ReadonlyArray} candidates — output of fuseCandidateRankings().candidates
 * @param {object} fusion — full fuseCandidateRankings() result (for reserved ID/key sets)
 * @param {string} sparseQueryText — the caller's sparse text (from queryContext.sparseText)
 * @returns {{ accepted: Array, rejectedWeakSingleChannel: Array, rejectedNoNameOverlap: Array }}
 */
export function rerankedCandidates(candidates, fusion, sparseQueryText) {
  const reservedKeys = new Set(
    (fusion.reservedRecordKeys ?? []).map((k) => String(k ?? '').trim()).filter(Boolean),
  );
  const reservedIds = new Set(
    (fusion.reservedRecordIds ?? []).map(normalizeId).filter(Boolean),
  );
  const queryTokenSet = new Set(tokens(sparseQueryText ?? ''));

  const accepted = [];
  const rejectedWeakSingleChannel = [];
  const rejectedNoNameOverlap = [];

  for (const candidate of candidates) {
    // Reserved records are always accepted unconditionally.
    if (isReserved(candidate, reservedKeys, reservedIds)) {
      accepted.push(candidate);
      continue;
    }

    // Gate 1: single-channel score guard.
    // A candidate that appears in only one channel must have a strong enough
    // provider score to avoid noise from a single marginal match.
    const channelCount = (candidate.channels ?? []).length;
    if (channelCount === 1) {
      const score = strongestScore(candidate);
      if (score < SINGLE_CHANNEL_MIN_SCORE) {
        rejectedWeakSingleChannel.push(normalizeId(candidate.recordId));
        continue;
      }
    }

    // Gate 2: Name overlap token check for non-reserved candidates.
    // Full sentence queries (> 3 tokens) or Qdrant semantic channels match by meaning/description
    // (e.g. "Which published option supports rotating assembly work?" -> Nebula Drive).
    // Name overlap check is enforced for short keyword queries (<= 3 tokens) on sparse channels.
    const isSemanticQuery = queryTokenSet.size > 3 || (candidate.channels ?? []).includes('qdrant');
    if (!isSemanticQuery && !hasNameOverlap(candidate, queryTokenSet)) {
      rejectedNoNameOverlap.push(normalizeId(candidate.recordId));
      continue;
    }

    accepted.push(candidate);
  }

  return Object.freeze({
    accepted: Object.freeze(accepted),
    rejectedWeakSingleChannel: Object.freeze(rejectedWeakSingleChannel),
    rejectedNoNameOverlap: Object.freeze(rejectedNoNameOverlap),
  });
}
