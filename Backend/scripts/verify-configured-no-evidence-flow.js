import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  selectConfiguredNoEvidenceResponse,
} from '../src/voice/interaction/configured-no-evidence-response.js';
import { InterruptionCandidateManager } from '../src/voice/interruption/interruption-candidate-manager.js';
import {
  openIsolatedCallMemory,
  seedConfiguredQuestion,
} from '../src/knowledge-engine/call-memory.js';

const unavailable = 'Configured unavailable response. Continue?';
const clarification = 'Configured clarification response?';

const first = selectConfiguredNoEvidenceResponse({
  unavailableResponse: unavailable,
  clarificationResponse: clarification,
});
assert.equal(first.text, unavailable);
assert.equal(first.role, 'information_unavailable');
assert.equal(first.repeated, false);

const repeated = selectConfiguredNoEvidenceResponse({
  unavailableResponse: unavailable,
  clarificationResponse: clarification,
  previousSpeechIdentity: first.identity,
});
assert.equal(repeated.text, clarification);
assert.equal(repeated.role, 'clarification');
assert.equal(repeated.repeated, true);

const noConfiguredAlternative = selectConfiguredNoEvidenceResponse({
  unavailableResponse: unavailable,
  clarificationResponse: '',
  previousSpeechIdentity: first.identity,
});
assert.equal(noConfiguredAlternative.text, unavailable);
assert.equal(noConfiguredAlternative.repeated, false);

const memory = openIsolatedCallMemory({
  tenantId: randomUUID(), agentId: randomUUID(), callId: randomUUID(),
});
const pending = seedConfiguredQuestion(memory, unavailable, 'configured_response_question');
assert.equal(pending.key, 'configured_response_question');
assert.equal(pending.text, 'Continue?');
memory.close();

const acknowledgement = new InterruptionCandidateManager({
  configuration: {
    timeBased: { enabled: false, thresholdMs: 0 },
    wordBased: { enabled: true, minimumWords: 1 },
    acknowledgementPhrases: ['configured-affirmative'],
    explicitStopPhrases: [],
  },
});
assert.equal(
  acknowledgement.observeTranscript('configured-affirmative').classification,
  'acknowledgement',
);

const source = await readFile(
  new URL('../src/voice/realtime-conversation-orchestrator.js', import.meta.url),
  'utf8',
);
const normalizedSource = source.replace(/\r\n/gu, '\n');
const noEvidenceBranch = normalizedSource.indexOf('} else if (noVerifiedEvidence) {');
const llmBranch = normalizedSource.indexOf('} else {\n      try {', noEvidenceBranch);
assert.ok(noEvidenceBranch >= 0 && llmBranch > noEvidenceBranch,
  'the configured no-evidence response must be selected before LLM execution');
assert.match(source, /conversation\.pending_question_acknowledged/u);
assert.match(source, /conversation\.configured_response_question_seeded/u);
assert.match(source, /acknowledgedPendingQuestionIdentity/u);

console.log(JSON.stringify({
  success: true,
  configuredAcknowledgement: true,
  pendingQuestionPersistence: true,
  zeroEvidenceLlmBypass: true,
  repeatedFallbackProtection: true,
}));
