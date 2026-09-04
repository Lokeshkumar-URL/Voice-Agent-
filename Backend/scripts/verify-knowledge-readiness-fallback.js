import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimeSource = await readFile(
  new URL('../src/knowledge-engine/runtime-service.js', import.meta.url),
  'utf8',
);
const orchestratorSource = await readFile(
  new URL('../src/voice/realtime-conversation-orchestrator.js', import.meta.url),
  'utf8',
);
const providerConfigurationSource = await readFile(
  new URL('../src/voice/providers/provider-config.js', import.meta.url),
  'utf8',
);

const activePublicationQuery = runtimeSource.slice(
  runtimeSource.indexOf('const activePublicationSql'),
  runtimeSource.indexOf('const defaults'),
);

assert.doesNotMatch(activePublicationQuery, /knowledge_processing_jobs/,
  'Published assignments must remain discoverable when an index recovery is needed');
assert.match(orchestratorSource, /this\.knowledgeReadinessPromise = readinessPromise/,
  'Knowledge readiness must run without blocking voice startup');
assert.match(orchestratorSource, /Knowledge publication recovery is pending; voice runtime will continue safely/,
  'Knowledge readiness failures must degrade safely instead of ending calls');
assert.doesNotMatch(orchestratorSource, /const readiness = await ensureKnowledgeReady/,
  'Voice startup must not wait for knowledge artifact recovery');
const assignedKnowledgeQuery = providerConfigurationSource.slice(
  providerConfigurationSource.indexOf("'semanticReady', EXISTS"),
  providerConfigurationSource.indexOf("), '[]'::jsonb) knowledge_bases"),
);
assert.equal((assignedKnowledgeQuery.match(/knowledge_processing_jobs/g) ?? []).length, 1,
  'Runtime profiles must report readiness without filtering out recoverable published assignments');

console.log('Knowledge readiness fallback verified successfully.');
