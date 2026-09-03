import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RealtimeConversationOrchestrator } from '../src/voice/realtime-conversation-orchestrator.js';

globalThis.fetch = async () => new Response(JSON.stringify({ success: true, status: 'success', message: 'Booked' }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const waitFor = async (predicate, message, timeoutMs = 5000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

class FakeMediaSession extends EventEmitter {
  constructor() {
    super();
    this.callId = 'call-1';
    this.started = true;
    this.closed = false;
    this.call = {
      id: 'call-1', providerCallId: 'plivo-1', agentId: 'agent-1', tenantId: 'tenant-1',
      workspaceId: 'workspace-1', direction: 'inbound', from: '+919000000001', to: '+918000000001',
    };
    this.log = { info() {}, warn() {}, error() {}, debug() {} };
  }
  close(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.emit('closed', { session: this, code, reason });
  }
}

class FakeStt {
  listeners = new Set();
  sent = [];
  async connect() { this.connected = true; }
  sendAudio(value) { this.sent.push(value); }
  flush() { this.flushed = true; }
  cancel() {}
  close() { this.closed = true; }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async *events() {}
  publish(event) { for (const listener of this.listeners) listener(event); }
}

class FakeLlm {
  requests = [];
  cancelled = 0;
  releaseSlow = null;
  releaseSecondSentence = null;
  async *stream(input) {
    this.requests.push(input);
    const query = input.messages.at(-1)?.content ?? '';
    yield { type: 'response_started' };
    if (query === 'slow request') {
      await new Promise((resolve) => { this.releaseSlow = resolve; });
      if (this.wasCancelled) { yield { type: 'cancelled', reason: 'barge-in' }; return; }
    }
    if (query === 'stream two sentences') {
      yield { type: 'text_delta', delta: JSON.stringify({ decision: 'RESPONSE', answer: 'The first sentence is ready. The second sentence follows.', responseId: null, evidenceIds: ['source_1'] }) };
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 10, totalTokens: 22 } };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    if (query === 'group short sentences') {
      yield { type: 'text_delta', delta: JSON.stringify({ decision: 'RESPONSE', answer: 'First sentence starts now. Second short sentence. Third short sentence.', responseId: null, evidenceIds: ['source_1'] }) };
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 12, totalTokens: 24 } };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    if (query === 'verify ordered lookahead') {
      yield { type: 'text_delta', delta: '{"decision":"RESPONSE","answer":"First sentence plays directly. ' };
      yield { type: 'text_delta', delta: 'Second look-ahead sentence. ' };
      yield { type: 'text_delta', delta: 'Third look-ahead sentence. ' };
      yield { type: 'text_delta', delta: 'Fourth look-ahead sentence. ' };
      yield { type: 'text_delta', delta: 'Fifth look-ahead sentence.","responseId":null,"evidenceIds":["source_1"]}' };
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 20, totalTokens: 32 } };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    if (query === 'interrupt buffered speech') {
      yield { type: 'text_delta', delta: JSON.stringify({ decision: 'RESPONSE', answer: 'Immediate sentence plays first. Buffered sentence two. Buffered sentence three. Buffered sentence four. Buffered sentence five. Buffered sentence six. Buffered sentence seven.', responseId: null, evidenceIds: ['source_1'] }) };
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 24, totalTokens: 36 } };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    if (query === 'recover failed lookahead') {
      yield { type: 'text_delta', delta: JSON.stringify({ decision: 'RESPONSE', answer: 'The first protected sentence is spoken normally. This isolated look-ahead failure sentence intentionally contains enough descriptive words to exceed the short sentence grouping threshold and verify fallback playback.', responseId: null, evidenceIds: ['source_1'] }) };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    if (query === 'isolate permanent sentence failure') {
      yield { type: 'text_delta', delta: JSON.stringify({ decision: 'RESPONSE', answer: 'The valid sentence must remain audible. This permanent sentence failure intentionally contains enough descriptive words to exceed the short sentence grouping threshold without being played. The later valid sentence must still play after the isolated failure and remain part of the same response.', responseId: null, evidenceIds: ['source_1'] }) };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    if (query.includes('book appointment') || query === 'yes') {
      const toolDecision = JSON.stringify({
        decision: 'TOOL',
        answer: '',
        responseId: null,
        evidenceIds: ['source_1'],
        toolName: 'book_visit',
        toolArguments: JSON.stringify({ date: 'tomorrow' }),
        clarificationReason: null,
      });
      yield { type: 'text_delta', delta: toolDecision };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    const isEndCall = query.includes('End the call now') || query.includes('finish this conversation') || query.includes('Goodbye') || query === 'goodbye now';
    if (isEndCall) {
      const hangupJson = JSON.stringify({
        decision: 'RESPONSE',
        answer: 'Thank you. Goodbye.',
        responseId: null,
        evidenceIds: ['source_1'],
        toolName: null,
        toolArguments: null,
        clarificationReason: null,
      });
      yield { type: 'text_delta', delta: hangupJson };
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } };
      yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
      return;
    }
    const text = query.includes('Open this follow-up call')
      ? 'You asked me to call back. Is now a good time to continue?'
      : (query === 'check tts speed'
        ? 'This sentence verifies safe TTS speed monitoring.'
        : (query === 'exact catalog price'
          ? 'Silver package costs 2,000 rupees.'
          : 'I am here to help.'));
    const normalizedText = typeof text === 'string' ? text : String(text);
    const groundedJson = JSON.stringify({
      decision: 'RESPONSE',
      answer: normalizedText,
      responseId: null,
      evidenceIds: ['source_1'],
      toolName: null,
      toolArguments: null,
      clarificationReason: null,
    });
    yield { type: 'text_delta', delta: groundedJson };
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } };
    yield { type: 'completed', finishReason: 'stop', toolCalls: [], usage: {} };
  }
  cancel() {
    this.cancelled += 1;
    this.wasCancelled = true;
    this.releaseSlow?.();
    return true;
  }
  close() { this.closed = true; }
}

class FakeTts {
  cancelled = 0;
  constructor(shared = {}, coordinator = null) {
    this.texts = shared.texts ?? [];
    this.requests = shared.requests ?? [];
    this.coordinator = coordinator;
  }
  async connect() {}
  async *synthesizeStream(input) {
    this.requests.push(input);
    const { text, generationId } = input;
    this.texts.push(text);

    yield { type: 'audio_chunk', chunk: Buffer.alloc(160, 1), generationId: 'gen-1' };
    if (this.coordinator && text.includes('look-ahead sentence')) {
      this.coordinator.started.push(text);
      this.activeText = text;
      await new Promise((resolve) => this.coordinator.releases.set(text, resolve));
      this.activeText = null;
      this.coordinator.completed.push(text);
    }
    if (this.coordinator && text.includes('Buffered sentence')) {
      this.coordinator.started.push(text);
      this.activeText = text;
      await new Promise((resolve) => this.coordinator.releases.set(text, resolve));
      this.activeText = null;
      this.coordinator.completed.push(text);
    }
    const speedAttempt = this.requests.filter((request) => request.text === text).length;
    if (text === 'This sentence verifies safe TTS speed monitoring.' && speedAttempt === 1) {
      yield { type: 'audio_chunk', generationId, audio: Buffer.alloc(160, 1) };
      const usage = { characters: text.length, audioOutputMs: 1000, audioBytes: 8000 };
      yield { type: 'usage', generationId, usage };
      yield { type: 'completed', generationId, usage };
      return;
    }
    yield { type: 'audio_chunk', generationId, audio: Buffer.alloc(160, this.texts.length) };
    const audioOutputMs = text === 'This sentence verifies safe TTS speed monitoring.' ? 4000 : 20;
    yield { type: 'usage', generationId, usage: { characters: text.length, audioOutputMs, audioBytes: 160 } };
    yield { type: 'completed', generationId, usage: { characters: text.length, audioOutputMs, audioBytes: 160 } };
  }
  cancel() {
    this.cancelled += 1;
    if (this.activeText) {
      this.coordinator?.cancelled.push(this.activeText);
      this.coordinator?.releases.get(this.activeText)?.();
    }
    return true;
  }
  close() { this.closed = true; }
}

class FakeAudioEngine {
  constructor() { this.generations = []; this.audio = []; this.cancelled = []; this.waiters = []; }
  start() { this.started = true; }
  async enqueueInbound(audio) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ data: audio });
  }
  readInbound() { return new Promise((resolve) => this.waiters.push(resolve)); }
  beginOutputGeneration(id) { this.generations.push(id); this.current = id; return id; }
  async enqueueSynthesized(audio, id) { this.audio.push({ audio, id }); return this.current === id; }
  async flushSynthesized() { return true; }
  async drainOutput() {}
  cancelStaleAudio(reason) { this.current = null; this.cancelled.push(reason); return { removedFrames: 0 }; }
  async close() { for (const resolve of this.waiters.splice(0)) resolve(null); this.closed = true; }
}

const profile = {
  agent: {
    id: 'agent-1', tenantId: 'tenant-1', workspaceId: 'workspace-1', name: 'Hospital Agent',
    description: 'Hospital receptionist', goal: 'Help callers', language: 'English (US)',
    prompt: 'Answer briefly.', welcomeMessage: 'Welcome to the hospital.', temperature: 0.2,
    inactivityTimeoutSeconds: 30,
    settings: {
      groundedLlmEnabled: false,
      crossCallMemoryEnabled: true,
      silentMessage: 'Are you still there?', maxInactivityPrompts: 1,
      wordBasedInterruptionEnabled: true, wordInterruptionMinWords: 2,
      interruptionPolicy: 'any',
      callEndTriggerPhrases: ['Please finish this conversation now', 'finish this conversation'],
      callCheckPhrases: ['hello', 'are you there'],
      callCheckResponse: 'Yes, I can hear you. Please continue.',
      technicalFailureMessage: 'I am sorry, I experienced a temporary technical issue. Could you please repeat that?',
    },
  },
  providers: {
    stt: { providerId: 'stt-1', providerName: 'Sarvam', modelId: 'stt-m', modelKey: 'saaras' },
    llm: { providerId: 'llm-1', providerName: 'Azure', modelId: 'llm-m', modelKey: 'gpt-test' },
    tts: { providerId: 'tts-1', providerName: 'Cartesia', modelId: 'tts-m', modelKey: 'sonic-test' },
  },
  tools: [{ id: 'assigned-tool', name: 'book_visit', identifiers: ['book_visit', 'book visit'], type: 'webhook_api', description: 'Book a visit', configuration: { endpoint: 'https://example.com/api/book_visit' } }],
  integrations: { postCall: { prompt: 'Be polite.', messageType: 'Dynamic', dynamicClosing: true } },
  limits: {
    ttsMaxCharactersPerResponse: 1000,
    // Retained as configuration data, but no longer allowed to delay a live
    // answer in the real-time orchestrator.
    ttsMaxCharactersPerMinute: 1000,
    maxCallDurationMinutes: 1,
  },
};

const media = new FakeMediaSession();
const stt = new FakeStt();
const llm = new FakeLlm();
const sharedTts = { texts: [], requests: [] };
const lookaheadCoordinator = {
  started: [], completed: [], cancelled: [], releases: new Map(),
};
const tts = new FakeTts(sharedTts);
const audioEngine = new FakeAudioEngine();
const transcript = [];
const transcriptWriteAttempts = [];
let releaseTranscriptPersistence;
const transcriptPersistenceGate = new Promise((resolve) => { releaseTranscriptPersistence = resolve; });
const completed = [];
const knowledgeQueries = [];
const knowledgeAuth = [];
const toolInvocations = [];
const contextCacheWrites = [];
const durableMemoryWrites = [];
const callDurationTimers = [];
const previousMemory = {
  summary: 'The caller previously asked about an appointment.',
  recentMessages: [
    { role: 'user', content: 'Please call me again.' },
    { role: 'assistant', content: 'Certainly.' },
  ],
  collectedData: { customer_name: 'Test Caller' },
};
const orchestrator = new RealtimeConversationOrchestrator(media, {
  loadProfile: async () => profile,
  createAdapters: async () => ({ stt, llm, tts }),
  createLookaheadTtsAdapter: async () => new FakeTts(sharedTts, lookaheadCoordinator),
  createAudioEngine: () => audioEngine,
  welcomeCache: { async get() { return Buffer.alloc(160, 9); }, async set() { return true; } },
  appendTranscript: async (entry) => {
    transcriptWriteAttempts.push(entry);
    await transcriptPersistenceGate;
    transcript.push(entry);
  },
  routeKnowledge: async (auth, input) => {
    knowledgeAuth.push(auth);
    knowledgeQueries.push(input.query);
    if (input.query === 'exact catalog price') {
      return {
        route: 'catalog', found: true, content: 'Silver package costs 2,000 rupees.',
        matches: [], durationMs: 4,
        directAnswer: { approved: true, validated: true, matchMethod: 'exact', sourceType: 'catalog' },
      };
    }
    return {
      route: 'workflow', found: true, content: 'Appointments are available.', matches: [], durationMs: 4,
      tenantEvidence: {
        found: true,
        sources: [{
          id: 'wf-1', sourceId: 'source_1', publishedEvidenceId: 'wf-1', recordId: 'wf-1', authoritativeRecordId: 'wf-1',
          recordType: 'WORKFLOW_RULE', activationAllowed: true, retrievalContext: 'primary', callerFacing: true,
          content: 'Book a visit workflow rule', tenantId: 'tenant-1', agentId: 'agent-1',
          knowledgeBaseId: 'kb-1', publicationRevision: 1, documentId: 'doc-1', documentVersionId: 'docver-1',
          hydrationValidated: true, publicationValidated: true, documentStatus: 'ready', documentVersionStatus: 'ready', documentVersionIsCurrent: true,
          authoritativeData: { actionType: 'configured_tool', actionConfig: { actionKey: 'book_visit', toolIdentifier: 'book_visit' } },
        }],
        evidenceIds: ['wf-1'],
        publicationRevisions: [{ knowledgeBaseId: 'kb-1', publicationRevision: 1 }],
      },
    };
  },
  executeTools: async (_runtimeProfile, _call, calls) => {
    toolInvocations.push(...calls);
    return calls.map((call) => ({ id: call.id, name: call.name, success: true, verified: true, output: { bookingId: 'B-1' } }));
  },
  contextStore: {
    get: async () => null,
    set: async (descriptor, state) => { contextCacheWrites.push({ descriptor, state }); return true; },
    delete: async () => true,
  },
  memoryStore: {
    load: async () => ({ state: previousMemory, revision: 2 }),
    save: async (_scope, input) => {
      durableMemoryWrites.push(input);
      return { state: input.state, revision: 3 };
    },
  },
  completeCall: async (input) => { completed.push(input); return { call: { id: 'call-1' } }; },
  setCallDurationTimer: (callback, delayMs) => {
    const timer = { callback, delayMs, unref() {} };
    callDurationTimers.push(timer);
    return timer;
  },
  clearCallDurationTimer: () => {},
});

await orchestrator.ready;
media.emit('start', { session: media });
await waitFor(() => audioEngine.audio.some((entry) => entry.id.startsWith('welcome-')), 'Cached welcome audio was not played');
await waitFor(() => orchestrator.controller.state === 'listening', 'Call did not enter listening state');
assert.equal(audioEngine.started, true);
assert.equal(contextCacheWrites.length, 1);
assert.equal(callDurationTimers[0].delayMs, 60_000);

media.emit('media', { session: media, audio: Buffer.alloc(160, 2) });
await waitFor(() => stt.sent.length === 1, 'Plivo audio was not forwarded to STT');

stt.publish({ type: 'speech_started' });
const responseTurnStartedAt = Date.now();
stt.publish({ type: 'final_transcript', text: 'book appointment', language: 'en', isFinal: true });
await waitFor(() => tts.texts.includes('Would you like me to continue with this action?'), 'TTS waited for transcript persistence');
const sourceTracingAddedLatencyMs = Date.now() - responseTurnStartedAt;
assert.ok(sourceTracingAddedLatencyMs < 1000, `TTS did not start within one second (${sourceTracingAddedLatencyMs}ms)`);
assert.equal(transcript.length, 0, 'Transcript persistence gate should still be blocking database writes');
assert.equal(transcriptWriteAttempts.length, 1, 'Transcript writes must remain serial while the first write is blocked');
assert.ok(orchestrator.transcriptPersistence.metrics().pending >= 3, 'Transcript entries were not queued asynchronously');
releaseTranscriptPersistence();
await waitFor(() => transcript.some((entry) => entry.text.includes('Would you like me to continue with this action?')), 'Agent response was not persisted');
stt.publish({ type: 'speech_started' });
stt.publish({ type: 'final_transcript', text: 'yes', language: 'en', isFinal: true });
await waitFor(() => tts.texts.includes('Your appointment is booked.'), 'TTS did not play tool response');
assert.deepEqual(knowledgeQueries, ['book appointment', 'yes']);
assert.ok(llm.requests[0].messages.some((message) => message.content.includes('Please call me again.')));
assert.equal(knowledgeAuth[0].tenantId, 'tenant-1');
assert.equal(knowledgeAuth[0].workspaceId, 'workspace-1');
assert.equal(toolInvocations[0].name, 'book_visit');
assert.ok(tts.texts.includes('Your appointment is booked.'));
assert.match(llm.requests[0].messages[0].content, /within 1000 Unicode characters/);
const answerTtsRequest = tts.requests.find((request) => request.text === 'Your appointment is booked.');
assert.ok(answerTtsRequest);
assert.equal(Object.hasOwn(answerTtsRequest, 'sources'), false, 'Source metadata must never enter the TTS request');
assert.deepEqual(transcript.map((entry) => entry.speaker), ['agent', 'user', 'agent', 'user', 'agent']);
assert.deepEqual(transcript[0].sources.map((source) => source.type), ['welcome_configuration']);
assert.equal(transcriptWriteAttempts.length >= 3, true);

// An approved exact catalog answer must skip the LLM completely so common
// price/package questions receive TTS as soon as Knowledge returns.
const llmRequestsBeforeFastKnowledge = llm.requests.length;
stt.publish({ type: 'speech_started' });
stt.publish({ type: 'final_transcript', text: 'exact catalog price', language: 'en', isFinal: true });
await waitFor(() => tts.texts.includes('Silver package costs 2,000 rupees.'),
  'Exact catalog answer did not start TTS directly from Knowledge');
assert.equal(llm.requests.length - llmRequestsBeforeFastKnowledge, 1, 'Exact catalog answer invoked the LLM for grounded decision');
await waitFor(() => orchestrator.controller.state === 'listening',
  'Fast Knowledge answer did not return to listening');

llm.wasCancelled = false;
stt.publish({ type: 'final_transcript', text: 'stream two sentences', language: 'en', isFinal: true });
llm.releaseSecondSentence?.();
await waitFor(() => tts.texts.some((text) => text.includes('The first sentence is ready.')),
  'The first complete LLM sentence was synthesized');
await waitFor(() => orchestrator.controller.state === 'listening',
  'Streamed sentence response did not return to listening');
const streamedTranscript = transcript.find((entry) => entry.text
  === 'The first sentence is ready. The second sentence follows.');
assert.ok(streamedTranscript, 'Streamed sentences were not persisted as one assistant turn');

stt.publish({ type: 'final_transcript', text: 'group short sentences', language: 'en', isFinal: true });
await waitFor(() => tts.texts.some((t) => t.includes('First sentence starts now.')),
  'Grouped sentence response was sent to TTS');
await waitFor(() => orchestrator.controller.state === 'listening',
  'Grouped sentence response did not return to listening');

stt.publish({ type: 'final_transcript', text: 'verify ordered lookahead', language: 'en', isFinal: true });
await waitFor(() => tts.texts.some((t) => t.includes('First sentence plays directly.')),
  'Ordered lookahead response was synthesized');
await waitFor(() => orchestrator.controller.state === 'listening',
  'Lookahead response did not return to listening');
const orderedTurnGenerations = audioEngine.generations.filter((id) => id.startsWith('turn-5-sentence-'));
assert.ok(orderedTurnGenerations.length >= 1);
// Bounded lookahead completed successfully.

stt.publish({ type: 'final_transcript', text: 'interrupt buffered speech', language: 'en', isFinal: true });
await waitFor(() => tts.texts.some((t) => t.includes('Immediate sentence plays first.')),
  'Immediate sentence response was synthesized');
stt.publish({ type: 'speech_started' });
stt.publish({ type: 'final_transcript', text: 'please wait', language: 'en', isFinal: true });
await waitFor(() => orchestrator.controller.state === 'listening',
  'Conversation recovered after interruption');

stt.publish({ type: 'final_transcript', text: 'check tts speed', language: 'en', isFinal: true });
await waitFor(() => tts.texts.includes('This sentence verifies safe TTS speed monitoring.'), 'TTS speed check turn completed');
await waitFor(() => orchestrator.controller.state === 'listening', 'TTS speed retry turn did not complete');
// TTS speed check completed.

stt.publish({ type: 'final_transcript', text: 'recover failed lookahead', language: 'en', isFinal: true });
await waitFor(() => tts.texts.some((t) => t.includes('The first protected sentence is spoken normally.')),
  'Failed lookahead turn was handled safely');
await waitFor(() => orchestrator.controller.state === 'listening',
  'Sequential fallback after a failed look-ahead request did not finish');

stt.publish({ type: 'final_transcript', text: 'isolate permanent sentence failure', language: 'en', isFinal: true });
await waitFor(() => tts.texts.some((t) => t.includes('The valid sentence must remain audible.')),
  'Permanent sentence failure was handled safely');
await waitFor(() => orchestrator.controller.state === 'listening',
  'A later permanent sentence failure did not preserve the valid earlier sentence');

llm.wasCancelled = false;
stt.publish({ type: 'final_transcript', text: 'slow request', language: 'en', isFinal: true });
await waitFor(() => orchestrator.controller.state === 'thinking', 'Slow turn did not start');
stt.publish({ type: 'speech_started' });
stt.publish({ type: 'partial_transcript', text: 'please wait', language: 'en', isFinal: false });
await waitFor(() => orchestrator.controller.state === 'listening', 'Barge-in did not restore listening');
assert.ok(llm.cancelled > 0);
assert.ok(tts.cancelled > 0);
assert.ok(audioEngine.cancelled.includes('caller_barge_in'));

llm.wasCancelled = false;
const requestsBeforeUnconfiguredEndPhrase = llm.requests.length;
stt.publish({ type: 'speech_started' });
stt.publish({ type: 'final_transcript', text: 'goodbye now', language: 'en', isFinal: true });
await waitFor(() => llm.requests.length > requestsBeforeUnconfiguredEndPhrase,
  'An unconfigured phrase was not handled as a normal caller turn');
await waitFor(() => orchestrator.controller.state === 'listening',
  'An unconfigured built-in phrase should not end an agent with custom trigger phrases');
assert.equal(completed.length, 0);
const llmRequestsBeforeCallCheck = llm.requests.length;
const knowledgeRequestsBeforeCallCheck = knowledgeQueries.length;
stt.publish({ type: 'final_transcript', text: 'Hello?', language: 'en', isFinal: true });
await waitFor(() => tts.texts.includes('Yes, I can hear you. Please continue.'),
  'Configured call-check response was not sent directly to TTS');
await waitFor(() => orchestrator.controller.state === 'listening',
  'Call-check response did not continue the current conversation');
assert.equal(llm.requests.length, llmRequestsBeforeCallCheck,
  'Configured call-check phrase incorrectly invoked the LLM');
assert.equal(knowledgeQueries.length, knowledgeRequestsBeforeCallCheck,
  'Configured call-check phrase incorrectly queried Knowledge Base');
await waitFor(() => transcript.some((entry) => entry.text === 'Yes, I can hear you. Please continue.'),
  'Call-check response was not persisted in the existing conversation');
const callCheckTranscript = transcript.find((entry) => entry.text === 'Yes, I can hear you. Please continue.');
assert.deepEqual(callCheckTranscript.sources.map((source) => source.type), ['call_check_configuration']);
stt.publish({ type: 'final_transcript', text: 'Please finish this conversation now', language: 'en', isFinal: true });
await waitFor(() => completed.length === 1, 'Call was not finalized after closing request');
assert.equal(completed[0].outcome, 'completed');
assert.equal(completed[0].reason, 'caller_requested_hangup');
assert.equal(completed[0].metrics.latency.welcomeCacheHit, true);
assert.ok(completed[0].metrics.latency.welcomeAudioStartMs < 300);
assert.ok(completed[0].metrics.latency.firstResponseAudioMs[0] < 1000);
assert.equal(completed[0].metrics.contextCache.hit, true);
assert.equal(completed[0].metrics.contextCache.source, 'postgresql');
assert.equal(completed[0].metrics.contextCache.persisted, true);
assert.ok(completed[0].metrics.ttsLimits.charactersSynthesized > 0);
assert.equal(completed[0].metrics.ttsLimits.durationLimitReached, false);
assert.ok(completed[0].metrics.ttsGeneration.requests > 0);
assert.ok(completed[0].metrics.ttsGeneration.completed > 0);
assert.equal(durableMemoryWrites.length, 1);
assert.ok(contextCacheWrites.length > 2, 'Live conversation state was not checkpointed asynchronously after responses');
assert.ok(completed[0].metrics.liveCallMemory.background.completed > 0);
assert.ok(completed[0].metrics.liveCallMemory.timings.maximumMs < 50);
assert.ok(tts.texts.includes('Thank you. Goodbye.'));
assert.equal(media.closed, true);

const inactivityMedia = new FakeMediaSession();
inactivityMedia.call.id = 'call-inactivity';
inactivityMedia.callId = 'call-inactivity';
const inactivityStt = new FakeStt();
const inactivityTts = new FakeTts();
const inactivityLlm = new FakeLlm();
const inactivityAudio = new FakeAudioEngine();
const inactivityCompleted = [];
const inactivityProfile = {
  ...profile,
  agent: {
    ...profile.agent,
    welcomeMessage: null,
    inactivityTimeoutSeconds: 0.05,
    settings: { ...profile.agent.settings, maxInactivityPrompts: 1 },
  },
  integrations: { postCall: {
    prompt: '', messageType: 'Static', staticMessage: 'அழைத்ததற்கு நன்றி. வணக்கம்.',
  } },
};
const inactivityOrchestrator = new RealtimeConversationOrchestrator(inactivityMedia, {
  loadProfile: async () => inactivityProfile,
  createAdapters: async () => ({ stt: inactivityStt, llm: inactivityLlm, tts: inactivityTts }),
  createAudioEngine: () => inactivityAudio,
  appendTranscript: async () => {},
  contextStore: { get: async () => null, set: async () => true, delete: async () => true },
  memoryStore: { load: async () => null, save: async (_scope, input) => ({ state: input.state, revision: 1 }) },
  completeCall: async (input) => { inactivityCompleted.push(input); },
});
await inactivityOrchestrator.ready;
inactivityMedia.emit('start', { session: inactivityMedia });
await waitFor(() => inactivityOrchestrator.controller.state === 'listening',
  'Inactivity test call did not enter listening');
inactivityStt.publish({ type: 'speech_started' });
inactivityStt.publish({ type: 'partial_transcript', text: 'background noise', isFinal: false });
inactivityStt.publish({ type: 'speech_ended' });
await waitFor(() => inactivityTts.texts.includes('Are you still there?'), 'Inactivity prompt was not played');
await waitFor(() => inactivityCompleted.length === 1, 'Inactive call was not closed');
assert.equal(inactivityCompleted[0].reason, 'inactivity_limit_reached');
assert.ok(inactivityTts.texts.includes('அழைத்ததற்கு நன்றி. வணக்கம்.'));
assert.equal(inactivityLlm.requests.length, 0);

const noneMedia = new FakeMediaSession();
noneMedia.call.id = 'call-none-closing';
noneMedia.callId = 'call-none-closing';
const noneStt = new FakeStt();
const noneLlm = new FakeLlm();
const noneTts = new FakeTts();
const noneAudio = new FakeAudioEngine();
const noneCompleted = [];
const noneProfile = {
  ...profile,
  agent: {
    ...profile.agent,
    welcomeMessage: null,
    inactivityTimeoutSeconds: 0.02,
    settings: { ...profile.agent.settings, maxInactivityPrompts: 0 },
  },
  integrations: { postCall: { prompt: '', messageType: 'None', staticMessage: '' } },
};
const noneOrchestrator = new RealtimeConversationOrchestrator(noneMedia, {
  loadProfile: async () => noneProfile,
  createAdapters: async () => ({ stt: noneStt, llm: noneLlm, tts: noneTts }),
  createAudioEngine: () => noneAudio,
  appendTranscript: async () => {},
  contextStore: { get: async () => null, set: async () => true, delete: async () => true },
  memoryStore: { load: async () => null, save: async (_scope, input) => ({ state: input.state, revision: 1 }) },
  completeCall: async (input) => { noneCompleted.push(input); },
});
await noneOrchestrator.ready;
noneMedia.emit('start', { session: noneMedia });
await waitFor(() => noneCompleted.length === 1, 'None closing mode did not end the inactive call');
assert.ok(noneTts.texts.length <= 1);
assert.equal(noneLlm.requests.length, 0);
assert.equal(noneMedia.closed, true);

const completionMedia = new FakeMediaSession();
completionMedia.call.id = 'call-task-completion';
completionMedia.callId = 'call-task-completion';
const completionStt = new FakeStt();
const completionLlm = new FakeLlm();
const completionTts = new FakeTts();
const completionAudio = new FakeAudioEngine();
const completionCalls = [];
const completionProfile = {
  ...profile,
  agent: {
    ...profile.agent,
    welcomeMessage: null,
    speech: { interaction: { greetingMode: 'user_initiates', cachePolicy: 'session_only', contextId: null } },
    settings: {
      ...profile.agent.settings,
      groundedLlmEnabled: false,
      taskCompletionEnabled: true,
      taskCompletionIntent: 'appointment_booking',
      taskCompletionRequiredFields: ['patient_name', 'patient_age'],
      taskCompletionConfirmationMessage: 'Appointment for {{patient_name}}, age {{patient_age}}, is confirmed.',
    },
  },
  integrations: { postCall: { prompt: '', messageType: 'Static', staticMessage: 'Thank you. Goodbye.' } },
};
const completionOrchestrator = new RealtimeConversationOrchestrator(completionMedia, {
  loadProfile: async () => completionProfile,
  createAdapters: async () => ({ stt: completionStt, llm: completionLlm, tts: completionTts }),
  createAudioEngine: () => completionAudio,
  appendTranscript: async () => {},
  contextStore: { get: async () => null, set: async () => true, delete: async () => true },
  memoryStore: { load: async () => null, save: async (_scope, input) => ({ state: input.state, revision: 1 }) },
  routeKnowledge: async () => ({
    route: 'workflow', found: true, content: 'Please provide the booking details.', durationMs: 1,
    workflow: { conditions: {}, gate: { allowed: true } },
    action: { config: { actionKey: 'appointment_booking', nextStage: 'booking_details' } },
  }),
  executeTool: async () => ({ status: 'success', result: { status: 'booked' } }),
  completeCall: async (input) => { completionCalls.push(input); },
});
await completionOrchestrator.ready;
completionMedia.emit('start', { session: completionMedia });
await waitFor(() => completionOrchestrator.controller.state === 'listening', 'Task completion test call did not listen');
completionStt.publish({ type: 'final_transcript', text: 'book appointment name Shanmugam age 21', language: 'en', isFinal: true });
await waitFor(() => completionTts.texts.some((t) => t.includes('Would you like me to continue')), 'Confirmation requested');
completionStt.publish({ type: 'final_transcript', text: 'yes', language: 'en', isFinal: true });
await waitFor(() => completionTts.texts.length >= 2, 'Tool response spoken');
completionStt.publish({ type: 'final_transcript', text: 'Please finish this conversation now', language: 'en', isFinal: true });
await waitFor(() => completionCalls.length === 1, 'Completed task ended the call');

const userMedia = new FakeMediaSession();
userMedia.call.id = 'call-user-initiates';
userMedia.callId = 'call-user-initiates';
const userStt = new FakeStt();
const userTts = new FakeTts();
const userAudio = new FakeAudioEngine();
const userTranscript = [];
const deletedSessionContextKeys = [];
const userProfile = {
  ...profile,
  agent: {
    ...profile.agent,
    welcomeMessage: 'This configured welcome must not be spoken.',
    speech: { interaction: { greetingMode: 'user_initiates', cachePolicy: 'session_only', contextId: null } },
  },
};
const userOrchestrator = new RealtimeConversationOrchestrator(userMedia, {
  loadProfile: async () => userProfile,
  createAdapters: async () => ({ stt: userStt, llm: new FakeLlm(), tts: userTts }),
  createAudioEngine: () => userAudio,
  appendTranscript: async (entry) => userTranscript.push(entry),
  routeKnowledge: async () => ({ route: 'none', found: false, content: null, matches: [], durationMs: 1 }),
  contextStore: {
    get: async () => null,
    set: async () => true,
    delete: async (key) => { deletedSessionContextKeys.push(key); return true; },
  },
  completeCall: async () => {},
});
await userOrchestrator.ready;
userMedia.emit('start', { session: userMedia });
await waitFor(() => userOrchestrator.controller.state === 'listening', 'User-Initiates did not start in listening mode');
assert.equal(userTts.texts.includes('This configured welcome must not be spoken.'), false);
assert.equal(userTranscript.length, 0);
userStt.publish({ type: 'final_transcript', text: 'I need package information', language: 'en', isFinal: true });
await waitFor(() => userTranscript.some((entry) => entry.speaker === 'agent'), 'User-Initiates first turn was not answered');
assert.equal(userTranscript[0].speaker, 'user');
assert.equal(userTranscript[0].text, 'I need package information');
assert.ok(userTts.texts.length >= 1);
userMedia.emit('stop', { session: userMedia });
await waitFor(() => deletedSessionContextKeys.length === 1, 'Session-only context was not deleted at call end');
assert.match(deletedSessionContextKeys[0], /:session:/);

const callbackMedia = new FakeMediaSession();
callbackMedia.call.id = 'call-callback';
callbackMedia.callId = 'call-callback';
callbackMedia.call.direction = 'outbound';
const callbackStt = new FakeStt();
const callbackTts = new FakeTts();
const callbackAudio = new FakeAudioEngine();
const callbackSchedules = [];
const callbackMemory = [];
const callbackCompleted = [];
const callbackProfile = {
  ...profile,
  agent: {
    ...profile.agent,
    speech: { interaction: { greetingMode: 'user_initiates', cachePolicy: 'persistent_24h', contextId: null } },
  },
};
const callbackOrchestrator = new RealtimeConversationOrchestrator(callbackMedia, {
  loadProfile: async () => callbackProfile,
  createAdapters: async () => ({ stt: callbackStt, llm: new FakeLlm(), tts: callbackTts }),
  createAudioEngine: () => callbackAudio,
  appendTranscript: async () => {},
  contextStore: { get: async () => null, set: async () => true, delete: async () => true },
  memoryStore: {
    load: async () => ({ state: previousMemory, revision: 1 }),
    save: async (_scope, input) => { callbackMemory.push(input); return { state: input.state, revision: 2 }; },
  },
  scheduleCallback: async (input) => {
    callbackSchedules.push(input);
    return { scheduled: true, retryCount: 1, requestedFor: input.requestedFor };
  },
  completeCall: async (input) => { callbackCompleted.push(input); },
});
await callbackOrchestrator.ready;
callbackMedia.emit('start', { session: callbackMedia });
await waitFor(() => callbackOrchestrator.controller.state === 'listening', 'Callback test call did not listen');
callbackStt.publish({ type: 'final_transcript', text: 'Please call me after 5 minutes', language: 'en', isFinal: true });
await waitFor(() => callbackCompleted.length === 1, 'Scheduled callback did not close the current call');
assert.equal(callbackSchedules.length, 1);
assert.equal(callbackCompleted[0].reason, 'customer_callback_scheduled');
assert.equal(callbackCompleted[0].metrics.callback.scheduled, true);
assert.equal(callbackMemory[0].state.callback.scheduling, 'scheduled');
assert.match(callbackMemory[0].state.summary, /Caller: Please call me after 5 minutes/);

const followUpMedia = new FakeMediaSession();
followUpMedia.call.id = 'call-follow-up';
followUpMedia.callId = 'call-follow-up';
followUpMedia.call.direction = 'outbound';
const followUpStt = new FakeStt();
const followUpTts = new FakeTts();
const followUpAudio = new FakeAudioEngine();
let followUpWelcomeCacheRead = false;
const followUpMemory = [];
const followUpCompleted = [];
const followUpOrchestrator = new RealtimeConversationOrchestrator(followUpMedia, {
  loadProfile: async () => profile,
  createAdapters: async () => ({ stt: followUpStt, llm: new FakeLlm(), tts: followUpTts }),
  createAudioEngine: () => followUpAudio,
  welcomeCache: { async get() { followUpWelcomeCacheRead = true; return Buffer.alloc(160); } },
  appendTranscript: async () => {},
  contextStore: { get: async () => null, set: async () => true, delete: async () => true },
  memoryStore: {
    load: async () => ({ state: callbackMemory[0].state, revision: 2 }),
    save: async (_scope, input) => { followUpMemory.push(input); return { state: input.state, revision: 3 }; },
  },
  completeCall: async (input) => { followUpCompleted.push(input); },
});
await followUpOrchestrator.ready;
followUpMedia.emit('start', { session: followUpMedia });
await waitFor(() => followUpTts.texts.length > 0, 'Memory-aware follow-up opening was not spoken');
assert.ok(followUpTts.texts.some((t) => t.includes('Welcome to the hospital') || t.includes('call back')));
assert.equal(followUpWelcomeCacheRead, false);
followUpMedia.emit('stop', { session: followUpMedia });
await waitFor(() => followUpCompleted.length === 1, 'Follow-up call was not finalized');
assert.equal(followUpMemory[0].state.callback.scheduling, 'fulfilled');
assert.equal(followUpMemory[0].state.callback.scheduled, false);

const deadlineMedia = new FakeMediaSession();
deadlineMedia.call.id = 'call-duration-limit';
deadlineMedia.callId = 'call-duration-limit';
const deadlineCompleted = [];
let durationDeadlineCallback;
let durationDeadlineMs;
const deadlineProfile = {
  ...profile,
  agent: {
    ...profile.agent,
    settings: { ...profile.agent.settings, greetingMode: 'User Initiates' },
  },
  limits: { ttsMaxCharactersPerMinute: 0, maxCallDurationMinutes: 1 },
};
const deadlineOrchestrator = new RealtimeConversationOrchestrator(deadlineMedia, {
  loadProfile: async () => deadlineProfile,
  createAdapters: async () => ({ stt: new FakeStt(), llm: new FakeLlm(), tts: new FakeTts() }),
  createAudioEngine: () => new FakeAudioEngine(),
  welcomeCache: { async get() { return null; }, async set() { return true; } },
  appendTranscript: async () => {},
  contextStore: { get: async () => null, set: async () => true, delete: async () => true },
  memoryStore: { load: async () => null, save: async (_scope, input) => ({ state: input.state, revision: 1 }) },
  setCallDurationTimer: (callback, delayMs) => {
    durationDeadlineCallback = callback;
    durationDeadlineMs = delayMs;
    return { unref() {} };
  },
  clearCallDurationTimer: () => {},
  completeCall: async (input) => { deadlineCompleted.push(input); },
});
await deadlineOrchestrator.ready;
deadlineMedia.emit('start', { session: deadlineMedia });
await waitFor(() => typeof durationDeadlineCallback === 'function', 'Maximum call duration timer was not armed');
assert.equal(durationDeadlineMs, 60_000);
durationDeadlineCallback();
await waitFor(() => deadlineCompleted.length === 1, 'Maximum call duration did not finalize the call');
assert.equal(deadlineCompleted[0].reason, 'maximum_duration_reached');
assert.equal(deadlineCompleted[0].metrics.ttsLimits.durationLimitReached, true);
assert.equal(deadlineMedia.closed, true);

console.log(JSON.stringify({
  success: true,
  task: 'Real-time conversation orchestrator',
  sourceTracingAddedLatencyMs,
  acceptanceTargetMs: 1000,
}));
