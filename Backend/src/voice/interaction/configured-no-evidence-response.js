export function runtimeMessageIdentity(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function isInternalRuntimeText(value) {
  const text = runtimeMessageIdentity(value);
  if (!text) return true;
  return /(?:runtime_context|grounded_response_contract|response_mode|action_config|selectedentitykeys|evidencesourceids|flowaction|catalog_item_required)/iu.test(text)
    || /\bstart or resume the configured\b/iu.test(text)
    || /\buse (?:only )?the configured\b/iu.test(text)
    || /^\s*(?:instruction|action|workflow|response)\s*:/iu.test(text);
}

export function selectConfiguredNoEvidenceResponse({
  unavailableResponse,
  clarificationResponse,
  previousSpeechIdentity = '',
} = {}) {
  const unavailable = String(unavailableResponse ?? '').trim();
  const clarification = String(clarificationResponse ?? '').trim();
  const unavailableIdentity = runtimeMessageIdentity(unavailable);
  const clarificationIdentity = runtimeMessageIdentity(clarification);
  const repeated = Boolean(unavailableIdentity
    && unavailableIdentity === runtimeMessageIdentity(previousSpeechIdentity));
  const useClarification = Boolean(repeated
    && clarificationIdentity
    && clarificationIdentity !== unavailableIdentity
    && !isInternalRuntimeText(clarification));
  const text = useClarification ? clarification : unavailable;
  return Object.freeze({
    text,
    role: useClarification ? 'clarification' : 'information_unavailable',
    identity: runtimeMessageIdentity(text),
    repeated: useClarification,
  });
}
