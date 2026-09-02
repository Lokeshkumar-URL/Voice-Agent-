/**
 * Numeric Claim Validator
 *
 * After the grounded LLM generates a response, this module extracts all
 * numeric claims (prices, percentages, phone numbers, counts) and verifies
 * each one appears verbatim in at least one of the authoritative evidence
 * records that were given to the LLM.
 *
 * This prevents price hallucination: if the LLM says "₹45,000" but the
 * evidence records only contain "₹42,000", the validation fails and the
 * response is rejected or sanitized before TTS.
 *
 * Design rules:
 *  - Only numeric patterns are validated. Non-numeric claims (names, dates
 *    without digit-heavy format) pass without check.
 *  - Phone numbers are excluded because they are contact info, not evidence
 *    claims, and may come from agent-level config rather than evidence.
 *  - A claim that appears in ANY of the five evidence records passes.
 *  - Reserved records (contextual memory) are included as valid sources.
 *  - The validator never modifies the response text; it only returns a
 *    validation result that the caller can act on.
 */

// Regex patterns for claim types we validate strictly.
// Each pattern must have a named capture group `value` containing the
// numeric portion for source comparison.
const PRICE_PATTERN = /(?:₹|rs\.?|inr|\$|usd)\s*(?<value>[\d,]+(?:\.\d{1,2})?)|(?<value2>[\d,]+(?:\.\d{1,2})?)\s*(?:inr|usd)/giu;
const PERCENTAGE_PATTERN = /(?<value>[\d]+(?:\.\d{1,2})?)\s*%/gu;
// Counts and standalone numbers ≥ 3 digits that look like amounts
const AMOUNT_PATTERN = /\b(?<value>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{4,}(?:\.\d{1,2})?)\b/gu;

function normalizeNumeric(value) {
  return String(value ?? '').replace(/[,\s]/gu, '').trim().toLocaleLowerCase();
}

function extractNumericClaims(text) {
  const claims = new Set();
  const normalized = String(text ?? '');
  for (const pattern of [PRICE_PATTERN, PERCENTAGE_PATTERN, AMOUNT_PATTERN]) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = pattern.exec(normalized)) !== null) {
      const raw = match.groups?.value ?? match.groups?.value2 ?? '';
      const n = normalizeNumeric(raw);
      if (n && n.length >= 2) claims.add(n);
    }
  }
  return claims;
}

function evidenceSourceText(evidenceRecords) {
  return evidenceRecords.flatMap((record) => {
    const parts = [];
    // Primary content block
    if (record.content) parts.push(record.content);
    // Authoritative data fields that may contain numeric info
    const data = record.authoritativeData ?? {};
    if (data.price != null) parts.push(String(data.price));
    if (data.answer) parts.push(data.answer);
    if (data.content) parts.push(data.content);
    if (data.responseTemplate) parts.push(data.responseTemplate);
    // Attributes array (catalog items)
    for (const attr of data.attributes ?? []) {
      if (attr.value != null) parts.push(String(attr.value));
    }
    // Children of a category
    for (const child of data.children ?? []) {
      if (child.price != null) parts.push(String(child.price));
      if (child.name) parts.push(child.name);
    }
    return parts;
  }).join(' ');
}

/**
 * Validates that every numeric claim in `responseText` is traceable to at
 * least one of the `evidenceRecords` returned by the authoritative hydration.
 *
 * @param {string} responseText — the LLM-generated response to validate
 * @param {ReadonlyArray} evidenceRecords — hydrated evidence records (≤5)
 * @returns {{
 *   valid: boolean,
 *   unsourcedClaims: string[],
 *   checkedClaims: string[],
 *   evidenceSnippet: string,
 * }}
 */
export function validateNumericClaims(responseText, evidenceRecords) {
  if (!responseText || !evidenceRecords?.length) {
    return Object.freeze({
      valid: true,
      unsourcedClaims: [],
      checkedClaims: [],
      evidenceSnippet: '',
    });
  }

  const claims = extractNumericClaims(responseText);
  if (!claims.size) {
    return Object.freeze({
      valid: true,
      unsourcedClaims: [],
      checkedClaims: [],
      evidenceSnippet: '',
    });
  }

  const evidenceText = evidenceSourceText(evidenceRecords);
  const evidenceNumbers = extractNumericClaims(evidenceText);

  const checkedClaims = [...claims];
  const unsourcedClaims = checkedClaims.filter((claim) => !evidenceNumbers.has(claim));

  return Object.freeze({
    valid: unsourcedClaims.length === 0,
    unsourcedClaims: Object.freeze(unsourcedClaims),
    checkedClaims: Object.freeze(checkedClaims),
    // Short snippet for debug logging (do not log full evidence in production)
    evidenceSnippet: evidenceText.slice(0, 400),
  });
}

/**
 * Sanitizes the LLM response by stripping sentences that contain
 * unsourced numeric claims. Falls back to an empty string if all
 * sentences are removed (caller should use the fallback response).
 *
 * @param {string} responseText
 * @param {ReadonlyArray} unsourcedClaims — from validateNumericClaims()
 * @returns {string} sanitized response text
 */
export function sanitizeUnsourcedNumericClaims(responseText, unsourcedClaims) {
  if (!unsourcedClaims?.length) return responseText;
  // Split into sentences by period, exclamation, or question mark.
  const sentences = String(responseText ?? '').split(/(?<=[.!?])\s+/u);
  const filtered = sentences.filter((sentence) => {
    const sentenceNumbers = extractNumericClaims(sentence);
    return ![...sentenceNumbers].some((n) => unsourcedClaims.includes(n));
  });
  return filtered.join(' ').trim();
}
