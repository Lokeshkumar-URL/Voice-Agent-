import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createGroundedLlmOutput,
  groundedLlmOutputTypes,
} from '../src/knowledge-bases/normal-turn-contract.js';

const unavailable = createGroundedLlmOutput(groundedLlmOutputTypes.RESPONSE, {
  text: 'The requested information is unavailable.',
  selectedEvidenceIds: [],
  approvedInformationUnavailableResponse: true,
});

assert.equal(unavailable.approvedInformationUnavailableResponse, true);
assert.deepEqual(unavailable.selectedEvidenceIds, []);

assert.throws(() => createGroundedLlmOutput(groundedLlmOutputTypes.RESPONSE, {
  text: 'An unsupported answer.',
  selectedEvidenceIds: [],
}), (error) => error.code === 'LLM_GROUNDED_OUTPUT_INVALID');

const orchestrator = await readFile(
  new URL('../src/voice/realtime-conversation-orchestrator.js', import.meta.url),
  'utf8',
);
const unifiedTurn = await readFile(
  new URL('../src/voice/interaction/unified-grounded-turn.js', import.meta.url),
  'utf8',
);

assert.match(unifiedTurn, /approvedInformationUnavailableResponse:[\s\S]*approvedZeroEvidenceResponse/);
assert.match(orchestrator, /approvedInformationUnavailableResponse:[\s\S]*grounded\.approvedInformationUnavailableResponse/);
assert.match(orchestrator, /operationalFailure !== 'output_validation'/);
assert.match(orchestrator, /configuredOperationalFailureResponse\([\s\S]*validation: true/);

console.log(JSON.stringify({
  success: true,
  approvedUnavailableResponseAcceptedWithoutEvidence: true,
  unsupportedEvidenceFreeResponseRejected: true,
  outputValidationSeparatedFromProviderFailure: true,
}));
