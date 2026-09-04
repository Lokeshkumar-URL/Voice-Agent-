import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const orchestrator = await readFile(
  new URL('../src/voice/realtime-conversation-orchestrator.js', import.meta.url),
  'utf8',
);
const voiceRoutes = await readFile(new URL('../src/voice/voice.routes.js', import.meta.url), 'utf8');
const proxy = await readFile(new URL('../../docs/production-openresty-websocket.conf', import.meta.url), 'utf8');

assert.match(orchestrator, /retrieveEvidence\(auth, normalTurnInput,/);
assert.doesNotMatch(orchestrator, /retrieveEvidence\(auth, engineInput,/);
assert.match(voiceRoutes, /voiceRouter\.post\(['"]\/answer['"]/);
assert.match(voiceRoutes, /createVoiceCallSession\(\{ call, runtimeProfile \}\)/);
assert.match(voiceRoutes, /returning Plivo stream XML/);
assert.match(proxy, /location \/webhooks\/plivo\/ \{/);
assert.match(proxy, /location \/webhooks\/plivo\/media \{/);

console.log(JSON.stringify({
  success: true,
  phoneAnswerWebhookProxied: true,
  phoneSessionCreationConnected: true,
  plivoMediaWebSocketProxied: true,
  retrievalReferenceErrorFixed: true,
}));
